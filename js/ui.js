// js/ui.js
import { data, saveAppData } from './db.js';
import { t, fmtMoney, fmtDate, parseMoney, initMoneyInputs } from './utils.js';

// Global variables
let chartInstance = null;
let trendChartInstance = null;
let currentPinInput = "";
let isSettingUpPin = false;
let onConfirmAction = null;
let deferredPrompt = null; // Untuk PWA Install

// --- PWA INSTALL LOGIC ---
export function initPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        // Tampilkan tombol di halaman setting
        const installBtn = document.getElementById('btn-install-app');
        if(installBtn) installBtn.style.display = 'flex'; 
        
        // Tampilkan banner di Home jika belum pernah ditutup
        const homeBanner = document.getElementById('install-prompt');
        if(homeBanner && !localStorage.getItem('installDismissed')) {
            homeBanner.style.display = 'block';
        }
    });
}

export function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('User accepted the install prompt');
            }
            deferredPrompt = null;
            document.getElementById('btn-install-app').style.display = 'none';
            const homeBanner = document.getElementById('install-prompt');
            if(homeBanner) homeBanner.style.display = 'none';
        });
    }
}

export function dismissInstall() {
    document.getElementById('install-prompt').style.display = 'none';
    localStorage.setItem('installDismissed', 'true');
}

// --- HELPER UI ---
export function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Inline style untuk memastikan tampilan benar
    toast.style.cssText = `background:${type==='success'?'#00b09b':'#fc5c7d'}; color:white; padding:12px 20px; border-radius:12px; margin-top:10px; box-shadow:0 5px 15px rgba(0,0,0,0.2); animation:fadeIn 0.3s; display:flex; align-items:center; gap:10px;`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- NAVIGATION ---
export function navTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navLinks = document.querySelectorAll('.nav-item');
    navLinks.forEach(link => {
        if(link.getAttribute('onclick') && link.getAttribute('onclick').includes(pageId)) {
            link.classList.add('active');
        }
    });
    
    // Render ulang grafik saat kembali ke home
    if (pageId === 'page-home') {
        renderTrendChart();
        renderWallets();
    }
}

export function switchTab(context, tabId) {
    const parent = context === 'tools' ? document.getElementById('page-tools') : document.getElementById(`page-${context}`);
    if(!parent) return;

    parent.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = 'none';
    });
    const target = document.getElementById(tabId);
    target.classList.add('active');
    target.style.display = 'block';

    parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if(event && event.target) event.target.classList.add('active');
}

export function openModal(id) {
    document.getElementById(id).classList.add('active');
    // Jika modal budget, render pilihan kategori
    if(id === 'modal-budget') {
        renderCategorySelector();
    }
}

export function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    if(id === 'modal-budget') {
        // Reset form input
        document.getElementById('b-id').value = '';
        document.getElementById('b-amount').value = '';
        document.getElementById('b-desc').value = '';
        document.getElementById('b-category-id').value = '';
        document.querySelectorAll('.cat-item').forEach(c => c.classList.remove('active'));
    }
}

// --- WALLETS ---
export function renderWallets() {
    const container = document.getElementById('wallet-list');
    const select = document.getElementById('b-wallet');
    if(!container || !select) return;

    container.innerHTML = '';
    select.innerHTML = '';
    let globalTotal = 0;

    data.wallets.forEach(w => {
        globalTotal += w.balance;
        
        let icon = 'fa-wallet';
        if(w.type === 'bank') icon = 'fa-university';
        if(w.type === 'ewallet') icon = 'fa-mobile-alt';

        const div = document.createElement('div');
        div.className = 'wallet-card-mini';
        div.innerHTML = `<div class="icon"><i class="fas ${icon}"></i></div><small>${w.name}</small><strong>${fmtMoney(w.balance)}</strong>`;
        container.appendChild(div);

        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name;
        select.appendChild(opt);
    });
    document.getElementById('main-balance').textContent = fmtMoney(globalTotal);
}

