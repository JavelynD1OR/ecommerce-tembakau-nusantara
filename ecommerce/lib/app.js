/**
 * TOKO NUSANTARA TOBACCO - BACKEND (Express + Turso/libSQL) - versi VERCEL
 * Pembayaran NYATA: Midtrans Snap + webhook terverifikasi.
 *
 * Perbedaan dengan versi lokal (server.js lama):
 *  - Database: Turso (SQLite hosted) lewat lib/db.js, semua query async.
 *  - Tidak ada setInterval: pembersihan pesanan kedaluwarsa dijalankan oleh Vercel Cron
 *    (/api/cron/sweep) dan juga "malas" saat daftar produk dibuka.
 *  - Foto produk yang diunggah admin disimpan di tabel `uploads` (disk Vercel tidak permanen).
 *  - Notifikasi Telegram & pembatalan ke Midtrans di-await (proses serverless dibekukan setelah respons).
 *
 * Alur pembayaran tetap sama: status Lunas HANYA dari Midtrans (webhook bertanda-tangan + cek ulang API).
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const db = require('./db');

const ROOT = path.join(__dirname, '..');
const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const STORE_WA = (process.env.STORE_WHATSAPP || '6281234567890').replace(/\D/g, '');
const PAYMENT_WINDOW_MINUTES = Number(process.env.PAYMENT_WINDOW_MINUTES) || 180;
const AUTO_COMPLETE_DAYS = Math.max(1, Number(process.env.AUTO_COMPLETE_DAYS) || 7);

// ------------------------------------------------------------------
// KONFIGURASI
// ------------------------------------------------------------------
function configProblems() {
  const p = [];
  if (IS_PROD) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) p.push('JWT_SECRET (minimal 24 karakter)');
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123') p.push('ADMIN_PASSWORD (kuat, bukan admin123)');
    if (!(process.env.TURSO_DATABASE_URL || '').trim()) p.push('TURSO_DATABASE_URL');
    if (!(process.env.TURSO_AUTH_TOKEN || '').trim()) p.push('TURSO_AUTH_TOKEN');
  }
  return p;
}

let devSecret = null;
function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 24) return process.env.JWT_SECRET;
  if (IS_PROD) throw new Error('JWT_SECRET belum diisi di Environment Variables.');
  if (!devSecret) {
    devSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[dev] JWT_SECRET acak dibuat sementara (login hilang saat server restart). Isi JWT_SECRET di .env.');
  }
  return devSecret;
}

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
let adminHash = null;
function getAdminHash() {
  if (!adminHash) {
    let pw = process.env.ADMIN_PASSWORD;
    if (!pw || pw === 'admin123') {
      if (IS_PROD) throw new Error('ADMIN_PASSWORD belum diisi dengan password kuat di Environment Variables.');
      pw = pw || 'admin123';
      console.warn('[dev] Memakai password admin bawaan "admin123". JANGAN dipakai di server online.');
    }
    adminHash = bcrypt.hashSync(pw, 10);
  }
  return adminHash;
}

// ------------------------------------------------------------------
// MIDTRANS
// ------------------------------------------------------------------
const MT_SERVER_KEY = (process.env.MIDTRANS_SERVER_KEY || '').trim();
const MT_CLIENT_KEY = (process.env.MIDTRANS_CLIENT_KEY || '').trim();
const MT_PROD = String(process.env.MIDTRANS_IS_PRODUCTION).toLowerCase() === 'true';
const MT_SNAP_BASE = MT_PROD ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
const MT_API_BASE = MT_PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';

// 'midtrans' = pembayaran sungguhan | 'mock' = simulasi lokal (HANYA di luar produksi) | 'disabled'
let PAYMENT_MODE = 'disabled';
if (MT_SERVER_KEY && MT_CLIENT_KEY) PAYMENT_MODE = 'midtrans';
else if (!IS_PROD) PAYMENT_MODE = 'mock';

if (PAYMENT_MODE === 'midtrans') {
  if (MT_PROD && /^SB-/.test(MT_SERVER_KEY)) {
    console.error('KONFIGURASI SALAH: MIDTRANS_IS_PRODUCTION=true tetapi Server Key berawalan "SB-" (kunci Sandbox). Pembayaran dinonaktifkan.');
    PAYMENT_MODE = 'disabled';
  } else {
    console.log(`[pembayaran] Midtrans ${MT_PROD ? 'PRODUKSI (uang sungguhan)' : 'SANDBOX (uji coba)'} aktif.`);
  }
} else if (PAYMENT_MODE === 'mock') {
  console.warn('[pembayaran] MODE SIMULASI: kunci Midtrans belum diisi. TIDAK ada uang masuk.');
} else {
  console.error('[pembayaran] NONAKTIF: isi MIDTRANS_SERVER_KEY & MIDTRANS_CLIENT_KEY.');
}

async function midtransRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(MT_SERVER_KEY + ':').toString('base64')
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { httpStatus: res.status, json };
}

// ------------------------------------------------------------------
// UTILITAS
// ------------------------------------------------------------------
const COURIERS = {
  'JD Express': 3500,
  'J&T Express': 5500,
  'Ambil di Toko': 0
};

const PAYMENT_METHODS = {
  qris:       { label: 'QRIS',                       enabled: ['other_qris'] },
  gopay:      { label: 'GoPay',                      enabled: ['gopay'] },
  shopeepay:  { label: 'ShopeePay',                  enabled: ['shopeepay'] },
  dana:       { label: 'DANA',                       enabled: ['dana'] },
  va_bca:     { label: 'Transfer BCA (VA)',          enabled: ['bca_va'] },
  va_bni:     { label: 'Transfer BNI (VA)',          enabled: ['bni_va'] },
  va_bri:     { label: 'Transfer BRI (VA)',          enabled: ['bri_va'] },
  va_mandiri: { label: 'Transfer Mandiri (Bill)',    enabled: ['echannel'] },
  va_permata: { label: 'Transfer Permata (VA)',      enabled: ['permata_va'] },
  semua:      { label: 'Metode lain (pilih di popup)', enabled: null }
};

const CANCEL_REASONS = {
  salah_produk: 'Salah memilih produk / ingin mengubah isi pesanan',
  ubah_alamat: 'Ingin mengubah alamat pengiriman',
  gagal_bayar: 'Kesulitan / gagal melakukan pembayaran',
  harga_lebih_murah: 'Menemukan harga yang lebih murah',
  ongkir_mahal: 'Ongkos kirim terlalu mahal',
  berubah_pikiran: 'Berubah pikiran / tidak jadi membeli',
  pesanan_ganda: 'Salah membuat pesanan / pesanan ganda',
  kirim_lama: 'Estimasi pengiriman terlalu lama',
  lainnya: 'Lainnya'
};

const rupiah = n => 'Rp' + Number(n).toLocaleString('id-ID');
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function cleanText(v, max = 300) {
  return String(v == null ? '' : v).replace(/[<>`]/g, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);
}

function newInvoice() {
  const d = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, ''); // tanggal WIB
  return `INV-${d}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function publicOrder(o) {
  if (!o) return o;
  const { midtrans_token, midtrans_redirect_url, stock_restored, midtrans_transaction_id, midtrans_order_id, ...safe } = o;
  if (safe.status === 'Dikirim' && safe.shipped_at) {
    safe.auto_complete_at = new Date(new Date(safe.shipped_at.replace(' ', 'T') + 'Z').getTime() + AUTO_COMPLETE_DAYS * 86400000).toISOString();
  }
  return safe;
}

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function signUserToken(user) {
  return jwt.sign({ sub: user.id, role: 'user' }, getJwtSecret(), { expiresIn: '7d' });
}
function publicUser(u) {
  return { id: u.id, nama: u.nama, email: u.email, no_hp: u.no_hp, alamat: u.alamat, avatar: u.avatar };
}
function readToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function verify(token, role) {
  try {
    const p = jwt.verify(token, getJwtSecret());
    return p.role === role ? p : null;
  } catch (e) { return null; }
}
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
  console.error('[error]', req.method, req.originalUrl, e);
  if (!res.headersSent) res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
});
const requireUser = ah(async (req, res, next) => {
  const p = verify(readToken(req), 'user');
  if (!p) return res.status(401).json({ success: false, message: 'Sesi login berakhir. Silakan masuk kembali.' });
  const user = await db.get('SELECT * FROM users WHERE id = ?', [p.sub]);
  if (!user) return res.status(401).json({ success: false, message: 'Akun tidak ditemukan.' });
  req.user = user;
  next();
});
function isAdminReq(req) {
  return !!verify(req.headers['x-admin-token'], 'admin');
}
function requireAdmin(req, res, next) {
  if (isAdminReq(req)) return next();
  return res.status(401).json({ success: false, message: 'Akses ditolak. Silakan login admin kembali.' });
}

/** Pembatas laju berbasis database (fixed window). Gagal-buka: bila DB error, request tetap lewat. */
function dbLimiter({ name, windowMs, limit, message }) {
  return async (req, res, next) => {
    try {
      const key = `${name}:${req.ip || 'x'}`;
      const w = Math.floor(Date.now() / windowMs) * windowMs;
      await db.run('INSERT INTO rate_limits (k, w, c) VALUES (?, ?, 1) ON CONFLICT(k, w) DO UPDATE SET c = c + 1', [key, w]);
      const row = await db.get('SELECT c FROM rate_limits WHERE k = ? AND w = ?', [key, w]);
      if (row && row.c > limit) return res.status(429).json({ success: false, message });
    } catch (e) { console.error('[ratelimit]', e.message); }
    next();
  };
}
const authLimiter = dbLimiter({ name: 'auth', windowMs: 15 * 60 * 1000, limit: 15, message: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
const orderLimiter = dbLimiter({ name: 'order', windowMs: 60 * 60 * 1000, limit: 30, message: 'Terlalu banyak pesanan dibuat. Coba lagi nanti.' });

// ------------------------------------------------------------------
// NOTIFIKASI TELEGRAM (di-await agar tidak terpotong saat fungsi dibekukan)
// ------------------------------------------------------------------
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
async function notifyAdmin(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: String(text).slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) console.error('[notifikasi] Telegram menolak:', r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error('[notifikasi] gagal kirim Telegram:', e.message); }
}
function orderSummary(o) {
  let items = '';
  try { items = JSON.parse(o.items_json).map(i => `- ${i.nama} x${i.qty}`).join('\n'); } catch (e) { }
  return `${o.no_invoice}\nPenerima: ${o.nama_pelanggan} (${o.no_hp})\n${items}\nKurir: ${o.kurir}\nTotal: Rp${Number(o.total_bayar).toLocaleString('id-ID')}\nAlamat: ${o.alamat}`;
}

// ------------------------------------------------------------------
// LOGIKA PEMBAYARAN & STOK
// ------------------------------------------------------------------
/** Kembalikan stok pesanan satu kali saja (di dalam transaksi `t`). */
async function restockOrder(t, order) {
  const fresh = await t.get('SELECT stock_restored, items_json FROM orders WHERE id = ?', [order.id]);
  if (!fresh || fresh.stock_restored) return;
  for (const it of JSON.parse(fresh.items_json)) {
    await t.run('UPDATE products SET stok = stok + ? WHERE id = ?', [it.qty, it.id]);
  }
  await t.run('UPDATE orders SET stock_restored = 1 WHERE id = ?', [order.id]);
}

function paymentLabel(type, fallback) {
  const map = {
    qris: 'QRIS', gopay: 'GoPay', shopeepay: 'ShopeePay', dana: 'DANA',
    bank_transfer: 'Transfer Bank (VA)', echannel: 'Mandiri Bill', cstore: 'Minimarket',
    credit_card: 'Kartu Kredit', akulaku: 'Akulaku', kredivo: 'Kredivo'
  };
  return map[type] || fallback || type || 'Midtrans';
}

/**
 * Terapkan status transaksi Midtrans ke pesanan. Idempoten.
 * `tx` = objek status dari API Midtrans (bukan body webhook mentah).
 */
async function applyMidtransStatus(tx) {
  let notifyText = null;
  const result = await db.tx(async (t) => {
    const attempt = await t.get('SELECT order_id FROM midtrans_attempts WHERE mt_order_id = ?', [tx.order_id]);
    const order = attempt
      ? await t.get('SELECT * FROM orders WHERE id = ?', [attempt.order_id])
      : await t.get('SELECT * FROM orders WHERE no_invoice = ?', [tx.order_id]);
    if (!order) return { applied: false, reason: 'order tidak ditemukan' };
    const isCurrentAttempt = !order.midtrans_order_id || order.midtrans_order_id === tx.order_id;

    if (tx.gross_amount != null && Math.round(Number(tx.gross_amount)) !== Number(order.total_bayar)) {
      console.error(`[pembayaran] NOMINAL TIDAK COCOK untuk ${order.no_invoice}: Midtrans=${tx.gross_amount} sistem=${order.total_bayar}`);
      return { applied: false, reason: 'nominal tidak cocok' };
    }

    const ts = tx.transaction_status;
    const fraud = tx.fraud_status;
    const paymentType = tx.payment_type || order.payment_type || '';
    const txId = tx.transaction_id || order.midtrans_transaction_id || '';

    const isPaid = ts === 'settlement' || (ts === 'capture' && (!fraud || fraud === 'accept'));
    const isDead = ['deny', 'cancel', 'expire', 'failure'].includes(ts);
    const isRefund = ['refund', 'partial_refund', 'chargeback', 'partial_chargeback'].includes(ts);

    if (isPaid) {
      if (order.payment_status === 'paid') return { applied: false, reason: 'sudah lunas' };
      await t.run(`UPDATE orders SET payment_status='paid', payment_type=?, midtrans_transaction_id=?, paid_at=?,
                  status = CASE WHEN status IN ('Menunggu Pembayaran','Kedaluwarsa','Dibatalkan') THEN 'Diproses' ELSE status END,
                  metode_bayar = ? WHERE id = ?`,
        [paymentType, txId, nowSql(), paymentLabel(paymentType, order.metode_bayar), order.id]);
      if (order.stock_restored) {
        for (const it of JSON.parse(order.items_json)) {
          await t.run('UPDATE products SET stok = MAX(stok - ?, 0) WHERE id = ?', [it.qty, it.id]);
        }
        await t.run('UPDATE orders SET stock_restored = 0 WHERE id = ?', [order.id]);
        console.warn(`[pembayaran] ${order.no_invoice} dibayar setelah dibatalkan; stok diambil kembali. Mohon cek stok.`);
      }
      notifyText = `💰 PESANAN BARU LUNAS\n${orderSummary(order)}\n\nBuka panel admin untuk memproses & isi resi.`;
      return { applied: true, state: 'paid' };
    }

    if (isRefund) {
      await t.run("UPDATE orders SET payment_status='refunded' WHERE id = ?", [order.id]);
      return { applied: true, state: 'refunded' };
    }

    if (isDead) {
      if (!isCurrentAttempt) return { applied: false, reason: 'percobaan bayar lama' };
      if (order.payment_status !== 'pending') return { applied: false, reason: 'bukan pending' };
      const expired = ts === 'expire';
      await t.run('UPDATE orders SET payment_status=?, status=? WHERE id = ?',
        [expired ? 'expired' : 'failed', expired ? 'Kedaluwarsa' : 'Dibatalkan', order.id]);
      await restockOrder(t, order);
      return { applied: true, state: expired ? 'expired' : 'failed' };
    }

    if (order.payment_status === 'pending' && paymentType && isCurrentAttempt) {
      await t.run('UPDATE orders SET payment_type=?, midtrans_transaction_id=? WHERE id = ?', [paymentType, txId, order.id]);
    }
    return { applied: true, state: 'pending' };
  });
  if (notifyText) await notifyAdmin(notifyText);
  return result;
}

async function fetchMidtransStatus(invoice) {
  return midtransRequest('GET', `${MT_API_BASE}/v2/${encodeURIComponent(invoice)}/status`);
}

async function syncOrderWithMidtrans(order) {
  if (PAYMENT_MODE !== 'midtrans' || order.payment_status !== 'pending') return order;
  try {
    const rows = await db.all('SELECT mt_order_id FROM midtrans_attempts WHERE order_id = ? ORDER BY rowid DESC LIMIT 8', [order.id]);
    const ids = rows.map(r => r.mt_order_id);
    if (!ids.length) ids.push(order.midtrans_order_id || order.no_invoice);
    for (const mtId of ids) {
      const { httpStatus, json } = await fetchMidtransStatus(mtId);
      if (httpStatus === 200 && json.transaction_status) {
        const r = await applyMidtransStatus({ ...json, order_id: mtId });
        if (r && r.state === 'paid') break;
      }
    }
  } catch (e) {
    console.error('[pembayaran] gagal sinkron status:', e.message);
  }
  return db.get('SELECT * FROM orders WHERE id = ?', [order.id]);
}

async function createSnapTransaction(order, user, enabledPayments, mtOrderId, base) {
  const items = JSON.parse(order.items_json).map(i => ({
    id: String(i.kode_produk).slice(0, 50),
    price: i.harga,
    quantity: i.qty,
    name: String(i.nama).slice(0, 50)
  }));
  if (order.ongkir > 0) {
    items.push({ id: 'ONGKIR', price: order.ongkir, quantity: 1, name: `Ongkos Kirim ${order.kurir.split(' (')[0]}`.slice(0, 50) });
  }
  const sum = items.reduce((s, i) => s + i.price * i.quantity, 0);
  if (sum !== order.total_bayar) throw new Error('Rincian item tidak sama dengan total tagihan.');

  const remainMin = Math.max(5, Math.ceil((new Date(order.expires_at).getTime() - Date.now()) / 60000));
  const body = {
    transaction_details: { order_id: mtOrderId || order.no_invoice, gross_amount: order.total_bayar },
    item_details: items,
    customer_details: {
      first_name: order.nama_pelanggan.slice(0, 100),
      email: user.email,
      phone: order.no_hp,
      shipping_address: { first_name: order.nama_pelanggan.slice(0, 100), phone: order.no_hp, address: order.alamat.slice(0, 200), country_code: 'IDN' }
    },
    expiry: { unit: 'minutes', duration: remainMin },
    callbacks: { finish: `${base}/?bayar=selesai&inv=${encodeURIComponent(order.no_invoice)}` }
  };
  let fallback = false;
  if (enabledPayments) body.enabled_payments = enabledPayments;
  let { httpStatus, json } = await midtransRequest('POST', `${MT_SNAP_BASE}/snap/v1/transactions`, body);
  if ((httpStatus >= 300 || !json.token) && enabledPayments) {
    console.warn('[pembayaran] enabled_payments', enabledPayments.join(','), 'ditolak:', JSON.stringify(json).slice(0, 300), '-> coba tanpa filter');
    delete body.enabled_payments;
    ({ httpStatus, json } = await midtransRequest('POST', `${MT_SNAP_BASE}/snap/v1/transactions`, body));
    fallback = true;
  }
  if (httpStatus >= 300 || !json.token) {
    console.error('[pembayaran] Snap gagal:', httpStatus, JSON.stringify(json).slice(0, 500));
    const msg = (json.error_messages && json.error_messages.join('; ')) || json.status_message || 'Midtrans menolak permintaan.';
    throw new Error('Gagal membuat tagihan pembayaran: ' + msg);
  }
  return { token: json.token, redirect_url: json.redirect_url, fallback };
}

/** Pesanan lewat batas bayar -> batalkan & kembalikan stok (cek Midtrans dulu agar tidak salah batalkan). */
async function sweepExpiredOrders() {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const stale = await db.all("SELECT * FROM orders WHERE payment_status = 'pending' AND expires_at != '' AND expires_at < ?", [cutoff]);
  for (const o of stale) {
    if (PAYMENT_MODE === 'midtrans') {
      try {
        const mtId = o.midtrans_order_id || o.no_invoice;
        const { httpStatus, json } = await fetchMidtransStatus(mtId);
        if (httpStatus === 200 && json.transaction_status && json.transaction_status !== 'pending') {
          await applyMidtransStatus({ ...json, order_id: mtId });
          continue;
        }
      } catch (e) {
        continue; // gagal cek -> coba lagi nanti, jangan batalkan sembarangan
      }
    }
    const expired = await db.tx(async (t) => {
      const u = await t.run("UPDATE orders SET payment_status='expired', status='Kedaluwarsa' WHERE id = ? AND payment_status='pending'", [o.id]);
      if (!u.changes) return false;
      await restockOrder(t, o);
      return true;
    });
    if (expired) console.log(`[pembayaran] ${o.no_invoice} kedaluwarsa, stok dikembalikan.`);
  }
}

async function autoCompleteShipped() {
  const cutoff = new Date(Date.now() - AUTO_COMPLETE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const r = await db.run("UPDATE orders SET status='Selesai', received_at=?, received_by='otomatis' WHERE status='Dikirim' AND shipped_at != '' AND shipped_at <= ?", [nowSql(), cutoff]);
  if (r.changes) console.log(`[pesanan] ${r.changes} pesanan otomatis diselesaikan (>${AUTO_COMPLETE_DAYS} hari sejak dikirim).`);
}

async function housekeeping() {
  try {
    await sweepExpiredOrders();
    await autoCompleteShipped();
    await db.run('DELETE FROM rate_limits WHERE w < ?', [Date.now() - 24 * 3600 * 1000]);
  } catch (e) { console.error('[housekeeping]', e.message); }
}
let lastLazySweep = 0;
async function lazyHousekeeping() {
  if (Date.now() - lastLazySweep < 60 * 1000) return;
  lastLazySweep = Date.now();
  await housekeeping();
}

// ------------------------------------------------------------------
// EXPRESS
// ------------------------------------------------------------------
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : (IS_PROD ? 1 : 0));
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Halaman statis: di Vercel disajikan langsung dari /public (lihat vercel.json). Ini untuk jalan lokal.
app.use(express.static(path.join(ROOT, 'public'), { index: false, dotfiles: 'deny' }));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(ROOT, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

// Diagnosa tanpa membuka rahasia: hanya NAMA variabel yang kurang.
app.get('/api/healthz', async (req, res) => {
  const out = { ok: true, env: IS_PROD ? 'production' : 'development', paymentMode: PAYMENT_MODE, missing: configProblems() };
  try { await db.init(); await db.get('SELECT 1 AS x'); out.database = 'ok'; }
  catch (e) { out.ok = false; out.database = 'error: ' + e.message; }
  if (out.missing.length) out.ok = false;
  res.status(out.ok ? 200 : 500).json(out);
});

// Semua endpoint lain: pastikan konfigurasi lengkap & database siap.
app.use('/api', async (req, res, next) => {
  const problems = configProblems();
  if (problems.length) {
    return res.status(500).json({ success: false, message: 'Konfigurasi server belum lengkap. Isi Environment Variables di Vercel: ' + problems.join(', ') });
  }
  try { await db.init(); }
  catch (e) {
    console.error('[db] gagal inisialisasi:', e.message);
    return res.status(500).json({ success: false, message: 'Database belum terhubung. Periksa TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN. (' + e.message + ')' });
  }
  next();
});

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      cancelReasons: CANCEL_REASONS,
      paymentMode: PAYMENT_MODE,
      snapJsUrl: `${MT_SNAP_BASE}/snap/snap.js`,
      midtransClientKey: PAYMENT_MODE === 'midtrans' ? MT_CLIENT_KEY : '',
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      storeWhatsapp: STORE_WA,
      paymentWindowMinutes: PAYMENT_WINDOW_MINUTES,
      autoCompleteDays: AUTO_COMPLETE_DAYS,
      couriers: COURIERS
    }
  });
});

