/**
 * OPSIONAL: salin produk (harga & stok terkini) dari file SQLite lama ke Turso.
 * Pakai bila Anda sudah mengubah harga/stok di versi lokal dan tidak mau memakai data awal.
 *
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/migrate-products.js path/ke/toko_tembakau.db
 *
 * Gambar yang diunggah lewat admin versi lama (/images/uploads/...) tidak ikut; unggah ulang dari panel admin.
 */
const { createClient } = require('@libsql/client');
const path = require('path');
const db = require('../lib/db');

(async () => {
  const src = process.argv[2];
  if (!src) { console.error('Pemakaian: node scripts/migrate-products.js <file toko_tembakau.db>'); process.exit(1); }
  const old = createClient({ url: 'file:' + path.resolve(src) });
  const rs = await old.execute('SELECT * FROM products ORDER BY id');
  await db.init();
  let n = 0;
  for (const r of rs.rows) {
    await db.run(`INSERT INTO products (kode_produk, nama, kategori, karakteristik, berat, harga, stok, gambar, deskripsi)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(kode_produk) DO UPDATE SET nama=excluded.nama, kategori=excluded.kategori, karakteristik=excluded.karakteristik,
                    berat=excluded.berat, harga=excluded.harga, stok=excluded.stok, gambar=excluded.gambar, deskripsi=excluded.deskripsi`,
      [r.kode_produk, r.nama, r.kategori, r.karakteristik, r.berat, r.harga, r.stok, r.gambar, r.deskripsi]);
    n++;
  }
  console.log(`${n} produk disalin.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
