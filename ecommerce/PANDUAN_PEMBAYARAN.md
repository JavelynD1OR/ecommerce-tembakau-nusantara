# Panduan Pembayaran Nyata (Midtrans) — Toko Nusantara Tobacco

## 1. Cara kerja singkat

```
Pelanggan checkout → server hitung harga & kurangi stok → server minta tagihan ke Midtrans (Snap)
→ pelanggan bayar di popup (QRIS / DANA / GoPay / ShopeePay / VA bank)
→ Midtrans memanggil  POST /api/payments/midtrans/notification  (webhook)
→ server cek tanda-tangan + tanya ulang status ke API Midtrans
→ baru status pesanan jadi "Diproses" (Lunas). Uang masuk ke rekening Anda di Midtrans.
```

Tidak ada lagi QRIS/rekening yang ditulis manual di kode. Rekening pencairan dana diatur di dashboard Midtrans, bukan di aplikasi ini.

## 2. Yang Anda siapkan (agar benar-benar real)

| Kebutuhan | Keterangan |
|---|---|
| Akun Midtrans | Daftar di dashboard.midtrans.com. Untuk uang asli perlu verifikasi bisnis (KTP/NPWP/rekening, dan sesuai jenis usaha: perorangan atau badan usaha). |
| **Cek kebijakan produk tembakau** | Penyedia pembayaran bisa membatasi produk tertentu. Sebelum daftar, tanyakan/baca syarat Midtrans apakah **tembakau & alat linting** boleh dijual. Saya tidak dapat memastikan hal ini; sandbox tetap bisa dipakai untuk uji. Jika ditolak, alternatifnya penyedia lain atau QRIS/rekening toko dengan verifikasi manual admin. |
| Server Key & Client Key | Dashboard Midtrans → Settings → Access Keys. Mulai dengan kunci **Sandbox** (di akun baru bisa berawalan `Mid-` juga; yang menentukan adalah dropdown Environment di dashboard). |
| Alamat publik HTTPS | Agar Midtrans bisa mengirim webhook (lihat bagian 5). |
| Rekening pencairan | Diisi saat onboarding Midtrans. |
| (Opsional) Google Client ID | Google Cloud Console → Credentials → OAuth client (Web). Tambahkan alamat toko ke "Authorized JavaScript origins". |

## 3. Uji lokal tanpa kunci (mode simulasi)

1. `npm install`
2. Salin `.env.example` → `.env` (atau jalankan `jalankan.bat` di Windows, yang melakukannya otomatis).
3. `npm start`, buka http://localhost:3000, daftar akun, belanja, checkout.
4. Tab baru "Simulasi Pembayaran" terbuka; klik **Simulasikan Pembayaran Berhasil**. Status berubah otomatis.

Mode ini hanya ada bila kunci Midtrans kosong **dan** `NODE_ENV` bukan `production`. Tidak ada uang bergerak.

## 4. Uji dengan Midtrans Sandbox (uang palsu, alur sungguhan)

1. Isi di `.env`: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY` (dari Environment: Sandbox), `MIDTRANS_IS_PRODUCTION=false`.
2. Restart server. Checkout akan membuka popup Midtrans asli (sandbox).
3. Bayar memakai simulator Midtrans (https://simulator.sandbox.midtrans.com) untuk QRIS / VA / e-wallet.
4. Status di toko berubah otomatis. Walau webhook belum disetel, aplikasi mengecek status ke Midtrans tiap beberapa detik selama jendela pembayaran terbuka, jadi uji lokal tetap jalan.

## 5. Webhook (wajib saat online)

Di dashboard Midtrans → Settings → Configuration:
- **Payment Notification URL**: `https://DOMAIN-ANDA/api/payments/midtrans/notification`
- (Opsional) Finish/Unfinish/Error URL: `https://DOMAIN-ANDA/`

Webhook diverifikasi dengan tanda-tangan SHA-512 dan dicek ulang ke API Midtrans; panggilan palsu ditolak. Pesanan yang tidak dibayar juga dibersihkan oleh pemeriksa otomatis tiap menit, jadi stok tidak tertahan selamanya meski webhook terlambat.

Mengetes webhook dari komputer sendiri: jalankan tunnel (mis. `cloudflared tunnel --url http://localhost:3000` atau ngrok) dan pakai alamat HTTPS-nya sebagai Notification URL sementara.

## 6. Go-live (uang asli)

1. Midtrans sudah menyetujui akun Production Anda; aktifkan metode bayar yang diinginkan (QRIS, e-wallet, VA) di dashboard.
2. Ganti di `.env`: kunci **Production**, `MIDTRANS_IS_PRODUCTION=true`, `NODE_ENV=production`, `BASE_URL=https://domain-anda`, `JWT_SECRET` (acak ≥ 32 karakter), `ADMIN_PASSWORD` (kuat), `TRUST_PROXY=1` bila di balik proxy.
3. Server menolak start di mode production bila `JWT_SECRET`/`ADMIN_PASSWORD` lemah, dan menolak bila jenis kunci tidak cocok dengan `MIDTRANS_IS_PRODUCTION`.
4. Lakukan **satu transaksi nyata nominal kecil** dan pastikan: status berubah, dana tercatat di Midtrans, stok benar.
5. Refund/pembatalan setelah lunas dilakukan dari dashboard Midtrans. Webhook akan menandai pesanan "Refund".

