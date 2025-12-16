import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

// --- CONFIGURATION FIREBASE ---
// Accès standard via process.env
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

// Vérifie si la clé API est présente et valide
const isConfigValid = !!firebaseConfig.apiKey;

let auth: any = null;

if (isConfigValid) {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
    } catch (e) {
        console.error("Erreur initialisation Firebase:", e);
    }
} else {
    // Ne pas spammer la console en dev si pas de firebase, juste warn une fois
    console.warn("Firebase non configuré : Variables VITE_FIREBASE_... manquantes.");
}

export const isAuthAvailable = () => isConfigValid && !!auth;

export const loginWithGoogle = async () => {
    if (!auth) throw new Error("Firebase non configuré.");
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
};

export const logout = async () => {
    if (!auth) return;
    return signOut(auth);
};

export const subscribeToAuthChanges = (callback: (user: any) => void) => {
    if (!auth) {
        callback(null);
        return () => {};
    }
    return onAuthStateChanged(auth, callback);
};