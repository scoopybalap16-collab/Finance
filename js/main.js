// js/main.js
import { firebaseConfig } from './config.js';
import { data, loadAppData, saveAppData, setupRealtimeListener } from './db.js';
import { setupAuthListeners, logoutUser } from './auth.js';
import * as UI from './ui.js'; 
import { initMoneyInputs } from './utils.js';

// --- REGISTER SERVICE WORKER (PWA) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Menggunakan file yang sudah Anda punya (sw-register.js / sw.js)
        // Pastikan path-nya sesuai
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered!', reg.scope))
            .catch(err => console.log('SW Failed', err));
    });
}

// --- EXPOSE TO WINDOW (Agar HTML bisa memanggil fungsi ini) ---
window.navTo = UI.navTo;
window.switchTab = UI.switchTab;
window.openModal = UI.openModal;
window.closeModal = UI.closeModal;
window.saveBudget = UI.saveBudget;
window.editBudget = UI.editBudget;
window.deleteItem = UI.deleteItem;
window.toggleTheme = UI.toggleTheme;
window.renderBudget = UI.renderBudget;
window.onBudgetTypeChange = UI.onBudgetTypeChange;
window.installApp = UI.installApp;
window.refreshAds = UI.refreshAds;
window.dismissInstall = UI.dismissInstall;
window.logoutUser = () => { logoutUser(auth); };

// --- MAIN INIT ---
let auth, db;

window.addEventListener('load', () => {
    // Init PWA Prompt Logic
    UI.initPWA();

    if(window.firebaseLib) {
        const { initializeApp, getAuth, getFirestore, onAuthStateChanged, enableIndexedDbPersistence } = window.firebaseLib;
        
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        window.dbInstance = db;
        
        // Offline Persistence
        enableIndexedDbPersistence(db).catch(err => console.log("Persistence error:", err.code));

        setupAuthListeners(auth);

        onAuthStateChanged(auth, (user) => {
            document.getElementById('loading-overlay').style.display = 'none';
            if (user) {
                window.currentUser = user;
                document.getElementById('login-screen').style.display = 'none';
                startApp();
            } else {
                document.getElementById('login-screen').style.display = 'flex';
            }
        });
    } else {
        alert("Firebase Lib Error. Cek koneksi.");
    }
});

async function startApp() {
    await loadAppData(window.currentUser, db);
    setupRealtimeListener(window.currentUser, db, () => UI.updateUI());
    
    UI.initTheme();
    initMoneyInputs();
    UI.updateUI();
    
    // Set tanggal hari ini di input modal
    const dateInput = document.getElementById('b-date');
    if(dateInput) dateInput.value = new Date().toISOString().split('T')[0];
}
