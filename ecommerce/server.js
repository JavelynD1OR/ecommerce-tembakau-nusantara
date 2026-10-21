/**
 * Menjalankan toko di komputer sendiri (uji lokal): npm start
 * Di Vercel file ini TIDAK dipakai; yang dipakai adalah api/index.js.
 */
const app = require('./lib/app');
const db = require('./lib/db');

const PORT = app.PORT;
db.init()
  .then(() => app.listen(PORT, () => console.log(`Toko berjalan di http://localhost:${PORT}  (database: ${db.isRemote ? 'Turso' : 'file local.db'})`)))
  .catch(e => { console.error('Gagal menyiapkan database:', e.message); process.exit(1); });
