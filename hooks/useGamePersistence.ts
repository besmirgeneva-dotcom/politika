
import { useState, useEffect, useRef } from 'react';
import { collection, doc, writeBatch, query, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../services/authService';
import { GameState, GameEvent } from '../types';

export interface SaveMetadata {
    id: string; country: string; date: string; turn: number; lastPlayed: number;
}

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
        if (!user || !db) { showNotification("Connexion requise !"); return; }
        const metadata: SaveMetadata = {
            id: state.gameId, country: state.playerCountry || "Inconnu",
            date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now()
        };
        try {
            const batch = writeBatch(db);
            batch.set(doc(db, "users", user.uid, "games", state.gameId), { metadata, state, history, aiProvider, tokenCount });
            batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
            await batch.commit();
            if (showNotif) showNotification("Sauvegarde Cloud réussie !");
        } catch (e) { showNotification("Échec Sauvegarde"); }
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
                data.state.currentDate = new Date(data.state.currentDate);
                showNotification("Partie chargée.");
                return data;
            }
        } catch (e) { showNotification("Erreur chargement."); }
        return null;
    };

    return { availableSaves, saveGame, deleteGame, loadGameData, notification };
};