// --- BUDGET & CATEGORIES ---
function renderCategorySelector() {
    const grid = document.getElementById('category-grid');
    const type = document.querySelector('input[name="b-type"]:checked').value;
    const currentCatId = document.getElementById('b-category-id').value;
    
    grid.innerHTML = '';
    
    // Filter kategori berdasarkan tipe (expense/income)
    const cats = data.categories.filter(c => c.type === type);
    
    cats.forEach(c => {
        const div = document.createElement('div');
        div.className = `cat-item ${currentCatId === c.id ? 'active' : ''}`;
        div.onclick = () => {
            document.querySelectorAll('.cat-item').forEach(x => x.classList.remove('active'));
            div.classList.add('active');
            document.getElementById('b-category-id').value = c.id;
        };
        div.innerHTML = `<i class="fas ${c.icon}" style="color:${c.color}"></i><span>${c.name}</span>`;
        grid.appendChild(div);
    });
}

// Saat radio button Pemasukan/Pengeluaran berubah
export function onBudgetTypeChange() {
    document.getElementById('b-category-id').value = ''; // Reset pilihan
    renderCategorySelector();
}

export function saveBudget() {
    const id = document.getElementById('b-id').value;
    const amount = parseMoney(document.getElementById('b-amount').value);
    const desc = document.getElementById('b-desc').value;
    const categoryId = document.getElementById('b-category-id').value;
    const walletId = parseInt(document.getElementById('b-wallet').value);
    const date = document.getElementById('b-date').value || new Date().toISOString().split('T')[0];
    const type = document.querySelector('input[name="b-type"]:checked').value;

    if (!amount || !categoryId) return showToast("Nominal & Kategori wajib diisi", 'error');

    // Ambil nama kategori untuk deskripsi default jika kosong
    const cat = data.categories.find(c => c.id === categoryId);
    const finalDesc = desc || cat.name;

    // Logic Update Saldo (Hapus transaksi lama dulu jika sedang edit)
    if (id) {
        const oldItem = data.budget.find(b => b.id == id);
        if(oldItem) {
            const w = data.wallets.find(x => x.id === oldItem.walletId);
            if(w) {
                if(oldItem.type === 'income') w.balance -= oldItem.amount; else w.balance += oldItem.amount;
            }
            data.budget = data.budget.filter(b => b.id != id);
        }
    }

    // Update Saldo Baru
    const w = data.wallets.find(x => x.id === walletId);
    if(w) {
        if(type === 'income') w.balance += amount; else w.balance -= amount;
    }

    // Simpan Transaksi
    data.budget.unshift({
        id: id || Date.now(),
        type, amount, desc: finalDesc, categoryId, walletId, date
    });

    saveAppData(window.currentUser, window.dbInstance);
    closeModal('modal-budget');
    showToast("Transaksi disimpan!");
    updateUI();
}

export function renderBudget() {
    const list = document.getElementById('budget-list');
    const keyword = document.getElementById('budget-search').value.toLowerCase();
    
    list.innerHTML = '';
    let income = 0, expense = 0;
    
    // Grouping data untuk Grafik Donat
    const expenseCats = {}; 

    data.budget.forEach(b => {
        if(b.type === 'income') income += b.amount; else expense += b.amount;
        
        // Data Grafik
        if(b.type === 'expense') {
            if(!expenseCats[b.categoryId]) expenseCats[b.categoryId] = 0;
            expenseCats[b.categoryId] += b.amount;
        }

        // Filter Pencarian
        if(keyword && !b.desc.toLowerCase().includes(keyword)) return;

        // Cari detail kategori
        const cat = data.categories.find(c => c.id === b.categoryId) || { icon: 'fa-question', color: '#ccc', name: 'Umum' };
        const w = data.wallets.find(x => x.id === b.walletId);

        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div style="display:flex; align-items:center; width:100%">
                <div class="cat-icon-box" style="background:${cat.color}">
                    <i class="fas ${cat.icon}"></i>
                </div>
                <div style="flex:1">
                    <div class="flex-between">
                        <strong>${b.desc}</strong>
                        <strong class="${b.type === 'income' ? 'text-green' : 'text-red'}">
                            ${b.type === 'income' ? '+' : '-'} ${fmtMoney(b.amount)}
                        </strong>
                    </div>
                    <div class="flex-between mt-10">
                        <small class="text-muted">${fmtDate(b.date)} • ${w ? w.name : 'Dompet'}</small>
                        <div>
                            <i class="fas fa-pen text-primary" style="margin-right:10px; cursor:pointer;" onclick="editBudget(${b.id})"></i>
                            <i class="fas fa-trash text-muted" style="cursor:pointer;" onclick="deleteItem('budget', ${b.id})"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
        list.appendChild(div);
    });

    document.getElementById('main-income').textContent = fmtMoney(income);
    document.getElementById('main-expense').textContent = fmtMoney(expense);
    
    renderChart(expenseCats);
}

