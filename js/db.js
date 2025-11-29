// js/db.js
import { APP_KEY } from './config.js';

// State Data Utama
export let data = {
    budget: [], 
    loans: [], 
    goals: [], 
    bills: [],
    wallets: [
        { id: 1, name: 'Tunai', type: 'cash', balance: 0 },
        { id: 2, name: 'Bank/ATM', type: 'bank', balance: 0 },
        { id: 3, name: 'E-Wallet', type: 'ewallet', balance: 0 }
    ],
    // [BARU] Daftar Kategori Default
    categories: [
        { id: 'c1', type: 'expense', name: 'Makan', icon: 'fa-utensils', color: '#ff6b6b' },
        { id: 'c2', type: 'expense', name: 'Transport', icon: 'fa-bus', color: '#54a0ff' },
        { id: 'c3', type: 'expense', name: 'Belanja', icon: 'fa-shopping-bag', color: '#1dd1a1' },
        { id: 'c4', type: 'expense', name: 'Tagihan', icon: 'fa-file-invoice', color: '#feca57' },
        { id: 'c5', type: 'expense', name: 'Hiburan', icon: 'fa-gamepad', color: '#5f27cd' },
        { id: 'c6', type: 'expense', name: 'Kesehatan', icon: 'fa-medkit', color: '#ff9ff3' },
        { id: 'c7', type: 'expense', name: 'Lainnya', icon: 'fa-box', color: '#8395a7' },
        { id: 'c8', type: 'income', name: 'Gaji', icon: 'fa-money-bill-wave', color: '#1dd1a1' },
        { id: 'c9', type: 'income', name: 'Bonus', icon: 'fa-star', color: '#feca57' },
        { id: 'c10', type: 'income', name: 'Investasi', icon: 'fa-chart-line', color: '#54a0ff' },
        { id: 'c11', type: 'income', name: 'Lainnya', icon: 'fa-box-open', color: '#8395a7' }
    ],
    emergency: { saved: 0, expense: 0, job: 'stable', dependents: '0', targetMonths: 6, targetAmount: 0 },
    settings: { theme: 'light', lang: 'id', pin: null }
};

export function setData(newData) {
    data = newData;
}

// Load Data
export async function loadAppData(currentUser, db) {
    if (!currentUser || !window.firebaseLib) return; 
    const { doc, getDoc } = window.firebaseLib;

    try {
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const cloudData = docSnap.data();
            // Gabungkan data cloud dengan struktur lokal (agar kategori baru masuk)
            data = { ...data, ...cloudData }; 
            
            // Cek jika user lama belum punya kategori, kita isi default
            if(!data.categories || data.categories.length === 0) {
                data.categories = [
                    { id: 'c1', type: 'expense', name: 'Makan', icon: 'fa-utensils', color: '#ff6b6b' },
                    { id: 'c2', type: 'expense', name: 'Transport', icon: 'fa-bus', color: '#54a0ff' },
                    { id: 'c3', type: 'expense', name: 'Belanja', icon: 'fa-shopping-bag', color: '#1dd1a1' },
                    { id: 'c4', type: 'expense', name: 'Tagihan', icon: 'fa-file-invoice', color: '#feca57' },
                    { id: 'c5', type: 'expense', name: 'Hiburan', icon: 'fa-gamepad', color: '#5f27cd' },
                    { id: 'c6', type: 'expense', name: 'Kesehatan', icon: 'fa-medkit', color: '#ff9ff3' },
                    { id: 'c7', type: 'expense', name: 'Lainnya', icon: 'fa-box', color: '#8395a7' },
                    { id: 'c8', type: 'income', name: 'Gaji', icon: 'fa-money-bill-wave', color: '#1dd1a1' },
                    { id: 'c9', type: 'income', name: 'Bonus', icon: 'fa-star', color: '#feca57' },
                    { id: 'c10', type: 'income', name: 'Investasi', icon: 'fa-chart-line', color: '#54a0ff' },
                    { id: 'c11', type: 'income', name: 'Lainnya', icon: 'fa-box-open', color: '#8395a7' }
                ];
            }
            
            console.log("Data loaded from Cloud/Cache");
            localStorage.setItem(APP_KEY, JSON.stringify(data));
        } else {
            const localData = localStorage.getItem(APP_KEY);
            if (localData) {
                data = JSON.parse(localData);
                saveAppData(currentUser, db); 
            }
        }

    } catch (error) {
        console.warn("Offline Mode (LocalStorage).");
        const localData = localStorage.getItem(APP_KEY);
        if (localData) {
            data = JSON.parse(localData);
        }
    }
    
    // Validasi Data Kosong
    if (!data.bills) data.bills = [];
    if (!data.wallets || data.wallets.length === 0) {
         data.wallets = [{ id: 1, name: 'Tunai', type: 'cash', balance: 0 }];
    }
    if (!data.emergency) {
         data.emergency = { saved: 0, expense: 0, job: 'stable', dependents: '0', targetMonths: 6, targetAmount: 0 };
    }
}

export async function saveAppData(currentUser, db) {
    localStorage.setItem(APP_KEY, JSON.stringify(data));
    if (currentUser && window.firebaseLib && db) {
        const { doc, setDoc } = window.firebaseLib;
        try {
            await setDoc(doc(db, "users", currentUser.uid), data);
        } catch (error) {
            console.error("Cloud sync failed:", error);
        }
    }
}

export function setupRealtimeListener(currentUser, db, onUpdateCallback) {
    if (!currentUser || !window.firebaseLib) return;
    const { doc, onSnapshot } = window.firebaseLib;
    const docRef = doc(db, "users", currentUser.uid);

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const cloudData = docSnap.data();
            Object.assign(data, cloudData);
            if (onUpdateCallback) onUpdateCallback();
            localStorage.setItem(APP_KEY, JSON.stringify(data));
        }
    });
}
