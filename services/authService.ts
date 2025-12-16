import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// --- CONFIGURATION FIREBASE ---
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

// Vérifie si la configuration minimale est présente
const isConfigValid = !!firebaseConfig.apiKey && !!firebaseConfig.authDomain;

let auth: any = null;
let db: any = null;

if (isConfigValid) {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("Firebase (Auth & Firestore) initialisé avec succès.");
    } catch (e) {
        console.error("Erreur critique initialisation Firebase:", e);
    }
} else {
    console.warn("Firebase non configuré : Variables d'environnement VITE_FIREBASE_* manquantes. L'authentification sera désactivée.");
}

export const isAuthAvailable = () => isConfigValid && !!auth;

export const loginWithGoogle = async () => {
    if (!auth) {
        alert("Erreur de configuration: Clés Firebase manquantes.");
        throw new Error("Firebase non configuré.");
    }
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
};

export const loginWithEmail = async (email: string, pass: string) => {
    if (!auth) throw new Error("Firebase non configuré.");
    return signInWithEmailAndPassword(auth, email, pass);
};

export const registerWithEmail = async (email: string, pass: string) => {
    if (!auth) throw new Error("Firebase non configuré.");
    return createUserWithEmailAndPassword(auth, email, pass);
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

export { auth, db };