// Vercel Cron memanggil ini (Authorization: Bearer CRON_SECRET).
app.get('/api/cron/sweep', ah(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, message: 'Tidak diizinkan.' });
  }
  await housekeeping();
  res.json({ success: true });
}));

// ------------------------- AUTENTIKASI PELANGGAN -------------------------
app.post('/api/auth/google', authLimiter, ah(async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ success: false, message: 'Login Google belum diaktifkan oleh toko. Silakan masuk dengan email.' });
    }
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: String(req.body.credential || ''), audience: process.env.GOOGLE_CLIENT_ID });
    const g = ticket.getPayload();
    if (!g || !g.email || !g.email_verified) {
      return res.status(401).json({ success: false, message: 'Email Google belum terverifikasi.' });
    }
    const email = g.email.toLowerCase();
    let user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      const r = await db.run('INSERT INTO users (nama, email, google_id, avatar, created_at) VALUES (?, ?, ?, ?, ?)',
        [cleanText(g.name || email.split('@')[0], 100), email, g.sub, g.picture || '', new Date().toISOString()]);
      user = await db.get('SELECT * FROM users WHERE id = ?', [r.lastInsertRowid]);
    } else if (!user.google_id) {
      await db.run('UPDATE users SET google_id = ?, avatar = COALESCE(NULLIF(avatar, ?), ?) WHERE id = ?', [g.sub, '', g.picture || '', user.id]);
      user = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    }
    res.json({ success: true, token: signUserToken(user), user: publicUser(user) });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Verifikasi akun Google gagal.' });
  }
}));

