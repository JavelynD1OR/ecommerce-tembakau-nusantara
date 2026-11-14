/**
 * DATA PEMBAYARAN MANUAL (transfer bank / QRIS / e-wallet).
 * Ubah nomor rekening, nama pemilik, atau nomor WhatsApp admin di SINI saja,
 * lalu Commit & Push. Tidak ada kunci rahasia di file ini (hanya info yang memang
 * ditampilkan ke pelanggan).
 */
module.exports = {
  // Nomor WhatsApp admin penerima bukti pembayaran (format 62..., tanpa + atau 0 di depan)
  whatsapp: '6285385490505',
  whatsappDisplay: '0853-8549-0505',

  // Urutan di sini = urutan tampil di halaman checkout.
  methods: [
    {
      code: 'm_qris', type: 'qris', label: 'QRIS', badge: 'QR',
      desc: 'Scan dengan e-wallet / m-banking apa pun',
      image: '/images/qris.jpg', merchant: 'Uzee21'
    },
    {
      code: 'm_bca', type: 'bank', label: 'Transfer BCA', badge: 'BCA',
      desc: 'Transfer ke rekening BCA',
      bank: 'BCA', number: '2221186682', holder: 'Wahyu Dwi Saputra'
    },
    {
      code: 'm_bni', type: 'bank', label: 'Transfer BNI', badge: 'BNI',
      desc: 'Transfer ke rekening BNI',
      bank: 'BNI', number: '0104369968', holder: 'Mus Muamil'
    },
    {
      code: 'm_dana', type: 'ewallet', label: 'DANA', badge: 'DANA',
      desc: 'Kirim saldo ke nomor DANA',
      bank: 'DANA', number: '082136326320', holder: 'Daskinem'
    },
    {
      code: 'm_jago', type: 'bank', label: 'Transfer Bank Jago', badge: 'JAGO',
      desc: 'Transfer ke rekening Bank Jago',
      bank: 'Bank Jago', number: '103343608037', holder: 'Muhamad Fauzi'
    }
  ]
};
