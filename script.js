// ===================================
// VARIABEL GLOBAL DAN KONSTANTA
// ===================================
let transactions = [];
const FINE_RATE = 0.05; // 5% per bulan
const STORAGE_KEY = 'eximouse_finance_v4'; // Kunci LocalStorage Baru

// Elemen DOM Utama
const pageTitle = document.getElementById('pageTitle');
const sideMenuModal = document.getElementById('sideMenuModal');
const menuToggle = document.getElementById('menuToggle');
const fab = document.getElementById('fabAddTransaction');

const detailModal = document.getElementById('transactionDetailModal');
const paymentModal = document.getElementById('paymentDateModal');
const nominalPaidInput = document.getElementById('nominalPaidInput');
const datePaidInput = document.getElementById('datePaidInput');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
const paymentAmountDisplay = document.getElementById('paymentAmountDisplay');
const transactionForm = document.getElementById('transactionForm');
const principalInput = document.getElementById('principal');
const interestRateInput = document.getElementById('interestRate');
const installmentsCountInput = document.getElementById('installmentsCount');
const finalDueDateDisplay = document.getElementById('finalDueDateDisplay');
const estimateDiv = document.getElementById('installmentEstimate');
const startDateInput = document.getElementById('startDate'); // Mendapatkan input tanggal mulai

// Variabel state modal
let currentTxId = null;
let currentPaymentData = { totalDue: 0, cumulativeInstallments: 0, totalFine: 0, installmentsToPay: 0 };
let loanChartInstance = null;
let notificationScheduler = null;

// Konstanta Notifikasi
const NOTIFICATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam

// ===================================
// 1. MANAJEMEN DATA & LOCAL STORAGE
// ===================================

function loadTransactions() {
    const storedTransactions = localStorage.getItem(STORAGE_KEY);
    if (storedTransactions) {
        try {
            transactions = JSON.parse(storedTransactions);
            if (!Array.isArray(transactions)) {
                transactions = [];
            }
        } catch (e) {
            console.error("Gagal parse data Local Storage:", e);
            transactions = [];
        }
    }
}

function saveTransactions() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
        renderBackupPageData();
    } catch (error) {
        alert('Gagal menyimpan data lokal. Local Storage mungkin penuh.');
        console.error(error);
    }
}

function clearAllData() {
    if (confirm("ANDA YAKIN? Semua data transaksi (Piutang & Utang) akan dihapus PERMANEN!")) {
        localStorage.removeItem(STORAGE_KEY);
        transactions = [];
        alert("Semua data berhasil dihapus. Halaman akan dimuat ulang.");
        location.reload();
    }
}


// ===================================
// 2. FUNGSI UTILITAS DATA & FORMATTING
// ===================================

function formatInputRupiah(inputElement) {
    let angka = inputElement.value.replace(/\D/g, '');
    if (!angka || angka === '0') {
        inputElement.value = '';
        return;
    }
    let formatted = new Intl.NumberFormat('id-ID').format(angka);
    inputElement.value = formatted;
}

function formatCurrency(amount) {
    const roundedAmount = Math.round(parseFloat(amount) || 0);
    return roundedAmount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).replace('IDR', 'Rp ');
}

function cleanInterestRate(input) {
    return String(input).replace(/,/g, '.').replace(/[^0-9.]/g, '');
}

function cleanPrincipal(input) {
     return parseFloat(String(input).replace(/\./g, '').replace(/,/g, '') || 0);
}

// Fungsi Perhitungan Utama: Total Pokok + Bunga
function calculateTotal(principal, rate, installmentsCount) {
    const principalAmount = cleanPrincipal(principal);
    const interestRate = parseFloat(cleanInterestRate(rate)) / 100;
    const installments = parseInt(installmentsCount);

    if (isNaN(principalAmount) || isNaN(interestRate) || isNaN(installments) || installments <= 0) {
        return { totalInterest: 0, totalAmount: 0, totalPerInstallment: 0 };
    }

    const totalInterest = principalAmount * interestRate * installments;
    const totalAmount = principalAmount + totalInterest;
    const totalPerInstallment = totalAmount / installments;

    return {
        totalInterest: totalInterest,
        totalAmount: totalAmount,
        totalPerInstallment: totalPerInstallment,
    };
}

// Fungsi Penentuan Jatuh Tempo Cicilan ke-N
function calculateInstallmentDueDate(tx, installmentIndex) {
     const dateString = tx.startDate;
     if (!dateString || installmentIndex <= 0) return null;

     const startDate = new Date(dateString + 'T00:00:00');
     const startDay = startDate.getDate();

     const targetMonth = startDate.getMonth() + installmentIndex;
     const targetYear = startDate.getFullYear() + Math.floor(targetMonth / 12);
     const newMonth = targetMonth % 12;

     let dueDate = new Date(targetYear, newMonth, startDay);

     // Penyesuaian tanggal akhir bulan
     if (dueDate.getMonth() !== newMonth) {
          dueDate = new Date(targetYear, newMonth + 1, 0);
     }

     const year = dueDate.getFullYear();
     const month = String(dueDate.getMonth() + 1).padStart(2, '0');
     const day = String(dueDate.getDate()).padStart(2, '0');

     return `${year}-${month}-${day}`;
}