app.post('/api/auth/login', authLimiter, ah(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email dan password wajib diisi.' });
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ success: false, message: 'Email atau password salah.' });
  }
  res.json({ success: true, token: signUserToken(user), user: publicUser(user) });
}));

app.post('/api/auth/register', authLimiter, ah(async (req, res) => {
  const nama = cleanText(req.body.nama, 100);
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  if (!nama || !email || !password) return res.status(400).json({ success: false, message: 'Nama, email, dan password wajib diisi.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return res.status(400).json({ success: false, message: 'Format email tidak valid.' });
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Password minimal 8 karakter.' });
  const hpReg = cleanText(req.body.no_hp, 20).replace(/[^0-9+]/g, '');
  if (!/^(\+62|62|0)8\d{7,12}$/.test(hpReg)) return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid (contoh: 081234567890).' });
  if (cleanText(req.body.alamat, 400).length < 15) return res.status(400).json({ success: false, message: 'Alamat pengiriman belum lengkap.' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email])) {
    return res.status(400).json({ success: false, message: 'Email sudah terdaftar. Silakan gunakan email lain atau login.' });
  }
  const r = await db.run('INSERT INTO users (nama, email, password, no_hp, alamat, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [nama, email, bcrypt.hashSync(password, 10), hpReg, cleanText(req.body.alamat, 400), '', new Date().toISOString()]);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [r.lastInsertRowid]);
  res.json({ success: true, token: signUserToken(user), user: publicUser(user) });
}));

app.put('/api/user/profile/:id', requireUser, ah(async (req, res) => {
  if (Number(req.params.id) !== req.user.id) return res.status(403).json({ success: false, message: 'Tidak diizinkan.' });
  await db.run('UPDATE users SET nama = ?, no_hp = ?, alamat = ? WHERE id = ?',
    [cleanText(req.body.nama, 100) || req.user.nama, cleanText(req.body.no_hp, 20), cleanText(req.body.alamat, 400), req.user.id]);
  const updated = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ success: true, message: 'Alamat berhasil disimpan.', data: publicUser(updated) });
}));

