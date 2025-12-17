import React, { useState, useEffect, useRef } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import NewsTicker from './components/NewsTicker';
import { GameState, GameEvent, MapEntity, ChatMessage, ChaosLevel, MapEntityType } from './types';
import { simulateTurn, getStrategicSuggestions, sendBatchDiplomaticMessage, generateHistorySummary, AIProvider } from './services/geminiService';
import { NUCLEAR_POWERS, LANDLOCKED_COUNTRIES, SPACE_POWERS, ALL_COUNTRIES_LIST, NATO_MEMBERS_2000, getFlagUrl, normalizeCountryName } from './constants';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logout, subscribeToAuthChanges, db } from './services/authService';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, addDoc, query, onSnapshot } from 'firebase/firestore';

const INITIAL_DATE = new Date('2000-01-01');

interface SaveMetadata {
    id: string;
    country: string;
    date: string;
    turn: number;
    lastPlayed: number;
}

type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';
type GameScreen = 'splash' | 'loading' | 'game';

const getInitialStats = (country: string): { power: number, corruption: number } => {
    const c = country.toLowerCase();
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni') || c.includes('allemagne') || c.includes('japon') || c.includes('canada')) return { power: 65, corruption: 10 };
    if (c.includes('chine')) return { power: 60, corruption: 50 };
    if (c.includes('russie')) return { power: 70, corruption: 60 };
    if (c.includes('inde')) return { power: 50, corruption: 55 };
    if (c.includes('brésil')) return { power: 45, corruption: 50 };
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number): number => {
    return Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
};

const isCountryLandlocked = (country: string): boolean => LANDLOCKED_COUNTRIES.some(c => country.includes(c));
const hasNuclearArsenal = (country: string): boolean => NUCLEAR_POWERS.some(c => country.includes(c));
const hasSpaceProgramInitial = (country: string): boolean => SPACE_POWERS.some(c => country.includes(c));