// Fungsi Penentuan Jatuh Tempo Cicilan Berikutnya (Aktif)
function calculateNextDueDate(tx) {
    const paidCount = tx.paymentHistory ? tx.paymentHistory.reduce((sum, p) => sum + (p.installmentsPaid || 1), 0) : 0;
    const nextInstallmentIndex = paidCount + 1;

    if (nextInstallmentIndex > tx.installmentsCount) return null;

    return calculateInstallmentDueDate(tx, nextInstallmentIndex);
}

// Fungsi Perhitungan Denda Majemuk (Compounding Fine) - KRUSIAL
function calculateCumulativePayment(tx, currentDateString) {
    if (tx.status !== 'aktif') return { cumulativeInstallments: 0, totalFine: 0, totalOverdueInstallments: 0, fineDetails: [], remainingPrincipal: 0 };

    const totals = calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount);
    const installmentAmount = totals.totalPerInstallment;

    const paidTotalCount = tx.paymentHistory ? tx.paymentHistory.reduce((sum, p) => sum + (p.installmentsPaid || 1), 0) : 0;

    let cumulativeInstallments = 0;
    let totalFine = 0;
    let fineDetails = [];
    let totalOverdueInstallments = 0;

    const currentDate = new Date(currentDateString + 'T00:00:00');
    currentDate.setHours(0, 0, 0, 0);

    let firstOverdueDate = null;

    // 1. Tentukan Cicilan yang SUDAH JATUH TEMPO
    for (let i = paidTotalCount + 1; i <= tx.installmentsCount; i++) {
        const dueDateString = calculateInstallmentDueDate(tx, i);
        const dueDate = new Date(dueDateString + 'T00:00:00');
        dueDate.setHours(0, 0, 0, 0);

        if (currentDate > dueDate) {
             cumulativeInstallments += installmentAmount;
             totalOverdueInstallments++;
             if (firstOverdueDate === null) firstOverdueDate = dueDate;
        } else {
             break;
        }
    }

    // 2. Hitung Denda Majemuk (5% per bulan dari total tunggakan)
    if (totalOverdueInstallments > 0 && firstOverdueDate !== null) {

         const dateDiff = currentDate.getTime() - firstOverdueDate.getTime();
         const daysLate = Math.floor(dateDiff / (1000 * 60 * 60 * 24));
         // Menghitung bulan penuh terlambat sejak tanggal jatuh tempo pertama yang terlambat
         const monthsLate = Math.floor(daysLate / 30); 

         if (monthsLate > 0) {

             let compoundingBalance = cumulativeInstallments; 

             for (let i = 1; i <= monthsLate; i++) {
                 const currentFine = compoundingBalance * FINE_RATE;
                 
                 compoundingBalance += currentFine; // Denda ditambahkan ke basis (Majemuk)
                 totalFine += currentFine;
                 
                 fineDetails.push({
                     month: i,
                     fine: Math.round(currentFine),
                     basis: Math.round(compoundingBalance - currentFine)
                 });
             }
         }
    }

    const totalPaidAmount = paidTotalCount * installmentAmount;
    const remainingTotalAmount = totals.totalAmount - totalPaidAmount;

    return {
        cumulativeInstallments: Math.round(cumulativeInstallments),
        totalFine: Math.round(totalFine),
        totalOverdueInstallments: totalOverdueInstallments,
        remainingPrincipal: Math.round(remainingTotalAmount),
        fineDetails: fineDetails
    };
}


// ===================================
// 3. NAVIGASI DAN SIDE MENU
// ===================================

function closeSideMenu() {
    sideMenuModal.classList.remove('open');
    menuToggle.innerHTML = '<i class="fas fa-bars"></i>';
}

function openSideMenu() {
    sideMenuModal.classList.add('open');
    menuToggle.innerHTML = '<i class="fas fa-times"></i>';
}

function navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
        pageTitle.textContent = getPageTitle(pageId);
    }
    
    document.querySelectorAll('#sideMenuContent .menu-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-page') === pageId) {
            item.classList.add('active');
        }
    });

    if (pageId === 'homePage' || pageId === 'activeLoansPage') {
        fab.classList.add('show');
    } else {
        fab.classList.remove('show');
    }
    
    reRenderActivePage(pageId);
    closeSideMenu(); 

    history.pushState({page: pageId}, pageId, `#${pageId}`);
}

function getPageTitle(pageId) {
    switch(pageId) {
        case 'homePage': return 'Beranda';
        case 'activeLoansPage': return 'Daftar Pinjaman Aktif';
        case 'historyPage': return 'Riwayat Pembayaran';
        case 'summaryPage': return 'Ringkasan Total Keuangan';
        case 'backupPage': return 'Export & Import Data';
        case 'formPage': return 'Tambah Catatan Baru';
        case 'aboutPage': return 'Tentang Aplikasi';
        default: return 'Catatan Keuangan';
    }
}


// ===================================
// 4. LOGIKA FORM DAN CRUD
// ===================================

function updateInstallmentEstimate() {
    const principal = principalInput.value;
    const rate = interestRateInput.value;
    const count = installmentsCountInput.value;

    const totals = calculateTotal(principal, rate, count);
    
    if (totals.totalAmount > 0) {
        estimateDiv.style.display = 'block';
        estimateDiv.innerHTML = `
            <p style="margin-top: 0;">Total Pokok + Bunga: <strong>${formatCurrency(totals.totalAmount)}</strong></p>
            <p style="margin-bottom: 0;">Estimasi Cicilan per Bulan: <strong style="color: var(--success-color);">${formatCurrency(totals.totalPerInstallment)}</strong></p>
        `;
    } else {
        estimateDiv.style.display = 'none';
    }

    calculateDueDate();
}