// ------------------------- PRODUK -------------------------
app.get('/api/products', ah(async (req, res) => {
  await lazyHousekeeping();   // pesanan kedaluwarsa dibersihkan & stok dikembalikan (cadangan Cron)
  res.json({ success: true, data: await db.all('SELECT * FROM products ORDER BY id ASC') });
}));

// Foto produk: disimpan di database (maks ~3 MB agar muat di batas body 4,5 MB Vercel).
const ALLOWED_IMG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
const MAX_IMG_BYTES = 3 * 1024 * 1024;
app.post('/api/upload', requireAdmin, ah(async (req, res) => {
  const { dataUrl } = req.body;
  const m = String(dataUrl || '').match(/^data:([A-Za-z0-9+\/.-]+);base64,([A-Za-z0-9+\/=]+)$/);
  if (!m || !ALLOWED_IMG[m[1]]) return res.status(400).json({ success: false, message: 'Hanya file gambar PNG, JPG, atau WEBP yang diizinkan.' });
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_IMG_BYTES) return res.status(400).json({ success: false, message: 'Ukuran gambar maksimal 3 MB.' });
  const r = await db.run('INSERT INTO uploads (mime, data, created_at) VALUES (?, ?, ?)', [m[1] === 'image/jpg' ? 'image/jpeg' : m[1], m[2], nowSql()]);
  res.json({ success: true, url: `/api/img/${r.lastInsertRowid}`, message: 'Foto produk berhasil diunggah.' });
}));