const GameLogo = ({ size = 'large', theme = 'dark' }: { size?: 'small' | 'large', theme?: 'dark' | 'light' }) => {
    const isLight = theme === 'light';
    return (
        <div className={`flex flex-col items-center justify-center ${size === 'large' ? 'gap-4' : 'gap-2'}`}>
            <div className={`
                relative flex items-center justify-center rounded-full border-2 
                ${isLight ? 'border-emerald-500 bg-white shadow-xl' : 'border-emerald-500 bg-black/80 shadow-[0_0_20px_rgba(16,185,129,0.5)]'}
                ${size === 'large' ? 'w-32 h-32' : 'w-12 h-12'}
            `}>
                <div className="absolute inset-0 rounded-full border border-emerald-500/30 overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-top-left bg-gradient-to-r from-transparent to-emerald-500/40 animate-[spin_2s_linear_infinite]" style={{ borderRadius: '100% 0 0 0' }}></div>
                </div>
                <div className="absolute w-full h-[1px] bg-emerald-500/30"></div>
                <div className="absolute h-full w-[1px] bg-emerald-500/30"></div>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping absolute top-1/4 right-1/4"></div>
            </div>
            <h1 className={`font-serif font-bold tracking-widest uppercase ${isLight ? 'text-slate-800' : 'text-white'} ${size === 'large' ? 'text-4xl' : 'text-xl'}`}>
                GeoSim
            </h1>
        </div>
    );
};

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>('portal_landing');
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('splash');
  const [hasSave, setHasSave] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [customApiKey, setCustomApiKey] = useState<string>(() => localStorage.getItem('custom_gemini_key') || "");
  const [customProviderName, setCustomProviderName] = useState<string>(() => localStorage.getItem('custom_provider_name') || "gemini");
  const [customModelName, setCustomModelName] = useState<string>(() => localStorage.getItem('custom_model_name') || "");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKey, setTempKey] = useState("");
  const [tempModel, setTempModel] = useState("");
  const [isSyncing, setIsSyncing] = useState(true);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [bugTitle, setBugTitle] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [isSendingBug, setIsSendingBug] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  
  const [gameState, setGameState] = useState<GameState>({
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], turn: 1, events: [], isProcessing: false,
    globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false, hasSpaceProgram: false,
    militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, historySummary: '', isGameOver: false, gameOverReason: null
  });

  const [eventQueue, setEventQueue] = useState<GameEvent[]>([]);
  const [fullHistory, setFullHistory] = useState<GameEvent[]>([]);
  const [activeWindow, setActiveWindow] = useState<'none' | 'events' | 'history' | 'chat' | 'alliance'>('none');
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [typingParticipants, setTypingParticipants] = useState<string[]>([]);
  const [focusCountry, setFocusCountry] = useState<string | null>(null);
  const [playerInput, setPlayerInput] = useState("");
  const [pendingOrders, setPendingOrders] = useState<string[]>([]); 
  const [showStartModal, setShowStartModal] = useState(true);
  const [pendingCountry, setPendingCountry] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const unsubscribe = subscribeToAuthChanges((u) => {
        if (!isMountedRef.current) return;
        setUser(u);
        if (u) { setAppMode('portal_dashboard'); setShowLoginModal(false); }
        else { setAppMode('portal_landing'); setAvailableSaves([]); setHasSave(false); }
    });
    return () => { isMountedRef.current = false; unsubscribe(); };
  }, []);

  useEffect(() => {
      if (!user || !db) { setAvailableSaves([]); setIsSyncing(false); return; }
      setIsSyncing(true);
      const q = query(collection(db, "users", user.uid, "game_metas"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
            const saves: SaveMetadata[] = [];
            snapshot.forEach((doc) => { saves.push(doc.data() as SaveMetadata); });
            saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
            if (isMountedRef.current) { setAvailableSaves(saves); setHasSave(saves.length > 0); setIsSyncing(false); }
        }, (error) => { console.error(error); if (isMountedRef.current) setIsSyncing(false); });
      return () => unsubscribe();
  }, [user]); 

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') {
        const timer = setTimeout(() => { setCurrentScreen('loading'); }, 2000);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'loading') {
        const timer = setTimeout(() => { setCurrentScreen('game'); }, 2000);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
              if (activeWindow !== 'none') setActiveWindow('none');
              else if (isSettingsOpen) setIsSettingsOpen(false);
              else if (isLoadMenuOpen) setIsLoadMenuOpen(false);
              else if (showKeyModal) setShowKeyModal(false);
              else if (showBugReportModal) setShowBugReportModal(false);
              else if (pendingCountry) setPendingCountry(null);
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeWindow, isSettingsOpen, isLoadMenuOpen, showKeyModal, showBugReportModal, pendingCountry]);

  const toggleFullscreen = () => {
      if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(e => console.error("Fullscreen error", e)); }
      else { if (document.exitFullscreen) document.exitFullscreen(); }
  };

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) { showNotification("Connexion requise !"); if (!user) setShowLoginModal(true); return; }
      const metadata: SaveMetadata = {
          id: state.gameId, country: state.playerCountry || "Inconnu", date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now()
      };
      const sanitizedData = JSON.parse(JSON.stringify({ metadata, state, history, aiProvider }));
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), sanitizedData);
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
      } catch (e) { showNotification("Échec Sauvegarde Cloud"); }
  };

  const deleteSave = async (id: string) => {
      if (!user || !db) return;
      try {
          const batch = writeBatch(db);
          batch.delete(doc(db, "users", user.uid, "games", id));
          batch.delete(doc(db, "users", user.uid, "game_metas", id));
          await batch.commit();
      } catch (e) { console.error("Cloud delete failed", e); }
  };

  const loadGameById = async (id: string) => {
      if (isGlobalLoading) return; 
      setIsGlobalLoading(true); 
      let data: any = null;
      if (user && db) {
          try {
              const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
              if (docSnap.exists()) data = docSnap.data();
          } catch (e) { showNotification("Erreur de chargement"); setIsGlobalLoading(false); return; }
      }
      if (data) {
          try {
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState(data.state); setFullHistory(data.history); if (data.aiProvider) setAiProvider(data.aiProvider);
              setEventQueue([]); setShowStartModal(false); setAppMode('game_active'); setCurrentScreen('loading'); setIsGlobalLoading(false); 
              showNotification(`Partie chargée: ${data.state.playerCountry}`);
          } catch (e) { showNotification("Erreur de sauvegarde (Corrompue)"); setIsGlobalLoading(false); }
      } else { showNotification("Données introuvables."); setIsGlobalLoading(false); }
      setIsSettingsOpen(false); setIsLoadMenuOpen(false);
  };

  const handleLogout = async () => { await logout(); showNotification("Déconnecté."); setAppMode('portal_landing'); };
  const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      try { if (isRegistering) await registerWithEmail(authEmail, authPassword); else await loginWithEmail(authEmail, authPassword); }
      catch (err: any) { showNotification("Erreur d'authentification."); }
  };

  const handleSendChatMessage = async (targets: string[], message: string) => {
    if (!gameState.playerCountry) return;
    const playerMsg: ChatMessage = {
      id: `chat-${Date.now()}-p`, sender: 'player', senderName: gameState.playerCountry, targets: targets, text: message, timestamp: Date.now(), isRead: true
    };
    setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, playerMsg] }));
    const effectiveProvider = aiProvider === 'custom' ? customProviderName : aiProvider;
    const apiKeyToUse = aiProvider === 'custom' ? customApiKey : undefined;
    const modelToUse = aiProvider === 'custom' ? customModelName : undefined;
    setTypingParticipants(targets);
    try {
        const responses = await sendBatchDiplomaticMessage(gameState.playerCountry, targets, message, gameState.chatHistory, effectiveProvider as any, apiKeyToUse, modelToUse);
        const newAiMessages: ChatMessage[] = Object.entries(responses)
            .filter(([_, text]) => text !== "NO_RESPONSE")
            .map(([country, text], idx) => ({
                id: `chat-${Date.now()}-ai-${idx}`, sender: 'ai', senderName: country, targets: [gameState.playerCountry!], text: text, timestamp: Date.now() + (idx * 10), isRead: false
            }));
        if (newAiMessages.length > 0) {
            setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, ...newAiMessages] }));
            setHasUnreadChat(true);
        }
    } catch (e) { console.error("Diplomacy error:", e); } finally { setTypingParticipants([]); }
  };

  const handleMarkRead = (targets: string[]) => {
      setGameState(prev => {
          const newHistory = prev.chatHistory.map(m => {
              if (!m.isRead && m.sender !== 'player' && targets.includes(normalizeCountryName(m.senderName))) return { ...m, isRead: true };
              return m;
          });
          return { ...prev, chatHistory: newHistory };
      });
      setTimeout(() => {
          setGameState(current => {
              const stillUnread = current.chatHistory.some(m => !m.isRead && m.sender !== 'player');
              setHasUnreadChat(stillUnread);
              return current;
          });
      }, 0);
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry || gameState.isGameOver) return;
    setActiveWindow('none');
    const allOrders = [...pendingOrders];
    if (playerInput.trim()) allOrders.push(playerInput.trim());
    const finalOrderString = allOrders.join("\n");
    const formattedDate = gameState.currentDate.toLocaleDateString('fr-FR');
    const playerEvent: GameEvent = { id: `turn-${gameState.turn}-p`, date: formattedDate, type: 'player', headline: 'Mandat exécuté', description: finalOrderString || "Statu quo politique." };
    setGameState(prev => ({ ...prev, isProcessing: true }));
    const effectiveProvider = aiProvider === 'custom' ? customProviderName : aiProvider;
    const apiKeyToUse = aiProvider === 'custom' ? customApiKey : undefined;
    const modelToUse = aiProvider === 'custom' ? customModelName : undefined;
    let currentSummary = gameState.historySummary;
    if (gameState.turn % 10 === 0 && fullHistory.length > 10) {
        currentSummary = await generateHistorySummary(gameState.playerCountry, fullHistory, currentSummary, effectiveProvider, apiKeyToUse, modelToUse);
    }
    const result = await simulateTurn(
        gameState.playerCountry, formattedDate, finalOrderString, gameState.events, gameState.ownedTerritories,
        gameState.mapEntities.map(e => `${e.label || e.type} en ${e.country}`), isCountryLandlocked(gameState.playerCountry), 
        gameState.hasNuclear, gameState.chatHistory.slice(-10).map(m => m.text).join(' '), gameState.chaosLevel, 
        effectiveProvider, apiKeyToUse, modelToUse, currentSummary
    );
    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1);
    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({
        id: `turn-${gameState.turn}-ai-${idx}`, date: nextDate.toLocaleDateString('fr-FR'), type: e.type, headline: e.headline, description: e.description, relatedCountry: e.relatedCountry
    }));
    let newOwnedTerritories = [...gameState.ownedTerritories];
    let newEntities = [...gameState.mapEntities];
    let newHasNuclear = gameState.hasNuclear;
    if (result.mapUpdates) {
        result.mapUpdates.forEach(upd => {
            if (upd.type === 'annexation') {
                const target = upd.targetCountry; const owner = upd.newOwner || gameState.playerCountry;
                if (owner === gameState.playerCountry && !newOwnedTerritories.includes(target)) { newOwnedTerritories.push(target); if (hasNuclearArsenal(target)) newHasNuclear = true; }
                else if (owner !== gameState.playerCountry) { newOwnedTerritories = newOwnedTerritories.filter(t => t !== target); }
            }
            if (['build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense', 'build_base', 'troop_deployment'].includes(upd.type)) {
                newEntities.push({ id: `ent-${Date.now()}-${Math.random()}`, type: upd.type as MapEntityType, country: upd.targetCountry, lat: upd.lat || 0, lng: upd.lng || 0, label: upd.label });
            }
        });
    }
    const newGameState = {
        ...gameState, currentDate: nextDate, turn: gameState.turn + 1, ownedTerritories: newOwnedTerritories, mapEntities: newEntities,
        globalTension: Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange)),
        economyHealth: Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange)),
        militaryPower: Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange)),
        popularity: Math.max(0, Math.min(100, gameState.popularity + (result.popularityChange || 0))),
        corruption: Math.max(0, Math.min(100, gameState.corruption + (result.corruptionChange || 0))),
        hasNuclear: newHasNuclear, isProcessing: false, historySummary: currentSummary
    };
    setGameState(newGameState); setEventQueue([playerEvent, ...newAiEvents]); setFullHistory(prev => [...prev, playerEvent, ...newAiEvents]);
    setPlayerInput(""); setPendingOrders([]); setFocusCountry(newAiEvents[0]?.relatedCountry || gameState.playerCountry);
    setActiveWindow('events'); saveGame(newGameState, fullHistory, false);
  };

  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };
  const launchGeoSim = () => { setGameState({ ...gameState, gameId: Date.now().toString(), playerCountry: null }); setAppMode('game_active'); setCurrentScreen('splash'); };

  if (appMode === 'portal_landing') return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col items-center justify-center p-6">
        <GameLogo size="large" theme="light" />
        <p className="mt-8 text-xl text-slate-500 max-w-md text-center">Prenez le contrôle d'une nation en l'an 2000 et affrontez l'intelligence artificielle mondiale.</p>
        <button onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)} className="mt-10 px-10 py-5 bg-black text-white rounded-2xl font-bold text-xl shadow-2xl hover:scale-105 transition-transform">COMMENCER ➔</button>
        {showLoginModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl p-8 max-w-sm w-full border shadow-2xl">
                    <h3 className="text-2xl font-bold mb-6">{isRegistering ? "Rejoindre GeoSim" : "Connexion Tactique"}</h3>
                    <form onSubmit={handleEmailAuth} className="space-y-4">
                        <input type="email" placeholder="Email" required className="w-full p-3 rounded-lg border bg-slate-50" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}/>
                        <input type="password" placeholder="Mot de passe" required className="w-full p-3 rounded-lg border bg-slate-50" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}/>
                        <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg">{isRegistering ? "S'inscrire" : "Se connecter"}</button>
                    </form>
                    <button onClick={() => setIsRegistering(!isRegistering)} className="mt-4 text-xs text-blue-600 block mx-auto font-bold">{isRegistering ? "Déjà membre ?" : "Créer un compte"}</button>
                    <button onClick={() => setShowLoginModal(false)} className="mt-4 w-full py-2 text-stone-400 font-bold">Annuler</button>
                </div>
            </div>
        )}
    </div>
  );

  if (appMode === 'portal_dashboard') return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 flex flex-col items-center">
        <header className="w-full max-w-6xl flex justify-between items-center mb-10">
            <h1 className="text-3xl font-black uppercase">QG POLITIKA</h1>
            <div className="flex gap-4">
                <button onClick={() => setIsLoadMenuOpen(true)} className="px-4 py-2 bg-white border rounded-lg font-bold shadow-sm">📂 Sauvegardes</button>
                <button onClick={handleLogout} className="p-2 text-red-500">Déconnexion</button>
            </div>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-6xl">
            <div className="bg-white p-8 rounded-3xl border shadow-xl flex flex-col items-center text-center cursor-pointer hover:shadow-2xl transition-all" onClick={launchGeoSim}>
                <div className="text-6xl mb-4">🌍</div>
                <h2 className="text-2xl font-bold mb-2">GeoSim An 2000</h2>
                <p className="text-slate-500 mb-6">Simulation mondiale dynamique. Tout est possible.</p>
                <button className="w-full py-4 bg-black text-white font-bold rounded-xl">NOUVELLE PARTIE</button>
            </div>
            {availableSaves.length > 0 && (
                <div className="bg-white p-8 rounded-3xl border shadow-xl overflow-y-auto max-h-[400px]">
                    <h2 className="text-xl font-bold mb-4">Continuer</h2>
                    <div className="space-y-4">
                        {availableSaves.map(s => (
                            <div key={s.id} className="flex items-center justify-between p-4 border rounded-xl hover:bg-slate-50 cursor-pointer" onClick={() => loadGameById(s.id)}>
                                <div><div className="font-bold">{s.country}</div><div className="text-xs text-slate-400">Tour {s.turn} • {s.date}</div></div>
                                <span className="text-blue-600 font-bold">➔</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
        {isLoadMenuOpen && (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
                    <h3 className="text-xl font-bold mb-4">Charger une simulation</h3>
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                        {availableSaves.map(s => (
                            <div key={s.id} className="p-3 border rounded-lg flex justify-between items-center">
                                <div><div className="font-bold">{s.country}</div><div className="text-[10px] uppercase">{s.date}</div></div>
                                <button onClick={() => loadGameById(s.id)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Charger</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => setIsLoadMenuOpen(false)} className="mt-4 w-full py-2 bg-stone-100 rounded font-bold text-stone-500">Retour</button>
                </div>
            </div>
        )}
    </div>
  );

  if (appMode === 'game_active') {
    if (currentScreen === 'splash') return (<div className="w-screen h-screen bg-white flex items-center justify-center animate-fade-in"><GameLogo /></div>);
    if (currentScreen === 'loading') return (<div className="w-screen h-screen bg-slate-900 flex flex-col items-center justify-center text-white"><div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden mb-4"><div className="h-full bg-blue-500 animate-[width_2s_ease-in-out]"></div></div><div className="text-xs uppercase tracking-widest animate-pulse">Initialisation Satellite...</div></div>);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
            <NewsTicker text={eventQueue.length > 0 ? eventQueue[0].headline : (fullHistory.length > 0 ? fullHistory[fullHistory.length-1].headline : "GeoSim : Millénaire An 2000")} />
            <div className="absolute inset-0 z-0 pt-8"><WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} onRegionClick={(c) => { if(!gameState.playerCountry) { setPendingCountry(c); setShowStartModal(true); } }} focusCountry={focusCountry}/></div>
            
            {showStartModal && !gameState.playerCountry && (
                <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
                        {!pendingCountry ? (<p className="font-bold">Sélectionnez une nation sur la carte.</p>) : (
                            <>
                                <h2 className="text-3xl font-black mb-4 uppercase">{pendingCountry}</h2>
                                <p className="text-slate-500 mb-6">Souhaitez-vous prendre le contrôle de cette nation ?</p>
                                <div className="flex gap-2">
                                    <button onClick={() => setPendingCountry(null)} className="flex-1 py-3 bg-stone-100 rounded-lg">Non</button>
                                    <button onClick={() => { setGameState({ ...gameState, playerCountry: pendingCountry }); setShowStartModal(false); setFocusCountry(pendingCountry); }} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-xl">Prendre le commandement</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {gameState.playerCountry && !gameState.isGameOver && (
                <>
                    <div className="absolute top-12 left-4 z-20 flex gap-2 bg-stone-900/80 p-2 rounded-lg border border-white/10 backdrop-blur-md shadow-2xl">
                        {['Tension', 'Économie', 'Popularité', 'Militaire'].map(stat => (
                            <div key={stat} className="flex flex-col gap-1 w-16">
                                <span className="text-[8px] uppercase text-white/50 font-bold">{stat}</span>
                                <div className="h-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-blue-400" style={{width: '50%'}}></div></div>
                            </div>
                        ))}
                    </div>
                    <div className="absolute bottom-6 left-6 z-20 flex gap-4">
                        <button onClick={() => setActiveWindow(activeWindow === 'events' ? 'none' : 'events')} className={`w-14 h-14 rounded-full shadow-2xl border-2 flex items-center justify-center transition-all ${activeWindow === 'events' ? 'bg-blue-600 border-white text-white' : 'bg-white border-stone-200 text-stone-700'}`}>📝</button>
                        <button onClick={() => setActiveWindow(activeWindow === 'chat' ? 'none' : 'chat')} className={`w-14 h-14 rounded-full shadow-2xl border-2 flex items-center justify-center transition-all ${activeWindow === 'chat' ? 'bg-blue-600 border-white text-white' : 'bg-white border-stone-200 text-stone-700'}`}>💬</button>
                        <button onClick={() => setActiveWindow(activeWindow === 'history' ? 'none' : 'history')} className="w-14 h-14 bg-white rounded-full shadow-2xl border-2 border-stone-200 flex items-center justify-center">📚</button>
                        <button onClick={() => setIsSettingsOpen(true)} className="w-14 h-14 bg-stone-800 rounded-full shadow-2xl border-2 border-white/20 flex items-center justify-center text-white">⚙️</button>
                    </div>
                    <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing}/>
                </>
            )}

            <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={() => { setFullHistory(prev => [...prev, eventQueue[0]]); setEventQueue(eventQueue.slice(1)); }} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={() => { setPendingOrders([...pendingOrders, playerInput]); setPlayerInput(""); }} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={() => getStrategicSuggestions(gameState.playerCountry!, fullHistory, aiProvider)} turn={gameState.turn}/>
            <HistoryLog isOpen={activeWindow === 'history'} onClose={() => setActiveWindow('none')} history={fullHistory}/>
            <ChatInterface 
                isOpen={activeWindow === 'chat'} 
                onClose={() => setActiveWindow('none')} 
                playerCountry={gameState.playerCountry!} 
                chatHistory={gameState.chatHistory} 
                onSendMessage={async (t, m) => { 
                    showNotification("Transmission diplomatique..."); 
                    await handleSendChatMessage(t, m); 
                }} 
                isProcessing={gameState.isProcessing} 
                allCountries={ALL_COUNTRIES_LIST}
                typingParticipants={typingParticipants}
                onMarkRead={handleMarkRead}
            />
            {notification && (<div className="fixed top-12 left-1/2 -translate-x-1/2 z-[60] bg-stone-900 text-white px-6 py-2 rounded-full shadow-2xl font-bold text-xs animate-fade-in-down">{notification}</div>)}
            
            {isSettingsOpen && (
                <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                        <h3 className="text-2xl font-black mb-6 uppercase tracking-tight">Poste de Contrôle</h3>
                        <div className="space-y-4">
                            <button onClick={toggleFullscreen} className="w-full py-3 bg-stone-100 rounded-xl font-bold">Plein Écran ⛶</button>
                            <button onClick={() => saveGame(gameState, fullHistory)} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg">Sauvegarder Cloud ☁️</button>
                            <button onClick={() => setAppMode('portal_dashboard')} className="w-full py-3 text-red-500 font-bold">Quitter au Dashboard</button>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-4 bg-black text-white font-bold rounded-xl">REPRENDRE</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
  }
  return null;
};

export default App;