function calculateDueDate() {
    const count = parseInt(installmentsCountInput.value);
    const startDate = startDateInput.value;
    
    if (startDate && count > 0) {
        const finalDueDateString = calculateInstallmentDueDate({startDate: startDate}, count);
        finalDueDateDisplay.textContent = new Date(finalDueDateString).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        finalDueDateDisplay.textContent = 'Masukkan Tanggal Mulai dan Tenor.';
    }
}

function submitForm(e) {
    e.preventDefault();

    const principal = cleanPrincipal(principalInput.value);
    const rate = cleanInterestRate(interestRateInput.value);
    const count = parseInt(installmentsCountInput.value);
    const person = document.getElementById('person').value.trim();
    const type = document.getElementById('type').value;
    const startDate = startDateInput.value;
    
    if (principal <= 0 || count <= 0 || person === "" || !startDate) {
        alert("Semua field wajib diisi dan Pokok/Tenor harus lebih dari 0.");
        return;
    }

    const newTransaction = {
        id: Date.now().toString(),
        type: type,
        person: person,
        principal: principal,
        interestRate: parseFloat(rate),
        installmentsCount: count,
        startDate: startDate,
        paymentHistory: [],
        status: 'aktif'
    };

    transactions.push(newTransaction);
    saveTransactions();
    alert(`Transaksi ${person} berhasil ditambahkan!`);
    
    // Reset form dan navigasi ke Beranda
    transactionForm.reset();
    updateInstallmentEstimate(); // Clear estimate
    navigateTo('homePage');
}

function deleteTransaction(id) {
    if (confirm("Yakin ingin menghapus transaksi ini? Tindakan ini tidak dapat dibatalkan.")) {
        transactions = transactions.filter(tx => tx.id !== id);
        saveTransactions();
        closeDetailModal();
        reRenderActivePage(document.querySelector('.page.active').id);
    }
}


// ===================================
// 5. RENDER UTAMA DAN DASHBOARD
// ===================================

function reRenderActivePage(pageId) {
    loadTransactions(); 
    switch(pageId) {
        case 'homePage':
            renderSummaryCards();
            renderChart();
            renderLatestTransactions();
            break;
        case 'activeLoansPage':
            filterTransactionList('active');
            break;
        case 'historyPage':
            filterTransactionList('history');
            break;
        case 'summaryPage':
            renderSummaryPage();
            break;
        case 'backupPage':
            renderBackupPageData();
            break;
    }
}

function getFinancialTotals() {
    let sisaPiutang = 0;
    let sisaUtang = 0;
    let pokokPiutangAwal = 0;
    let pokokUtangAwal = 0;

    const todayDate = new Date().toISOString().split('T')[0];

    transactions.forEach(tx => {
        const totals = calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount);
        
        if (tx.type === 'piutang') {
             pokokPiutangAwal += totals.totalAmount;
        } else {
             pokokUtangAwal += totals.totalAmount;
        }

        if (tx.status === 'aktif') {
            const cumulative = calculateCumulativePayment(tx, todayDate);
            const remaining = cumulative.remainingPrincipal + cumulative.totalFine;
            
            if (tx.type === 'piutang') {
                sisaPiutang += remaining;
            } else {
                sisaUtang += remaining;
            }
        }
    });

    return {
        sisaPiutang: sisaPiutang,
        sisaUtang: sisaUtang,
        pokokPiutangAwal: pokokPiutangAwal,
        pokokUtangAwal: pokokUtangAwal,
        netWorthAkhir: sisaPiutang - sisaUtang
    };
}

function getChartData() {
    let piutangAktif = 0;
    let piutangLunas = 0;
    let utangAktif = 0;
    let utangLunas = 0;

    transactions.forEach(tx => {
        const principal = calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount).totalAmount;
        if (tx.type === 'piutang') {
            if (tx.status === 'aktif') piutangAktif += principal;
            else piutangLunas += principal;
        } else {
            if (tx.status === 'aktif') utangAktif += principal;
            else utangLunas += principal;
        }
    });

    return { piutangAktif, piutangLunas, utangAktif, utangLunas };
}

function renderSummaryCards() {
    const totals = getFinancialTotals();
    const dashboard = document.getElementById('mainDashboard');

    dashboard.innerHTML = `
        <div class="summary-card card-piutang" onclick="navigateTo('activeLoansPage')">
            <h3>Sisa Piutang (Klaim)</h3>
            <p>${formatCurrency(totals.sisaPiutang)}</p>
        </div>
        <div class="summary-card card-utang" onclick="navigateTo('activeLoansPage')">
            <h3>Sisa Utang (Kewajiban)</h3>
            <p>${formatCurrency(totals.sisaUtang)}</p>
        </div>
        <div class="summary-card card-networth" onclick="navigateTo('summaryPage')">
            <h3>Net Worth</h3>
            <p style="color: ${totals.netWorthAkhir >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">${formatCurrency(totals.netWorthAkhir)}</p>
        </div>
    `;
}

