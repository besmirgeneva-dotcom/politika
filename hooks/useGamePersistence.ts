
import { useState, useEffect, useRef } from 'react';
import { collection, doc, writeBatch, query, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../services/authService';
import { GameState, GameEvent } from '../types';

export interface SaveMetadata {
    id: string; country: string; date: string; turn: number; lastPlayed: number;
}

// Helper pour nettoyer les objets avant envoi Firestore (retire undefined)
const sanitizeForFirestore = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null) return null;
    if (obj instanceof Date) return obj.toISOString(); // Stocker les dates comme ISO string pour consistance
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
    if (typeof obj === 'object') {
        // Détection Firestore Timestamp
        if (typeof obj.toDate === 'function') return obj.toDate().toISOString();
        
        const newObj: any = {};
        for (const key in obj) {
            const val = sanitizeForFirestore(obj[key]);
            if (val !== undefined) newObj[key] = val;
        }
        return newObj;
    }
    return obj;
};

// Helper pour parser les dates safe
const safeDate = (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (typeof d.toDate === 'function') return d.toDate(); // Firestore Timestamp
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const useGamePersistence = (user: any) => {
    const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
    const [notification, setNotification] = useState<string | null>(null);
    const isMountedRef = useRef(true);

    const showNotification = (msg: string) => { 
        setNotification(msg); 
        setTimeout(() => setNotification(null), 3000); 
    }

    useEffect(() => {
        isMountedRef.current = true;
        if (!user || !db) {
            setAvailableSaves([]);
            return;
        }
        const q = query(collection(db, "users", user.uid, "game_metas"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
              const saves: SaveMetadata[] = [];
              snapshot.forEach((doc) => saves.push(doc.data() as SaveMetadata));
              saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
              if (isMountedRef.current) setAvailableSaves(saves);
          });
        return () => { isMountedRef.current = false; unsubscribe(); };
    }, [user]);

    const saveGame = async (state: GameState, history: GameEvent[], aiProvider: string, tokenCount: number, showNotif = true) => {
        if (!user || !db) { 
            if (showNotif) showNotification("Connexion requise !"); 
            return; 
        }
        
        if (!state) {
            console.error("Tentative de sauvegarde d'un état vide.");
            return;
        }

        // Sécurisation de la date pour les métadonnées
        let dateStr = "Date Inconnue";
        try {
            const d = safeDate(state.currentDate);
            dateStr = d.toLocaleDateString('fr-FR');
        } catch (err) {
            console.warn("Date invalide métadonnées", err);
        }

        const metadata: SaveMetadata = {
            id: state.gameId, country: state.playerCountry || "Inconnu",
            date: dateStr, turn: state.turn, lastPlayed: Date.now()
        };

        try {
            // Utilisation de sanitizeForFirestore au lieu de JSON.parse/stringify
            const cleanState = sanitizeForFirestore(state);
            const cleanHistory = sanitizeForFirestore(history);

            const batch = writeBatch(db);
            batch.set(doc(db, "users", user.uid, "games", state.gameId), { 
                metadata, 
                state: cleanState, 
                history: cleanHistory, 
                aiProvider, 
                tokenCount 
            });
            batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
            await batch.commit();
            
            if (showNotif) showNotification("Sauvegarde Cloud réussie !");
        } catch (e) { 
            console.error("ERREUR SAUVEGARDE:", e);
            showNotification("Échec Sauvegarde"); 
        }
    };

    const deleteGame = async (id: string) => {
        if (!user || !db) return;
        if (!confirm("Supprimer définitivement cette sauvegarde ?")) return;
        try {
            const batch = writeBatch(db);
            batch.delete(doc(db, "users", user.uid, "games", id));
            batch.delete(doc(db, "users", user.uid, "game_metas", id));
            await batch.commit();
            showNotification("Sauvegarde supprimée.");
        } catch (e) {
            showNotification("Erreur suppression.");
        }
    }

    const loadGameData = async (id: string): Promise<any> => {
        if (!user || !db) return null;
        try {
            const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // Re-hydration robuste de la date dans le state
                if (data.state) {
                    data.state.currentDate = safeDate(data.state.currentDate);
                }
                
                showNotification("Partie chargée.");
                return data;
            }
        } catch (e) { showNotification("Erreur chargement."); }
        return null;
    };

    return { availableSaves, saveGame, deleteGame, loadGameData, notification };
};