## 6b. Ganti metode bayar & pembatalan pesanan

| Kondisi pesanan | Yang bisa dilakukan pelanggan |
|---|---|
| Menunggu Pembayaran | **Ganti Metode** (tagihan baru dibuat, tagihan lama dibatalkan) atau **Batalkan** langsung (stok kembali otomatis) |
| Diproses (sudah dibayar) | **Ajukan Pembatalan** — admin harus menyetujui/menolak |
| Dikirim / Selesai | Tidak bisa dibatalkan |

- Pelanggan memilih alasan dari daftar, atau "Lainnya" lalu menulis sendiri (min. 5 karakter).
- Admin melihat alasan di tab **⚠ Pengajuan Batal**, banner dashboard, dan jendela status pesanan.
- Selama ada pengajuan batal, admin **tidak bisa** menandai pesanan "Dikirim" sampai memutuskan Setujui atau Tolak.
- Setelah admin **menyetujui** pembatalan pesanan yang sudah dibayar, stok kembali, tetapi **refund uangnya dilakukan manual** di dashboard Midtrans (Transactions → pilih transaksi → Refund).

## 6c. Notifikasi pesanan masuk

- **Panel admin**: bunyi "ting" + banner hijau saat ada pesanan baru lunas atau pengajuan batal baru (cek tiap 15 detik). Panel admin harus terbuka di browser.
- **Telegram (ke HP, walau admin tertutup)**: pesan otomatis berisi invoice, barang, total, alamat saat pesanan **lunas**, dan saat ada **pengajuan batal**.
  1. Di Telegram cari **@BotFather**, kirim `/newbot`, ikuti langkahnya, salin **token**.
  2. Buka bot baru Anda, tekan Start, kirim pesan apa saja.
  3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates` di browser; cari `"chat":{"id":12345...}` dan salin angkanya.
  4. Isi di `.env`: `TELEGRAM_BOT_TOKEN=...` dan `TELEGRAM_CHAT_ID=...`, lalu restart server.
  Token bot itu rahasia, jangan dibagikan. Server harus berjalan (hosting) agar notifikasi terkirim.

## 6d. Barang sampai -> pesanan Selesai

1. Admin ubah status ke **Dikirim** dan isi resi (waktu kirim tercatat otomatis).
2. Pelanggan menekan **✅ Pesanan Sudah Diterima** di Pesanan Saya setelah barang sampai, status jadi **Selesai**.
3. Jika pelanggan lupa menekan, pesanan **Selesai otomatis** setelah `AUTO_COMPLETE_DAYS` hari sejak dikirim (bawaan 7 hari, ubah di `.env`). Isi sesuai lama pengiriman terlama ditambah beberapa hari cadangan.
4. Admin tetap bisa mengubah ke Selesai sendiri kapan saja.

Server tidak tahu posisi paket secara real-time (tidak terhubung ke sistem kurir), jadi dua mekanisme di atas yang dipakai.

## 6e. Ongkir per kilo

- Kurir: **JD Express Rp 3.500/kg**, **J&T Express Rp 5.500/kg**, dan Ambil di Toko (gratis).
- Semua produk dihitung **1 kg (1000 gram)**. Ongkir = tarif per kilo x berat total belanja, dibulatkan ke atas per 1 kg. Contoh: 3 tembakau, JD Express = 3 kg x 3.500 = Rp 10.500; J&T Express = 3 x 5.500 = Rp 16.500.
- Ongkir dihitung ulang oleh **server** saat pesanan dibuat, jadi tidak bisa diubah dari browser.
- Ubah tarif di `server.js` pada bagian `COURIERS`, dan tulisan harganya di `public/index.html` (cari `data-perkg`).
- Berat produk bisa diubah per produk di panel admin (kolom Berat, dalam gram). Ongkir otomatis ikut.

## 7. Hosting (SQLite butuh disk yang tidak hilang)

Aplikasi memakai file `toko_tembakau.db` dan folder `public/images/uploads`. Karena itu hosting harus menyimpan disk secara permanen:
- **VPS** (disarankan): Node.js 18+, jalankan dengan PM2, pasang Caddy/Nginx untuk HTTPS (Let's Encrypt), `TRUST_PROXY=1`. Cadangkan file `.db` secara rutin.
- **Railway / Render**: wajib pakai *persistent volume*, arahkan `DB_PATH` ke volume tersebut (mis. `/data/toko_tembakau.db`). Tanpa volume, data hilang tiap deploy.

## 8. Catatan keamanan untuk Anda

- Jangan pernah mengunggah `.env` atau membagikan **Server Key**. Client Key memang publik.
- Ganti password admin di `.env` dan jangan berbagi.
- Data bawaan: pesanan uji & akun demo dihapus dari database di paket ini; produk dan stok tetap. Sesuaikan stok & harga lewat panel admin.
- Footer/header toko masih memuat nomor WhatsApp & alamat contoh di `public/index.html`; ganti dengan data toko asli.
- Aspek hukum penjualan rokok/tembakau (izin usaha, batas usia, pajak/cukai, aturan pengiriman) di luar cakupan kode ini dan perlu Anda pastikan sendiri.