function renderChart() {
    const chartData = getChartData();
    const ctx = document.getElementById('loanChart').getContext('2d');
    
    if (loanChartInstance) {
        loanChartInstance.destroy();
    }

    loanChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Piutang Aktif', 'Piutang Lunas', 'Utang Aktif', 'Utang Lunas'],
            datasets: [{
                data: [
                    chartData.piutangAktif, 
                    chartData.piutangLunas, 
                    chartData.utangAktif, 
                    chartData.utangLunas
                ],
                backgroundColor: [
                    '#1cc88a', 
                    '#4e73df', 
                    '#e74a3b', 
                    '#5a5c69'
                ],
            }],
        },
        options: {
            maintainAspectRatio: false,
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            if (context.parsed !== null) {
                                label += formatCurrency(context.parsed);
                            }
                            return label;
                        }
                    }
                },
                datalabels: {
                    formatter: (value, context) => {
                         const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                         if (total === 0) return '';
                         const percentage = (value / total * 100).toFixed(1) + "%";
                         return percentage;
                    },
                    color: '#fff',
                    textShadowBlur: 4,
                    textShadowColor: 'rgba(0,0,0,0.5)',
                    font: { weight: 'bold' }
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}

function getDueStatus(dueDateString) {
    if (!dueDateString) return { badge: 'LUNAS', class: 'status-paid' };
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(dueDateString + 'T00:00:00');

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return { badge: `TERLAMBAT ${Math.abs(diffDays)} hari`, class: 'status-late' };
    } else if (diffDays === 0) {
        return { badge: 'J.T HARI INI', class: 'status-late' };
    } else if (diffDays <= 7) {
        return { badge: `${diffDays} hari lagi`, class: 'status-warning' };
    } else {
        return { badge: 'Aktif', class: 'status-active' };
    }
}

function renderLatestTransactions() {
    const todayDate = new Date().toISOString().split('T')[0];
    const latestContainer = document.getElementById('latestTransactions');

    // Filter transaksi aktif dan urutkan berdasarkan jatuh tempo terdekat
    let activeLoans = transactions.filter(tx => tx.status === 'aktif').map(tx => {
        const nextDueDate = calculateNextDueDate(tx);
        const cumulativePay = calculateCumulativePayment(tx, todayDate);
        return {
            ...tx,
            nextDueDate: nextDueDate,
            daysUntilDue: nextDueDate ? Math.ceil((new Date(nextDueDate).getTime() - new Date(todayDate).getTime()) / (1000 * 60 * 60 * 24)) : Infinity,
            isOverdue: cumulativePay.totalOverdueInstallments > 0
        };
    }).filter(tx => tx.daysUntilDue >= -30 && tx.daysUntilDue <= 30 || tx.isOverdue); // Tampilkan yang mendekati 30 hari atau terlambat 30 hari

    activeLoans.sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        return a.daysUntilDue - b.daysUntilDue;
    });

    if (activeLoans.length === 0) {
        latestContainer.innerHTML = `<p style="text-align: center; color: var(--text-muted);">Tidak ada transaksi yang mendekati jatuh tempo atau terlambat.</p>`;
        return;
    }

    latestContainer.innerHTML = activeLoans.map(tx => {
        const status = getDueStatus(tx.nextDueDate);
        const initials = tx.person.split(' ').map(n => n[0]).join('').substring(0, 2);
        const isLate = tx.isOverdue || status.class === 'status-late';
        
        // Cek denda
        const cumulativePay = calculateCumulativePayment(tx, todayDate);
        let badge;
        if (cumulativePay.totalFine > 0) {
             badge = `<span class="status-badge status-fine">DENDA ${formatCurrency(cumulativePay.totalFine)}</span>`;
        } else if (isLate) {
             badge = `<span class="status-badge status-late">${status.badge}</span>`;
        } else {
             badge = `<span class="status-badge status-active">${status.badge}</span>`;
        }

        return `
            <div class="transaction-list-item ${tx.type}" onclick="showDetailModal('${tx.id}')">
                <div class="avatar-icon" style="background-color: ${tx.type === 'piutang' ? 'var(--success-color)' : 'var(--danger-color)'};">${initials}</div>
                <div class="info-section">
                    <strong>${tx.person} (${tx.type.toUpperCase()})</strong>
                    <div class="due-info">Sisa: ${formatCurrency(cumulativePay.remainingPrincipal + cumulativePay.totalFine)}</div>
                    ${badge}
                </div>
                <div class="amount-section">
                    <div class="remaining-amount">
                        ${tx.nextDueDate ? new Date(tx.nextDueDate).toLocaleDateString('id-ID') : 'LUNAS'}
                    </div>
                    <div class="due-info">${isLate ? 'Segera Bayar' : 'Jatuh Tempo'}</div>
                </div>
            </div>
        `;
    }).join('');
}

function filterTransactionList(type = 'active') {
    renderTransactionList(type);
}

