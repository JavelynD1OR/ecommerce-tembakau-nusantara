# Sistem Informasi E-Commerce Penjualan Tembakau dan Alat Linting serta Manajemen Stok Berbasis Web
**Studi Kasus: Toko Nusantara Tobacco**  
*Proyek Tugas Akhir / Skripsi Sarjana Jurusan Sistem Informasi*

---


---

## 💳 UPDATE: PEMBAYARAN NYATA (Midtrans) & PENGAMANAN

Dokumen lengkap: **PANDUAN_PEMBAYARAN.md** (cara daftar Midtrans, uji sandbox, go-live, deploy).

**Apa yang berubah**
- Tombol "Saya Sudah Bayar" dihapus. Status **Lunas hanya berubah setelah Midtrans mengonfirmasi dana masuk** (webhook bertanda-tangan + cek ulang ke API Midtrans).
- Pelanggan membayar lewat popup Midtrans Snap: QRIS dinamis (nominal otomatis), DANA/GoPay/ShopeePay, Virtual Account bank. QRIS/rekening statis palsu di kode sudah dibuang. Dana masuk ke rekening yang Anda daftarkan di Midtrans.
- Harga, ongkir, dan total dihitung **server** (tidak bisa diubah dari browser). Stok dikurangi saat pesanan dibuat dan **dikembalikan otomatis** jika tidak dibayar dalam batas waktu (default 3 jam).
- Status baru: *Menunggu Pembayaran* -> *Diproses* (otomatis setelah lunas) -> *Dikirim* -> *Selesai*; juga *Kedaluwarsa* / *Dibatalkan*. Admin tidak bisa mengirim pesanan yang belum lunas.
- Keamanan: password di-hash (bcrypt), token login JWT bertanda-tangan, admin memakai password dari `.env`, endpoint pesanan hanya bisa diakses pemiliknya, login Google palsu/"akun cepat" dihapus (Google asli opsional), rate-limit login, validasi upload gambar, sanitasi input.
- Laporan & omzet admin hanya menghitung pesanan yang benar-benar lunas.
- Tanpa kunci Midtrans, aplikasi berjalan dalam **MODE SIMULASI** (halaman /simulasi-bayar.html) khusus uji lokal; mode ini otomatis mati bila `NODE_ENV=production`.

**Deploy ke Vercel: lihat PANDUAN_VERCEL.md.** Uji lokal: `npm install`, salin `.env.example` menjadi `.env`, lalu `npm start`.
Akun admin: sesuai `ADMIN_USERNAME` / `ADMIN_PASSWORD` di `.env` (bawaan lokal jika kosong: admin / admin123, hanya untuk uji lokal).
Akun pelanggan: daftar sendiri di halaman toko (password minimal 8 karakter).

---

## 📌 1. Deskripsi Proyek
Aplikasi web ini merupakan sistem informasi e-commerce terintegrasi yang dirancang khusus untuk toko UMKM tembakau tradisional nusantara dan peralatan linting (*Toko Nusantara Tobacco*). Sistem ini mengintegrasikan fungsi penjualan langsung pelanggan (*Customer Facing Store*) dengan sistem manajemen stok persediaan dan pelacakan pesanan secara otomatis (*Back-Office Administration*).

Sistem dirancang dengan pendekatan **Clean, Minimalis, Natural, dan Fungsional** layaknya toko e-commerce UMKM profesional sungguhan, tanpa elemen visual berlebihan, sehingga sangat cocok untuk kebutuhan pengujian sidang dan implementasi nyata.

---

## 🎨 2. Prinsip Desain UI/UX
- **Palet Warna Alami UMKM**:
  - Background Utama: Warm Off-White / Krem Muda (`#F6F5F2`)
  - Permukaan Kartu & Tabel: Putih Bersih (`#FFFFFF`) dengan border tegas (`1px solid #E2DFD9`) dan sudut melengkung halus (`border-radius: 8px`).
  - Warna Utama (Primary): Coklat Tembakau Klasik (`#5C3A21`) & Hover Coklat Tua (`#422815`).
  - Warna Teks: Charcoal Gelap (`#1F2937`) untuk heading/teks utama & Abu-abu Sedang (`#6B7280`) untuk teks pendukung.
  - Warna Status Pesanan:
    - **Selesai**: Hijau Tenang (`#DEF7EC` / `#03543F`)
    - **Menunggu Konfirmasi**: Kuning Amber (`#FEF3C7` / `#92400E`)
    - **Diproses**: Biru Formal (`#E1EFFE` / `#1E429F`)
    - **Dikirim**: Ungu Pengiriman (`#EDEBFE` / `#5521B5`)
- **Peringatan Wajib Regulasi**: Banner peringatan batas usia (*18+ Khusus Dewasa*) tersemat pada header aplikasi sesuai regulasi peredaran tembakau.

---

## 🛠️ 3. Tech Stack & Arsitektur
- **Runtime & Server**: Node.js & Express.js
- **Database**: SQLite3 (`better-sqlite3` dengan berkas lokal `toko_tembakau.db`)
- **Frontend**: Vanilla HTML5 Semantik, CSS3 Modern (CSS Variables & Flex/Grid), Vanilla JavaScript Modern (Fetch API, DOM Events, LocalStorage)
- **Aset Gambar**: 8 foto katalog produk studio nyata tersimpan di `public/images/`.

