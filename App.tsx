
import React, { useState, useEffect, useRef } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import { GameState, GameEvent, MapEntity, ChatMessage, ChaosLevel, MapEntityType } from './types';
import { simulateTurn, getStrategicSuggestions, sendDiplomaticMessage, AIProvider } from './services/geminiService';
import { NUCLEAR_POWERS, LANDLOCKED_COUNTRIES, SPACE_POWERS, ALL_COUNTRIES_LIST, NATO_MEMBERS_2000, getFlagUrl, normalizeCountryName } from './constants';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logout, subscribeToAuthChanges, db } from './services/authService';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, addDoc, query, onSnapshot } from 'firebase/firestore';

const INITIAL_DATE = new Date('2000-01-01');

interface SaveMetadata { id: string; country: string; date: string; turn: number; lastPlayed: number; }
type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';
type GameScreen = 'splash' | 'loading' | 'game';

const getInitialStats = (country: string): { power: number, corruption: number } => {
    const c = country.toLowerCase();
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni') || c.includes('allemagne') || c.includes('japon') || c.includes('canada')) return { power: 65, corruption: 10 };
    if (c.includes('chine')) return { power: 60, corruption: 50 };
    if (c.includes('russie')) return { power: 70, corruption: 60 };
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number): number => Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
const isCountryLandlocked = (country: string): boolean => LANDLOCKED_COUNTRIES.some(c => country.includes(c));
const hasNuclearArsenal = (country: string): boolean => NUCLEAR_POWERS.some(c => country.includes(c));
const hasSpaceProgramInitial = (country: string): boolean => SPACE_POWERS.some(c => country.includes(c));

// POINT 3: FORMAT COMPACT (B=Base, D=Défense, I=Infra)
const getCompactCode = (t: string) => {
    const low = t.toLowerCase();
    if (low.includes('base')) return 'B';
    if (low.includes('défense') || low.includes('defense')) return 'D';
    return 'I';
}