function renderTransactionList(type = 'active') {
    const isHistory = type === 'history';
    const listId = isHistory ? 'historyList' : 'activeLoansList';
    const transactionsContainer = document.getElementById(listId);
    
    let filteredList = transactions.filter(tx => (isHistory ? tx.status === 'lunas' : tx.status === 'aktif'));

    const searchInput = document.getElementById(isHistory ? 'searchHistory' : 'searchLoans');
    const filterSelect = document.getElementById('filterLoans');

    const searchText = searchInput ? searchInput.value.toLowerCase() : '';
    const filterType = filterSelect && !isHistory ? filterSelect.value : 'all';
    
    if (searchText) {
        filteredList = filteredList.filter(tx => tx.person.toLowerCase().includes(searchText));
    }

    if (!isHistory && filterType !== 'all') {
         filteredList = filteredList.filter(tx => tx.type === filterType);
    }
    
    if (!isHistory) {
         filteredList.sort((a, b) => {
              const nextDueA = calculateNextDueDate(a) || '3000-01-01';
              const nextDueB = calculateNextDueDate(b) || '3000-01-01';
              return nextDueA.localeCompare(nextDueB);
         });
    } else {
         filteredList.sort((a, b) => new Date(b.dateCompleted) - new Date(a.dateCompleted));
    }


    if (filteredList.length === 0) {
        transactionsContainer.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 20px 0;">Tidak ada transaksi ${isHistory ? 'lunas' : 'aktif'} yang ditemukan.</p>`;
        return;
    }

    // ... (logic render list item sama seperti di balasan sebelumnya)
    transactionsContainer.innerHTML = filteredList.map(tx => {
        const typeClass = tx.type;
        const initials = tx.person.split(' ').map(n => n[0]).join('').substring(0, 2);
        
        const nextDueDate = calculateNextDueDate(tx);
        let dueDisplay = 'LUNAS';
        let amountDisplay = formatCurrency(calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount).totalAmount);
        let statusBadge = `<span class="status-badge status-paid">LUNAS</span>`;
        let remainingAmount = 0;

        if (tx.status === 'aktif') {
            const todayDate = new Date().toISOString().split('T')[0];
            const cumulativePay = calculateCumulativePayment(tx, todayDate);
            const status = getDueStatus(nextDueDate);
            
            remainingAmount = cumulativePay.remainingPrincipal + cumulativePay.totalFine;
            amountDisplay = formatCurrency(remainingAmount);
            
            dueDisplay = nextDueDate ? `J.T: ${new Date(nextDueDate).toLocaleDateString('id-ID')}` : 'Terakhir: -';
            
            if (cumulativePay.totalFine > 0) {
                 statusBadge = `<span class="status-badge status-fine">DENDA</span>`;
            } else if (status.badge === 'J.T HARI INI') {
                 statusBadge = `<span class="status-badge status-late">J.T HARI INI</span>`;
            } else if (status.class === 'status-late') {
                 statusBadge = `<span class="status-badge status-late">${status.badge}</span>`;
            } else {
                 statusBadge = `<span class="status-badge status-active">${status.badge}</span>`;
            }
        }

        return `
            <div class="transaction-list-item ${typeClass}" onclick="showDetailModal('${tx.id}')">
                <div class="avatar-icon" style="background-color: ${tx.type === 'piutang' ? 'var(--success-color)' : 'var(--danger-color)'};">${initials}</div>
                <div class="info-section">
                    <strong>${tx.person} (${tx.type.toUpperCase()})</strong>
                    <div class="due-info">Pokok: ${formatCurrency(tx.principal)} (${tx.installmentsCount}x)</div>
                    ${statusBadge}
                </div>
                <div class="amount-section">
                    <div class="remaining-amount" style="color: ${tx.status === 'aktif' ? (remainingAmount > 0 ? 'var(--danger-color)' : 'var(--primary-color)') : 'var(--secondary-color)'};">
                        ${amountDisplay}
                    </div>
                    <div class="due-info">${dueDisplay}</div>
                </div>
            </div>
        `;
    }).join('');

}


// ===================================
// 6. MODAL DETAIL & PEMBAYARAN
// ===================================