---

## 🗄️ 4. Struktur Database SQLite (`toko_tembakau.db`)

### A. Tabel `users` (Akun Pelanggan & Alamat Tersimpan)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Identitas unik pengguna |
| `nama` | TEXT NOT NULL | Nama lengkap pengguna |
| `email` | TEXT UNIQUE NOT NULL | Email Google / terdaftar |
| `no_hp` | TEXT | Nomor WhatsApp / Telepon aktif |
| `alamat` | TEXT | Alamat pengiriman pribadi tersimpan |
| `avatar` | TEXT | Foto profil akun Google |
| `created_at` | TEXT NOT NULL | Waktu pendaftaran akun |

### B. Tabel `products` (Katalog & Stok Barang)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Identitas unik produk |
| `kode_produk` | TEXT UNIQUE NOT NULL | Kode SKU barang (misal: `TMB-001`, `ALT-001`) |
| `nama` | TEXT NOT NULL | Nama lengkap produk |
| `kategori` | TEXT NOT NULL | Kategori (*Tembakau Nusantara*, *Tembakau Flavour*, *Alat Linting*, *Paket Bundling*) |
| `karakteristik`| TEXT | Ulasan rasa / spesifikasi (misal: *Strong - Gurih Alami*) |
| `berat` | INTEGER | Berat bersih dalam satuan gram |
| `harga` | INTEGER NOT NULL | Harga jual satuan (Rupiah) |
| `stok` | INTEGER NOT NULL | Jumlah persediaan fisik di gudang toko |
| `gambar` | TEXT | URL / path file gambar produk |
| `deskripsi` | TEXT | Deskripsi lengkap produk dan keunggulan |

### C. Tabel `orders` (Transaksi Penjualan)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Identitas unik pesanan |
| `user_id` | INTEGER | Relasi FK ke tabel `users` (Akun pemesan) |
| `no_invoice` | TEXT UNIQUE NOT NULL | Format: `INV-YYYYMMDD-XXXX` |
| `nama_pelanggan`| TEXT NOT NULL | Nama lengkap penerima barang |
| `no_hp` | TEXT NOT NULL | Nomor WhatsApp / Telepon aktif penerima |
| `alamat` | TEXT NOT NULL | Alamat pengiriman lengkap |
| `kurir` | TEXT NOT NULL | Jasa ekspedisi (JNE, J&T, SiCepat, Ambil di Toko) |
| `ongkir` | INTEGER NOT NULL | Biaya ongkos kirim (Rp) |
| `metode_bayar`| TEXT NOT NULL | Pilihan bayar (QRIS, Transfer BCA, COD) |
| `total_belanja`| INTEGER NOT NULL | Subtotal harga produk |
| `total_bayar` | INTEGER NOT NULL | Total belanja + ongkos kirim |
| `status` | TEXT NOT NULL | *Menunggu Konfirmasi*, *Diproses*, *Dikirim*, *Selesai* |
| `no_resi` | TEXT | Nomor resi pelacakan ekspedisi dari Admin |
| `items_json` | TEXT NOT NULL | Serialisasi JSON rincian item, kuantitas & harga |
| `created_at` | TEXT NOT NULL | Waktu transaksi dibuat (WIB) |

---

## 👥 5. Fitur Utama & Pemisahan 2 Role Pengguna

### A. Role Pelanggan (Front-Office di `http://localhost:3000`):
1. **Autentikasi Akun Google & Proteksi Orderan Anti-Fiktif (Seperti Shopee/Tokopedia)**:
   - Pelanggan diwajibkan masuk terlebih dahulu sebelum dapat melakukan checkout.
   - Tersedia tombol resmi **"Lanjutkan dengan Akun Google"** dan pilihan akun cepat siap uji untuk dosen penguji skripsi.
   - Menu profil dropdown menampilkan status akun terverifikasi dan menu kelola **Alamat Pengiriman Saya**.
   - Saat checkout, form Nama, No. WhatsApp, dan Alamat Pengiriman **otomatis terisi (*auto-fill*)** dari profil tersimpan.
2. **Katalog Produk Real-Time**:
   - Tab filter kategori (*Semua*, *Tembakau Nusantara*, *Tembakau Flavour*, *Alat Linting*, *Paket Bundling*).
   - Kolom pencarian real-time berdasarkan nama produk, rasa, maupun kode SKU.
   - Pilihan pengurutan (*Termurah, Termahal, A-Z, Stok Terbanyak*).
   - Kartu produk informatif: foto produk, kategori, karakteristik, berat, harga Rupiah, dan indikator sisa stok gudang (*Stok Tersedia, Sisa Sedikit, Stok Habis*).
   - Tombol `+ Keranjang` otomatis nonaktif jika stok = 0.