app.get('/api/img/:id', ah(async (req, res) => {
  const row = await db.get('SELECT mime, data FROM uploads WHERE id = ?', [Number(req.params.id) || 0]);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(row.data, 'base64'));
}));

function productFields(body) {
  const harga = Math.round(Number(body.harga));
  const stok = Math.round(Number(body.stok));
  if (!body.kode_produk || !body.nama || !body.kategori) throw new Error('Kode, nama, dan kategori produk wajib diisi.');
  if (!Number.isFinite(harga) || harga < 1000) throw new Error('Harga tidak valid (minimal Rp1.000).');
  if (!Number.isFinite(stok) || stok < 0) throw new Error('Stok tidak valid.');
  const gambar = String(body.gambar || '').trim();
  if (gambar && !/^\/images\/[A-Za-z0-9_\-\/.]+$/.test(gambar) && !/^\/api\/img\/\d+$/.test(gambar) && !/^https:\/\//.test(gambar)) throw new Error('Path gambar tidak valid.');
  return [
    cleanText(body.kode_produk, 30), cleanText(body.nama, 120), cleanText(body.kategori, 50),
    cleanText(body.karakteristik, 300), Math.max(0, Math.round(Number(body.berat)) || 0), harga, stok,
    gambar || '/images/temanggung_srinthil.jpg', cleanText(body.deskripsi, 1000)
  ];
}

app.post('/api/products', requireAdmin, ah(async (req, res) => {
  try {
    const f = productFields(req.body);
    const r = await db.run(`INSERT INTO products (kode_produk, nama, kategori, karakteristik, berat, harga, stok, gambar, deskripsi)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, f);
    res.json({ success: true, message: 'Produk berhasil ditambahkan.', data: await db.get('SELECT * FROM products WHERE id = ?', [r.lastInsertRowid]) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}));

app.put('/api/products/:id', requireAdmin, ah(async (req, res) => {
  try {
    const f = productFields(req.body);
    await db.run(`UPDATE products SET kode_produk=?, nama=?, kategori=?, karakteristik=?, berat=?, harga=?, stok=?, gambar=?, deskripsi=? WHERE id=?`,
      [...f, Number(req.params.id)]);
    res.json({ success: true, message: 'Produk berhasil diperbarui.', data: await db.get('SELECT * FROM products WHERE id = ?', [Number(req.params.id)]) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}));

app.delete('/api/products/:id', requireAdmin, ah(async (req, res) => {
  await db.run('DELETE FROM products WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true, message: 'Produk berhasil dihapus.' });
}));

// ------------------------- PESANAN & PEMBAYARAN -------------------------
app.post('/api/orders', orderLimiter, requireUser, ah(async (req, res) => {
  if (PAYMENT_MODE === 'disabled') {
    return res.status(503).json({ success: false, message: 'Pembayaran belum dikonfigurasi oleh toko. Hubungi admin.' });
  }
  try {
    const nama = cleanText(req.body.nama_pelanggan, 100);
    const no_hp = cleanText(req.body.no_hp, 20).replace(/[^0-9+]/g, '');
    const alamat = cleanText(req.body.alamat, 400);
    const kurirCode = String(req.body.kurir_code || '');
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    const payCode = String(req.body.payment_code || 'semua');
    if (!Object.prototype.hasOwnProperty.call(PAYMENT_METHODS, payCode)) throw new Error('Metode pembayaran tidak valid.');
    const payMethod = PAYMENT_METHODS[payCode];

    if (nama.length < 3) throw new Error('Nama penerima tidak valid.');
    if (!/^(\+62|62|0)8\d{7,12}$/.test(no_hp)) throw new Error('Nomor WhatsApp tidak valid (contoh: 081234567890).');
    if (alamat.length < 15) throw new Error('Alamat pengiriman belum lengkap.');
    if (!Object.prototype.hasOwnProperty.call(COURIERS, kurirCode)) throw new Error('Kurir tidak valid.');
    if (!rawItems.length || rawItems.length > 30) throw new Error('Keranjang kosong atau terlalu banyak item.');

    const invoice = newInvoice();
    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000).toISOString();

    const order = await db.tx(async (t) => {
      let total_belanja = 0;
      const orderItems = [];
      const seen = new Set();
      for (const it of rawItems) {
        const id = Number(it.id), qty = Number(it.qty);
        if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Data item tidak valid.');
        if (seen.has(id)) throw new Error('Item duplikat di keranjang.');
        seen.add(id);
        const p = await t.get('SELECT * FROM products WHERE id = ?', [id]);
        if (!p) throw new Error('Produk tidak ditemukan.');
        // Pengurangan stok bersyarat: gagal jika stok tidak cukup (anti-balapan).
        const upd = await t.run('UPDATE products SET stok = stok - ? WHERE id = ? AND stok >= ?', [qty, id, qty]);
        if (upd.changes === 0) throw new Error(`Stok "${p.nama}" tidak cukup (tersisa ${p.stok}).`);
        const subtotal = p.harga * qty;
        total_belanja += subtotal;
        orderItems.push({ id: p.id, kode_produk: p.kode_produk, nama: p.nama, harga: p.harga, qty, subtotal, berat: Number(p.berat) > 0 ? Number(p.berat) : 1000 });
      }
      const totalGram = orderItems.reduce((g, it) => g + it.berat * it.qty, 0);
      const kg = Math.max(1, Math.ceil(totalGram / 1000));
      const ongkir = COURIERS[kurirCode] * kg;
      const kurirLabel = COURIERS[kurirCode] === 0 ? `${kurirCode} (Rp0)` : `${kurirCode} (${rupiah(ongkir)} - ${kg} kg x ${rupiah(COURIERS[kurirCode])})`;
      const total_bayar = total_belanja + ongkir;
      const r = await t.run(`
        INSERT INTO orders (user_id, no_invoice, nama_pelanggan, no_hp, alamat, kurir, ongkir, metode_bayar,
                            total_belanja, total_bayar, status, payment_status, items_json, created_at, expires_at, midtrans_order_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Menunggu Pembayaran', 'pending', ?, ?, ?, ?)
      `, [req.user.id, invoice, nama, no_hp, alamat, kurirLabel, ongkir, payMethod.label, total_belanja, total_bayar, JSON.stringify(orderItems), nowSql(), expiresAt, invoice]);
      await t.run('INSERT INTO midtrans_attempts (mt_order_id, order_id, created_at) VALUES (?, ?, ?)', [invoice, r.lastInsertRowid, nowSql()]);
      if (!req.user.no_hp || !req.user.alamat) {
        await t.run("UPDATE users SET no_hp = CASE WHEN no_hp = '' THEN ? ELSE no_hp END, alamat = CASE WHEN alamat = '' THEN ? ELSE alamat END WHERE id = ?",
          [no_hp, alamat, req.user.id]);
      }
      return t.get('SELECT * FROM orders WHERE id = ?', [r.lastInsertRowid]);
    });

    let pay;
    try {
      if (PAYMENT_MODE === 'midtrans') {
        pay = await createSnapTransaction(order, req.user, payMethod.enabled, null, baseUrl(req));
      } else {
        pay = { token: 'mock-' + order.no_invoice, redirect_url: `/simulasi-bayar.html?invoice=${encodeURIComponent(order.no_invoice)}` };
      }
    } catch (e) {
      await db.tx(async (t) => {
        await t.run("UPDATE orders SET payment_status='failed', status='Dibatalkan' WHERE id = ?", [order.id]);
        await restockOrder(t, order);
      });
      return res.status(502).json({ success: false, message: e.message });
    }
    await db.run('UPDATE orders SET midtrans_token = ?, midtrans_redirect_url = ? WHERE id = ?', [pay.token, pay.redirect_url, order.id]);

    res.status(201).json({
      success: true,
      data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [order.id])),
      payment: { mode: PAYMENT_MODE, token: pay.token, redirect_url: pay.redirect_url, fallback: !!pay.fallback }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}));

async function getOwnedOrder(req, res) {
  const o = await db.get('SELECT * FROM orders WHERE no_invoice = ?', [req.params.invoice]);
  if (!o || o.user_id !== req.user.id) {
    res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
    return null;
  }
  return o;
}

app.post('/api/orders/:invoice/payment', requireUser, ah(async (req, res) => {
  let o = await getOwnedOrder(req, res);
  if (!o) return;
  o = await syncOrderWithMidtrans(o);
  if (o.payment_status !== 'pending') {
    return res.json({ success: true, data: publicOrder(o), payment: null });
  }
  if (new Date(o.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ success: false, message: 'Batas waktu pembayaran sudah lewat.' });
  }
  res.json({ success: true, data: publicOrder(o), payment: { mode: PAYMENT_MODE, token: o.midtrans_token, redirect_url: o.midtrans_redirect_url } });
}));

app.get('/api/orders/:invoice/sync', requireUser, ah(async (req, res) => {
  let o = await getOwnedOrder(req, res);
  if (!o) return;
  o = await syncOrderWithMidtrans(o);
  res.json({ success: true, data: publicOrder(o) });
}));

// ---- WEBHOOK MIDTRANS (HTTP Notification) ----
app.post('/api/payments/midtrans/notification', async (req, res) => {
  try {
    if (PAYMENT_MODE !== 'midtrans') return res.status(200).json({ ok: true, ignored: true });
    const n = req.body || {};
    const expected = crypto.createHash('sha512')
      .update(String(n.order_id) + String(n.status_code) + String(n.gross_amount) + MT_SERVER_KEY).digest('hex');
    const given = String(n.signature_key || '');
    const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) {
      console.warn('[webhook] signature tidak valid dari', req.ip);
      return res.status(403).json({ ok: false });
    }
    const mtId = String(n.order_id);
    const att = await db.get('SELECT order_id FROM midtrans_attempts WHERE mt_order_id = ?', [mtId]);
    const order = att ? await db.get('SELECT no_invoice FROM orders WHERE id = ?', [att.order_id]) : null;
    if (!order) return res.status(200).json({ ok: true, ignored: 'order tidak dikenal' }); // mis. notifikasi tes

    // Verifikasi ganda: status resmi langsung dari API Midtrans.
    const { httpStatus, json } = await fetchMidtransStatus(mtId);
    if (httpStatus !== 200 || !json.transaction_status) {
      return res.status(500).json({ ok: false, message: 'gagal verifikasi ke Midtrans' }); // Midtrans akan kirim ulang
    }
    const r = await applyMidtransStatus({ ...json, order_id: mtId });
    console.log(`[webhook] ${order.no_invoice} -> ${json.transaction_status} (${JSON.stringify(r)})`);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[webhook] error:', e.message);
    res.status(500).json({ ok: false });
  }
});

// ---- SIMULASI LOKAL (hanya saat kunci Midtrans kosong & bukan produksi) ----
if (PAYMENT_MODE === 'mock') {
  app.post('/api/dev/simulate-pay/:invoice', requireUser, ah(async (req, res) => {
    const o = await getOwnedOrder(req, res);
    if (!o) return;
    const outcome = req.body.outcome === 'expire' ? 'expire' : 'settlement';
    const r = await applyMidtransStatus({
      order_id: o.midtrans_order_id || o.no_invoice, gross_amount: o.total_bayar, transaction_status: outcome,
      payment_type: 'qris', transaction_id: 'SIMULASI-' + crypto.randomBytes(4).toString('hex')
    });
    res.json({ success: true, result: r, data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])) });
  }));
}

// ---- GANTI METODE PEMBAYARAN ----
app.post('/api/orders/:invoice/change-payment', requireUser, async (req, res) => {
  try {
    let o = await getOwnedOrder(req, res);
    if (!o) return;
    o = await syncOrderWithMidtrans(o);
    if (o.payment_status === 'paid') return res.status(400).json({ success: false, message: 'Pesanan ini sudah dibayar.' });
    if (o.payment_status !== 'pending') return res.status(400).json({ success: false, message: 'Pesanan tidak lagi menunggu pembayaran.' });
    if (new Date(o.expires_at).getTime() < Date.now()) return res.status(400).json({ success: false, message: 'Batas waktu pembayaran sudah lewat.' });

    const payCode = String(req.body.payment_code || '');
    if (!Object.prototype.hasOwnProperty.call(PAYMENT_METHODS, payCode)) return res.status(400).json({ success: false, message: 'Metode pembayaran tidak valid.' });
    const method = PAYMENT_METHODS[payCode];

    const cnt = await db.get('SELECT COUNT(*) AS c FROM midtrans_attempts WHERE order_id = ?', [o.id]);
    const newMtId = `${o.no_invoice}-${cnt.c + 1}`;
    const oldMtId = o.midtrans_order_id || o.no_invoice;

    let pay;
    if (PAYMENT_MODE === 'midtrans') pay = await createSnapTransaction(o, req.user, method.enabled, newMtId, baseUrl(req));
    else pay = { token: 'mock-' + newMtId, redirect_url: `/simulasi-bayar.html?invoice=${encodeURIComponent(o.no_invoice)}` };

    await db.tx(async (t) => {
      await t.run('INSERT INTO midtrans_attempts (mt_order_id, order_id, created_at) VALUES (?, ?, ?)', [newMtId, o.id, nowSql()]);
      await t.run("UPDATE orders SET midtrans_order_id=?, midtrans_token=?, midtrans_redirect_url=?, metode_bayar=?, payment_type='' WHERE id=?",
        [newMtId, pay.token, pay.redirect_url, method.label, o.id]);
    });
    if (PAYMENT_MODE === 'midtrans') {
      try { await midtransRequest('POST', `${MT_API_BASE}/v2/${encodeURIComponent(oldMtId)}/cancel`); } catch (e) { /* 404 bila belum pernah dipakai; abaikan */ }
    }
    res.json({
      success: true,
      data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])),
      payment: { mode: PAYMENT_MODE, token: pay.token, redirect_url: pay.redirect_url, fallback: !!pay.fallback }
    });
  } catch (e) {
    res.status(502).json({ success: false, message: e.message });
  }
});

// ---- PEMBATALAN OLEH PELANGGAN ----
app.post('/api/orders/:invoice/cancel', requireUser, ah(async (req, res) => {
  let o = await getOwnedOrder(req, res);
  if (!o) return;
  const code = String(req.body.reason || '');
  if (!Object.prototype.hasOwnProperty.call(CANCEL_REASONS, code)) return res.status(400).json({ success: false, message: 'Pilih alasan pembatalan.' });
  const detail = cleanText(req.body.detail, 300);
  if (code === 'lainnya' && detail.length < 5) return res.status(400).json({ success: false, message: 'Tuliskan alasan Anda (minimal 5 karakter).' });
  const reasonText = code === 'lainnya' ? `Lainnya: ${detail}` : (CANCEL_REASONS[code] + (detail ? ` (${detail})` : ''));

  o = await syncOrderWithMidtrans(o);
  if (o.payment_status === 'pending') {
    await db.tx(async (t) => {
      const u = await t.run("UPDATE orders SET status='Dibatalkan', payment_status='failed', cancel_status='dibatalkan_pelanggan', cancel_reason=?, cancel_at=? WHERE id=? AND payment_status='pending'",
        [reasonText, nowSql(), o.id]);
      if (u.changes) await restockOrder(t, o);
    });
    if (PAYMENT_MODE === 'midtrans') {
      try { await midtransRequest('POST', `${MT_API_BASE}/v2/${encodeURIComponent(o.midtrans_order_id || o.no_invoice)}/cancel`); } catch (e) { /* abaikan */ }
    }
    return res.json({ success: true, message: 'Pesanan dibatalkan.', data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])) });
  }
  if (o.payment_status === 'paid' && o.status === 'Diproses') {
    if (o.cancel_status === 'diajukan') return res.status(400).json({ success: false, message: 'Pengajuan pembatalan sudah dikirim dan sedang ditinjau toko.' });
    const u = await db.run("UPDATE orders SET cancel_status='diajukan', cancel_reason=?, cancel_at=? WHERE id=? AND status='Diproses'", [reasonText, nowSql(), o.id]);
    if (!u.changes) return res.status(409).json({ success: false, message: 'Status pesanan baru saja berubah (mungkin sudah dikirim). Muat ulang halaman.' });
    await notifyAdmin(`⚠️ PENGAJUAN BATAL (jangan kirim dulu)\n${orderSummary(o)}\nAlasan: ${reasonText}`);
    return res.json({ success: true, message: 'Pengajuan pembatalan dikirim. Toko akan meninjau dan memproses pengembalian dana.', data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])) });
  }
  if (o.status === 'Dikirim' || o.status === 'Selesai') {
    return res.status(400).json({ success: false, message: 'Pesanan sudah dikirim, tidak bisa dibatalkan. Silakan hubungi toko.' });
  }
  return res.status(400).json({ success: false, message: 'Pesanan ini tidak bisa dibatalkan.' });
}));

app.post('/api/orders/:id/cancel-request/reject', requireAdmin, ah(async (req, res) => {
  const o = await db.get('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!o || o.cancel_status !== 'diajukan') return res.status(400).json({ success: false, message: 'Tidak ada pengajuan pembatalan.' });
  await db.run("UPDATE orders SET cancel_status='ditolak' WHERE id=?", [o.id]);
  res.json({ success: true, message: 'Pengajuan pembatalan ditolak.', data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])) });
}));

const STATUS_ALLOWED = ['Menunggu Pembayaran', 'Diproses', 'Dikirim', 'Selesai', 'Dibatalkan', 'Kedaluwarsa'];
app.put('/api/orders/:id/status', requireAdmin, ah(async (req, res) => {
  const status = String(req.body.status || '');
  const no_resi = cleanText(req.body.no_resi, 60);
  if (!STATUS_ALLOWED.includes(status)) return res.status(400).json({ success: false, message: 'Status tidak valid.' });
  const o = await db.get('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!o) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });

  if (o.cancel_status === 'diajukan' && ['Dikirim', 'Selesai'].includes(status)) {
    return res.status(409).json({ success: false, message: `Pelanggan mengajukan pembatalan (${o.cancel_reason}). Putuskan dulu: setujui (ubah ke Dibatalkan) atau tolak, sebelum mengirim.` });
  }
  const needsPaid = ['Diproses', 'Dikirim', 'Selesai'].includes(status);
  if (needsPaid && !['paid', 'legacy'].includes(o.payment_status)) {
    return res.status(400).json({ success: false, message: 'Pesanan belum dibayar. Status hanya bisa diubah setelah pembayaran dikonfirmasi Midtrans.' });
  }
  if (status === 'Dibatalkan' && o.payment_status === 'pending' && PAYMENT_MODE === 'midtrans') {
    try { await midtransRequest('POST', `${MT_API_BASE}/v2/${encodeURIComponent(o.midtrans_order_id || o.no_invoice)}/cancel`); } catch (e) { /* abaikan */ }
  }
  await db.tx(async (t) => {
    await t.run('UPDATE orders SET status = ?, no_resi = ? WHERE id = ?', [status, no_resi, o.id]);
    if (status === 'Dikirim' && o.status !== 'Dikirim') await t.run('UPDATE orders SET shipped_at = ? WHERE id = ?', [nowSql(), o.id]);
    if (status === 'Selesai' && o.status !== 'Selesai') await t.run("UPDATE orders SET received_at = ?, received_by = 'admin' WHERE id = ?", [nowSql(), o.id]);
    if (['Dibatalkan', 'Kedaluwarsa'].includes(status)) {
      if (o.payment_status === 'pending') await t.run("UPDATE orders SET payment_status='failed' WHERE id = ?", [o.id]);
      if (o.cancel_status === 'diajukan') await t.run("UPDATE orders SET cancel_status='disetujui' WHERE id = ?", [o.id]);
      await restockOrder(t, o);
    }
  });
  res.json({ success: true, message: 'Status pesanan berhasil diperbarui.', data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])) });
}));

app.post('/api/orders/:invoice/confirm-received', requireUser, ah(async (req, res) => {
  const o = await getOwnedOrder(req, res);
  if (!o) return;
  if (o.status !== 'Dikirim') return res.status(400).json({ success: false, message: o.status === 'Selesai' ? 'Pesanan ini sudah selesai.' : 'Pesanan belum berstatus Dikirim.' });
  const u = await db.run("UPDATE orders SET status='Selesai', received_at=?, received_by='pelanggan' WHERE id=? AND status='Dikirim'", [nowSql(), o.id]);
  if (!u.changes) return res.status(409).json({ success: false, message: 'Status pesanan baru saja berubah. Muat ulang halaman.' });
  res.json({ success: true, message: 'Terima kasih! Pesanan ditandai sudah diterima.', data: publicOrder(await db.get('SELECT * FROM orders WHERE id = ?', [o.id])) });
}));

// Daftar pesanan: admin melihat semua, pelanggan hanya miliknya.
app.get('/api/orders', ah(async (req, res, next) => {
  if (isAdminReq(req)) {
    await lazyHousekeeping();
    const rows = await db.all('SELECT * FROM orders ORDER BY id DESC');
    return res.json({ success: true, data: rows.map(publicOrder) });
  }
  next();
}), requireUser, ah(async (req, res) => {
  let rows = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  const pending = rows.filter(o => o.payment_status === 'pending').slice(0, 5);
  if (pending.length && PAYMENT_MODE === 'midtrans') {
    await Promise.all(pending.map(o => syncOrderWithMidtrans(o)));
    rows = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  }
  res.json({ success: true, data: rows.map(publicOrder) });
}));

app.get('/api/orders/:invoice', ah(async (req, res, next) => {
  if (isAdminReq(req)) {
    const o = await db.get('SELECT * FROM orders WHERE no_invoice = ?', [req.params.invoice]);
    if (!o) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
    return res.json({ success: true, data: publicOrder(o) });
  }
  next();
}), requireUser, ah(async (req, res) => {
  const o = await getOwnedOrder(req, res);
  if (o) res.json({ success: true, data: publicOrder(o) });
}));

// ------------------------- ADMIN -------------------------
app.post('/api/admin/login', authLimiter, ah(async (req, res) => {
  const u = String(req.body.username || ''), p = String(req.body.password || '');
  const userOk = u.length === ADMIN_USERNAME.length && crypto.timingSafeEqual(Buffer.from(u), Buffer.from(ADMIN_USERNAME));
  const passOk = bcrypt.compareSync(p, getAdminHash());
  if (userOk && passOk) {
    return res.json({ success: true, token: jwt.sign({ role: 'admin' }, getJwtSecret(), { expiresIn: '12h' }) });
  }
  res.status(401).json({ success: false, message: 'Username atau password admin salah.' });
}));

app.get('/api/admin/stats', requireAdmin, ah(async (req, res) => {
  const one = async (sql) => (await db.get(sql)) || {};
  res.json({
    success: true,
    data: {
      totalJenisProduk: (await one('SELECT COUNT(*) AS c FROM products')).c || 0,
      totalStok: (await one('SELECT SUM(stok) AS t FROM products')).t || 0,
      totalPesanan: (await one("SELECT COUNT(*) AS c FROM orders WHERE payment_status IN ('paid','legacy')")).c || 0,
      totalOmzet: (await one("SELECT SUM(total_bayar) AS t FROM orders WHERE payment_status IN ('paid','legacy') AND status NOT IN ('Dibatalkan','Kedaluwarsa')")).t || 0,
      pengajuanBatal: (await one("SELECT COUNT(*) AS c FROM orders WHERE cancel_status = 'diajukan'")).c || 0,
      menungguPembayaran: (await one("SELECT COUNT(*) AS c FROM orders WHERE payment_status = 'pending'")).c || 0,
      paymentMode: PAYMENT_MODE
    }
  });
}));

app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' }));

module.exports = app;
module.exports.PORT = PORT;