const GameLogo = ({ size = 'large', theme = 'dark' }: { size?: 'small' | 'large', theme?: 'dark' | 'light' }) => {
    const isLight = theme === 'light';
    return (
        <div className={`flex flex-col items-center justify-center ${size === 'large' ? 'gap-4' : 'gap-2'}`}>
            <div className={`relative flex items-center justify-center rounded-full border-2 ${isLight ? 'border-emerald-500 bg-white shadow-xl' : 'border-emerald-500 bg-black/80 shadow-[0_0_20px_rgba(16,185,129,0.5)]'} ${size === 'large' ? 'w-32 h-32' : 'w-12 h-12'}`}>
                <div className="absolute inset-0 rounded-full border border-emerald-500/30 overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-top-left bg-gradient-to-r from-transparent to-emerald-500/40 animate-[spin_2s_linear_infinite]" style={{ borderRadius: '100% 0 0 0' }}></div>
                </div>
                <div className="absolute w-full h-[1px] bg-emerald-500/30"></div>
                <div className="absolute h-full w-[1px] bg-emerald-500/30"></div>
            </div>
            <h1 className={`font-serif font-bold tracking-widest uppercase ${isLight ? 'text-slate-800' : 'text-white'} ${size === 'large' ? 'text-4xl' : 'text-xl'}`}>GeoSim</h1>
        </div>
    );
};

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>('portal_landing');
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('splash');
  const [notification, setNotification] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
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
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], infrastructure: {},
    worldSummary: "Situation stable au tournant du millénaire.", // Init Point 2
    strategicSuggestions: [], // Init Point 4
    turn: 1, events: [], isProcessing: false, globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30,
    hasNuclear: false, hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null
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
        else { setAppMode('portal_landing'); setAvailableSaves([]); }
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
          if (isMountedRef.current) { setAvailableSaves(saves); setIsSyncing(false); }
      });
      return () => unsubscribe();
  }, [user]); 

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) return;
      const metadata = { id: state.gameId, country: state.playerCountry || "Inconnu", date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now() };
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), JSON.parse(JSON.stringify({ metadata, state, history, aiProvider })));
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
      } catch (e) { showNotification("Échec Sauvegarde Cloud"); }
  };

  const loadGameById = async (id: string) => {
      if (isGlobalLoading) return; 
      setIsGlobalLoading(true); 
      try {
          const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
          if (docSnap.exists()) {
              const data = docSnap.data();
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState(data.state);
              setFullHistory(data.history);
              if (data.aiProvider) setAiProvider(data.aiProvider);
              setEventQueue([]); setShowStartModal(false); setAppMode('game_active'); setCurrentScreen('loading');
          }
      } catch (e) { showNotification("Erreur de chargement"); }
      setIsGlobalLoading(false); setIsSettingsOpen(false); setIsLoadMenuOpen(false);
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry || gameState.isGameOver) return;
    setActiveWindow('none');
    const finalOrderString = [...pendingOrders, playerInput.trim()].filter(Boolean).join("\n");
    const formattedDate = gameState.currentDate.toLocaleDateString('fr-FR');
    setGameState(prev => ({ ...prev, isProcessing: true }));

    // POINT 3: GENERATION RESUME COMPACT
    const summaryMap: Record<string, Record<string, number>> = {};
    gameState.mapEntities.forEach(ent => {
        if (!summaryMap[ent.country]) summaryMap[ent.country] = {};
        const code = getCompactCode(ent.type);
        summaryMap[ent.country][code] = (summaryMap[ent.country][code] || 0) + 1;
    });
    if (gameState.infrastructure) {
        Object.entries(gameState.infrastructure).forEach(([country, infraTypes]) => {
            if (!summaryMap[country]) summaryMap[country] = {};
            Object.entries(infraTypes).forEach(([type, count]) => {
                const code = getCompactCode(type);
                summaryMap[country][code] = (summaryMap[country][code] || 0) + count;
            });
        });
    }
    const entitiesSummary = Object.entries(summaryMap).map(([country, counts]) => {
        const countsStr = Object.entries(counts).map(([type, count]) => `${type}${count}`).join('');
        return `${country.slice(0,3).toUpperCase()}:${countsStr}`;
    }).join('|');

    const result = await simulateTurn(
        gameState.playerCountry, formattedDate, finalOrderString, fullHistory, gameState.ownedTerritories,
        entitiesSummary, isCountryLandlocked(gameState.playerCountry), gameState.hasNuclear,
        gameState.chatHistory.slice(-5).map(m => m.text).join('|'), gameState.chaosLevel, aiProvider, gameState.militaryPower, gameState.alliance,
        gameState.worldSummary // Envoi du worldSummary
    );

    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1);

    const playerEvent: GameEvent = { id: `turn-${gameState.turn}-p`, date: formattedDate, type: 'player', headline: 'Décrets émis', description: finalOrderString || "Maintien de l'ordre." };
    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({ id: `turn-${gameState.turn}-ai-${idx}`, date: nextDate.toLocaleDateString('fr-FR'), type: e.type, headline: e.headline, description: e.description, relatedCountry: e.relatedCountry }));

    let newOwned = [...gameState.ownedTerritories];
    let newEntities = [...gameState.mapEntities];
    let newInfra = JSON.parse(JSON.stringify(gameState.infrastructure || {}));

    if (result.mapUpdates) {
        result.mapUpdates.forEach(u => {
            if (u.type === 'annexation' && u.targetCountry === gameState.playerCountry) return; // Sécurité Arcade
            if (u.type === 'annexation' && !newOwned.includes(u.targetCountry)) newOwned.push(u.targetCountry);
            else if (u.type === 'build_base' || u.type === 'build_defense') newEntities.push({ id: `e-${Date.now()}-${Math.random()}`, type: u.type as MapEntityType, country: u.targetCountry, lat: u.lat || 0, lng: u.lng || 0, label: u.label });
        });
    }

    if (result.infrastructureUpdates) {
        result.infrastructureUpdates.forEach(u => {
            if (!newInfra[u.country]) newInfra[u.country] = {};
            newInfra[u.country][u.type] = Math.max(0, (newInfra[u.country][u.type] || 0) + u.change);
        });
    }

    const newGameState = {
        ...gameState, currentDate: nextDate, turn: gameState.turn + 1, ownedTerritories: newOwned, mapEntities: newEntities, infrastructure: newInfra,
        worldSummary: result.worldSummary, // Stockage du worldSummary (Point 2)
        strategicSuggestions: result.strategicSuggestions, // Stockage des suggestions (Point 4)
        globalTension: Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange)),
        economyHealth: Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange)),
        militaryPower: Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange)),
        popularity: Math.max(0, Math.min(100, gameState.popularity + (result.popularityChange || 0))),
        corruption: Math.max(0, Math.min(100, gameState.corruption + (result.corruptionChange || 0))),
        isProcessing: false,
        isGameOver: newOwned.length === 0, gameOverReason: "Nation annexée."
    };

    setGameState(newGameState);
    setEventQueue([playerEvent, ...newAiEvents]);
    setFullHistory(prev => [...prev, playerEvent, ...newAiEvents]);
    setPlayerInput(""); setPendingOrders([]); setFocusCountry(result.events[0]?.relatedCountry || gameState.playerCountry);
    if (!newGameState.isGameOver) { setActiveWindow('events'); saveGame(newGameState, [...fullHistory, playerEvent, ...newAiEvents], false); }
  };

  const handleRegionSelect = (region: string) => { if (!gameState.playerCountry) { setPendingCountry(region); setShowStartModal(true); } };
  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };
  const handleLogout = async () => { await logout(); setAppMode('portal_landing'); };
  
  // Point 4: suggestions instantanées
  const handleGetSuggestions = async () => gameState.strategicSuggestions;

  if (appMode === 'portal_landing') return (
      <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
          <nav className="p-6 flex justify-between items-center"><h1 className="text-2xl font-black uppercase">Politika</h1></nav>
          <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <h2 className="text-5xl md:text-7xl font-black mb-6">REECRIVEZ<br/>L'HISTOIRE.</h2>
              <button onClick={() => setShowLoginModal(true)} className="px-8 py-4 bg-blue-600 text-white font-bold rounded-xl shadow-xl hover:scale-105 transition-transform">JOUER ➔</button>
          </main>
          {showLoginModal && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                  <div className="bg-white p-6 rounded-2xl w-full max-w-sm">
                      <h3 className="text-xl font-bold mb-6">Connexion</h3>
                      <button onClick={() => loginWithGoogle()} className="w-full py-3 border border-slate-300 rounded-lg flex items-center justify-center gap-2 font-bold mb-4"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5" alt=""/>Google</button>
                      <button onClick={() => setShowLoginModal(false)} className="w-full py-2 text-slate-400 font-bold">Annuler</button>
                  </div>
              </div>
          )}
      </div>
  );

  if (appMode === 'portal_dashboard') return (
      <div className="min-h-screen bg-slate-50 p-6">
          <header className="flex justify-between items-center mb-10"><h1 className="text-xl font-black uppercase">Politika Dashboard</h1><button onClick={handleLogout} className="text-red-500 font-bold">Déconnexion</button></header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div onClick={() => { setGameState({...gameState, gameId: Date.now().toString()}); setAppMode('game_active'); setCurrentScreen('splash'); }} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 cursor-pointer hover:shadow-lg transition-shadow"><h3 className="text-xl font-bold mb-2">Nouvelle Simulation</h3><p className="text-slate-500 text-sm">Démarrez un nouveau mandat en l'an 2000.</p></div>
              {availableSaves.length > 0 && availableSaves.slice(0, 1).map(s => (<div key={s.id} onClick={() => loadGameById(s.id)} className="bg-blue-600 p-6 rounded-2xl shadow-sm text-white cursor-pointer hover:bg-blue-700 transition-colors"><h3 className="text-xl font-bold mb-2">Continuer</h3><p className="opacity-80 text-sm">{s.country} • Tour {s.turn}</p></div>))}
          </div>
      </div>
  );

  if (appMode === 'game_active') {
    if (currentScreen === 'splash') return (<div className="w-screen h-screen bg-white flex items-center justify-center animate-fade-in"><GameLogo/></div>);
    if (currentScreen === 'loading') return (<div className="w-screen h-screen bg-white flex flex-col items-center justify-center"><GameLogo size="small" theme="light"/><div className="w-64 h-1 bg-slate-100 rounded-full mt-8 overflow-hidden"><div className="h-full bg-emerald-500 animate-[width_3s_ease-in-out_forwards]" style={{width: '0%'}}></div></div></div>);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900">
            <WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} onRegionClick={handleRegionSelect} focusCountry={focusCountry}/>
            <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={() => { const e = eventQueue[0]; setEventQueue(eventQueue.slice(1)); setFullHistory([...fullHistory, e]); }} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={() => { setPendingOrders([...pendingOrders, playerInput]); setPlayerInput(""); }} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={handleGetSuggestions} turn={gameState.turn}/>
            {gameState.playerCountry && (
                <div className="absolute top-4 left-4 z-20 flex gap-2 bg-stone-900/90 p-2 rounded-lg border border-stone-700 shadow-xl backdrop-blur-md">
                    <div className="flex flex-col gap-1 w-16 text-[9px] font-bold text-stone-400"><span>TEN</span><div className="h-1 bg-stone-700 rounded-full"><div className="h-full bg-red-500" style={{width: `${gameState.globalTension}%`}}></div></div></div>
                    <div className="flex flex-col gap-1 w-16 text-[9px] font-bold text-stone-400"><span>ECO</span><div className="h-1 bg-stone-700 rounded-full"><div className="h-full bg-emerald-500" style={{width: `${gameState.economyHealth}%`}}></div></div></div>
                    <div className="flex flex-col gap-1 w-16 text-[9px] font-bold text-stone-400"><span>MIL</span><div className="h-1 bg-stone-700 rounded-full"><div className="h-full bg-blue-500" style={{width: `${gameState.militaryPower}%`}}></div></div></div>
                </div>
            )}
            <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing}/>
            {notification && <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-stone-800 text-white px-4 py-2 rounded-full z-50 font-bold text-xs">{notification}</div>}
            {showStartModal && !gameState.playerCountry && !pendingCountry && <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-6 text-center"><div className="bg-white p-6 rounded-2xl max-w-xs shadow-2xl"><h2 className="text-xl font-bold mb-2">Sélectionnez une nation</h2><p className="text-sm text-slate-500">Touchez un pays sur le satellite pour débuter votre mandat.</p><button onClick={() => setShowStartModal(false)} className="mt-4 text-blue-600 font-bold text-sm underline">Fermer</button></div></div>}
            {pendingCountry && <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/20"><div className="bg-white p-6 rounded-2xl shadow-2xl text-center"><h3 className="text-2xl font-bold mb-4">{pendingCountry}</h3><div className="flex gap-2"><button onClick={() => setPendingCountry(null)} className="flex-1 py-2 border rounded-lg text-sm">Annuler</button><button onClick={() => { setGameState({...gameState, playerCountry: pendingCountry, ownedTerritories: [pendingCountry]}); setPendingCountry(null); setFocusCountry(pendingCountry); }} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Confirmer</button></div></div></div>}
        </div>
    );
  }
  return null;
};

export default App;