function showDetailModal(id) {
    currentTxId = id;
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const modalActions = document.getElementById('modalActions');
    
    const totals = calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount);
    const paidCount = tx.paymentHistory ? tx.paymentHistory.reduce((sum, p) => sum + (p.installmentsPaid || 1), 0) : 0;
    const remainingCount = tx.installmentsCount - paidCount;

    const todayDate = new Date().toISOString().split('T')[0];
    const cumulativePay = calculateCumulativePayment(tx, todayDate);
    
    // Total Tagihan (Cicilan + Denda)
    const totalDue = cumulativePay.cumulativeInstallments + cumulativePay.totalFine;

    modalTitle.innerHTML = `${tx.person} <span style="font-size:0.7em; font-weight:normal; color:var(--text-muted);">(${tx.type.toUpperCase()})</span>`;

    let htmlContent = `
        <div class="detail-section">
            <h3>Rincian Transaksi</h3>
            <div class="modal-detail-row"><span>Pokok Pinjaman</span><strong>${formatCurrency(tx.principal)}</strong></div>
            <div class="modal-detail-row"><span>Bunga (Flat ${tx.interestRate}%)</span><strong>${formatCurrency(totals.totalInterest)}</strong></div>
            <div class="modal-detail-row"><span>Total Pokok + Bunga</span><strong>${formatCurrency(totals.totalAmount)}</strong></div>
            <div class="modal-detail-row"><span>Cicilan per Periode (${tx.installmentsCount}x)</span><strong>${formatCurrency(totals.totalPerInstallment)}</strong></div>
            <div class="modal-detail-row"><span>Tanggal Mulai</span><strong>${new Date(tx.startDate).toLocaleDateString('id-ID')}</strong></div>
        </div>

        <div class="detail-section">
            <h3>Status Pembayaran</h3>
            <div class="modal-detail-row"><span>Cicilan Dibayar</span><strong>${paidCount} dari ${tx.installmentsCount}</strong></div>
            <div class="modal-detail-row"><span>Sisa Cicilan</span><strong>${remainingCount}x</strong></div>
            <div class="modal-detail-row"><span>Sisa Total (Pokok+Bunga)</span><strong>${formatCurrency(cumulativePay.remainingPrincipal)}</strong></div>
            <div class="modal-detail-row fine-info"><span>Total Denda Hari Ini</span><strong style="color:var(--danger-color);">${formatCurrency(cumulativePay.totalFine)}</strong></div>
            <div class="modal-detail-row"><span>Tagihan Tertunggak (Pokok+Bunga)</span><strong>${formatCurrency(cumulativePay.cumulativeInstallments)}</strong></div>
            <div class="modal-detail-row"><span>Tagihan Saat Ini (Tunggakan + Denda)</span><strong style="font-size:1.2em; color:var(--primary-color);">${formatCurrency(totalDue)}</strong></div>
        </div>
    `;
    
    // Detail Denda Majemuk
    if (cumulativePay.totalFine > 0) {
        let fineDetailList = '';
        cumulativePay.fineDetails.forEach(d => {
            fineDetailList += `<p>Bulan ke-${d.month}: ${formatCurrency(d.basis)} x ${FINE_RATE*100}% = <strong>${formatCurrency(d.fine)}</strong></p>`;
        });
        htmlContent += `
             <div class="fine-details-box">
                 <h4>RINCIAN DENDA MAJEMUK (5% per bulan)</h4>
                 ${fineDetailList}
             </div>
        `;
    }

    // Riwayat Pembayaran
    if (tx.paymentHistory && tx.paymentHistory.length > 0) {
        let historyList = tx.paymentHistory.map((p, index) => `
             <div style="display:flex; justify-content:space-between; font-size:0.9em; padding: 5px 0; border-bottom:1px solid #eee;">
                 <span>${index + 1}. Tgl ${new Date(p.date).toLocaleDateString('id-ID')}</span>
                 <span style="text-align:right;">
                     Bayar: <strong>${formatCurrency(p.amount + p.fine)}</strong> (${p.installmentsPaid}x) 
                     ${p.fine > 0 ? `<br><small style="color:var(--danger-color);">Denda: ${formatCurrency(p.fine)}</small>` : ''}
                 </span>
             </div>
        `).join('');
        htmlContent += `
            <div class="detail-section">
                <h3>Riwayat Pembayaran</h3>
                <div class="payment-history-list">${historyList}</div>
            </div>
        `;
    } else if (tx.status === 'aktif') {
         htmlContent += `<div class="detail-section"><p style="color:var(--text-muted);">Belum ada riwayat pembayaran.</p></div>`;
    }


    modalContent.innerHTML = htmlContent;

    modalActions.innerHTML = `
        <button class="btn-danger" onclick="deleteTransaction('${tx.id}')">
            <i class="fas fa-trash-alt"></i> Hapus
        </button>
        ${tx.status === 'aktif' ? `
        <button class="btn-success" onclick="showPaymentModal('${tx.id}', ${totalDue})">
            <i class="fas fa-cash-register"></i> Catat Bayar
        </button>` : `<button class="btn-secondary" disabled>LUNAS</button>`}
    `;

    detailModal.style.display = 'flex';
}

function closeDetailModal() {
    detailModal.style.display = 'none';
    currentTxId = null;
}

function showPaymentModal(id, totalDue) {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    closeDetailModal();

    // Set nilai global state pembayaran
    currentTxId = id;
    currentPaymentData.totalDue = totalDue; 
    
    // Render info tagihan
    paymentAmountDisplay.innerHTML = `
        <p>Total Tagihan (Tunggakan + Denda)</p>
        <p style="color: var(--danger-color);">${formatCurrency(totalDue)}</p>
    `;

    // Set default tanggal hari ini
    datePaidInput.value = new Date().toISOString().split('T')[0];
    
    // Set nominal default = total due (dibersihkan dari format rupiah)
    nominalPaidInput.value = totalDue.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    formatInputRupiah(nominalPaidInput);

    paymentModal.style.display = 'flex';
}

function closePaymentModal() {
    paymentModal.style.display = 'none';
    currentTxId = null;
    nominalPaidInput.value = '';
    datePaidInput.value = '';
}