3. **Keranjang Belanja & Validasi Stok Gudang**:
   - Kontrol kuantitas (`-` / `+`) yang secara ketat tervalidasi agar pembelian tidak melebihi sisa stok di database.
   - Pilihan ekspedisi pengiriman lengkap dengan tarif ongkir (JNE Rp15.000, J&T Rp16.000, SiCepat Rp14.000, Ambil di Toko Rp0).
   - Pilihan metode bayar (QRIS, Transfer Bank BCA, Bayar di Tempat/COD).
   - Kalkulasi otomatis Subtotal + Ongkir = Total Tagihan.
4. **Checkout Atomik & Pengurangan Stok Otomatis**:
   - Saat checkout dikonfirmasi, transaksi database (`db.transaction`) memvalidasi stok riil gudang dan secara atomik langsung **mengurangi stok produk**.
   - Sistem menerbitkan nomor invoice unik (`INV-YYYYMMDD-XXXX`).
   - Modal konfirmasi menampilkan ringkasan tagihan, QRIS, dan tombol konfirmasi otomatis langsung ke WhatsApp Toko.
5. **Halaman Pesanan Saya**:
   - Otomatis memfilter dan menampilkan riwayat transaksi akun pelanggan yang sedang login.
   - Menampilkan status pesanan terkini dan **Nomor Resi Pengiriman** yang diinput oleh Admin dengan fitur salin cepat.

### B. Role Administrator (Back-Office Terpisah di `http://localhost:3000/admin`):
Halaman admin dibuat **sepenuhnya terpisah** dari antarmuka toko pelanggan untuk menjaga keamanan data dan sesuai arsitektur sistem informasi enterprise:
1. **Layar Login Khusus Administrator**:
   - URL khusus: `http://localhost:3000/admin`.
   - Autentikasi terpisah (username/password dari file `.env`).
2. **Dashboard 4 Kartu Statistik**:
   - Total Jenis Produk
   - Total Stok Tersedia di Gudang (pcs)
   - Total Pesanan Masuk
   - Total Omzet Penjualan (Rp)
2. **Kelola Data Produk (CRUD & Manajemen Stok)**:
   - Tambah produk baru dengan modal dialog.
   - Edit data produk (nama, harga, kategori, karakteristik, foto, dan penambahan/penyesuaian stok).
   - Hapus produk dengan konfirmasi proteksi.
3. **Kelola Pesanan Masuk & Pelacakan Resi**:
   - Tabel pesanan lengkap dengan nama penerima, nomor WhatsApp, alamat tujuan, dan daftar barang.
   - Fitur ubah status pesanan (*Menunggu Konfirmasi* -> *Diproses* -> *Dikirim* -> *Selesai*).
   - Input nomor resi pengiriman kurir (misal: `JNE88291039401`).
4. **Cetak Laporan Penjualan (Window Print)**:
   - Disediakan kop surat resmi: *TOKO NUSANTARA TOBACCO*.
   - Tabel rekapitulasi transaksi dan total omzet bersih.
   - Format tanda tangan pemilik toko untuk kelengkapan berkas skripsi/tugas akhir.

---

## 🚀 6. Cara Menjalankan Aplikasi

### Langkah 1: Buka Terminal pada Direktori Proyek
```bash
cd "C:\Users\sapuo\OneDrive\Desktop\ecommerce"
```

### Langkah 2: Instal Dependensi (Jika Belum)
```bash
npm install
```

### Langkah 3: Jalankan Server
```bash
node server.js
```
*Atau gunakan mode dev:*
```bash
npm run dev
```

### Langkah 4: Buka di Browser
Akses aplikasi melalui browser di:
```
http://localhost:3000
```

---

## 🔑 7. Akun Administrator
- Diatur di file `.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`). Tidak ada lagi kredensial bawaan di halaman login.

---

## 📁 8. Struktur Direktori Proyek (Multi-Page Architecture)
```
ecommerce/
├── package.json              # Konfigurasi dependensi (express, better-sqlite3)
├── server.js                 # Backend Express & Transaksi SQLite Multi-Page
├── toko_tembakau.db          # Berkas Database SQLite (users, products, orders)
├── README.md                 # Dokumentasi sistem skripsi
└── public/
    ├── index.html            # 1. Khusus Halaman Toko / Pelanggan (Tanpa Menu Admin)
    ├── login.html            # 2. Halaman Login Terpusat (Pelanggan / Admin dengan Role Redirect)
    ├── admin.html            # 3. Khusus Dashboard Admin (Layout Sidebar Profesional)
    ├── admin.js              # Logika Back-Office Admin (Dashboard, CRUD, Resi, Laporan)
    ├── app.js                # Logika Front-Office Toko (Katalog, Keranjang, Checkout, Profil)
    ├── style.css             # Desain sistem & stylesheet UMKM profesional
    └── images/               # Koleksi foto produk nyata beresolusi tinggi
        ├── temanggung_srinthil.jpg
        ├── gayo_hijau.jpg
        ├── kasturi_madura.jpg
        ├── mole_vanilla.jpg
        ├── handroller_110.jpg
        ├── papir_manis.jpg
        ├── busa_filter.jpg
        └── paket_bundling.jpg
```
