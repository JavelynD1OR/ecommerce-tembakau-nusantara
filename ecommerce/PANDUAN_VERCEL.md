# Deploy ke Vercel — Toko Nusantara Tobacco

Versi ini sudah disesuaikan untuk Vercel. Perubahan utama dari versi lokal:

| Sebelumnya | Sekarang di Vercel | Alasan |
|---|---|---|
| SQLite file `toko_tembakau.db` | **Turso** (SQLite online, gratis) | Disk Vercel tidak permanen, data akan hilang |
| `server.js` berjalan terus | `api/index.js` (serverless function) | Vercel tidak menjalankan server permanen |
| Pemeriksa kedaluwarsa tiap menit (`setInterval`) | Vercel Cron harian + dibersihkan juga saat daftar produk dibuka + webhook Midtrans | Tidak ada proses yang hidup terus |
| Foto produk disimpan ke folder | Foto disimpan di database (maks 3 MB) | Tidak bisa menulis file di Vercel |
| `.env` | Environment Variables di dashboard Vercel | `.env` tidak ikut ter-upload |

Alur pembayaran, harga, stok, pembatalan, dan panel admin **tidak berubah**.

## 1. Buat database Turso (gratis, ±5 menit)

1. Daftar di https://turso.tech, lalu buat database (nama bebas, mis. `toko-nusantara`, lokasi **Singapore**).
2. Buka database > **Generate Token** (read & write). Salin:
   - **URL**: `libsql://toko-nusantara-xxxx.turso.io`
   - **Token**: teks panjang `eyJ...`

Tabel dan 8 produk awal dibuat otomatis saat pertama kali dibuka. Tidak ada yang perlu diimpor.
(Opsional: bila sudah mengubah harga/stok di versi lokal, jalankan `npm run migrate:produk -- toko_tembakau.db` dengan `TURSO_*` terisi.)

## 2. Upload ke Vercel

Cara termudah lewat GitHub:
1. Buat repository GitHub (private), upload isi folder ini (file `.env` dan `*.db` sudah di-`.gitignore`).
2. Di https://vercel.com > **Add New Project** > pilih repository. Framework: **Other**. Build/Output biarkan kosong. 
3. **Sebelum klik Deploy**, buka **Environment Variables** dan isi (centang Production, Preview):

| Nama | Isi |
|---|---|
| `TURSO_DATABASE_URL` | URL dari langkah 1 |
| `TURSO_AUTH_TOKEN` | token dari langkah 1 |
| `JWT_SECRET` | teks acak ≥ 32 karakter (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `ADMIN_USERNAME` | `admin` (atau ganti) |
| `ADMIN_PASSWORD` | password admin yang kuat (bukan `admin123`) |
| `CRON_SECRET` | teks acak apa saja |
| `MIDTRANS_SERVER_KEY` | Server Key (Sandbox dulu) |
| `MIDTRANS_CLIENT_KEY` | Client Key (Sandbox dulu) |
| `MIDTRANS_IS_PRODUCTION` | `false` (Sandbox) / `true` (uang asli) |
| `STORE_WHATSAPP` | `62812...` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GOOGLE_CLIENT_ID` | opsional |

4. **Deploy**. (Atau lewat CLI: `npm i -g vercel`, lalu `vercel` dan `vercel --prod`.)

## 3. Cek bahwa semuanya benar

Buka `https://NAMA-ANDA.vercel.app/api/healthz`. Harus tampil `"ok": true`, `"database": "ok"`, `"missing": []`.
Bila `ok: false`, daftar `missing` menyebut variabel yang belum diisi (nama saja, tanpa isi rahasia).
Setelah mengubah Environment Variables, lakukan **Redeploy** agar berlaku.

## 4. Webhook Midtrans (wajib)

Dashboard Midtrans > Settings > Configuration > **Payment Notification URL**:
`https://NAMA-ANDA.vercel.app/api/payments/midtrans/notification`

Pastikan environment dashboard (Sandbox/Production) sama dengan kunci yang dipakai di Vercel.

## 5. Go-live (uang asli)

Ganti `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY` ke kunci **Production**, `MIDTRANS_IS_PRODUCTION=true`, Redeploy, dan coba satu transaksi nominal kecil.
Bila `MIDTRANS_IS_PRODUCTION=true` tetapi key berawalan `SB-`, pembayaran otomatis dinonaktifkan demi keamanan.

## Catatan

- **Mode simulasi bayar tidak ada di Vercel** (hanya lokal tanpa kunci). Di Vercel wajib kunci Midtrans (Sandbox boleh).
- Paket Vercel **Hobby** hanya mengizinkan Cron 1x/hari. Itu cukup, karena Midtrans sendiri mengirim webhook "expire" dan server juga membersihkan pesanan kedaluwarsa tiap ada yang membuka daftar produk/pesanan admin.
- Paket Hobby Vercel secara aturan ditujukan untuk penggunaan non-komersial; toko berjualan sungguhan sebaiknya memakai paket **Pro**. Cek syarat terbaru di vercel.com/pricing.
- Pembatas percobaan login (rate limit) kini disimpan di database agar bekerja di serverless.
- Uji lokal tetap bisa: `npm install`, salin `.env.example` ke `.env`, `npm start` (memakai file `local.db`, ada mode simulasi).
