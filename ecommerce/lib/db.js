/**
 * Lapisan database: Turso (libSQL, SQLite hosted) untuk Vercel.
 * Lokal tanpa TURSO_DATABASE_URL otomatis memakai file SQLite "local.db".
 * API-nya sengaja mirip better-sqlite3 tetapi async: get / all / run / tx.
 */
const path = require('path');
const { createClient } = require('@libsql/client');

let url = (process.env.TURSO_DATABASE_URL || '').trim() || 'file:' + path.join(__dirname, '..', 'local.db');
// Di serverless, HTTP lebih andal daripada WebSocket: libsql://xxx -> https://xxx
if (/^libsql:\/\//i.test(url)) url = url.replace(/^libsql:\/\//i, 'https://');
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim() || undefined;
const client = createClient({ url, authToken });

function rowsToObjects(rs) {
  return rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
}

function wrap(ex) {
  const api = {
    async all(sql, args = []) { return rowsToObjects(await ex.execute({ sql, args })); },
    async get(sql, args = []) { return (await api.all(sql, args))[0]; },
    async run(sql, args = []) {
      const rs = await ex.execute({ sql, args });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null };
    }
  };
  return api;
}

const db = wrap(client);
db.isRemote = /^(libsql|https?|wss?):/i.test(url);

/** Transaksi: fn menerima objek {get, all, run}. Commit bila sukses, rollback bila error. */
db.tx = async function tx(fn) {
  const t = await client.transaction('write');
  try {
    const result = await fn(wrap(t));
    await t.commit();
    return result;
  } catch (e) {
    try { await t.rollback(); } catch (_) { /* abaikan */ }
    throw e;
  } finally {
    t.close();
  }
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    no_hp TEXT DEFAULT '',
    alamat TEXT DEFAULT '',
    google_id TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    password TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode_produk TEXT UNIQUE NOT NULL,
    nama TEXT NOT NULL,
    kategori TEXT NOT NULL,
    karakteristik TEXT,
    berat INTEGER DEFAULT 0,
    harga INTEGER NOT NULL,
    stok INTEGER NOT NULL,
    gambar TEXT,
    deskripsi TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL,
    no_invoice TEXT UNIQUE NOT NULL,
    nama_pelanggan TEXT NOT NULL,
    no_hp TEXT NOT NULL,
    alamat TEXT NOT NULL,
    kurir TEXT NOT NULL,
    ongkir INTEGER NOT NULL,
    metode_bayar TEXT NOT NULL,
    total_belanja INTEGER NOT NULL,
    total_bayar INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Menunggu Pembayaran',
    no_resi TEXT DEFAULT '',
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    payment_type TEXT DEFAULT '',
    midtrans_token TEXT DEFAULT '',
    midtrans_redirect_url TEXT DEFAULT '',
    midtrans_transaction_id TEXT DEFAULT '',
    expires_at TEXT DEFAULT '',
    paid_at TEXT DEFAULT '',
    stock_restored INTEGER NOT NULL DEFAULT 0,
    midtrans_order_id TEXT DEFAULT '',
    cancel_reason TEXT DEFAULT '',
    cancel_status TEXT DEFAULT '',
    cancel_at TEXT DEFAULT '',
    shipped_at TEXT DEFAULT '',
    received_at TEXT DEFAULT '',
    received_by TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS midtrans_attempts (
    mt_order_id TEXT PRIMARY KEY,
    order_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // Foto produk yang diunggah admin (Vercel tidak punya disk permanen, jadi disimpan di database).
  `CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // Pembatas laju (rate limit) berbasis database, karena memori server Vercel tidak dibagi antar-instance.
  `CREATE TABLE IF NOT EXISTS rate_limits (
    k TEXT NOT NULL,
    w INTEGER NOT NULL,
    c INTEGER NOT NULL,
    PRIMARY KEY (k, w)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_orders_pay ON orders(payment_status)',
  'CREATE INDEX IF NOT EXISTS idx_attempts_order ON midtrans_attempts(order_id)'
];

const SEED_PRODUCTS = [
  ['TMB-001', 'Tembakau Temanggung Srinthil Super', 'Tembakau Nusantara', 'Strong - Gurih Alami Mantap Khas Lereng Gunung Sumbing', 1000, 35000, 25, '/images/temanggung_srinthil.jpg', 'Tembakau rajangan asli Temanggung grade Srinthil pilihan.'],
  ['TMB-002', 'Tembakau Gayo Hijau Aceh Asli', 'Tembakau Nusantara', 'Medium - Harum Segar Khas Dataran Tinggi Gayo', 1000, 28000, 30, '/images/gayo_hijau.jpg', 'Tembakau hijau khas Tanah Gayo Aceh.'],
  ['TMB-003', 'Tembakau Kasturi Madura Super', 'Tembakau Nusantara', 'Mild - Manis Lembut, Gurih Renyah Khas Madura', 1000, 25000, 40, '/images/kasturi_madura.jpg', 'Tembakau Kasturi asli Pamekasan Madura.'],
  ['TMB-004', 'Tembakau Mole Flavour Vanilla Cream', 'Tembakau Flavour', 'Mild - Aroma Manis Vanilla Creamy Lembut', 1000, 22000, 35, '/images/mole_vanilla.jpg', 'Tembakau rajangan mole aroma vanilla.'],
  ['ALT-001', 'Alat Linting Besi Handroller 110mm King Size', 'Alat Linting', 'Besi Chrome Stainless Steel, Kuat & Presisi', 1000, 25000, 15, '/images/handroller_110.jpg', 'Alat penggulung tembakau manual besi.'],
  ['ALT-002', 'Kertas Papir Rokok Manis Cap Wayang', 'Alat Linting', 'Slow Burning, Rasa Manis Gurih di Bibir', 1000, 5000, 100, '/images/papir_manis.jpg', 'Kertas linting rokok legendaris.'],
  ['ALT-003', 'Busa Filter Rokok Reguler (Isi 100 Pcs)', 'Alat Linting', 'Diameter 8mm (Standard Size), Kapas Padat Bersih', 1000, 12000, 50, '/images/busa_filter.jpg', 'Busa filter rokok berkualitas tinggi.'],
  ['BDL-001', 'Paket Starter Bundling Tingwe Siap Linting', 'Paket Bundling', 'Lengkap: 1 Tembakau + Handroller + Papir + Filter', 1000, 65000, 12, '/images/paket_bundling.jpg', 'Paket hemat pemula tingwe.']
];

let readyPromise = null;
/** Buat tabel + isi produk awal (sekali per instance; aman dipanggil berulang). */
db.init = function init() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await client.batch(SCHEMA.map(sql => ({ sql, args: [] })), 'write');
      const c = await db.get('SELECT COUNT(*) AS c FROM products');
      if (!c || c.c === 0) {
        await client.batch(SEED_PRODUCTS.map(args => ({
          sql: `INSERT OR IGNORE INTO products (kode_produk, nama, kategori, karakteristik, berat, harga, stok, gambar, deskripsi)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, args
        })), 'write');
      }
    })().catch(e => { readyPromise = null; throw e; });
  }
  return readyPromise;
};

module.exports = db;