function confirmPayment() {
    const tx = transactions.find(t => t.id === currentTxId);
    if (!tx) { alert('Error: Transaksi tidak ditemukan.'); return; }

    const datePaid = datePaidInput.value;
    const nominalPaidClean = cleanPrincipal(nominalPaidInput.value);

    if (!datePaid || nominalPaidClean <= 0) {
        alert('Tanggal dan Nominal pembayaran harus diisi dengan benar.');
        return;
    }

    const installmentAmount = calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount).totalPerInstallment;
    let totalPaid = nominalPaidClean;
    let remainingPayment = totalPaid;
    let totalFinePaid = 0;
    let installmentsCovered = 0;

    const todayDate = new Date().toISOString().split('T')[0];
    const cumulativePay = calculateCumulativePayment(tx, todayDate);

    // 1. Bayar Denda (Jika Ada) - Denda dibayar duluan
    if (cumulativePay.totalFine > 0) {
        const fineToPay = Math.min(remainingPayment, cumulativePay.totalFine);
        totalFinePaid = fineToPay;
        remainingPayment -= fineToPay;
    }

    // 2. Bayar Cicilan (Pokok + Bunga)
    if (remainingPayment > 0) {
        const remainingInstallments = tx.installmentsCount - (tx.paymentHistory ? tx.paymentHistory.reduce((sum, p) => sum + (p.installmentsPaid || 1), 0) : 0);
        const overdueInstallments = cumulativePay.totalOverdueInstallments;

        // Hitung berapa cicilan yang bisa dicover
        let maxCoverable = Math.floor(remainingPayment / installmentAmount);

        if (overdueInstallments > 0) {
             // Jika ada tunggakan, bayar tunggakan dulu
             installmentsCovered = Math.min(maxCoverable, overdueInstallments);
        } else {
             // Jika tidak ada tunggakan, hanya boleh bayar 1 cicilan (cicilan bulan berjalan)
             installmentsCovered = Math.min(maxCoverable, 1);
        }

        // Batasi maksimal sesuai sisa cicilan total
        installmentsCovered = Math.min(installmentsCovered, remainingInstallments);
        
        const principalPaid = installmentsCovered * installmentAmount;
        remainingPayment -= principalPaid;
    }

    if (installmentsCovered <= 0 && totalFinePaid <= 0) {
        alert('Pembayaran gagal dicatat. Nominal terlalu kecil untuk menutupi denda atau cicilan.');
        return;
    }

    if (!tx.paymentHistory) tx.paymentHistory = [];
    tx.paymentHistory.push({
        date: datePaid,
        amount: Math.round(nominalPaidClean - totalFinePaid), 
        fine: Math.round(totalFinePaid), 
        installmentsPaid: installmentsCovered,
        remainingBalance: Math.round(remainingPayment) // Sisa uang kembali (jika ada kelebihan)
    });

    const totalPaidCount = tx.paymentHistory.reduce((sum, p) => sum + (p.installmentsPaid || 1), 0);

    if (totalPaidCount >= tx.installmentsCount) {
        tx.status = 'lunas';
        tx.dateCompleted = datePaid;
        alert(`Transaksi ${tx.person} LUNAS! Total cicilan dicover: ${totalPaidCount}.`);
    } else {
        alert(`Pembayaran berhasil dicatat! Dicover: **${installmentsCovered}** cicilan. Sisa ${tx.installmentsCount - totalPaidCount} cicilan. Kembalian: ${formatCurrency(Math.max(0, remainingPayment))}`);
    }

    saveTransactions();
    closePaymentModal();
    reRenderActivePage(document.querySelector('.page.active').id);
}

// ===================================
// 7. SUMMARY, EXPORT, IMPORT
// ===================================

function renderSummaryPage() {
    const totals = getFinancialTotals();
    
    document.getElementById('summaryPiutangAwal').textContent = formatCurrency(totals.pokokPiutangAwal);
    document.getElementById('summaryPiutangSisa').textContent = formatCurrency(totals.sisaPiutang);
    
    document.getElementById('summaryUtangAwal').textContent = formatCurrency(totals.pokokUtangAwal);
    document.getElementById('summaryUtangSisa').textContent = formatCurrency(totals.sisaUtang);
    
    document.getElementById('summaryNetWorth').textContent = formatCurrency(totals.netWorthAkhir);
    document.getElementById('summaryNetWorth').style.color = totals.netWorthAkhir >= 0 ? 'var(--success-color)' : 'var(--danger-color)';
}

function renderBackupPageData() {
    document.getElementById('totalTransactionsCount').textContent = `${transactions.length} Transaksi`;
    const lastBackup = localStorage.getItem('lastBackupDate');
    document.getElementById('lastBackupDate').textContent = lastBackup ? new Date(lastBackup).toLocaleString('id-ID') : 'Belum Ada';
}

function exportToCSV() {
    let csv = [];
    const headers = [
        'ID', 'Tipe', 'Pihak', 'Pokok_Awal', 'Bunga_Rate', 'Tenor_Bulan', 'Tgl_Mulai', 'Status', 'Tgl_Lunas', 'Total_Tagihan_Termasuk_Bunga', 'Sisa_Tagihan_Aktif'
    ];
    csv.push(headers.join(','));

    const todayDate = new Date().toISOString().split('T')[0];

    transactions.forEach(tx => {
        const totals = calculateTotal(tx.principal, tx.interestRate, tx.installmentsCount);
        const cumulativePay = tx.status === 'aktif' ? calculateCumulativePayment(tx, todayDate) : { remainingPrincipal: 0, totalFine: 0 };
        const sisaTagihanAktif = tx.status === 'aktif' ? (cumulativePay.remainingPrincipal + cumulativePay.totalFine) : 0;
        
        const row = [
            tx.id,
            tx.type,
            `"${tx.person}"`, // Menggunakan quote untuk nama
            tx.principal,
            tx.interestRate,
            tx.installmentsCount,
            tx.startDate,
            tx.status,
            tx.dateCompleted || '',
            Math.round(totals.totalAmount),
            Math.round(sisaTagihanAktif)
        ];
        csv.push(row.join(','));
    });

    const csvString = csv.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Eximouse_Finance_Export_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!confirm("PERINGATAN: Mengimpor data akan MENIMPA SEMUA DATA yang ada saat ini. Lanjutkan?")) {
        event.target.value = null; // Clear file input
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (Array.isArray(importedData)) {
                transactions = importedData;
                saveTransactions();
                localStorage.setItem('lastBackupDate', new Date().toISOString());
                alert("Data berhasil diimpor! Halaman akan dimuat ulang.");
                location.reload();
            } else {
                alert("Format file JSON tidak valid. Pastikan berisi array data transaksi.");
            }
        } catch (error) {
            alert("Gagal memproses file. Pastikan file adalah JSON yang valid.");
            console.error(error);
        }
    };
    reader.readAsText(file);
    event.target.value = null; // Clear file input
}

