/**
 * PORTAL ADMINISTRATOR - JAVASCRIPT LOGIC
 * Toko Nusantara Tobacco (Back-Office Sidebar Dashboard)
 */

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('nusantara_admin_token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const state = {
    token: token,
    stats: null,
    products: [],
    orders: [],
    prodFilterCat: 'Semua',
    prodSearchQuery: '',
    orderFilterStatus: 'Semua',
    orderSearchQuery: ''
  };

  // Fetch dengan token admin; jika token habis/ditolak -> kembali ke halaman login
  async function adminFetch(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {}, { 'x-admin-token': state.token });
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      localStorage.removeItem('nusantara_admin_token');
      alert('Sesi admin berakhir. Silakan login kembali.');
      window.location.href = '/login.html';
    }
    return res;
  }

  // Label status pembayaran (dikonfirmasi Midtrans)
  function payLabel(o) {
    const map = { paid: ['✓ Lunas', '#065F46'], pending: ['⏳ Belum dibayar', '#92400E'], cod: ['💵 COD – belum dibayar', '#92400E'], expired: ['✕ Kedaluwarsa', '#991B1B'], failed: ['✕ Gagal/Batal', '#991B1B'], refunded: ['↩ Refund', '#5521B5'], legacy: ['(data lama)', '#6B7280'] };
    const [t, c] = map[o.payment_status] || ['', '#6B7280'];
    return t ? `<div style="font-size:0.72rem; font-weight:600; color:${c}; margin-top:3px;">${t}${o.payment_status === 'paid' && o.metode_bayar ? ' · ' + o.metode_bayar : ''}</div>` : '';
  }

  // Info pembatalan dari pelanggan (terlihat jelas oleh admin)
  function cancelBadge(o) {
    const r = (o.cancel_reason || '').replace(/</g, '&lt;');
    if (o.cancel_status === 'diajukan') return `<div style="margin-top:6px; background:#FEE2E2; border:1px solid #FCA5A5; color:#991B1B; padding:4px 8px; border-radius:6px; font-size:0.74rem; font-weight:700; max-width:210px;">⚠ PENGAJUAN BATAL<br><span style="font-weight:500;">${r}</span></div>`;
    if (o.cancel_status === 'ditolak') return `<div style="margin-top:4px; font-size:0.72rem; color:#6B7280;">Pengajuan batal ditolak</div>`;
    if (o.cancel_status === 'dibatalkan_pelanggan') return `<div style="margin-top:4px; font-size:0.72rem; color:#6B7280; max-width:210px;">Dibatalkan pelanggan: ${r}</div>`;
    if (o.cancel_status === 'disetujui') return `<div style="margin-top:4px; font-size:0.72rem; color:#6B7280; max-width:210px;">Batal disetujui: ${r}</div>`;
    return '';
  }

  // Hanya transaksi yang benar-benar dibayar & tidak dibatalkan masuk laporan/omzet
  function reportOrders() {
    return state.orders.filter(o => ['paid', 'legacy'].includes(o.payment_status) && !['Dibatalkan', 'Kedaluwarsa'].includes(o.status));
  }

  function formatRupiah(num) {
    return 'Rp ' + Number(num || 0).toLocaleString('id-ID');
  }

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

  // Update Jam & Tanggal di Topbar
  function updateClock() {
    const clockEl = document.getElementById('admin-clock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = '📅 ' + now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }
  }
  updateClock();

  // ========================================================
  // NAVIGASI SIDEBAR
  // ========================================================
  const menuBtns = {
    dashboard: document.getElementById('menu-btn-dashboard'),
    products: document.getElementById('menu-btn-products'),
    orders: document.getElementById('menu-btn-orders'),
    reports: document.getElementById('menu-btn-reports')
  };

  const sections = {
    dashboard: document.getElementById('section-dashboard'),
    products: document.getElementById('section-products'),
    orders: document.getElementById('section-orders'),
    reports: document.getElementById('section-reports')
  };

  const headings = {
    dashboard: {
      title: 'Ringkasan Dashboard Toko',
      sub: 'Monitoring stok fisik tembakau, transaksi aktif, dan rekapitulasi penjualan.'
    },
    products: {
      title: 'Manajemen Data Produk & Persediaan Stok',
      sub: 'Kelola varian tembakau nusantara, tembakau flavour, alat linting, dan paket bundling.'
    },
    orders: {
      title: 'Manajemen Pesanan Masuk & Nomor Resi',
      sub: 'Periksa detail pengiriman pesanan pelanggan dan masukkan resi ekspedisi kurir.'
    },
    reports: {
      title: 'Laporan Rekapitulasi Penjualan (Tugas Akhir/Skripsi)',
      sub: 'Dokumentasi rekap transaksi penjualan resmi yang siap dicetak dalam format PDF.'
    }
  };

  function switchSection(name) {
    Object.keys(sections).forEach(key => {
      if (sections[key]) {
        sections[key].classList.toggle('active', key === name);
      }
      if (menuBtns[key]) {
        menuBtns[key].classList.toggle('active', key === name);
      }
    });

    if (headings[name]) {
      document.getElementById('page-heading-title').textContent = headings[name].title;
      document.getElementById('page-heading-sub').textContent = headings[name].sub;
    }

    if (name === 'dashboard') {
      loadStats();
      loadRecentOrders();
    } else if (name === 'products') {
      fetchProducts();
    } else if (name === 'orders') {
      fetchOrders();
    } else if (name === 'reports') {
      loadReportsView();
    }
  }

  menuBtns.dashboard.addEventListener('click', () => switchSection('dashboard'));
  menuBtns.products.addEventListener('click', () => switchSection('products'));
  menuBtns.orders.addEventListener('click', () => switchSection('orders'));
  menuBtns.reports.addEventListener('click', () => switchSection('reports'));

  window.navToOrders = () => switchSection('orders');

  document.getElementById('btn-quick-print')?.addEventListener('click', () => {
    switchSection('reports');
    setTimeout(() => {
      preparePrintReport();
      window.print();
    }, 200);
  });

  // Logout Admin -> Redirect ke /login.html
  document.getElementById('btn-logout-sidebar')?.addEventListener('click', () => {
    if (confirm('Yakin ingin keluar dari Dashboard Administrator?')) {
      localStorage.removeItem('nusantara_admin_token');
      window.location.href = '/login.html';
    }
  });


  // ========================================================
  // 1. STATISTIK DASHBOARD & TRANSAKSI TERAKHIR
  // ========================================================
  async function loadStats() {
    try {
      const res = await adminFetch('/api/admin/stats', {
        headers: { 'x-admin-token': state.token }
      });
      const json = await res.json();
      if (json.success) {
        state.stats = json.data;
        document.getElementById('dash-stat-products').textContent = json.data.totalJenisProduk;
        document.getElementById('dash-stat-stock').textContent = `${json.data.totalStok} pcs`;
        document.getElementById('dash-stat-orders').textContent = json.data.totalPesanan;
        document.getElementById('dash-stat-revenue').textContent = formatRupiah(json.data.totalOmzet);
        const alertBox = document.getElementById('dash-cancel-alert');
        if (alertBox) {
          if (json.data.pengajuanBatal > 0) {
            alertBox.style.display = 'flex';
            alertBox.innerHTML = `<span>⚠ <strong>${json.data.pengajuanBatal} pengajuan pembatalan</strong> dari pelanggan menunggu keputusan Anda. Jangan kirim pesanan tersebut sebelum diputuskan.</span>
              <button class="btn-action btn-action-primary" id="btn-goto-cancel" style="background:#B91C1C; white-space:nowrap;">Tinjau Sekarang</button>`;
            document.getElementById('btn-goto-cancel')?.addEventListener('click', () => {
              switchSection('orders');
              document.querySelector('#order-status-tabs .tab-btn[data-status="Pengajuan Batal"]')?.click();
            });
          } else {
            alertBox.style.display = 'none';
          }
        }
      }
    } catch (err) {
      console.error('Error stats:', err);
    }
  }

  async function loadRecentOrders() {
    try {
      const res = await adminFetch('/api/orders');
      const json = await res.json();
      if (json.success) {
        state.orders = json.data;
        renderRecentOrdersTable();
      }
    } catch (err) {
      console.error(err);
    }
  }

  function renderRecentOrdersTable() {
    const tbody = document.getElementById('dash-table-recent-orders');
    if (!tbody) return;

    const recent = state.orders.slice(0, 5);
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">Belum ada data pesanan masuk.</td></tr>';
      return;
    }

    tbody.innerHTML = recent.map(o => {
      const statusClass = o.status.toLowerCase().replace(/\s+/g, '-');
      return `
        <tr>
          <td><strong style="color:var(--primary);">${o.no_invoice}</strong></td>
          <td style="font-size:0.78rem;">${formatTanggalIndo(o.created_at)}</td>
          <td>${o.nama_pelanggan} (${o.no_hp})</td>
          <td style="font-size:0.8rem;">${o.kurir}</td>
          <td><strong style="color:var(--primary);">${formatRupiah(o.total_bayar)}</strong></td>
          <td><span class="status-badge ${statusClass}">${o.status}</span>${payLabel(o)}${cancelBadge(o)}</td>
          <td style="text-align:center;">
            <button class="btn-action btn-action-secondary" onclick="window.viewInvoiceDetail('${o.no_invoice}')" style="font-size:0.74rem;">
              Detail
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }


  // ========================================================
  // 2. MANAJEMEN DATA PRODUK & STOK (CRUD)
  // ========================================================
  async function fetchProducts() {
    try {
      const res = await adminFetch('/api/products');
      const json = await res.json();
      if (json.success) {
        state.products = json.data;
        renderProductsTable();
      }
    } catch (err) {
      console.error(err);
    }
  }

  function renderProductsTable() {
    const tbody = document.getElementById('admin-products-table-body');
    if (!tbody) return;

    let list = [...state.products];
    if (state.prodFilterCat !== 'Semua') {
      list = list.filter(p => p.kategori === state.prodFilterCat);
    }
    if (state.prodSearchQuery) {
      const q = state.prodSearchQuery.toLowerCase();
      list = list.filter(p =>
        p.nama.toLowerCase().includes(q) ||
        p.kode_produk.toLowerCase().includes(q) ||
        (p.karakteristik && p.karakteristik.toLowerCase().includes(q))
      );
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:24px;">Tidak ada produk yang cocok.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((p, idx) => {
      const isLow = p.stok <= 5;
      const stockClass = p.stok <= 0 ? 'stock-empty' : (isLow ? 'stock-low' : 'stock-in');
      const img = p.gambar || '/images/temanggung_srinthil.jpg';

      return `
        <tr>
          <td>${idx + 1}</td>
          <td><span class="product-code">${p.kode_produk}</span></td>
          <td>
            <img src="${img}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-color);" onerror="this.src='/images/temanggung_srinthil.jpg'">
          </td>
          <td>
            <div style="font-weight: 600; color: var(--text-main);">${p.nama}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${p.karakteristik || '-'}</div>
          </td>
          <td><span class="badge-category">${p.kategori}</span></td>
          <td>${p.berat} gr</td>
          <td><strong>${formatRupiah(p.harga)}</strong></td>
          <td>
            <span class="product-stock-status ${stockClass}" style="font-weight: 600;">
              ${p.stok} pcs
            </span>
          </td>
          <td style="text-align: center;">
            <button class="btn-action btn-action-secondary" onclick="window.openEditProduct(${p.id})">Edit</button>
            <button class="btn-action btn-action-danger" onclick="window.deleteProduct(${p.id})">Hapus</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('prod-search-input')?.addEventListener('input', (e) => {
    state.prodSearchQuery = e.target.value;
    renderProductsTable();
  });

  document.getElementById('prod-category-filter')?.addEventListener('change', (e) => {
    state.prodFilterCat = e.target.value;
    renderProductsTable();
  });

  // Modal Tambah / Edit Produk
  const modalProd = document.getElementById('modal-product');
  const formProd = document.getElementById('form-product');
  const prodFileInput = document.getElementById('prod-gambar-file');
  const prodDropzone = document.getElementById('prod-dropzone');
  const btnBrowseImage = document.getElementById('btn-browse-image');
  const btnReupload = document.getElementById('btn-trigger-reupload');
  const imgPreview = document.getElementById('prod-gambar-preview');
  const filenameEl = document.getElementById('prod-preview-filename');
  const statusEl = document.getElementById('prod-preview-status');
  const hiddenGambarInput = document.getElementById('prod-gambar');

  function resetProductImage(customPath) {
    const defaultPath = customPath || '/images/temanggung_srinthil.jpg';
    if (hiddenGambarInput) hiddenGambarInput.value = defaultPath;
    if (imgPreview) imgPreview.src = defaultPath;
    if (prodFileInput) prodFileInput.value = '';
    
    if (customPath) {
      const name = customPath.split('/').pop() || 'foto_produk.jpg';
      if (filenameEl) filenameEl.textContent = name;
      if (statusEl) {
        statusEl.textContent = '✓ Foto produk terpasang';
        statusEl.style.color = '#059669';
      }
    } else {
      if (filenameEl) filenameEl.textContent = 'temanggung_srinthil.jpg (Default)';
      if (statusEl) {
        statusEl.textContent = 'ℹ️ Foto bawaan sistem (Bisa diganti file baru)';
        statusEl.style.color = 'var(--text-muted)';
      }
    }
  }

  function handleProductFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Harap unggah file berformat gambar (JPG, PNG, atau WEBP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Ukuran file foto terlalu besar! Maksimal 5 MB.');
      return;
    }

    if (filenameEl) filenameEl.textContent = file.name;
    if (statusEl) {
      statusEl.textContent = '⏳ Mengunggah foto produk...';
      statusEl.style.color = '#B45309';
    }
    if (prodDropzone) prodDropzone.classList.add('uploading');

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      if (imgPreview) imgPreview.src = dataUrl;

      try {
        const res = await adminFetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': state.token
          },
          body: JSON.stringify({
            dataUrl: dataUrl,
            filename: file.name
          })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        if (hiddenGambarInput) hiddenGambarInput.value = json.url;
        if (statusEl) {
          statusEl.textContent = '✓ Berhasil diunggah ke server';
          statusEl.style.color = '#059669';
        }
      } catch (err) {
        console.warn('Gagal upload gambar ke endpoint, gunakan dataUrl lokal:', err);
        if (hiddenGambarInput) hiddenGambarInput.value = dataUrl;
        if (statusEl) {
          statusEl.textContent = '✓ Foto tersimpan (Lokal/DataURL)';
          statusEl.style.color = '#059669';
        }
      } finally {
        if (prodDropzone) prodDropzone.classList.remove('uploading');
      }
    };
    reader.readAsDataURL(file);
  }

  // Trigger file input dialog
  btnBrowseImage?.addEventListener('click', (e) => {
    e.stopPropagation();
    prodFileInput?.click();
  });

  btnReupload?.addEventListener('click', (e) => {
    e.stopPropagation();
    prodFileInput?.click();
  });

  prodDropzone?.addEventListener('click', () => {
    prodFileInput?.click();
  });

  prodFileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProductFile(e.target.files[0]);
    }
  });

  // Drag and drop events for dropzone
  if (prodDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      prodDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        prodDropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      prodDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        prodDropzone.classList.remove('dragover');
      });
    });

    prodDropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleProductFile(e.dataTransfer.files[0]);
      }
    });
  }

  document.getElementById('btn-open-add-product')?.addEventListener('click', () => {
    formProd.reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('modal-product-title').textContent = '➕ Tambah Produk Baru';
    resetProductImage();
    modalProd.showModal();
  });

  window.openEditProduct = function(id) {
    const p = state.products.find(i => i.id === id);
    if (!p) return;

    document.getElementById('modal-product-title').textContent = '✏️ Edit Data Produk & Stok';
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-kode').value = p.kode_produk;
    document.getElementById('prod-nama').value = p.nama;
    document.getElementById('prod-kategori').value = p.kategori;
    document.getElementById('prod-karakteristik').value = p.karakteristik || '';
    document.getElementById('prod-berat').value = p.berat;
    document.getElementById('prod-harga').value = p.harga;
    document.getElementById('prod-stok').value = p.stok;
    document.getElementById('prod-deskripsi').value = p.deskripsi || '';

    resetProductImage(p.gambar);

    modalProd.showModal();
  };

  formProd?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (prodDropzone?.classList.contains('uploading')) {
      alert('Foto produk masih dalam proses pengunggahan. Harap tunggu sebentar.');
      return;
    }
    const id = document.getElementById('prod-id').value;
    const isEdit = Boolean(id);

    const payload = {
      kode_produk: document.getElementById('prod-kode').value.trim(),
      nama: document.getElementById('prod-nama').value.trim(),
      kategori: document.getElementById('prod-kategori').value,
      karakteristik: document.getElementById('prod-karakteristik').value.trim(),
      berat: Number(document.getElementById('prod-berat').value),
      harga: Number(document.getElementById('prod-harga').value),
      stok: Number(document.getElementById('prod-stok').value),
      gambar: document.getElementById('prod-gambar').value.trim() || '/images/temanggung_srinthil.jpg',
      deskripsi: document.getElementById('prod-deskripsi').value.trim()
    };

    const url = isEdit ? `/api/products/${id}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await adminFetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': state.token
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      modalProd.close();
      alert('✓ ' + json.message);
      fetchProducts();
      loadStats();
    } catch (err) {
      alert('Gagal menyimpan produk: ' + err.message);
    }
  });

  window.deleteProduct = async function(id) {
    const p = state.products.find(i => i.id === id);
    if (!p) return;

    if (!confirm(`Hapus produk "${p.nama}" (${p.kode_produk}) dari sistem?`)) {
      return;
    }

    try {
      const res = await adminFetch(`/api/products/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': state.token }
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      alert('✓ ' + json.message);
      fetchProducts();
      loadStats();
    } catch (err) {
      alert('Gagal menghapus: ' + err.message);
    }
  };


  // ========================================================
  // 3. MANAJEMEN PESANAN MASUK & STATUS RESI
  // ========================================================
  async function fetchOrders() {
    try {
      const res = await adminFetch('/api/orders');
      const json = await res.json();
      if (json.success) {
        notifyNewOrders(json.data);
        state.orders = json.data;
        renderOrdersTable();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Bunyi + banner saat ada pesanan lunas baru / pengajuan batal baru (panel admin harus terbuka).
  let seenPaid = null, seenCancel = null;
  const baseTitle = document.title;
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.2);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.18);
        o.start(ctx.currentTime + i * 0.2); o.stop(ctx.currentTime + i * 0.2 + 0.2);
      });
    } catch (e) { }
  }
  function notifyNewOrders(list) {
    const paid = new Set(list.filter(o => ['paid', 'cod'].includes(o.payment_status) && o.status === 'Diproses').map(o => o.id));
    const canc = new Set(list.filter(o => o.cancel_status === 'diajukan').map(o => o.id));
    if (seenPaid !== null) {
      const newPaid = [...paid].filter(id => !seenPaid.has(id)).length;
      const newCanc = [...canc].filter(id => !seenCancel.has(id)).length;
      if (newPaid || newCanc) {
        beep();
        const msg = [newPaid ? `${newPaid} pesanan baru masuk` : '', newCanc ? `${newCanc} pengajuan batal baru` : ''].filter(Boolean).join(' • ');
        let bar = document.getElementById('new-order-banner');
        if (!bar) {
          bar = document.createElement('div'); bar.id = 'new-order-banner';
          bar.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;background:#065F46;color:#fff;padding:14px 18px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-weight:600;cursor:pointer;max-width:320px';
          bar.onclick = () => bar.remove(); document.body.appendChild(bar);
        }
        bar.textContent = '🔔 ' + msg + ' (klik untuk tutup)';
        document.title = '(!) ' + msg + ' - ' + baseTitle;
        setTimeout(() => { document.title = baseTitle; }, 60000);
      }
    }
    seenPaid = paid; seenCancel = canc;
  }

  function renderOrdersTable() {
    const tbody = document.getElementById('admin-orders-table-body');
    if (!tbody) return;

    let orders = [...state.orders];
    if (state.orderFilterStatus !== 'Semua') {
      orders = orders.filter(o => state.orderFilterStatus === 'Pengajuan Batal' ? o.cancel_status === 'diajukan' : state.orderFilterStatus === 'Kedaluwarsa' ? ['Kedaluwarsa', 'Dibatalkan'].includes(o.status) : o.status === state.orderFilterStatus);
    }
    if (state.orderSearchQuery) {
      const q = state.orderSearchQuery.toLowerCase();
      orders = orders.filter(o =>
        o.no_invoice.toLowerCase().includes(q) ||
        o.nama_pelanggan.toLowerCase().includes(q) ||
        o.no_hp.toLowerCase().includes(q) ||
        (o.no_resi && o.no_resi.toLowerCase().includes(q))
      );
    }

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:24px;">Tidak ada pesanan yang sesuai filter.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(order => {
      const items = JSON.parse(order.items_json);
      const itemsSummary = items.map(i => `${i.nama} (x${i.qty})`).join(', ');
      const statusClass = order.status.toLowerCase().replace(/\s+/g, '-');

      return `
        <tr>
          <td><strong style="color: var(--primary);">${order.no_invoice}</strong></td>
          <td style="font-size: 0.78rem;">${formatTanggalIndo(order.created_at)}</td>
          <td>
            <strong>${order.nama_pelanggan}</strong><br>
            <span style="font-size: 0.78rem; color: var(--text-muted);">${order.no_hp}</span>
          </td>
          <td style="font-size: 0.8rem; max-width: 220px;">
            <strong>${order.kurir}</strong><br>
            <span style="color: var(--text-muted);">${order.alamat}</span>
          </td>
          <td style="font-size: 0.8rem; max-width: 180px;">
            ${itemsSummary}
          </td>
          <td>
            <strong style="color: var(--primary);">${formatRupiah(order.total_bayar)}</strong><br>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${order.metode_bayar}</span>
          </td>
          <td>
            <span class="status-badge ${statusClass}">${order.status}</span>${payLabel(order)}${cancelBadge(order)}
          </td>
          <td>
            ${order.no_resi ? `<code style="font-weight:bold; background:#F3F0EC; padding:2px 6px; border-radius:4px;">${order.no_resi}</code>` : '<span style="color:var(--text-light);">-</span>'}
          </td>
          <td style="text-align: center;">
            <button class="btn-action btn-action-primary" onclick="window.openStatusModal(${order.id})" style="font-size: 0.75rem; margin-bottom: 4px;">
              ⚙️ Ubah Status
            </button>
            ${order.payment_status === 'cod' && !['Dibatalkan', 'Kedaluwarsa'].includes(order.status) ? `<button class="btn-action" onclick="window.markCodPaid(${order.id})" style="font-size: 0.75rem; margin-bottom: 4px; background:#ECFDF5; color:#065F46; border:1px solid #6EE7B7;">💵 Tandai Lunas</button>` : ''}
            <button class="btn-action btn-action-secondary" onclick="window.viewInvoiceDetail('${order.no_invoice}')" style="font-size: 0.75rem;">
              Detail
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.markCodPaid = async function (id) {
    const o = state.orders.find(item => item.id === id);
    if (!o) return;
    if (!confirm(`Tandai pesanan ${o.no_invoice} sebagai LUNAS?\nPastikan uang tunai ${formatRupiah(o.total_bayar)} sudah benar-benar diterima.`)) return;
    try {
      const res = await adminFetch(`/api/orders/${id}/mark-paid`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      alert('✓ ' + json.message);
      fetchOrders(); loadStats();
    } catch (err) { alert('Gagal: ' + err.message); }
  };

  document.querySelectorAll('#order-status-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#order-status-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.orderFilterStatus = btn.getAttribute('data-status');
      renderOrdersTable();
    });
  });

  document.getElementById('order-search-input')?.addEventListener('input', (e) => {
    state.orderSearchQuery = e.target.value;
    renderOrdersTable();
  });

  // Modal Update Status
  const modalStatus = document.getElementById('modal-status');
  const formStatus = document.getElementById('form-status');

  window.openStatusModal = function(id) {
    const o = state.orders.find(item => item.id === id);
    if (!o) return;

    document.getElementById('status-order-id').value = o.id;
    document.getElementById('status-invoice-val').textContent = o.no_invoice;
    document.getElementById('status-customer-val').textContent = `${o.nama_pelanggan} (${o.no_hp})`;
    document.getElementById('status-courier-val').textContent = o.kurir;
    document.getElementById('status-select-val').value = o.status;
    document.getElementById('status-resi-val').value = o.no_resi || '';

    const box = document.getElementById('status-cancel-box');
    if (box) {
      if (o.cancel_status === 'diajukan') {
        const r = (o.cancel_reason || '').replace(/</g, '&lt;');
        box.style.display = 'block';
        box.innerHTML = `
          <div style="background:#FEE2E2; border:1px solid #FCA5A5; color:#991B1B; border-radius:8px; padding:12px 14px; margin-bottom:14px; font-size:0.86rem;">
            <strong>⚠ Pelanggan mengajukan pembatalan</strong><br>
            Alasan: <em>${r}</em><br>
            <span style="font-size:0.78rem;">Pesanan tidak bisa dikirim sebelum Anda memutuskan. ${o.payment_status === 'paid' ? 'Jika disetujui, lakukan <strong>refund</strong> di dashboard Midtrans (menu Transaction).' : ''}</span>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button type="button" id="btn-cancel-approve" class="btn-action btn-action-primary" style="background:#B91C1C; flex:1; justify-content:center;">✓ Setujui Pembatalan</button>
              <button type="button" id="btn-cancel-reject" class="btn-action btn-action-secondary" style="flex:1; justify-content:center;">✕ Tolak (tetap proses)</button>
            </div>
          </div>`;
        document.getElementById('btn-cancel-approve').onclick = async () => {
          if (!confirm('Setujui pembatalan? Pesanan jadi Dibatalkan dan stok dikembalikan.')) return;
          await submitStatusChange(o.id, 'Dibatalkan', o.no_resi || '');
        };
        document.getElementById('btn-cancel-reject').onclick = async () => {
          if (!confirm('Tolak pengajuan? Pesanan tetap diproses.')) return;
          try {
            const res = await adminFetch(`/api/orders/${o.id}/cancel-request/reject`, { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.message);
            modalStatus.close(); alert('✓ ' + json.message); fetchOrders(); loadStats();
          } catch (err) { alert('Gagal: ' + err.message); }
        };
      } else if (['dibatalkan_pelanggan', 'disetujui', 'ditolak'].includes(o.cancel_status)) {
        box.style.display = 'block';
        box.innerHTML = `<div style="background:#F3F4F6; border:1px solid #E5E7EB; border-radius:8px; padding:10px 12px; margin-bottom:14px; font-size:0.82rem;">Riwayat pembatalan pelanggan: ${cancelBadge(o).replace(/<div[^>]*>/, '<div>')}</div>`;
      } else {
        box.style.display = 'none'; box.innerHTML = '';
      }
    }

    modalStatus.showModal();
  };

  formStatus?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('status-order-id').value;
    const status = document.getElementById('status-select-val').value;
    const no_resi = document.getElementById('status-resi-val').value.trim();
    await submitStatusChange(id, status, no_resi);
  });

  async function submitStatusChange(id, status, no_resi) {
    try {
      const res = await adminFetch(`/api/orders/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': state.token
        },
        body: JSON.stringify({ status, no_resi })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      modalStatus.close();
      alert('✓ ' + json.message);
      fetchOrders();
      loadStats();
    } catch (err) {
      alert('Gagal memperbarui status: ' + err.message);
    }
  }

  // Modal Invoice Detail
  const modalInvoice = document.getElementById('modal-invoice-detail');
  window.viewInvoiceDetail = async function(invoiceNo) {
    try {
      const res = await adminFetch(`/api/orders/${invoiceNo}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      const order = json.data;
      const items = JSON.parse(order.items_json);
      const statusClass = order.status.toLowerCase().replace(/\s+/g, '-');

      const body = document.getElementById('invoice-modal-content');
      body.innerHTML = `
        <div style="text-align: center; border-bottom: 2px dashed var(--border-color); padding-bottom: 12px; margin-bottom: 14px;">
          <h2 style="font-size: 1.25rem; color: var(--primary); margin-bottom: 2px;">TOKO NUSANTARA TOBACCO</h2>
          <p style="font-size: 0.8rem; color: var(--text-muted);">Pusat Tembakau Pilihan Nusantara & Alat Linting Tradisional</p>
          <p style="font-size: 0.75rem; color: var(--text-muted);">Jl. Pramuka No.11, Jenang Utara, Jenang, Kec. Majenang, Kabupaten Cilacap, Jawa Tengah 53257 | WA: 0853-8549-0505</p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem; margin-bottom: 14px;">
          <div>
            <strong>No. Invoice:</strong> ${order.no_invoice}<br>
            <strong>Tanggal:</strong> ${formatTanggalIndo(order.created_at)}<br>
            <strong>Status:</strong> <span class="status-badge ${statusClass}">${order.status}</span>${payLabel(order)}${cancelBadge(order)}
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
      modalInvoice.showModal();
    } catch (err) {
      alert('Gagal memuat invoice: ' + err.message);
    }
  };


  // ========================================================
  // 4. LAPORAN PENJUALAN (SKRIPSI / PRINT PDF)
  // ========================================================
  function loadReportsView() {
    const tbody = document.getElementById('report-table-body');
    if (!tbody) return;

    const rep = reportOrders();
    if (rep.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px;">Tidak ada transaksi lunas.</td></tr>';
      return;
    }

    tbody.innerHTML = rep.map((o, idx) => {
      const items = JSON.parse(o.items_json);
      const itemsText = items.map(i => `${i.nama} (${i.qty}x)`).join(', ');
      return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${o.no_invoice}</strong></td>
          <td>${formatTanggalIndo(o.created_at)}</td>
          <td>${o.nama_pelanggan}</td>
          <td>${o.kurir}</td>
          <td style="font-size:0.8rem;">${itemsText}</td>
          <td style="text-align:right; font-weight:bold; color:var(--primary);">${formatRupiah(o.total_bayar)}</td>
          <td style="text-align:center;">${o.status}</td>
          <td>${o.no_resi || '-'}</td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('btn-print-report-action')?.addEventListener('click', () => {
    preparePrintReport();
    window.print();
  });

  function preparePrintReport() {
    const tbody = document.getElementById('print-report-table-body');
    const now = new Date();
    const tanggalCetak = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) + ' WIB';

    document.getElementById('print-report-date').textContent = `Tanggal Cetak: ${tanggalCetak}`;
    document.getElementById('print-signature-date').textContent = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const totalRevenue = reportOrders().reduce((sum, o) => sum + o.total_bayar, 0);
    document.getElementById('print-total-revenue').textContent = formatRupiah(totalRevenue);

    tbody.innerHTML = reportOrders().map((o, idx) => {
      const items = JSON.parse(o.items_json);
      const itemsList = items.map(i => `${i.nama} (${i.qty}x)`).join(', ');

      return `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${o.no_invoice}</strong></td>
          <td>${formatTanggalIndo(o.created_at)}</td>
          <td>${o.nama_pelanggan}</td>
          <td>${o.no_hp}</td>
          <td>${o.kurir}</td>
          <td>${itemsList}</td>
          <td style="text-align: right; font-weight: bold;">${formatRupiah(o.total_bayar)}</td>
          <td style="text-align: center;">${o.status}</td>
          <td>${o.no_resi || '-'}</td>
        </tr>
      `;
    }).join('');
  }

  // Muat ulang otomatis tiap 30 detik agar pengajuan batal / pesanan baru langsung terlihat
  setInterval(() => {
    if (document.querySelector('dialog[open]')) return;
    loadStats();
    loadRecentOrders();
    fetchOrders();
  }, 15000);

  // Initial Load
  switchSection('dashboard');
});