export function editBudget(id) {
    const b = data.budget.find(x => x.id === id);
    if(!b) return;

    document.getElementById('b-id').value = b.id;
    document.getElementById('b-amount').value = b.amount.toLocaleString('id-ID');
    document.getElementById('b-desc').value = b.desc;
    document.getElementById('b-date').value = b.date;
    document.getElementById('b-wallet').value = b.walletId;
    document.getElementById('b-category-id').value = b.categoryId;
    
    // Set Radio Button
    const radio = document.getElementById(b.type === 'income' ? 't-in' : 't-out');
    radio.checked = true;
    
    openModal('modal-budget');
    // Delay sedikit agar modal render dulu, lalu trigger seleksi kategori
    setTimeout(() => {
        renderCategorySelector();
        // Highlight kategori yang terpilih secara manual
        const items = document.querySelectorAll('.cat-item');
        // Loop sederhana untuk mencari kategori yg cocok
        data.categories.forEach((c, index) => {
             if(c.id === b.categoryId && items[index]) items[index].classList.add('active');
        });
    }, 100);
}

// --- CHART (EXPENSE BREAKDOWN) ---
function renderChart(expenseData) {
    const ctx = document.getElementById('mainChart');
    if(!ctx) return;
    if(chartInstance) chartInstance.destroy();

    const labels = [];
    const points = [];
    const colors = [];

    // Urutkan kategori berdasarkan pengeluaran terbesar
    const sorted = Object.keys(expenseData).sort((a,b) => expenseData[b] - expenseData[a]);
    
    sorted.forEach(catId => {
        const cat = data.categories.find(c => c.id === catId);
        if(cat) {
            labels.push(cat.name);
            points.push(expenseData[catId]);
            colors.push(cat.color);
        }
    });

    if(points.length === 0) {
        labels.push("Belum ada");
        points.push(1);
        colors.push("#e0e0e0");
    }

    chartInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: points,
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: {
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 15, font: { size: 10 } } }
            }
        }
    });
}

// --- TREND CHART ---
export function renderTrendChart() {
    const ctx = document.getElementById('trendChart');
    if(!ctx) return; 
    
    const labels = [];
    const dataPoints = [];
    const today = new Date();
    
    for(let i=5; i>=0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
        const key = d.toISOString().slice(0, 7); // "2023-11"
        labels.push(d.toLocaleDateString('id-ID', {month:'short'}));
        
        const total = data.budget
            .filter(b => b.type === 'expense' && b.date.startsWith(key))
            .reduce((sum, b) => sum + b.amount, 0);
        dataPoints.push(total);
    }

    if(trendChartInstance) trendChartInstance.destroy();
    
    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(68, 129, 235, 0.5)');
    gradient.addColorStop(1, 'rgba(68, 129, 235, 0.0)');

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Pengeluaran',
                data: dataPoints,
                borderColor: '#4481eb',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            scales: { y: { display: false }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

// --- SYSTEM ---
export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    data.settings.theme = next;
    saveAppData(window.currentUser, window.dbInstance);
}

export function initTheme() {
    document.documentElement.setAttribute('data-theme', data.settings.theme);
}

export function updateUI() {
    renderWallets();
    renderBudget();
    renderTrendChart();
    // Render modul lain jika diperlukan
}

export function deleteItem(collection, id) {
    if(!confirm("Yakin hapus?")) return;
    
    if(collection === 'budget') {
        const item = data.budget.find(x => x.id === id);
        if(item) {
            const w = data.wallets.find(x => x.id === item.walletId);
            if(w) {
                if(item.type === 'income') w.balance -= item.amount; else w.balance += item.amount;
            }
            data.budget = data.budget.filter(x => x.id !== id);
        }
    }
    
    saveAppData(window.currentUser, window.dbInstance);
    updateUI();
    showToast("Item dihapus");
}
// Tambahkan ini di bagian paling bawah js/ui.js

export function refreshAds(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const ads = container.querySelectorAll('ins.adsbygoogle');
    ads.forEach(ad => {
        // Jika iklan belum terisi (tidak ada atribut status)
        if (!ad.getAttribute('data-adsbygoogle-status')) {
            try {
                if (typeof window.adsbygoogle !== 'undefined') window.adsbygoogle.push({});
            } catch (e) {
                console.warn("AdSense pending...");
            }
        }
    });
}
