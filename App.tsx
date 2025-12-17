import React, { useState, useEffect, useRef } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import { GameState, GameEvent, ChatMessage, ChaosLevel, MapEntityType } from './types';
import { simulateTurn, getStrategicSuggestions, sendDiplomaticMessage } from './services/geminiService';
import { NUCLEAR_POWERS, LANDLOCKED_COUNTRIES, SPACE_POWERS, ALL_COUNTRIES_LIST, NATO_MEMBERS_2000, getFlagUrl, normalizeCountryName } from './constants';
import { loginWithEmail, registerWithEmail, logout, subscribeToAuthChanges, db } from './services/authService';
import { collection, doc, getDoc, addDoc, writeBatch, query, onSnapshot } from 'firebase/firestore';

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
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number): number => {
    return Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
};

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
  const [notification, setNotification] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [isSyncing, setIsSyncing] = useState(true);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  
  const [gameState, setGameState] = useState<GameState>({
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], turn: 1, events: [], isProcessing: false,
    globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false, hasSpaceProgram: false,
    militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null
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
      if (!user || !db) { setIsSyncing(false); return; }
      setIsSyncing(true);
      const q = query(collection(db, "users", user.uid, "game_metas"));
      return onSnapshot(q, (snapshot) => {
            const saves: SaveMetadata[] = [];
            snapshot.forEach((doc) => { saves.push(doc.data() as SaveMetadata); });
            saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
            if (isMountedRef.current) { setAvailableSaves(saves); setIsSyncing(false); }
        });
  }, [user]); 

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) return;
      const metadata: SaveMetadata = {
          id: state.gameId, country: state.playerCountry || "Inconnu", date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now()
      };
      const sanitizedData = JSON.parse(JSON.stringify({ metadata, state, history }));
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), sanitizedData);
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
      } catch (e) { showNotification("Échec Sauvegarde"); }
  };

  const deleteSave = async (id: string) => {
      if (!user || !db) return;
      try {
          const batch = writeBatch(db);
          batch.delete(doc(db, "users", user.uid, "games", id));
          batch.delete(doc(db, "users", user.uid, "game_metas", id));
          await batch.commit();
      } catch (e) { console.error(e); }
  };

  const loadGameById = async (id: string) => {
      if (isGlobalLoading || !user || !db) return; 
      setIsGlobalLoading(true); 
      try {
          const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
          if (docSnap.exists()) {
              const data = docSnap.data();
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState(data.state); setFullHistory(data.history); setEventQueue([]); setShowStartModal(false); setAppMode('game_active'); setCurrentScreen('loading');
          }
      } catch (e) { showNotification("Erreur de chargement"); }
      finally { setIsGlobalLoading(false); setIsSettingsOpen(false); setIsLoadMenuOpen(false); }
  };

  const handleLogout = async () => { await logout(); setAppMode('portal_landing'); };

  const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          if (isRegistering) await registerWithEmail(authEmail, authPassword);
          else await loginWithEmail(authEmail, authPassword);
      } catch (err: any) { showNotification("Erreur d'authentification."); }
  };

  const handleSendChatMessage = async (targets: string[], message: string) => {
      if (!gameState.playerCountry) return;
      const userMsg: ChatMessage = {
          id: `msg-${Date.now()}-p`, sender: 'player', senderName: gameState.playerCountry, targets, text: message, timestamp: Date.now(), isRead: true
      };
      setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, userMsg] }));
      setTypingParticipants(targets);
      try {
        const aiPromises = targets.map(async (targetCountry) => {
            const responseText = await sendDiplomaticMessage(gameState.playerCountry!, targetCountry, targets, message, [...gameState.chatHistory, userMsg], { militaryPower: gameState.militaryPower, economyHealth: gameState.economyHealth, globalTension: gameState.globalTension, hasNuclear: gameState.hasNuclear });
            setTypingParticipants(prev => prev.filter(p => p !== targetCountry));
            if (!responseText) return null;
            return { id: `msg-${Date.now()}-${targetCountry}`, sender: 'ai', senderName: targetCountry, targets, text: responseText, timestamp: Date.now(), isRead: false } as ChatMessage;
        });
        const validResponses = (await Promise.all(aiPromises)).filter(r => r !== null) as ChatMessage[];
        setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, ...validResponses] }));
        if (validResponses.length > 0) setHasUnreadChat(true);
      } catch (e) { setTypingParticipants([]); }
  };

  const handleMarkChatRead = (conversationPartners: string[]) => {
      if (!gameState.playerCountry) return;
      setGameState(prev => {
          const newHistory = prev.chatHistory.map(msg => {
              if (msg.isRead || msg.sender === 'player') return msg;
              if (conversationPartners.includes(normalizeCountryName(msg.senderName))) return { ...msg, isRead: true };
              return msg;
          });
          setHasUnreadChat(newHistory.some(m => !m.isRead && m.sender !== 'player'));
          return { ...prev, chatHistory: newHistory };
      });
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry || gameState.isGameOver) return;
    setActiveWindow('none');
    const allOrders = [...pendingOrders];
    if (playerInput.trim()) allOrders.push(playerInput.trim());
    const finalOrderString = allOrders.join("\n");
    setGameState(prev => ({ ...prev, isProcessing: true }));
    const result = await simulateTurn(gameState.playerCountry, gameState.currentDate.toLocaleDateString('fr-FR'), finalOrderString, gameState.events, gameState.ownedTerritories, gameState.mapEntities.map(e => e.type), LANDLOCKED_COUNTRIES.includes(gameState.playerCountry), NUCLEAR_POWERS.includes(gameState.playerCountry), "", gameState.chaosLevel);
    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1);
    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({ id: `t-${gameState.turn}-${idx}`, date: nextDate.toLocaleDateString('fr-FR'), type: e.type, headline: e.headline, description: e.description, relatedCountry: e.relatedCountry }));
    const newGameState = { ...gameState, currentDate: nextDate, turn: gameState.turn + 1, isProcessing: false, events: [...gameState.events, ...newAiEvents] };
    setGameState(newGameState); setEventQueue(newAiEvents); setFullHistory(prev => [...prev, ...newAiEvents]); setPlayerInput(""); setPendingOrders([]); setActiveWindow('events');
    saveGame(newGameState, [...fullHistory, ...newAiEvents], false);
  };

  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); }

  if (appMode === 'portal_landing') return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col items-center justify-center p-6 text-center">
        <GameLogo size="large" theme="light" />
        <h2 className="mt-8 text-5xl font-black uppercase tracking-tighter">Réécrivez l'histoire.</h2>
        <button onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)} className="mt-12 px-12 py-5 bg-black text-white rounded-2xl font-bold text-xl shadow-2xl hover:scale-105 transition-transform">LANCER LE MANDAT ➔</button>
        {showLoginModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                    <h3 className="text-xl font-bold mb-6">{isRegistering ? "Créer un compte" : "Connexion"}</h3>
                    <form onSubmit={handleEmailAuth} className="space-y-4">
                        <input type="email" placeholder="Email" required className="w-full p-3 rounded-lg border bg-slate-50" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}/>
                        <input type="password" placeholder="Mot de passe" required className="w-full p-3 rounded-lg border bg-slate-50" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}/>
                        <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg shadow-lg">Continuer</button>
                    </form>
                    <button onClick={() => setIsRegistering(!isRegistering)} className="mt-4 text-xs font-bold text-blue-600 block mx-auto underline">{isRegistering ? "Déjà membre ?" : "Créer un compte"}</button>
                    <button onClick={() => setShowLoginModal(false)} className="mt-4 w-full text-slate-400 font-bold">Annuler</button>
                </div>
            </div>
        )}
    </div>
  );

  if (appMode === 'portal_dashboard') return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 flex flex-col items-center">
        <header className="w-full max-w-6xl flex justify-between items-center mb-12">
            <h1 className="text-3xl font-black uppercase">Command Center</h1>
            <button onClick={handleLogout} className="px-4 py-2 text-red-500 font-bold border border-red-100 rounded-lg">Sortie</button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
            <div className="bg-white p-8 rounded-3xl border shadow-xl text-center cursor-pointer hover:shadow-2xl transition-all group" onClick={() => { setAppMode('game_active'); setCurrentScreen('splash'); }}>
                <div className="text-7xl mb-6 group-hover:scale-110 transition-transform">🌍</div>
                <h2 className="text-2xl font-black mb-2 uppercase">GeoSim 2000</h2>
                <button className="w-full py-4 bg-black text-white font-bold rounded-2xl">NOUVELLE PARTIE</button>
            </div>
            {availableSaves.length > 0 && (
                <div className="bg-white p-8 rounded-3xl border shadow-xl col-span-2 overflow-y-auto max-h-[400px]">
                    <h2 className="text-xl font-black mb-6 uppercase text-slate-400 tracking-widest">Sauvegardes</h2>
                    {availableSaves.map(s => (
                        <div key={s.id} className="p-4 border-b flex items-center justify-between hover:bg-slate-50 cursor-pointer" onClick={() => loadGameById(s.id)}>
                            <div><div className="font-bold">{s.country}</div><div className="text-xs text-slate-500">Tour {s.turn} • {s.date}</div></div>
                            <span className="text-blue-600 font-bold">➔</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    </div>
  );

  if (appMode === 'game_active') {
    if (currentScreen === 'splash') return (<div className="w-screen h-screen bg-white flex items-center justify-center animate-fade-in"><GameLogo /></div>);
    if (currentScreen === 'loading') return (<div className="w-screen h-screen bg-slate-50 flex flex-col items-center justify-center text-emerald-600"><GameLogo size="small" theme="light" /><div className="w-64 h-2 bg-slate-200 rounded-full mt-8 overflow-hidden"><div className="h-full bg-emerald-500 animate-[width_3s_ease-in-out]"></div></div></div>);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
            <WorldMap onRegionClick={(c) => { if(!gameState.playerCountry) { setPendingCountry(c); setShowStartModal(true); } }} playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} focusCountry={focusCountry}/>
            {showStartModal && !gameState.playerCountry && (
                <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
                        {!pendingCountry ? (<p className="font-bold text-slate-400">Sélectionnez une nation sur la carte</p>) : (
                            <>
                                <h2 className="text-3xl font-black mb-2 uppercase">{pendingCountry}</h2>
                                <div className="flex gap-2 mt-8">
                                    <button onClick={() => setPendingCountry(null)} className="flex-1 py-3 bg-stone-100 rounded-xl font-bold">Annuler</button>
                                    <button onClick={() => { setGameState({...gameState, playerCountry: pendingCountry, ownedTerritories: [pendingCountry]}); setFocusCountry(pendingCountry); setShowStartModal(false); }} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-xl">Confirmer</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {gameState.playerCountry && (
                <>
                    <div className="absolute bottom-6 left-6 z-20 flex gap-4">
                        <button onClick={() => setActiveWindow(activeWindow === 'events' ? 'none' : 'events')} className={`w-14 h-14 rounded-full shadow-xl border-2 flex items-center justify-center ${activeWindow === 'events' ? 'bg-blue-600 text-white border-white' : 'bg-white border-stone-200 text-stone-700'}`}>📝</button>
                        <button onClick={() => setActiveWindow(activeWindow === 'chat' ? 'none' : 'chat')} className={`w-14 h-14 rounded-full shadow-xl border-2 flex items-center justify-center ${activeWindow === 'chat' ? 'bg-blue-600 text-white border-white' : 'bg-white border-stone-200 text-stone-700'}`}>💬</button>
                        <button onClick={() => setIsSettingsOpen(true)} className="w-14 h-14 bg-stone-800 rounded-full shadow-xl border-2 border-white/20 flex items-center justify-center text-white">⚙️</button>
                    </div>
                    <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing}/>
                </>
            )}
            <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={() => { setFullHistory(prev => [...prev, eventQueue[0]]); setEventQueue(eventQueue.slice(1)); }} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={() => { setPendingOrders([...pendingOrders, playerInput]); setPlayerInput(""); }} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={() => getStrategicSuggestions(gameState.playerCountry!, fullHistory)} turn={gameState.turn}/>
            <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => setActiveWindow('none')} playerCountry={gameState.playerCountry!} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} onMarkRead={handleMarkChatRead}/>
            {isSettingsOpen && (
                <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-6 uppercase">Options du Système</h3>
                        <div className="space-y-4">
                            <button onClick={toggleFullscreen} className="w-full py-3 bg-stone-100 rounded-xl font-bold">Plein Écran ⛶</button>
                            <button onClick={() => { setIsSettingsOpen(false); saveGame(gameState, fullHistory); }} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg">Sauvegarder Cloud ☁️</button>
                            <button onClick={() => setAppMode('portal_dashboard')} className="w-full py-3 text-red-500 font-bold">Retour au QG</button>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-4 bg-black text-white font-bold rounded-xl">Reprendre</button>
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