// ===================================
// 8. NOTIFIKASI (Dipertahankan)
// ===================================

function updateNotificationStatusDisplay() {
    const statusText = document.getElementById('notificationStatusText');
    if ('Notification' in window) {
        statusText.textContent = Notification.permission.toUpperCase();
        statusText.style.color = Notification.permission === 'granted' ? 'var(--success-color)' : (Notification.permission === 'denied' ? 'var(--danger-color)' : 'var(--warning-color)');
    } else {
        statusText.textContent = 'Tidak Didukung Browser';
        statusText.style.color = 'var(--secondary-color)';
    }
}

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission().then(function(permission) {
            updateNotificationStatusDisplay();
            if (permission === 'granted') {
                // Notifikasi scheduler dihidupkan jika izin diberikan
                startNotificationScheduler();
            }
        });
    }
}

function checkAndSendNotifications() {
    if (Notification.permission !== 'granted') return;

    const todayDate = new Date().toISOString().split('T')[0];
    let notificationCount = 0;

    transactions.filter(tx => tx.status === 'aktif').forEach(tx => {
        const nextDueDate = calculateNextDueDate(tx);
        if (!nextDueDate) return;

        const status = getDueStatus(nextDueDate);
        const cumulativePay = calculateCumulativePayment(tx, todayDate);

        if (cumulativePay.totalFine > 0) {
            new Notification(`⚠️ DENDA AKTIF: ${tx.person} (${tx.type})`, {
                body: `Total tagihan tertunggak + denda: ${formatCurrency(cumulativePay.cumulativeInstallments + cumulativePay.totalFine)}`,
                icon: 'assets/icon.png'
            });
            notificationCount++;
        } else if (status.class === 'status-late' || status.badge.includes('hari lagi')) {
            new Notification(`🔔 Jatuh Tempo: ${tx.person} (${tx.type})`, {
                body: `${status.badge}! Tagihan ${formatCurrency(cumulativePay.cumulativeInstallments)} akan segera jatuh tempo/terlambat.`,
                icon: 'assets/icon.png'
            });
            notificationCount++;
        }
    });

    if (notificationCount === 0) {
        // Notifikasi pasif jika tidak ada yang mendesak
        // new Notification('Catatan Keuangan Aktif', {
        //     body: 'Aplikasi berjalan di latar belakang. Cek status keuangan Anda!',
        //     icon: 'assets/icon.png'
        // });
    }
}

function startNotificationScheduler() {
    // Stop scheduler lama (jika ada)
    if (notificationScheduler) {
        clearInterval(notificationScheduler);
    }
    
    if (Notification.permission === 'granted') {
        // Langsung cek saat startup
        checkAndSendNotifications(); 
        // Set interval untuk pengecekan berkala
        notificationScheduler = setInterval(checkAndSendNotifications, NOTIFICATION_INTERVAL_MS);
    }
}


// ===================================
// 9. EVENT LISTENER APLIKASI
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    loadTransactions();

    const today = new Date().toISOString().split('T')[0];
    if (startDateInput) startDateInput.value = today;
    
    // 1. NAVIGASI
    menuToggle.addEventListener('click', () => {
        if (sideMenuModal.classList.contains('open')) {
            closeSideMenu();
        } else {
            openSideMenu();
        }
    });

    sideMenuModal.addEventListener('click', (e) => {
        if (e.target === sideMenuModal) {
            closeSideMenu();
        }
    });

    document.querySelectorAll('#sideMenuContent .menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const pageId = item.getAttribute('data-page');
            if (pageId) navigateTo(pageId);
        });
    });

    // Handle navigasi via hash URL
    window.addEventListener('popstate', function(event) {
         closeSideMenu();
         const hash = window.location.hash.replace('#', '');
         const targetPage = hash || 'homePage';
         if (document.getElementById(targetPage)) {
             navigateTo(targetPage);
         }
    });

    // 2. FORM & INPUT
    if (transactionForm) transactionForm.addEventListener('submit', submitForm);
    if (principalInput) principalInput.addEventListener('input', updateInstallmentEstimate);
    if (interestRateInput) interestRateInput.addEventListener('input', updateInstallmentEstimate);
    if (installmentsCountInput) installmentsCountInput.addEventListener('input', updateInstallmentEstimate);
    if (startDateInput) startDateInput.addEventListener('input', updateInstallmentEstimate);

    // 3. MODAL
    if (confirmPaymentBtn) confirmPaymentBtn.addEventListener('click', confirmPayment);

    // 4. BACKUP
    document.getElementById('export-btn').addEventListener('click', () => {
        localStorage.setItem('lastBackupDate', new Date().toISOString());
        exportToCSV();
    });
    document.getElementById('trigger-import-btn').addEventListener('click', () => {
        document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', handleImport);
    
    // 5. INIALISASI AWAL
    const initialPage = window.location.hash.replace('#', '') || 'homePage';
    navigateTo(initialPage);
    
    // 6. NOTIFIKASI
    updateNotificationStatusDisplay();
    startNotificationScheduler();
});
