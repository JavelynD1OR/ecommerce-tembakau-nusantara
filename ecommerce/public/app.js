/**
 * TOKO NUSANTARA TOBACCO - LOGIKA APLIKASI WEB PELANGGAN
 * Sistem Informasi E-Commerce & Manajemen Stok Berbasis Web
 * Dilengkapi Login Google & Pengelolaan Alamat Pribadi (Anti-Pesanan Fiktif)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ========================================================
  // STATE APLIKASI PELANGGAN
  // ========================================================
  const state = {
    products: [],
    catalogFiltered: [],
    activeCategory: 'Semua',
    searchQuery: '',
    sortBy: 'default',

    // Keranjang Belanja disimpan di LocalStorage
    cart: JSON.parse(localStorage.getItem('nusantara_cart')) || [],

    // Akun Pengguna Pelanggan (Login Google / Akun Terdaftar)
    currentUser: JSON.parse(localStorage.getItem('nusantara_user')) || null,
    userToken: localStorage.getItem('nusantara_user_token') || null,

    // Pesanan Pengguna
    userOrders: []
  };

  function formatRupiah(number) {
    return 'Rp ' + Number(number || 0).toLocaleString('id-ID');
  }

  // Escape teks dari server sebelum dimasukkan ke innerHTML (cegah XSS)
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Fetch dengan token login pelanggan. Jika sesi habis (401) -> otomatis keluar.
  async function authFetch(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.userToken) headers['Authorization'] = 'Bearer ' + state.userToken;
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401 && state.userToken) {
      state.currentUser = null;
      state.userToken = null;
      localStorage.removeItem('nusantara_user');
      localStorage.removeItem('nusantara_user_token');
      try { renderUserAuthState(); } catch (e) { /* belum siap */ }
    }
    return res;
  }

  // Konfigurasi publik dari server (mode pembayaran, kunci client Midtrans, Google Client ID)
  state.config = { paymentMode: 'disabled', googleClientId: '', storeWhatsapp: '' };
  const configReady = fetch('/api/config').then(r => r.json()).then(j => {
    if (j.success) state.config = j.data;
    applyConfigToUi();
  }).catch(() => { });

  function formatTanggalIndo(dateStr) {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr.replace(' ', 'T'));
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB';
    } catch {
      return dateStr;
    }
  }

  // ========================================================
  // 1. HELPER FORM ALAMAT PER-KOTAK (TERSTRUKTUR)
  // ========================================================
  function combineAddressFields(prefix) {
    const jalan = (document.getElementById(`${prefix}-jalan`)?.value || '').trim();
    const rtrw = (document.getElementById(`${prefix}-rtrw`)?.value || '').trim();
    const kel = (document.getElementById(`${prefix}-kelurahan`)?.value || '').trim();
    const kec = (document.getElementById(`${prefix}-kecamatan`)?.value || '').trim();
    const kota = (document.getElementById(`${prefix}-kota`)?.value || '').trim();
    const prov = (document.getElementById(`${prefix}-provinsi`)?.value || '').trim();
    const pos = (document.getElementById(`${prefix}-kodepos`)?.value || '').trim();

    if (!jalan && !rtrw && !kel && !kec && !kota && !prov && !pos) return '';
    return `${jalan}, RT/RW ${rtrw}, Kel. ${kel}, Kec. ${kec}, ${kota}, ${prov} ${pos}`.trim();
  }
  window.combineAddressFields = combineAddressFields;

  function fillAddressFields(prefix, fullAddressStr) {
    const setVal = (field, val) => {
      const el = document.getElementById(`${prefix}-${field}`);
      if (el) el.value = val ? val.trim() : '';
    };

    if (!fullAddressStr) {
      ['jalan', 'rtrw', 'kelurahan', 'kecamatan', 'kota', 'provinsi', 'kodepos'].forEach(f => setVal(f, ''));
      return;
    }

    let str = fullAddressStr.trim();
    let pos = '';
    const posMatch = str.match(/\b(\d{5})$/);
    if (posMatch) {
      pos = posMatch[1];
      str = str.replace(/\s*\b\d{5}$/, '').trim();
    }

    const regex = /^(.*?)(?:,\s*RT\/RW\s*([^,]+))?(?:,\s*Kel\.\s*([^,]+))?(?:,\s*Kec\.\s*([^,]+))?(?:,\s*([^,]+))?(?:,\s*(.+))?$/i;
    const match = str.match(regex);

    if (match && (match[2] || match[3] || match[4])) {
      setVal('jalan', match[1] || '');
      setVal('rtrw', match[2] || '');
      setVal('kelurahan', match[3] || '');
      setVal('kecamatan', match[4] || '');
      setVal('kota', match[5] || '');
      setVal('provinsi', match[6] || '');
      setVal('kodepos', pos);
    } else {
      const parts = str.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 6) {
        setVal('jalan', parts[0]);
        setVal('rtrw', parts[1].replace(/^RT\/RW\s*/i, ''));
        setVal('kelurahan', parts[2].replace(/^Kel\.\s*/i, ''));
        setVal('kecamatan', parts[3].replace(/^Kec\.\s*/i, ''));
        setVal('kota', parts[4]);
        setVal('provinsi', parts.slice(5).join(', '));
        setVal('kodepos', pos);
      } else {
        setVal('jalan', fullAddressStr);
        setVal('rtrw', '');
        setVal('kelurahan', '');
        setVal('kecamatan', '');
        setVal('kota', '');
        setVal('provinsi', '');
        setVal('kodepos', pos);
      }
    }
  }
  window.fillAddressFields = fillAddressFields;

  function validateAddressFields(prefix) {
    const fields = [
      { id: `${prefix}-jalan`, label: 'Nama Jalan / Gedung / No. Rumah / Patokan' },
      { id: `${prefix}-rtrw`, label: 'RT / RW (Contoh: 002/005)' },
      { id: `${prefix}-kelurahan`, label: 'Desa / Kelurahan' },
      { id: `${prefix}-kecamatan`, label: 'Kecamatan' },
      { id: `${prefix}-kota`, label: 'Kota / Kabupaten' },
      { id: `${prefix}-provinsi`, label: 'Provinsi' },
      { id: `${prefix}-kodepos`, label: 'Kode Pos (5 digit angka)' }
    ];

    for (const f of fields) {
      const el = document.getElementById(f.id);
      if (!el || !el.value.trim()) {
        if (el) el.focus();
        return { valid: false, message: `Harap lengkapi kotak alamat: ${f.label}.` };
      }
      if (f.id.endsWith('-kodepos') && !/^\d{5}$/.test(el.value.trim())) {
        el.focus();
        return { valid: false, message: 'Kode pos harus terdiri dari 5 digit angka.' };
      }
    }
    return { valid: true };
  }

  // ========================================================
  // 2. HELPER CLIPBOARD & DEEPLINK APLIKASI
  // ========================================================
  window.copyToClipboard = function (text, label) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(String(text)).then(() => {
        showToast(`✓ Berhasil menyalin ${label || text}`);
      }).catch(() => fallbackCopy(text, label));
    } else {
      fallbackCopy(text, label);
    }
  };

  function fallbackCopy(text, label) {
    const textArea = document.createElement('textarea');
    textArea.value = String(text);
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(`✓ Berhasil menyalin ${label || text}`);
    } catch (err) {
      showToast(`Gagal menyalin: ${text}`);
    }
    document.body.removeChild(textArea);
  }

  function storeContactUrl(order) {
    const wa = (state.config && state.config.storeWhatsapp) || '';
    if (!wa) return '#';
    const text = `Halo Nusantara Tobacco, saya ingin menanyakan pesanan ${order.no_invoice}.`;
    return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
  }

  function saveCart() {
    localStorage.setItem('nusantara_cart', JSON.stringify(state.cart));
    updateCartBadge();
  }

  function updateCartBadge() {
    const badge = document.getElementById('cart-counter-badge');
    const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
    if (totalQty > 0) {
      badge.textContent = totalQty;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function showToast(msg) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.position = 'fixed';
      toast.style.bottom = '24px';
      toast.style.right = '24px';
      toast.style.backgroundColor = '#1F2937';
      toast.style.color = '#FFFFFF';
      toast.style.padding = '10px 18px';
      toast.style.borderRadius = '8px';
      toast.style.fontSize = '0.88rem';
      toast.style.fontWeight = '500';
      toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      toast.style.zIndex = '9999';
      toast.style.transition = 'opacity 0.2s ease';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { toast.style.display = 'none'; }, 200);
    }, 2200);
  }

  // ========================================================
  // NAVIGASI VIEW
  // ========================================================
  const views = {
    catalog: document.getElementById('view-catalog'),
    cart: document.getElementById('view-cart'),
    orders: document.getElementById('view-orders')
  };

  const navButtons = {
    catalog: document.getElementById('nav-catalog-btn'),
    cart: document.getElementById('nav-cart-btn'),
    orders: document.getElementById('nav-orders-btn')
  };

  function switchView(viewName) {
    Object.keys(views).forEach(key => {
      if (views[key]) {
        views[key].style.display = (key === viewName) ? 'block' : 'none';
      }
      if (navButtons[key]) {
        navButtons[key].classList.toggle('active', key === viewName);
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (viewName === 'catalog') {
      fetchProducts();
    } else if (viewName === 'cart') {
      renderCart();
    } else if (viewName === 'orders') {
      fetchCustomerOrders();
    }
  }

  document.getElementById('brand-home-btn').addEventListener('click', () => switchView('catalog'));
  navButtons.catalog.addEventListener('click', () => switchView('catalog'));
  navButtons.cart.addEventListener('click', () => switchView('cart'));
  navButtons.orders.addEventListener('click', () => switchView('orders'));

  document.getElementById('btn-back-to-shop')?.addEventListener('click', () => switchView('catalog'));
  document.getElementById('btn-go-to-myorders')?.addEventListener('click', () => {
    document.getElementById('modal-checkout-success').close();
    switchView('orders');
  });

  // ========================================================
  // AUTENTIKASI PELANGGAN & PROFIL ALAMAT (LOGIN GOOGLE)
  // ========================================================
  const loginModal = document.getElementById('modal-customer-login');
  const userMenuBox = document.getElementById('user-logged-box');
  const btnOpenLogin = document.getElementById('btn-open-login');
  const userDropdownMenu = document.getElementById('user-dropdown-menu');
  const addressModal = document.getElementById('modal-user-address');
  const orderConfirmModal = document.getElementById('modal-order-confirm');
  const paymentDetailModal = document.getElementById('modal-payment-detail');

  function renderUserAuthState() {
    if (state.currentUser) {
      btnOpenLogin.style.display = 'none';
      userMenuBox.style.display = 'block';

      document.getElementById('user-display-name').textContent = state.currentUser.nama.split(' ')[0];
      document.getElementById('dropdown-name').textContent = state.currentUser.nama;
      document.getElementById('dropdown-email').textContent = state.currentUser.email;
      if (state.currentUser.avatar) {
        document.getElementById('user-avatar-img').src = state.currentUser.avatar;
      }

      // Update Box Verifikasi di Form Checkout
      updateCheckoutAuthBox(true);
    } else {
      btnOpenLogin.style.display = 'inline-flex';
      userMenuBox.style.display = 'none';
      userDropdownMenu.classList.remove('show');

      // Update Box Verifikasi di Form Checkout
      updateCheckoutAuthBox(false);
    }
  }

  function updateCheckoutAuthBox(isLoggedIn) {
    const box = document.getElementById('checkout-auth-alert-box');
    const nameInput = document.getElementById('checkout-name');
    const phoneInput = document.getElementById('checkout-phone');

    if (!box) return;

    if (isLoggedIn && state.currentUser) {
      box.className = 'checkout-auth-alert verified';
      box.innerHTML = `
        <div style="font-size: 1.3rem;">✓</div>
        <div style="flex: 1;">
          <strong>Akun Pelanggan Terverifikasi Google</strong>
          <span>Masuk sebagai: <strong>${state.currentUser.nama}</strong> (${state.currentUser.email}). Data alamat pengiriman dan nomor kontak terisi otomatis dari profil Anda.</span>
          <div style="margin-top: 6px;">
            <button type="button" id="btn-edit-saved-address" class="btn-action btn-action-secondary" style="font-size: 0.78rem; padding: 3px 10px; background: #FFF;">
              ✏️ Sesuaikan Alamat Pengiriman
            </button>
          </div>
        </div>
      `;

      // Auto-fill data alamat tersimpan
      if (nameInput) nameInput.value = state.currentUser.nama || '';
      if (phoneInput) phoneInput.value = state.currentUser.no_hp || '';
      fillAddressFields('checkout-addr', state.currentUser.alamat || '');

      document.getElementById('btn-edit-saved-address')?.addEventListener('click', openAddressModal);
    } else {
      box.className = 'checkout-auth-alert unverified';
      box.innerHTML = `
        <div style="font-size: 1.3rem;">⚠️</div>
        <div style="flex: 1;">
          <strong>Verifikasi Akun Pelanggan Diperlukan</strong>
          <span>Untuk mencegah pesanan fiktif/iseng dari kalangan luar yang tidak bertanggung jawab, Anda wajib masuk terlebih dahulu. Data alamat dan kontak Anda akan tersimpan secara aman.</span>
          <div style="margin-top: 10px;">
            <button type="button" id="btn-checkout-login-trigger" class="btn-action btn-action-primary" style="font-size: 0.84rem; padding: 6px 14px;">
              🔑 Masuk / Daftar Akun dengan Google
            </button>
          </div>
        </div>
      `;

      document.getElementById('btn-checkout-login-trigger')?.addEventListener('click', () => {
        window.location.href = '/login.html';
      });
    }
  }

  btnOpenLogin.addEventListener('click', () => loginModal.showModal());

  // Toggle dropdown menu akun pengguna
  document.getElementById('btn-user-dropdown-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdownMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    userDropdownMenu.classList.remove('show');
  });

  // Modal Alamat Pengiriman
  function openAddressModal() {
    if (!state.currentUser) return;
    document.getElementById('profile-nama').value = state.currentUser.nama || '';
    document.getElementById('profile-email').value = state.currentUser.email || '';
    document.getElementById('profile-hp').value = state.currentUser.no_hp || '';
    fillAddressFields('profile-addr', state.currentUser.alamat || '');
    addressModal.showModal();
  }

  document.getElementById('btn-menu-address')?.addEventListener('click', () => {
    userDropdownMenu.classList.remove('show');
    openAddressModal();
  });

  document.getElementById('btn-menu-orders')?.addEventListener('click', () => {
    userDropdownMenu.classList.remove('show');
    switchView('orders');
  });

  document.getElementById('btn-menu-logout')?.addEventListener('click', () => {
    if (confirm('Yakin ingin keluar dari akun Anda?')) {
      state.currentUser = null;
      state.userToken = null;
      localStorage.removeItem('nusantara_user');
      localStorage.removeItem('nusantara_user_token');
      renderUserAuthState();
      showToast('Anda telah keluar dari akun.');
    }
  });

  // Simpan Alamat Profil
  document.getElementById('form-user-address')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentUser) return;

    const valRes = validateAddressFields('profile-addr');
    if (!valRes.valid) {
      alert(valRes.message);
      return;
    }

    const payload = {
      nama: document.getElementById('profile-nama').value.trim(),
      no_hp: document.getElementById('profile-hp').value.trim(),
      alamat: combineAddressFields('profile-addr')
    };

    try {
      const res = await authFetch(`/api/user/profile/${state.currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      state.currentUser = { ...state.currentUser, ...json.data };
      localStorage.setItem('nusantara_user', JSON.stringify(state.currentUser));

      // Sinkronkan juga ke form checkout yang sedang terbuka
      fillAddressFields('checkout-addr', state.currentUser.alamat);
      if (document.getElementById('checkout-name')) document.getElementById('checkout-name').value = state.currentUser.nama;
      if (document.getElementById('checkout-phone')) document.getElementById('checkout-phone').value = state.currentUser.no_hp;

      addressModal.close();
      renderUserAuthState();
      showToast('✓ Alamat pengiriman pribadi berhasil disimpan!');
    } catch (err) {
      alert('Gagal menyimpan alamat: ' + err.message);
    }
  });

  // Autentikasi Google (Google Identity Services - token diverifikasi di server)
  async function performGoogleAuth(credential) {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      state.currentUser = json.user;
      state.userToken = json.token;
      localStorage.setItem('nusantara_user', JSON.stringify(json.user));
      localStorage.setItem('nusantara_user_token', json.token);

      loginModal.close();
      renderUserAuthState();
      showToast(`✓ Selamat datang, ${json.user.nama}!`);

      if (views.orders.style.display === 'block') {
        fetchCustomerOrders();
      }
    } catch (err) {
      alert('Autentikasi Google gagal: ' + err.message);
    }
  }

  function loadScriptOnce(src, attrs = {}) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const sc = document.createElement('script');
      sc.src = src;
      Object.entries(attrs).forEach(([k, v]) => sc.setAttribute(k, v));
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('Gagal memuat ' + src));
      document.head.appendChild(sc);
    });
  }

  // Tampilkan tombol Google asli hanya jika toko sudah mengisi GOOGLE_CLIENT_ID
  async function applyConfigToUi() {
    const slot = document.getElementById('google-signin-slot');
    if (slot) {
      if (state.config.googleClientId) {
        slot.style.display = 'block';
        try {
          await loadScriptOnce('https://accounts.google.com/gsi/client');
          window.google.accounts.id.initialize({
            client_id: state.config.googleClientId,
            callback: (resp) => performGoogleAuth(resp.credential)
          });
          const btnBox = document.getElementById('google-signin-button');
          btnBox.innerHTML = '';
          window.google.accounts.id.renderButton(btnBox, { theme: 'outline', size: 'large', width: 320, text: 'continue_with', locale: 'id' });
        } catch (e) {
          slot.style.display = 'none';
        }
      } else {
        slot.style.display = 'none';
      }
    }
    const banner = document.getElementById('payment-mode-banner');
    if (banner) {
      if (state.config.paymentMode === 'mock') {
        banner.style.display = 'block';
        banner.innerHTML = '⚠️ <strong>MODE SIMULASI</strong> — kunci Midtrans belum diisi. Pembayaran hanya simulasi, tidak ada uang yang masuk.';
      } else if (state.config.paymentMode === 'disabled') {
        banner.style.display = 'block';
        banner.innerHTML = '⚠️ Pembayaran online belum diaktifkan oleh toko.';
      } else {
        banner.style.display = 'none';
      }
    }
  }

  // Tab Auth Manual
  const tabAuthLogin = document.getElementById('tab-auth-login');
  const tabAuthReg = document.getElementById('tab-auth-register');
  const formManualLogin = document.getElementById('form-customer-manual-login');
  const formManualReg = document.getElementById('form-customer-manual-register');

  tabAuthLogin?.addEventListener('click', () => {
    tabAuthLogin.classList.add('active');
    tabAuthReg.classList.remove('active');
    formManualLogin.style.display = 'block';
    formManualReg.style.display = 'none';
  });

  tabAuthReg?.addEventListener('click', () => {
    tabAuthReg.classList.add('active');
    tabAuthLogin.classList.remove('active');
    formManualReg.style.display = 'block';
    formManualLogin.style.display = 'none';
  });

  formManualLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('manual-login-email').value.trim();
    const password = document.getElementById('manual-login-password').value.trim();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      state.currentUser = json.user;
      state.userToken = json.token;
      localStorage.setItem('nusantara_user', JSON.stringify(json.user));
      localStorage.setItem('nusantara_user_token', json.token);

      loginModal.close();
      renderUserAuthState();
      showToast(`✓ Selamat datang, ${json.user.nama}!`);
    } catch (err) {
      alert('Login gagal: ' + err.message);
    }
  });

  if (window.NT) NT.bindPasswordMatch('reg-pass', 'reg-pass2', 'reg-pass-hint');

  formManualReg?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const addrVal = validateAddressFields('reg-addr');
    if (!addrVal.valid) { alert(addrVal.message); return; }
    const pw = document.getElementById('reg-pass').value;
    if (pw.length < 8) { alert('Password minimal 8 karakter.'); return; }
    if (pw !== document.getElementById('reg-pass2').value) {
      alert('Konfirmasi password tidak sama. Periksa kembali.');
      document.getElementById('reg-pass2').focus();
      return;
    }
    const payload = {
      nama: document.getElementById('reg-nama').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      password: pw,
      no_hp: document.getElementById('reg-hp').value.trim(),
      alamat: combineAddressFields('reg-addr')
    };

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      state.currentUser = json.user;
      state.userToken = json.token;
      localStorage.setItem('nusantara_user', JSON.stringify(json.user));
      localStorage.setItem('nusantara_user_token', json.token);

      loginModal.close();
      renderUserAuthState();
      showToast(`✓ Akun berhasil terdaftar!`);
    } catch (err) {
      alert('Pendaftaran gagal: ' + err.message);
    }
  });


  // ========================================================
  // KATALOG PRODUK
  // ========================================================
  async function fetchProducts() {
    try {
      const res = await fetch('/api/products');
      const json = await res.json();
      if (json.success) {
        state.products = json.data;
        applyCatalogFilters();
      }
    } catch (err) {
      console.error('Gagal mengambil data produk:', err);
    }
  }

  function applyCatalogFilters() {
    let filtered = [...state.products];

    if (state.activeCategory !== 'Semua') {
      filtered = filtered.filter(p => p.kategori === state.activeCategory);
    }

    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.nama.toLowerCase().includes(q) ||
        (p.karakteristik && p.karakteristik.toLowerCase().includes(q)) ||
        p.kode_produk.toLowerCase().includes(q)
      );
    }

    if (state.sortBy === 'price-asc') {
      filtered.sort((a, b) => a.harga - b.harga);
    } else if (state.sortBy === 'price-desc') {
      filtered.sort((a, b) => b.harga - a.harga);
    } else if (state.sortBy === 'name-asc') {
      filtered.sort((a, b) => a.nama.localeCompare(b.nama));
    } else if (state.sortBy === 'stock-desc') {
      filtered.sort((a, b) => b.stok - a.stok);
    }

    state.catalogFiltered = filtered;
    renderCatalogGrid();
  }

  function renderCatalogGrid() {
    const grid = document.getElementById('catalog-products-grid');
    if (!grid) return;

    if (state.catalogFiltered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🍃</div>
          <h3>Tidak Ada Produk yang Cocok</h3>
          <p>Coba gunakan kata kunci pencarian lain atau pilih kategori yang berbeda.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = state.catalogFiltered.map(p => {
      const isOutOfStock = p.stok <= 0;
      let stockBadge = '';
      if (isOutOfStock) {
        stockBadge = `<span class="product-stock-status stock-empty">Stok Habis</span>`;
      } else if (p.stok <= 5) {
        stockBadge = `<span class="product-stock-status stock-low">Sisa ${p.stok} pcs!</span>`;
      } else {
        stockBadge = `<span class="product-stock-status stock-in">Stok: ${p.stok} pcs</span>`;
      }

      const imgUrl = p.gambar || '/images/temanggung_srinthil.jpg';

      return `
        <div class="product-card" data-id="${p.id}">
          <div class="product-card-img-wrap" onclick="window.showProductDetail(${p.id})" style="cursor: pointer;" title="Klik untuk lihat deskripsi">
            <img src="${imgUrl}" alt="${p.nama}" loading="lazy" onerror="this.src='/images/temanggung_srinthil.jpg'">
          </div>
          <div class="product-card-body">
            <div class="product-meta-row">
              <span class="badge-category">${p.kategori}</span>
              <span class="product-code">${p.kode_produk}</span>
            </div>
            <h3 class="product-title" onclick="window.showProductDetail(${p.id})" style="cursor: pointer;">${p.nama}</h3>
            ${p.karakteristik ? `<div class="product-char">${p.karakteristik}</div>` : ''}
            
            <div class="product-spec-row">
              <span>Berat: <strong>${formatBerat(p.berat)}</strong></span>
              ${stockBadge}
            </div>

            <div class="product-footer-row">
              <div class="product-price">${formatRupiah(p.harga)}</div>
              <button 
                class="btn-add-cart" 
                onclick="window.addToCart(${p.id})"
                ${isOutOfStock ? 'disabled' : ''}
              >
                ${isOutOfStock ? 'Habis' : '+ Keranjang'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const categoryTabBtns = document.querySelectorAll('#catalog-category-tabs .tab-btn');
  categoryTabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      categoryTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCategory = btn.getAttribute('data-category');
      applyCatalogFilters();
    });
  });

  const searchInput = document.getElementById('catalog-search-input');
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value;
      applyCatalogFilters();
    }, 250);
  });

  const sortSelect = document.getElementById('catalog-sort-select');
  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    applyCatalogFilters();
  });

  window.showProductDetail = function (productId) {
    const p = state.products.find(item => item.id === productId);
    if (!p) return;

    document.getElementById('detail-prod-title').textContent = p.nama;
    const content = document.getElementById('detail-prod-content');
    content.innerHTML = `
      <div style="display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap;">
        <img src="${p.gambar || '/images/temanggung_srinthil.jpg'}" style="width: 140px; height: 140px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border-color);">
        <div style="flex: 1;">
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
            <span class="badge-category">${p.kategori}</span>
            <span class="product-code">${p.kode_produk}</span>
          </div>
          <div style="font-size: 1.25rem; font-weight: 700; color: var(--primary); margin-bottom: 6px;">
            ${formatRupiah(p.harga)}
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">
            Berat: <strong>${formatBerat(p.berat)}</strong>
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">
            Sisa Stok Gudang: <strong>${p.stok} pcs</strong>
          </div>
          ${p.karakteristik ? `<div class="product-char" style="margin-top: 6px;">${p.karakteristik}</div>` : ''}
        </div>
      </div>
      <div>
        <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 6px; color: var(--text-main);">Deskripsi & Ulasan Karakter:</h4>
        <p style="font-size: 0.88rem; color: var(--text-main); line-height: 1.6; background-color: var(--surface-alt); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
          ${p.deskripsi || 'Belum ada deskripsi untuk produk ini.'}
        </p>
      </div>
    `;

    const addBtn = document.getElementById('detail-prod-add-btn');
    if (p.stok <= 0) {
      addBtn.disabled = true;
      addBtn.textContent = 'Stok Habis';
    } else {
      addBtn.disabled = false;
      addBtn.textContent = '+ Tambah ke Keranjang';
      addBtn.onclick = () => {
        window.addToCart(p.id);
        document.getElementById('modal-product-detail').close();
      };
    }

    document.getElementById('modal-product-detail').showModal();
  };


  // ========================================================
  // KERANJANG BELANJA & CHECKOUT (DENGAN PROTEKSI LOGIN)
  // ========================================================
  window.addToCart = function (productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    if (product.stok <= 0) {
      alert(`Mohon maaf, stok untuk ${product.nama} sedang habis.`);
      return;
    }

    const existingIndex = state.cart.findIndex(item => item.id === productId);

    if (existingIndex > -1) {
      const currentQty = state.cart[existingIndex].qty;
      if (currentQty + 1 > product.stok) {
        alert(`Maksimal pembelian untuk "${product.nama}" adalah ${product.stok} pcs sesuai stok gudang.`);
        return;
      }
      state.cart[existingIndex].qty += 1;
      state.cart[existingIndex].subtotal = state.cart[existingIndex].qty * product.harga;
    } else {
      state.cart.push({
        id: product.id,
        kode_produk: product.kode_produk,
        nama: product.nama,
        harga: product.harga,
        berat: product.berat,
        stok: product.stok,
        gambar: product.gambar,
        qty: 1,
        subtotal: product.harga
      });
    }

    saveCart();
    showToast(`✓ "${product.nama}" berhasil ditambahkan ke keranjang!`);
  };

  function renderCart() {
    const emptyMsg = document.getElementById('cart-empty-message');
    const contentWrapper = document.getElementById('cart-content-wrapper');
    const tbody = document.getElementById('cart-table-body');

    if (state.cart.length === 0) {
      emptyMsg.style.display = 'block';
      contentWrapper.style.display = 'none';
      return;
    }

    emptyMsg.style.display = 'none';
    contentWrapper.style.display = 'grid';

    tbody.innerHTML = state.cart.map(item => {
      const img = item.gambar || '/images/temanggung_srinthil.jpg';
      return `
        <tr>
          <td>
            <div class="cart-item-preview">
              <img src="${img}" class="cart-item-img" alt="${item.nama}" onerror="this.src='/images/temanggung_srinthil.jpg'">
              <div>
                <div class="cart-item-name">${item.nama}</div>
                <div class="cart-item-sub">${item.kode_produk} • ${formatBerat(((state.products || []).find(x => x.id === item.id) || item).berat)}</div>
              </div>
            </div>
          </td>
          <td><strong>${formatRupiah(item.harga)}</strong></td>
          <td style="text-align: center;">
            <div class="qty-control">
              <button class="qty-btn" onclick="window.updateCartQty(${item.id}, ${item.qty - 1})">-</button>
              <input type="number" class="qty-input" value="${item.qty}" min="1" max="${item.stok}" onchange="window.updateCartQty(${item.id}, this.value)">
              <button class="qty-btn" onclick="window.updateCartQty(${item.id}, ${item.qty + 1})">+</button>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Stok: ${item.stok}</div>
          </td>
          <td style="text-align: right; font-weight: 700; color: var(--primary);">
            ${formatRupiah(item.subtotal)}
          </td>
          <td style="text-align: center;">
            <button class="btn-remove" onclick="window.removeCartItem(${item.id})" title="Hapus dari Keranjang">
              🗑️ Hapus
            </button>
          </td>
        </tr>
      `;
    }).join('');

    updateCheckoutSummary();
    renderUserAuthState();
  }

  window.updateCartQty = function (productId, newQty) {
    newQty = parseInt(newQty, 10);
    const itemIndex = state.cart.findIndex(i => i.id === productId);
    if (itemIndex === -1) return;

    if (isNaN(newQty) || newQty <= 0) {
      window.removeCartItem(productId);
      return;
    }

    const item = state.cart[itemIndex];
    if (newQty > item.stok) {
      alert(`Mohon maaf, stok tersedia untuk ${item.nama} adalah ${item.stok} pcs.`);
      newQty = item.stok;
    }

    state.cart[itemIndex].qty = newQty;
    state.cart[itemIndex].subtotal = newQty * state.cart[itemIndex].harga;
    saveCart();
    renderCart();
  };

  window.removeCartItem = function (productId) {
    state.cart = state.cart.filter(i => i.id !== productId);
    saveCart();
    renderCart();
  };

  document.getElementById('btn-clear-cart').addEventListener('click', () => {
    if (confirm('Yakin ingin mengosongkan seluruh isi keranjang belanja?')) {
      state.cart = [];
      saveCart();
      renderCart();
    }
  });

  // ---- Ongkir per kilo: berat total keranjang dibulatkan ke atas per 1 kg (server menghitung ulang) ----
  function cartWeightGram() {
    return state.cart.reduce((g, item) => {
      const p = (state.products || []).find(x => x.id === item.id);
      const berat = p && Number(p.berat) > 0 ? Number(p.berat) : 1000;
      return g + berat * item.qty;
    }, 0);
  }
  function currentShipping() {
    const radio = document.querySelector('input[name="courier"]:checked');
    const name = radio ? radio.value : 'JD Express';
    const perKg = radio ? Number(radio.getAttribute('data-perkg')) : 3500;
    const kg = Math.max(1, Math.ceil(cartWeightGram() / 1000));
    return { name, perKg, kg, ongkir: perKg * kg };
  }
  function formatBerat(gr) { return Number(gr) >= 1000 ? (Number(gr) / 1000).toString().replace('.', ',') + ' kg' : gr + ' gr'; }

  function updateCheckoutSummary() {
    const subtotal = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const ship = currentShipping();
    const ongkir = ship.ongkir;
    const courierName = ship.name;

    const grandTotal = subtotal + ongkir;

    document.getElementById('summary-subtotal').textContent = formatRupiah(subtotal);
    document.getElementById('summary-courier-name').textContent = courierName;
    document.getElementById('summary-ongkir').textContent = ongkir === 0 ? 'Gratis (Rp 0)' : formatRupiah(ongkir);
    const wEl = document.getElementById('summary-weight');
    if (wEl) wEl.textContent = ship.perKg === 0 ? '' : `Total berat ${ship.kg} kg x ${formatRupiah(ship.perKg)}`;
    document.getElementById('summary-grandtotal').textContent = formatRupiah(grandTotal);

    // Update nominal harga dinamis di semua kartu metode pembayaran MobaPay
    document.querySelectorAll('.pay-nominal-display').forEach(span => {
      span.textContent = formatRupiah(grandTotal);
    });
  }

  // COD: "Bayar di Toko" hanya untuk Ambil di Toko; "COD ke Kurir" hanya untuk pengiriman.
  function syncCodOptions() {
    const ship = currentShipping();
    const pickup = ship.name === 'Ambil di Toko';
    const toko = document.getElementById('pay-opt-cod-toko');
    const kurir = document.getElementById('pay-opt-cod-kurir');
    if (toko) toko.style.display = pickup ? '' : 'none';
    if (kurir) kurir.style.display = pickup ? 'none' : '';
    const checked = document.querySelector('input[name="payment"]:checked');
    if (checked && /^cod_/.test(checked.value) && checked.closest('.radio-card').style.display === 'none') {
      const qris = document.querySelector('input[name="payment"][value="qris"]');
      if (qris) { qris.checked = true; qris.dispatchEvent(new Event('change')); }
    }
  }

  document.querySelectorAll('input[name="courier"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('#courier-selector .radio-card').forEach(card => card.classList.remove('selected'));
      radio.closest('.radio-card')?.classList.add('selected');
      updateCheckoutSummary();
      syncCodOptions();
    });
  });
  syncCodOptions();

  document.querySelectorAll('#payment-selector input[name="payment"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('#payment-selector .radio-card').forEach(c => c.classList.remove('selected'));
      radio.closest('.radio-card')?.classList.add('selected');
    });
  });

  document.querySelectorAll('input[name="payment"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('#payment-selector .mobapay-card').forEach(card => card.classList.remove('selected'));
      radio.closest('.mobapay-card')?.classList.add('selected');
    });
  });

  document.querySelectorAll('#payment-selector .mobapay-card').forEach(card => {
    card.addEventListener('click', () => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    });
  });

  // ========================================================
  // ALUR PEMBAYARAN 3 TAHAP:
  // TAHAP A: DETAIL PESANAN (KONFIRMASI SEBELUM BAYAR)
  // TAHAP B: PEMBAYARAN DETAIL & REDIRECT APK (DEEPLINK & SALIN)
  // TAHAP C: OTOMATIS TERBACA LUNAS (DIPROSES) & WA OWNER
  // ========================================================
  let pendingCheckoutData = null;
  let currentActiveOrder = null;

  // TAHAP A - TOMBOL "KONFIRMASI & BUAT PESANAN" DI FORM CHECKOUT
  document.getElementById('btn-submit-order').addEventListener('click', () => {
    if (state.cart.length === 0) {
      alert('Keranjang belanja Anda masih kosong.');
      return;
    }

    // Cek validasi login wajib (anti-fiktif)
    if (!state.currentUser) {
      alert('🔒 Untuk mencegah pesanan fiktif, Anda wajib masuk/login ke akun Anda terlebih dahulu sebelum melakukan checkout.');
      loginModal.showModal();
      return;
    }

    const nama = document.getElementById('checkout-name')?.value.trim();
    const hp = document.getElementById('checkout-phone')?.value.trim();
    if (!nama || !hp) {
      alert('Harap lengkapi Nama Penerima dan Nomor WhatsApp aktif.');
      return;
    }

    // Validasi 7 kotak alamat terstruktur
    const addrVal = validateAddressFields('checkout-addr');
    if (!addrVal.valid) {
      alert(addrVal.message);
      return;
    }

    const alamat = combineAddressFields('checkout-addr');
    const courierRadio = document.querySelector('input[name="courier"]:checked');

    const ship = currentShipping();
    const kurirName = ship.name;
    const ongkir = ship.ongkir;
    const payRadio = document.querySelector('input[name="payment"]:checked');
    const payment_code = payRadio ? payRadio.value : 'qris';
    const metode_bayar = payRadio ? payRadio.getAttribute('data-label') : 'QRIS';

    const subtotal = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const grandTotal = subtotal + ongkir;

    pendingCheckoutData = {
      nama,
      hp,
      alamat,
      kurirName,
      ongkir,
      metode_bayar,
      payment_code,
      subtotal,
      grandTotal,
      items: state.cart.map(i => ({
        id: i.id,
        nama: i.nama,
        harga: i.harga,
        qty: i.qty,
        subtotal: i.subtotal,
        gambar: i.gambar
      }))
    };

    renderOrderConfirmModal(pendingCheckoutData);
    const proceedBtn = document.getElementById('btn-proceed-pay');
    if (proceedBtn) proceedBtn.textContent = /^cod_/.test(payment_code) ? '✅ Buat Pesanan (COD)' : '💳 Bayar Sekarang';
    orderConfirmModal.showModal();
  });

  // TAHAP A: RENDER POP-UP DETAIL PESANAN
  function renderOrderConfirmModal(data) {
    const container = document.getElementById('order-confirm-body');
    if (!container) return;

    const itemsRows = data.items.map(item => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 10px 12px; display: flex; align-items: center; gap: 10px;">
          <img src="${item.gambar}" style="width: 42px; height: 42px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color); background: #FAF7F2;">
          <div>
            <strong style="color: var(--text-main); font-size: 0.88rem;">${item.nama}</strong><br>
            <span style="font-size: 0.78rem; color: var(--text-muted);">${formatRupiah(item.harga)} × ${item.qty} pcs</span>
          </div>
        </td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: var(--primary);">
          ${formatRupiah(item.subtotal)}
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="order-detail-header-card">
        <div class="order-grid-two">
          <div>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Nama Pelanggan / Kontak:</span><br>
            <strong style="font-size: 0.95rem; color: var(--primary);">${data.nama}</strong><br>
            <span style="color: var(--text-main); font-size: 0.82rem;">📱 WhatsApp: <strong>${data.hp}</strong></span><br>
            <span style="color: var(--text-muted); font-size: 0.78rem;">✉️ ${state.currentUser ? state.currentUser.email : '-'}</span>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Pengiriman & Pembayaran:</span><br>
            <strong style="font-size: 0.92rem;">🚚 ${data.kurirName}</strong> (${data.ongkir === 0 ? 'Gratis' : formatRupiah(data.ongkir)})<br>
            <span style="display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 6px; background: var(--primary-light); color: var(--primary); font-size: 0.82rem; font-weight: 700;">
              💳 ${data.metode_bayar}
            </span>
          </div>
        </div>
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-color); font-size: 0.82rem;">
          <strong style="color: var(--primary);">📍 Alamat Pengiriman Lengkap:</strong><br>
          <span style="color: var(--text-main); line-height: 1.45;">${data.alamat}</span>
        </div>
      </div>

      <div style="border: 1px solid var(--border-color); border-radius: var(--radius); overflow: hidden; margin-bottom: 14px;">
        <div style="background-color: var(--surface-alt); padding: 8px 12px; font-weight: 700; font-size: 0.84rem; border-bottom: 1px solid var(--border-color);">
          Daftar Item Pesanan (${data.items.reduce((s, i) => s + i.qty, 0)} Pcs)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem;">
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
      </div>

      <div style="background-color: var(--surface-alt); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 12px 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;">
          <span>Jumlah Belanja (Subtotal):</span>
          <strong>${formatRupiah(data.subtotal)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem;">
          <span>Ongkos Kirim (${data.kurirName}):</span>
          <strong>${data.ongkir === 0 ? 'Gratis (Rp 0)' : formatRupiah(data.ongkir)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 8px; border-top: 2px solid var(--border-color); font-size: 1.05rem;">
          <strong>Total Tagihan:</strong>
          <strong style="color: var(--primary); font-size: 1.25rem;">${formatRupiah(data.grandTotal)}</strong>
        </div>
      </div>
    `;
  }

  // TAHAP B: TOMBOL "BAYAR SEKARANG" DI MODAL KONFIRMASI
  document.getElementById('btn-proceed-pay')?.addEventListener('click', async () => {
    if (!pendingCheckoutData) return;

    const btn = document.getElementById('btn-proceed-pay');
    btn.disabled = true;
    btn.textContent = /^cod_/.test(pendingCheckoutData.payment_code || '') ? 'Membuat pesanan...' : 'Membuat tagihan pembayaran...';

    try {
      const orderPayload = {
        nama_pelanggan: pendingCheckoutData.nama,
        no_hp: pendingCheckoutData.hp,
        alamat: pendingCheckoutData.alamat,
        kurir_code: pendingCheckoutData.kurirName,
        payment_code: pendingCheckoutData.payment_code,
        items: pendingCheckoutData.items.map(i => ({ id: i.id, qty: i.qty }))
      };

      const res = await authFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Gagal memproses pesanan.');
      }

      const orderData = json.data;
      currentActiveOrder = orderData;

      // Update profil lokal user
      state.currentUser.nama = pendingCheckoutData.nama;
      state.currentUser.no_hp = pendingCheckoutData.hp;
      state.currentUser.alamat = pendingCheckoutData.alamat;
      localStorage.setItem('nusantara_user', JSON.stringify(state.currentUser));

      // Kosongkan keranjang belanja
      state.cart = [];
      saveCart();
      renderCart();

      // Perbarui stok di katalog secara real-time
      fetchProducts();

      // Tutup Modal Tahap A
      orderConfirmModal.close();

      // Buka Modal Tahap B (ringkasan + popup pembayaran Midtrans)
      renderPaymentDetailModal(orderData, json.payment);
      paymentDetailModal.showModal();
      if (json.payment && json.payment.fallback) showToast('Metode yang dipilih belum aktif di akun Midtrans, jadi semua metode ditampilkan di popup.');
      launchPayment(orderData, json.payment);

    } catch (err) {
      alert('Gagal membuat pesanan: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = /^cod_/.test((pendingCheckoutData && pendingCheckoutData.payment_code) || '') ? '✅ Buat Pesanan (COD)' : '💳 Bayar Sekarang';
    }
  });

  // TAHAP B: HALAMAN PEMBAYARAN (Midtrans Snap).
  // Status "lunas" TIDAK ditentukan di browser: hanya server yang mengubahnya setelah Midtrans memastikan dana masuk.
  let payPollTimer = null;
  function stopPayPoll() {
    if (payPollTimer) { clearInterval(payPollTimer); payPollTimer = null; }
  }

  function renderPaymentDetailModal(order) {
    const container = document.getElementById('payment-detail-body');
    const toOrdersBtn = document.getElementById('btn-modal-to-myorders');
    if (toOrdersBtn) toOrdersBtn.style.display = 'none';
    stopPayPoll();

    const items = JSON.parse(order.items_json);
    let courierDisplay = order.kurir;
    const matchC = order.kurir.match(/^(.*?)\s*\(/);
    if (matchC) courierDisplay = matchC[1].trim();

    const itemsRows = items.map(item => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 8px 12px;"><strong>${esc(item.nama)}</strong> × ${item.qty}</td>
        <td style="padding: 8px 12px; text-align: right; font-weight: 600;">${formatRupiah(item.subtotal)}</td>
      </tr>
    `).join('');

    const windowMin = (state.config && state.config.paymentWindowMinutes) || 180;
    const windowText = windowMin % 60 === 0 ? `${windowMin / 60} jam` : `${windowMin} menit`;

    container.innerHTML = `
      <div class="order-detail-header-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Nomor Pesanan:</span><br>
            <strong style="color: var(--primary); font-size: 1.05rem;">${esc(order.no_invoice)}</strong>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--text-muted);">Status:</span><br>
            <span id="pay-modal-status-badge" class="status-badge ${order.status.toLowerCase().replace(/\s+/g, '-')}">${esc(order.status)}</span>
          </div>
        </div>
        <div style="margin-top: 12px; padding: 10px 14px; background: #FFFFFF; border-radius: 8px; border: 1px solid var(--border-color);">
          <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">Total Tagihan Pembayaran:</span>
          <strong style="font-size: 1.35rem; color: var(--primary);">${formatRupiah(order.total_bayar)}</strong>
        </div>
      </div>

      <div id="pay-warning-box" class="warning-banner-3h">
        <div style="font-size: 1.3rem; line-height: 1;">⚠️</div>
        <div>
          <strong>Batas Waktu Pembayaran: ${windowText}</strong><br>
          Pesanan yang belum dibayar sampai batas waktu akan otomatis dibatalkan dan stok dikembalikan.
        </div>
      </div>

      <div id="payment-stage-actions" class="pay-target-box" style="text-align:center;">
        <div style="font-size: 0.86rem; color: var(--text-muted); margin-bottom: 10px;">
          Metode pembayaran: <strong>${esc(order.metode_bayar)}</strong> (via Midtrans).
          Status akan berubah otomatis setelah pembayaran terkonfirmasi.
        </div>
        <button type="button" id="btn-open-snap" class="btn-verified-auto">💳 Bayar ${formatRupiah(order.total_bayar)} Sekarang</button>
        <div id="pay-checking-note" style="font-size: 0.78rem; color: var(--text-muted); margin-top: 8px; display:none;">
          ⏳ Menunggu konfirmasi pembayaran dari Midtrans...
        </div>
      </div>

      <div style="border: 1px solid var(--border-color); border-radius: var(--radius); overflow: hidden; margin-bottom: 14px;">
        <div style="background-color: var(--surface-alt); padding: 8px 12px; font-weight: 700; font-size: 0.84rem; border-bottom: 1px solid var(--border-color);">📋 Rincian Pesanan</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem;">
          <tbody>
            ${itemsRows}
            <tr style="background: #FAF8F5;">
              <td style="padding: 8px 12px;">Subtotal Produk</td>
              <td style="padding: 8px 12px; text-align: right; font-weight: 600;">${formatRupiah(order.total_belanja)}</td>
            </tr>
            <tr style="background: #FAF8F5;">
              <td style="padding: 8px 12px;">Ongkos Kirim (${esc(courierDisplay)})</td>
              <td style="padding: 8px 12px; text-align: right; font-weight: 600;">${order.ongkir === 0 ? 'Gratis (Rp 0)' : formatRupiah(order.ongkir)}</td>
            </tr>
            <tr style="background: #FAF8F5; border-top: 2px solid var(--border-color);">
              <td style="padding: 10px 12px; font-size: 0.95rem;"><strong>Total Pembayaran</strong></td>
              <td style="padding: 10px 12px; text-align: right; font-size: 1.1rem; color: var(--primary);"><strong>${formatRupiah(order.total_bayar)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="background-color: var(--surface-alt); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 8px; font-size: 0.84rem;">
        <strong style="color: var(--primary); display: block; margin-bottom: 4px;">📍 Alamat Pengiriman:</strong>
        <div style="color: var(--text-main); line-height: 1.45;">
          <strong>${esc(order.nama_pelanggan)}</strong> (${esc(order.no_hp)})<br>
          ${esc(order.alamat)}
        </div>
      </div>
    `;

    document.getElementById('btn-open-snap')?.addEventListener('click', () => window.resumePayment(order.no_invoice));

    if (order.payment_status === 'paid') showPaidState(order);
    else if (order.payment_status === 'cod') showCodState(order);
  }

  function showCodState(order) {
    stopPayPoll();
    setPayBadge(order);
    const toOrdersBtn = document.getElementById('btn-modal-to-myorders');
    if (toOrdersBtn) toOrdersBtn.style.display = 'inline-flex';
    document.getElementById('pay-warning-box')?.remove();
    const pickup = String(order.kurir || '').startsWith('Ambil di Toko');
    const box = document.getElementById('payment-stage-actions');
    if (box) {
      box.innerHTML = `
        <div class="wa-confirmation-box">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #065F46; font-weight: 700; font-size: 1rem; margin-bottom: 6px;">
            <span style="font-size: 1.2rem;">✓</span> Pesanan COD Diterima!
          </div>
          <p style="font-size: 0.84rem; color: #047857; margin-bottom: 14px; line-height: 1.45;">
            ${pickup
              ? `Pesanan Anda berstatus <strong>Diproses</strong>. Silakan ambil di toko dan bayar tunai <strong>${formatRupiah(order.total_bayar)}</strong> saat pengambilan. Toko akan menghubungi Anda lewat WhatsApp bila pesanan sudah siap.`
              : `Pesanan Anda berstatus <strong>Diproses</strong>. Siapkan uang tunai <strong>${formatRupiah(order.total_bayar)}</strong> (sudah termasuk ongkir) untuk dibayar ke kurir saat barang tiba.`}
          </p>
          <a href="${storeContactUrl(order)}" target="_blank" rel="noopener noreferrer" class="btn-wa-owner">💬 Hubungi Toko via WhatsApp (opsional)</a>
        </div>
      `;
    }
  }

  function setPayBadge(order) {
    const badge = document.getElementById('pay-modal-status-badge');
    if (badge) {
      badge.className = 'status-badge ' + order.status.toLowerCase().replace(/\s+/g, '-');
      badge.textContent = order.status;
    }
  }

  function showPaidState(order) {
    stopPayPoll();
    setPayBadge(order);
    const toOrdersBtn = document.getElementById('btn-modal-to-myorders');
    if (toOrdersBtn) toOrdersBtn.style.display = 'inline-flex';
    document.getElementById('pay-warning-box')?.remove();
    const box = document.getElementById('payment-stage-actions');
    if (box) {
      box.innerHTML = `
        <div class="wa-confirmation-box">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #065F46; font-weight: 700; font-size: 1rem; margin-bottom: 6px;">
            <span style="font-size: 1.2rem;">✓</span> Pembayaran Diterima!
          </div>
          <p style="font-size: 0.84rem; color: #047857; margin-bottom: 14px; line-height: 1.45;">
            Pembayaran ${formatRupiah(order.total_bayar)} sudah dikonfirmasi oleh Midtrans${order.payment_type ? ' (' + esc(order.metode_bayar) + ')' : ''}.
            Pesanan Anda berstatus <strong>Diproses</strong> dan akan segera dikemas. Tidak perlu mengirim bukti transfer.
          </p>
          <a href="${storeContactUrl(order)}" target="_blank" rel="noopener noreferrer" class="btn-wa-owner">💬 Hubungi Toko via WhatsApp (opsional)</a>
        </div>
      `;
    }
  }

  function showDeadState(order) {
    stopPayPoll();
    setPayBadge(order);
    document.getElementById('pay-warning-box')?.remove();
    const box = document.getElementById('payment-stage-actions');
    if (box) {
      box.innerHTML = `
        <div style="color: #991B1B; font-weight: 700; margin-bottom: 4px;">Pesanan ${order.status === 'Kedaluwarsa' ? 'kedaluwarsa' : 'dibatalkan'}</div>
        <div style="font-size: 0.84rem; color: var(--text-muted);">Pembayaran tidak diterima. Stok sudah dikembalikan; silakan buat pesanan baru.</div>
      `;
    }
  }

  // Tanya server (yang bertanya ke Midtrans) status terbaru pesanan ini.
  async function syncOrderStatus(invoice) {
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(invoice)}/sync`);
      const json = await res.json();
      if (!json.success) return null;
      const o = json.data;
      currentActiveOrder = o;
      if (o.payment_status === 'paid') {
        showPaidState(o);
        showToast('✓ Pembayaran berhasil dikonfirmasi!');
        fetchProducts();
      } else if (['expired', 'failed'].includes(o.payment_status)) {
        showDeadState(o);
      }
      return o;
    } catch (e) { return null; }
  }

  let snapOpen = false;
  function startPayPoll(invoice) {
    stopPayPoll();
    const note = document.getElementById('pay-checking-note');
    if (note) note.style.display = 'block';
    let ticks = 0;
    payPollTimer = setInterval(async () => {
      ticks++;
      if (!paymentDetailModal.open && !snapOpen && ticks > 3) { stopPayPoll(); return; }
      const o = await syncOrderStatus(invoice);
      if (o && o.payment_status !== 'pending') stopPayPoll();
      if (ticks > 360) stopPayPoll(); // ±30 menit
    }, 5000);
  }

  async function ensureSnap() {
    if (window.snap) return;
    await loadScriptOnce(state.config.snapJsUrl, { 'data-client-key': state.config.midtransClientKey });
    if (!window.snap) throw new Error('Popup pembayaran Midtrans gagal dimuat.');
  }

  // Buka popup pembayaran (Snap) atau halaman simulasi (mode uji lokal).
  async function launchPayment(order, payment) {
    if (!payment) return;
    try {
      if (payment.mode === 'mock') {
        window.open(payment.redirect_url, '_blank');
        startPayPoll(order.no_invoice);
        return;
      }
      await ensureSnap();
      // <dialog> modal menutupi popup Snap, jadi ditutup dulu lalu dibuka kembali setelah popup selesai.
      if (paymentDetailModal.open) paymentDetailModal.close();
      snapOpen = true;
      startPayPoll(order.no_invoice); // tetap cek status selama popup Midtrans terbuka
      const reopen = (after) => {
        snapOpen = false;
        if (!paymentDetailModal.open) paymentDetailModal.showModal();
        syncOrderStatus(order.no_invoice).then(o => { if (o && o.payment_status === 'pending') startPayPoll(order.no_invoice); });
        if (after) after();
      };
      window.snap.pay(payment.token, {
        onSuccess: () => reopen(),
        onPending: () => reopen(() => showToast('Menunggu pembayaran Anda. Selesaikan pembayaran lewat instruksi yang diberikan.')),
        onError: () => reopen(() => showToast('Pembayaran gagal. Silakan coba lagi.')),
        onClose: () => reopen()
      });
    } catch (err) {
      if (!paymentDetailModal.open) paymentDetailModal.showModal();
      alert(err.message);
    }
  }

  // Dipanggil dari tombol "Bayar Sekarang" (modal pembayaran & daftar Pesanan Saya)
  window.resumePayment = async function (invoice) {
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(invoice)}/payment`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Gagal memuat pembayaran.');
      currentActiveOrder = json.data;
      renderPaymentDetailModal(json.data);
      if (!paymentDetailModal.open) paymentDetailModal.showModal();
      if (!json.payment) {
        if (json.data.payment_status === 'paid') showPaidState(json.data); else showDeadState(json.data);
        return;
      }
      launchPayment(json.data, json.payment);
    } catch (err) {
      alert(err.message);
    }
  };


  // Event listener tombol Ke Pesanan Saya dari modal pembayaran
  document.getElementById('btn-modal-to-myorders')?.addEventListener('click', () => {
    paymentDetailModal.close();
    switchView('orders');
    fetchCustomerOrders();
  });


  // ========================================================
  // PESANAN SAYA (TERKAIT AKUN PENGGUNA)
  // ========================================================
  let orderFilterStatus = 'Semua';
  let orderSearchQuery = '';

  async function fetchCustomerOrders(silent) {
    const listContainer = document.getElementById('orders-list-container');
    if (!silent) listContainer.innerHTML = '<div style="text-align:center; padding: 24px; color: var(--text-muted);">Memuat riwayat pesanan...</div>';

    try {
      if (!state.currentUser) {
        state.userOrders = [];
        renderCustomerOrders();
        return;
      }
      const res = await authFetch('/api/orders');
      const json = await res.json();
      if (json.success) {
        state.userOrders = json.data;
        renderCustomerOrders();
      }
    } catch (err) {
      listContainer.innerHTML = '<div class="empty-state"><h3>Gagal memuat pesanan</h3></div>';
    }
  }


  // Segarkan Pesanan Saya otomatis selama ada pesanan yang menunggu pembayaran.
  setInterval(() => {
    if (document.hidden || !state.currentUser || !views.orders || views.orders.style.display !== 'block') return;
    if (paymentDetailModal.open || snapOpen) return;
    if (!(state.userOrders || []).some(o => o.payment_status === 'pending')) return;
    fetchCustomerOrders(true);
  }, 8000);

  // ---------- PEMBATALAN & GANTI METODE BAYAR (Pesanan Saya) ----------
  const PAY_OPTIONS = [
    ['qris', 'QRIS', 'Scan dengan e-wallet / m-banking apa pun', 'QR'],
    ['gopay', 'GoPay', 'Bayar lewat aplikasi Gojek / GoPay', 'GP'],
    ['shopeepay', 'ShopeePay', 'Bayar lewat aplikasi Shopee', 'SP'],
    ['dana', 'DANA', 'Bayar lewat aplikasi DANA', 'DA'],
    ['va_bca', 'Transfer BCA', 'Virtual Account BCA', 'BCA'],
    ['va_bni', 'Transfer BNI', 'Virtual Account BNI', 'BNI'],
    ['va_bri', 'Transfer BRI', 'Virtual Account BRI', 'BRI'],
    ['va_mandiri', 'Transfer Mandiri', 'Mandiri Bill Payment', 'MDR'],
    ['va_permata', 'Transfer Permata', 'Virtual Account Permata', 'PMT'],
    ['semua', 'Metode lain', 'Pilih sendiri di popup pembayaran', '···']
  ];

  // Tombol batal sesuai status: belum dibayar -> batalkan langsung; Diproses -> ajukan; Dikirim/Selesai -> tidak ada tombol.
  window.confirmReceived = async function (invoice) {
    if (!confirm('Pastikan barang sudah Anda terima dalam kondisi baik. Tandai pesanan sebagai selesai?')) return;
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(invoice)}/confirm-received`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Gagal memperbarui pesanan.');
      showToast('✓ ' + json.message);
      fetchCustomerOrders(true);
    } catch (err) { alert(err.message); }
  };

  function cancelActionHtml(order) {
    const inv = esc(order.no_invoice);
    if (order.payment_status === 'pending') {
      return `<button class="btn-action" onclick="window.openCancelOrder('${inv}')" style="width: 100%; justify-content: center; margin-bottom: 8px; background:#FFF; color:#B91C1C; border:1px solid #FCA5A5;">✕ Batalkan Pesanan</button>`;
    }
    if (['paid', 'cod'].includes(order.payment_status) && order.status === 'Diproses' && order.cancel_status !== 'diajukan') {
      return `<button class="btn-action" onclick="window.openCancelOrder('${inv}')" style="width: 100%; justify-content: center; margin-bottom: 8px; background:#FFF; color:#B91C1C; border:1px solid #FCA5A5;">✕ Ajukan Pembatalan</button>`;
    }
    if (order.status === 'Dikirim') {
      const days = (state.config && state.config.autoCompleteDays) || 7;
      return `<button class="btn-action btn-action-primary" onclick="window.confirmReceived('${inv}')" style="width: 100%; justify-content: center; margin-bottom: 8px;">✅ Pesanan Sudah Diterima</button>
        <div style="font-size:0.74rem; color: var(--text-muted); margin-bottom:8px; line-height:1.4;">Pesanan sudah dikirim, tidak dapat dibatalkan. Tekan tombol di atas setelah barang sampai. Jika tidak ditekan, pesanan selesai otomatis ${days} hari setelah dikirim.</div>`;
    }
    return '';
  }

  function cancelInfoHtml(order) {
    const box = (bg, bd, col, html) => `<div style="background:${bg}; border:1px solid ${bd}; color:${col}; padding:8px 12px; border-radius:6px; font-size:0.82rem; margin:8px 0; line-height:1.45;">${html}</div>`;
    const reason = esc(order.cancel_reason || '');
    if (order.cancel_status === 'diajukan') {
      return box('#FEF3C7', '#FDE68A', '#92400E', `⏳ <strong>Pengajuan pembatalan menunggu keputusan toko.</strong><br>Alasan Anda: ${reason}`);
    }
    if (order.cancel_status === 'ditolak') {
      return box('#FEE2E2', '#FCA5A5', '#991B1B', `✕ <strong>Pengajuan pembatalan ditolak toko</strong> — pesanan tetap diproses.<br>Alasan Anda: ${reason}`);
    }
    if (['Dibatalkan', 'Kedaluwarsa'].includes(order.status)) {
      let t = order.status === 'Kedaluwarsa' ? '⌛ <strong>Pesanan kedaluwarsa</strong> karena tidak dibayar tepat waktu.' : '✕ <strong>Pesanan dibatalkan.</strong>';
      if (reason) t += `<br>Alasan: ${reason}`;
      if (order.cancel_status === 'disetujui' && order.payment_status === 'paid') t += '<br>Pembatalan disetujui. Pengembalian dana diproses oleh toko; hubungi toko bila belum diterima.';
      return box('#F3F4F6', '#E5E7EB', '#374151', t);
    }
    return '';
  }

  // ---- Ganti metode pembayaran ----
  const changePayModal = document.getElementById('modal-change-payment');
  let changePayInvoice = null;
  window.openChangePayment = function (invoice) {
    const order = (state.userOrders || []).find(o => o.no_invoice === invoice);
    if (!order) return;
    changePayInvoice = invoice;
    document.getElementById('chg-pay-invoice').textContent = invoice;
    document.getElementById('chg-pay-total').textContent = formatRupiah(order.total_bayar);
    document.getElementById('chg-pay-options').innerHTML = PAY_OPTIONS.map(([v, t, d, b], i) => `
      <label class="radio-card pay-option${i === 0 ? ' selected' : ''}">
        <input type="radio" name="chg-payment" value="${v}"${i === 0 ? ' checked' : ''}>
        <span class="pay-badge">${b}</span>
        <div class="radio-info"><div class="radio-title"><span>${t}</span></div><div class="radio-desc">${d}</div></div>
      </label>`).join('');
    document.querySelectorAll('#chg-pay-options input').forEach(r => r.addEventListener('change', () => {
      document.querySelectorAll('#chg-pay-options .radio-card').forEach(c => c.classList.remove('selected'));
      r.closest('.radio-card').classList.add('selected');
    }));
    changePayModal.showModal();
  };
  document.getElementById('btn-chg-pay-submit')?.addEventListener('click', async () => {
    const code = document.querySelector('#chg-pay-options input:checked')?.value;
    if (!changePayInvoice || !code) return;
    const btn = document.getElementById('btn-chg-pay-submit');
    btn.disabled = true; btn.textContent = 'Memproses...';
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(changePayInvoice)}/change-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_code: code })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Gagal mengganti metode pembayaran.');
      changePayModal.close();
      currentActiveOrder = json.data;
      showToast('✓ Metode pembayaran diganti. Silakan lanjutkan pembayaran.');
      fetchCustomerOrders();
      renderPaymentDetailModal(json.data);
      paymentDetailModal.showModal();
      if (json.payment && json.payment.fallback) showToast('Metode yang dipilih belum aktif di akun Midtrans, jadi semua metode ditampilkan di popup.');
      launchPayment(json.data, json.payment);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Ganti & Lanjut Bayar';
    }
  });

  // ---- Batalkan / ajukan pembatalan ----
  const cancelModal = document.getElementById('modal-cancel-order');
  let cancelInvoice = null;
  function updateCancelDetailUi() {
    const code = document.querySelector('#cancel-reason-list input:checked')?.value;
    const lbl = document.getElementById('cancel-detail-label');
    const ta = document.getElementById('cancel-detail');
    if (code === 'lainnya') { lbl.innerHTML = 'Tuliskan alasan Anda <span class="req">*</span>'; ta.placeholder = 'Contoh: ... (wajib diisi, minimal 5 karakter)'; }
    else { lbl.textContent = 'Keterangan tambahan (opsional)'; ta.placeholder = 'Tuliskan keterangan di sini...'; }
  }
  window.openCancelOrder = function (invoice) {
    const order = (state.userOrders || []).find(o => o.no_invoice === invoice);
    if (!order) return;
    cancelInvoice = invoice;
    const paid = ['paid', 'cod'].includes(order.payment_status);
    const isCod = order.payment_status === 'cod';
    document.getElementById('cancel-modal-title').textContent = paid ? 'Ajukan Pembatalan Pesanan' : 'Batalkan Pesanan';
    const info = document.getElementById('cancel-modal-info');
    info.style.background = paid ? '#FEF3C7' : '#F3F4F6';
    info.style.border = paid ? '1px solid #FDE68A' : '1px solid #E5E7EB';
    info.style.color = paid ? '#92400E' : '#374151';
    info.innerHTML = paid
      ? (isCod ? `Pesanan COD <strong>${esc(invoice)}</strong> sedang diproses. Pembatalan perlu <strong>persetujuan toko</strong>; alasan Anda akan dibaca admin. Pesanan yang sudah <strong>dikirim</strong> tidak bisa dibatalkan.` : `Pesanan <strong>${esc(invoice)}</strong> sudah dibayar dan sedang diproses. Pembatalan perlu <strong>persetujuan toko</strong>; alasan Anda akan dibaca admin. Jika disetujui, dana dikembalikan oleh toko. Pesanan yang sudah <strong>dikirim</strong> tidak bisa dibatalkan.`)
      : `Pesanan <strong>${esc(invoice)}</strong> belum dibayar. Jika dibatalkan, pesanan langsung dibatalkan dan stok dikembalikan.`;
    const reasons = (state.config && state.config.cancelReasons) || { lainnya: 'Lainnya' };
    document.getElementById('cancel-reason-list').innerHTML = Object.entries(reasons).map(([code, text], i) => `
      <label style="display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; cursor:pointer; font-size:0.86rem;">
        <input type="radio" name="cancel-reason" value="${esc(code)}"${i === 0 ? ' checked' : ''} style="margin-top:3px;"> <span>${esc(text)}</span>
      </label>`).join('');
    document.querySelectorAll('#cancel-reason-list input').forEach(r => r.addEventListener('change', updateCancelDetailUi));
    document.getElementById('cancel-detail').value = '';
    document.getElementById('btn-cancel-submit').textContent = paid ? 'Kirim Pengajuan' : 'Batalkan Pesanan';
    updateCancelDetailUi();
    cancelModal.showModal();
  };
  document.getElementById('btn-cancel-submit')?.addEventListener('click', async () => {
    const code = document.querySelector('#cancel-reason-list input:checked')?.value;
    const detail = document.getElementById('cancel-detail').value.trim();
    if (!cancelInvoice || !code) return;
    if (code === 'lainnya' && detail.length < 5) { alert('Pilihan "Lainnya": tuliskan alasan Anda (minimal 5 karakter).'); document.getElementById('cancel-detail').focus(); return; }
    const btn = document.getElementById('btn-cancel-submit');
    btn.disabled = true;
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(cancelInvoice)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: code, detail })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Gagal memproses pembatalan.');
      cancelModal.close();
      showToast('✓ ' + json.message);
      fetchProducts();
      fetchCustomerOrders();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  function renderCustomerOrders() {
    const listContainer = document.getElementById('orders-list-container');
    if (!listContainer) return;

    let orders = state.userOrders || [];

    if (orderFilterStatus !== 'Semua') {
      orders = orders.filter(o => orderFilterStatus === 'Dibatalkan'
        ? ['Dibatalkan', 'Kedaluwarsa'].includes(o.status) : o.status === orderFilterStatus);
    }

    if (orderSearchQuery.trim() !== '') {
      const q = orderSearchQuery.toLowerCase();
      orders = orders.filter(o =>
        o.no_invoice.toLowerCase().includes(q) ||
        o.no_hp.toLowerCase().includes(q) ||
        o.nama_pelanggan.toLowerCase().includes(q) ||
        (o.no_resi && o.no_resi.toLowerCase().includes(q))
      );
    }

    if (orders.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <h3>${state.currentUser ? 'Belum Ada Pesanan di Akun Anda' : 'Tidak Ada Riwayat Pesanan'}</h3>
          <p>${state.currentUser ? 'Anda belum melakukan transaksi atau tidak ada pesanan yang sesuai filter.' : 'Silakan masuk ke akun Anda untuk melihat riwayat pesanan pribadi Anda.'}</p>
          ${!state.currentUser ? `
            <button class="btn-action btn-action-primary" onclick="document.getElementById('modal-customer-login').showModal()">
              🔑 Masuk dengan Akun Google
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    listContainer.innerHTML = orders.map(order => {
      const items = JSON.parse(order.items_json);
      const statusClass = order.status.toLowerCase().replace(/\s+/g, '-');

      const itemsHtml = items.map(item => `
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; padding: 4px 0;">
          <span>${item.nama} <strong>(x${item.qty})</strong></span>
          <span>${formatRupiah(item.subtotal)}</span>
        </div>
      `).join('');

      return `
        <div class="checkout-card" style="margin-bottom: 16px;">
          <div class="checkout-card-header" style="flex-wrap: wrap; gap: 8px;">
            <div>
              <span style="font-weight: 700; color: var(--primary); font-size: 1.05rem;">${order.no_invoice}</span>
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 10px;">📅 ${formatTanggalIndo(order.created_at)}</span>
            </div>
            <div>
              <span class="status-badge ${statusClass}">${order.status}</span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start;">
            <div>
              <div style="font-size: 0.84rem; margin-bottom: 8px;">
                <strong>Penerima:</strong> ${order.nama_pelanggan} (${order.no_hp})<br>
                <strong>Alamat:</strong> ${order.alamat}<br>
                <strong>Kurir:</strong> ${order.kurir}
              </div>

              ${order.no_resi ? `
                <div style="background-color: var(--badge-kirim-bg); border: 1px solid var(--badge-kirim-border); color: var(--badge-kirim-text); padding: 8px 12px; border-radius: 6px; font-size: 0.84rem; margin: 8px 0; display: inline-flex; align-items: center; gap: 8px;">
                  <span>🚚 <strong>Nomor Resi:</strong> ${order.no_resi}</span>
                  <button class="btn-action" style="padding: 2px 8px; font-size: 0.72rem; background: #FFF;" onclick="navigator.clipboard.writeText('${order.no_resi}'); alert('Nomor Resi berhasil disalin!');">
                    Salin
                  </button>
                </div>
              ` : `
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">
                  <em>Resi pengiriman akan diperbarui oleh Admin setelah paket dikirim.</em>
                </div>
              `}

              ${cancelInfoHtml(order)}
              <div style="background-color: var(--surface-alt); padding: 10px 14px; border-radius: 6px; border: 1px solid var(--border-color); margin-top: 10px;">
                <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Rincian Barang:</div>
                ${itemsHtml}
              </div>
            </div>

            <div style="text-align: right; border-left: 1px solid var(--border-color); padding-left: 20px;">
              <div style="font-size: 0.8rem; color: var(--text-muted);">Total Pembayaran</div>
              <div style="font-size: 1.25rem; font-weight: 700; color: var(--primary); margin: 4px 0 12px 0;">
                ${formatRupiah(order.total_bayar)}
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 12px;">
                Metode: <strong>${esc(order.metode_bayar)}</strong>
              </div>
              ${order.payment_status === 'cod' ? `<div style="font-size:0.76rem; color:#92400E; margin:-6px 0 10px 0; line-height:1.4;">💵 Belum dibayar — bayar tunai ${String(order.kurir || '').startsWith('Ambil di Toko') ? 'di toko saat mengambil' : 'ke kurir saat barang tiba'}.</div>` : ''}
              ${order.payment_status === 'pending' ? `
                <button class="btn-action btn-action-primary" onclick="window.resumePayment('${esc(order.no_invoice)}')" style="width: 100%; justify-content: center; margin-bottom: 8px;">
                  💳 Bayar Sekarang
                </button>
                <button class="btn-action btn-action-secondary" onclick="window.openChangePayment('${esc(order.no_invoice)}')" style="width: 100%; justify-content: center; margin-bottom: 8px;">
                  🔄 Ganti Metode Bayar
                </button>
              ` : ''}
              ${cancelActionHtml(order)}

              <button class="btn-action btn-action-secondary" onclick="window.viewInvoiceDetail('${order.no_invoice}')" style="width: 100%; justify-content: center;">
                📄 Lihat Struk Invoice
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.querySelectorAll('#order-status-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#order-status-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      orderFilterStatus = btn.getAttribute('data-status');
      renderCustomerOrders();
    });
  });

  document.getElementById('order-search-input').addEventListener('input', (e) => {
    orderSearchQuery = e.target.value;
    renderCustomerOrders();
  });

  window.viewInvoiceDetail = async function (invoiceNo) {
    try {
      const res = await authFetch(`/api/orders/${encodeURIComponent(invoiceNo)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      const order = json.data;
      const items = JSON.parse(order.items_json);
      const statusClass = order.status.toLowerCase().replace(/\s+/g, '-');

      const modalContent = document.getElementById('invoice-modal-content');
      modalContent.innerHTML = `
        <div style="text-align: center; border-bottom: 2px dashed var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
          <h2 style="font-size: 1.25rem; color: var(--primary); margin-bottom: 2px;">TOKO NUSANTARA TOBACCO</h2>
          <p style="font-size: 0.8rem; color: var(--text-muted);">Pusat Tembakau Pilihan Nusantara & Alat Linting Tradisional</p>
          <p style="font-size: 0.75rem; color: var(--text-muted);">Jl. Pramuka No.11, Jenang Utara, Jenang, Kec. Majenang, Kabupaten Cilacap, Jawa Tengah 53257 | WA: 0853-8549-0505</p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem; margin-bottom: 14px;">
          <div>
            <strong>No. Invoice:</strong> ${order.no_invoice}<br>
            <strong>Tanggal:</strong> ${formatTanggalIndo(order.created_at)}<br>
            <strong>Status:</strong> <span class="status-badge ${statusClass}">${order.status}</span>
          </div>
          <div>
            <strong>Pelanggan:</strong> ${order.nama_pelanggan}<br>
            <strong>No. WhatsApp:</strong> ${order.no_hp}<br>
            <strong>Kurir:</strong> ${order.kurir}
            ${order.no_resi ? `<br><strong>No. Resi:</strong> ${order.no_resi}` : ''}
          </div>
        </div>

        <div style="font-size: 0.85rem; margin-bottom: 12px;">
          <strong>Alamat Tujuan:</strong><br>
          <span style="color: var(--text-muted);">${order.alamat}</span>
        </div>

        <table class="custom-table" style="margin-bottom: 14px; font-size: 0.82rem;">
          <thead>
            <tr>
              <th>Item Produk</th>
              <th style="text-align: right;">Harga</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td>${i.nama}</td>
                <td style="text-align: right;">${formatRupiah(i.harga)}</td>
                <td style="text-align: center;">${i.qty}</td>
                <td style="text-align: right;">${formatRupiah(i.subtotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="border-top: 1px solid var(--border-color); padding-top: 10px; font-size: 0.88rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Subtotal Produk:</span>
            <span>${formatRupiah(order.total_belanja)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Ongkos Kirim:</span>
            <span>${formatRupiah(order.ongkir)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 1rem; color: var(--primary); margin-top: 6px; border-top: 1px dashed var(--border-color); padding-top: 6px;">
            <span>Total Tagihan:</span>
            <span>${formatRupiah(order.total_bayar)}</span>
          </div>
        </div>
      `;

      document.getElementById('btn-print-single-invoice').onclick = () => window.print();
      document.getElementById('modal-invoice-detail').showModal();
    } catch (err) {
      alert('Gagal memuat detail invoice: ' + err.message);
    }
  };

  // Inisialisasi awal
  renderUserAuthState();
  updateCartBadge();
  fetchProducts();

  // Kembali dari halaman pembayaran Midtrans (redirect) -> tampilkan Pesanan Saya
  const backParams = new URLSearchParams(window.location.search);
  if (backParams.get('bayar') && state.currentUser) {
    history.replaceState(null, '', window.location.pathname);
    switchView('orders');
    fetchCustomerOrders();
  }
});
