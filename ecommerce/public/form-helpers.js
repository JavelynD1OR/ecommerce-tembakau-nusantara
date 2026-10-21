/**
 * Helper form bersama (halaman login & toko):
 *  - ikon mata untuk melihat/menyembunyikan password
 *  - cek konfirmasi password langsung saat mengetik
 *  - gabung & validasi alamat per-kotak (format sama dengan checkout)
 */
(function () {
  const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function initPasswordToggles(root) {
    (root || document).querySelectorAll('input[type="password"]').forEach(inp => {
      if (inp.dataset.pwInit) return;
      inp.dataset.pwInit = '1';
      const wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle';
      btn.title = 'Lihat password';
      btn.setAttribute('aria-label', 'Tampilkan password');
      btn.innerHTML = EYE;
      btn.addEventListener('click', () => {
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        btn.innerHTML = show ? EYE_OFF : EYE;
        btn.title = show ? 'Sembunyikan password' : 'Lihat password';
        btn.setAttribute('aria-label', btn.title);
      });
      wrap.appendChild(btn);
    });
  }

  // Petunjuk langsung: password & konfirmasi sama / belum sama
  function bindPasswordMatch(passId, pass2Id, hintId) {
    const p1 = document.getElementById(passId), p2 = document.getElementById(pass2Id), hint = document.getElementById(hintId);
    if (!p1 || !p2 || !hint) return;
    const update = () => {
      if (!p2.value) { hint.textContent = ''; return; }
      const same = p1.value === p2.value;
      hint.textContent = same ? '✓ Password cocok' : '✕ Password belum sama';
      hint.style.color = same ? '#047857' : '#B91C1C';
    };
    p1.addEventListener('input', update);
    p2.addEventListener('input', update);
  }

  function val(prefix, f) {
    return (document.getElementById(prefix + '-' + f)?.value || '').trim();
  }

  function combineAddress(prefix) {
    return `${val(prefix, 'jalan')}, RT/RW ${val(prefix, 'rtrw')}, Kel. ${val(prefix, 'kelurahan')}, Kec. ${val(prefix, 'kecamatan')}, ${val(prefix, 'kota')}, ${val(prefix, 'provinsi')} ${val(prefix, 'kodepos')}`;
  }

  function validateAddress(prefix) {
    const fields = [
      ['jalan', 'Nama Jalan / Gedung / No. Rumah / Patokan'], ['rtrw', 'RT / RW (Contoh: 002/005)'],
      ['kelurahan', 'Desa / Kelurahan'], ['kecamatan', 'Kecamatan'], ['kota', 'Kota / Kabupaten'],
      ['provinsi', 'Provinsi'], ['kodepos', 'Kode Pos (5 digit angka)']
    ];
    for (const [f, label] of fields) {
      const el = document.getElementById(prefix + '-' + f);
      if (!el || !el.value.trim()) { if (el) el.focus(); return { valid: false, message: 'Harap lengkapi kotak alamat: ' + label + '.' }; }
      if (f === 'kodepos' && !/^\d{5}$/.test(el.value.trim())) { el.focus(); return { valid: false, message: 'Kode pos harus terdiri dari 5 digit angka.' }; }
    }
    return { valid: true };
  }

  window.NT = { initPasswordToggles, bindPasswordMatch, combineAddress, validateAddress };
  document.addEventListener('DOMContentLoaded', () => initPasswordToggles());
})();
