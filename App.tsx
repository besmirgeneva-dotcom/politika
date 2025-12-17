
import React, { useState, useEffect, useRef } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import NewsTicker from './components/NewsTicker';
import { GameState, GameEvent, ChatMessage, ChaosLevel, MapEntityType } from './types';
import { simulateTurn, getStrategicSuggestions, sendBatchDiplomaticMessage, generateHistorySummary, AIProvider } from './services/geminiService';
import { NUCLEAR_POWERS, LANDLOCKED_COUNTRIES, SPACE_POWERS, ALL_COUNTRIES_LIST, NATO_MEMBERS_2000, getFlagUrl, normalizeCountryName } from './constants';
import { loginWithGoogle, loginWithEmail, registerWithEmail, logout, subscribeToAuthChanges, db } from './services/authService';
import { collection, doc, getDoc, writeBatch, query, onSnapshot } from 'firebase/firestore';

const INITIAL_DATE = new Date('2000-01-01');

interface SaveMetadata {
    id: string; country: string; date: string; turn: number; lastPlayed: number;
}

type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';
type GameScreen = 'splash' | 'loading' | 'game';

const getInitialStats = (country: string): { power: number, corruption: number } => {
    const c = country.toLowerCase();
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni') || c.includes('allemagne')) return { power: 65, corruption: 10 };
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number): number => Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
const isCountryLandlocked = (country: string): boolean => LANDLOCKED_COUNTRIES.some(c => country.includes(c));
const hasNuclearArsenal = (country: string): boolean => NUCLEAR_POWERS.some(c => country.includes(c));

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
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping absolute top-1/4 right-1/4"></div>
                <span className={`font-black ${isLight ? 'text-emerald-600' : 'text-white'} ${size === 'large' ? 'text-3xl' : 'text-xs'}`}>G</span>
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
  const [customApiKey, setCustomApiKey] = useState<string>(() => localStorage.getItem('custom_gemini_key') || "");
  const [customProviderName, setCustomProviderName] = useState<string>(() => localStorage.getItem('custom_provider_name') || "gemini");
  const [customModelName, setCustomModelName] = useState<string>(() => localStorage.getItem('custom_model_name') || "");
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

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) return;
      const metadata: SaveMetadata = { id: state.gameId, country: state.playerCountry || "Inconnu", date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now() };
      const sanitizedData = JSON.parse(JSON.stringify({ metadata, state, history, aiProvider }));
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), sanitizedData);
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
      } catch (e) { showNotification("Échec Sauvegarde"); }
  };

  const loadGameById = async (id: string) => {
      if (isGlobalLoading || !user || !db) return; 
      setIsGlobalLoading(true); 
      try {
          const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
          if (docSnap.exists()) {
              const data = docSnap.data();
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState(data.state); setFullHistory(data.history); setAppMode('game_active'); setCurrentScreen('loading');
          }
      } catch (e) { showNotification("Erreur de chargement"); }
      finally { setIsGlobalLoading(false); setIsSettingsOpen(false); setIsLoadMenuOpen(false); }
  };

  const handleSendChatMessage = async (targets: string[], message: string) => {
    if (!gameState.playerCountry) return;
    const playerMsg: ChatMessage = { id: `chat-${Date.now()}-p`, sender: 'player', senderName: gameState.playerCountry, targets, text: message, timestamp: Date.now(), isRead: true };
    setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, playerMsg] }));
    setTypingParticipants(targets);
    try {
        const responses = await sendBatchDiplomaticMessage(gameState.playerCountry, targets, message, gameState.chatHistory, aiProvider as any, customApiKey, customModelName);
        const newAiMessages: ChatMessage[] = Object.entries(responses).filter(([_, text]) => text !== "NO_RESPONSE").map(([country, text], idx) => ({
            id: `chat-${Date.now()}-ai-${idx}`, sender: 'ai', senderName: country, targets: [gameState.playerCountry!], text: text, timestamp: Date.now() + (idx * 10), isRead: false
        }));
        if (newAiMessages.length > 0) { setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, ...newAiMessages] })); setHasUnreadChat(true); }
    } catch (e) { console.error(e); } finally { setTypingParticipants([]); }
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry) return;
    setActiveWindow('none'); setGameState(prev => ({ ...prev, isProcessing: true }));
    const result = await simulateTurn(gameState.playerCountry, gameState.currentDate.toLocaleDateString('fr-FR'), pendingOrders.join("\n"), gameState.events, gameState.ownedTerritories, gameState.mapEntities.map(e => e.type), isCountryLandlocked(gameState.playerCountry), gameState.hasNuclear, "", gameState.chaosLevel, aiProvider, customApiKey, customModelName, gameState.historySummary);
    const nextDate = new Date(gameState.currentDate); nextDate.setMonth(nextDate.getMonth() + 1);
    const newEvents: GameEvent[] = result.events.map((e, i) => ({ id: `t-${gameState.turn}-${i}`, date: nextDate.toLocaleDateString('fr-FR'), type: e.type, headline: e.headline, description: e.description, relatedCountry: e.relatedCountry }));
    setGameState(prev => ({ ...prev, currentDate: nextDate, turn: prev.turn + 1, isProcessing: false, events: [...prev.events, ...newEvents] }));
    setEventQueue(newEvents); setFullHistory(prev => [...prev, ...newEvents]); setPendingOrders([]); setActiveWindow('events');
  };

  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };

  // @fix: Added handleLogout to process user sign out and UI reset
  const handleLogout = async () => {
    try {
      await logout();
      setAppMode('portal_landing');
    } catch (e) {
      showNotification("Erreur lors de la déconnexion");
    }
  };

  // @fix: Added handleMarkRead to update message status and global unread indicator
  const handleMarkRead = (targets: string[]) => {
    setGameState(prev => {
      const updatedHistory = prev.chatHistory.map(msg => {
        // Group logic to match conversation
        const participants = msg.sender === 'player' ? [...msg.targets] : [msg.senderName, ...msg.targets];
        const normalizedParticipants = participants
          .map(p => normalizeCountryName(p.trim()))
          .filter(p => p !== prev.playerCountry)
          .sort();
        
        const sortedTargets = [...targets].sort();

        if (msg.sender === 'ai' && !msg.isRead && JSON.stringify(normalizedParticipants) === JSON.stringify(sortedTargets)) {
          return { ...msg, isRead: true };
        }
        return msg;
      });

      const anyUnread = updatedHistory.some(m => !m.isRead && m.sender === 'ai');
      setHasUnreadChat(anyUnread);

      return { ...prev, chatHistory: updatedHistory };
    });
  };

  if (appMode === 'portal_landing') return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col items-center justify-center p-6 text-center">
        <div className="absolute inset-0 opacity-5 bg-stone-900 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
        <GameLogo size="large" theme="light" />
        <h2 className="mt-8 text-5xl font-black leading-tight tracking-tighter uppercase">Réécrivez l'histoire.</h2>
        <p className="mt-4 text-xl text-slate-500 max-w-md">Le simulateur géopolitique ultime propulsé par l'IA.</p>
        <button onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)} className="mt-12 px-12 py-5 bg-black text-white rounded-2xl font-bold text-xl shadow-2xl hover:scale-105 transition-transform">LANCER LE MANDAT ➔</button>
        {showLoginModal && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-fade-in-up">
                    <h3 className="text-2xl font-black mb-6 uppercase tracking-tight">{isRegistering ? "Rejoindre" : "Connexion"}</h3>
                    <form onSubmit={(e) => { e.preventDefault(); isRegistering ? registerWithEmail(authEmail, authPassword) : loginWithEmail(authEmail, authPassword); }} className="space-y-4">
                        <input type="email" placeholder="Email" className="w-full p-3 rounded-xl border bg-slate-50" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}/>
                        <input type="password" placeholder="Mot de passe" className="w-full p-3 rounded-xl border bg-slate-50" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}/>
                        <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg">Continuer</button>
                    </form>
                    <button onClick={() => setIsRegistering(!isRegistering)} className="mt-4 text-xs font-bold text-blue-600 underline block mx-auto">{isRegistering ? "Déjà membre ?" : "Créer un compte"}</button>
                    <button onClick={() => setShowLoginModal(false)} className="mt-6 w-full text-stone-400 font-bold">Annuler</button>
                </div>
            </div>
        )}
    </div>
  );

  if (appMode === 'portal_dashboard') return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 flex flex-col items-center">
        <header className="w-full max-w-6xl flex justify-between items-center mb-12">
            <h1 className="text-3xl font-black uppercase tracking-tighter">Command Center</h1>
            <div className="flex items-center gap-4">
                {user && <span className="text-xs font-bold text-slate-400">{user.email}</span>}
                <button onClick={handleLogout} className="px-4 py-2 text-red-500 font-bold border border-red-100 rounded-lg hover:bg-red-50">Sortie</button>
            </div>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
            <div className="bg-white p-8 rounded-3xl border shadow-xl flex flex-col items-center text-center cursor-pointer hover:shadow-2xl transition-all group" onClick={() => { setGameState({ ...gameState, gameId: Date.now().toString() }); setAppMode('game_active'); setCurrentScreen('splash'); }}>
                <div className="text-7xl mb-6 group-hover:scale-110 transition-transform">🌍</div>
                <h2 className="text-2xl font-black mb-2 uppercase">GeoSim 2000</h2>
                <p className="text-slate-400 text-sm mb-6">Nouveau millénaire, nouveaux défis. Prenez le pouvoir.</p>
                <button className="w-full py-4 bg-black text-white font-bold rounded-2xl shadow-lg group-hover:bg-blue-600 transition-colors">NOUVELLE PARTIE</button>
            </div>
            {availableSaves.length > 0 && (
                <div className="bg-white p-8 rounded-3xl border shadow-xl col-span-1 md:col-span-1 lg:col-span-2 overflow-y-auto max-h-[400px]">
                    <h2 className="text-xl font-black mb-6 uppercase text-slate-400 tracking-widest">Continuer les opérations</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {availableSaves.map(s => (
                            <div key={s.id} className="p-4 border rounded-2xl flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => loadGameById(s.id)}>
                                <div><div className="font-bold text-lg">{s.country}</div><div className="text-[10px] text-slate-400 uppercase tracking-widest">Tour {s.turn} • {s.date}</div></div>
                                <span className="text-blue-600 text-xl font-bold">➔</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    </div>
  );

  if (appMode === 'game_active') {
    if (currentScreen === 'splash') return (<div className="w-screen h-screen bg-white flex items-center justify-center animate-fade-in"><GameLogo /></div>);
    if (currentScreen === 'loading') return (<div className="w-screen h-screen bg-slate-900 flex flex-col items-center justify-center text-white"><div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden mb-4"><div className="h-full bg-blue-500 animate-[width_3s_ease-in-out]"></div></div><div className="text-[10px] uppercase tracking-[0.3em] font-bold animate-pulse">Initialisation Satellite...</div></div>);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
            <NewsTicker text={eventQueue.length > 0 ? eventQueue[0].headline : "Flux de données géopolitiques actif."} />
            <div className="absolute inset-0 z-0 pt-8"><WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} onRegionClick={(c) => { if(!gameState.playerCountry) { setPendingCountry(c); setShowStartModal(true); } }} focusCountry={focusCountry}/></div>
            {showStartModal && !gameState.playerCountry && (
                <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl animate-fade-in-up">
                        {!pendingCountry ? (<p className="font-bold text-slate-400 uppercase text-xs tracking-widest">Sélectionnez une nation sur la carte</p>) : (
                            <>
                                <h2 className="text-3xl font-black mb-2 uppercase tracking-tight">{pendingCountry}</h2>
                                <p className="text-slate-500 mb-8 text-sm">Prendre le commandement suprême ?</p>
                                <div className="flex gap-2">
                                    <button onClick={() => setPendingCountry(null)} className="flex-1 py-3 bg-stone-100 rounded-xl font-bold">Annuler</button>
                                    <button onClick={() => { setGameState({ ...gameState, playerCountry: pendingCountry }); setShowStartModal(false); setFocusCountry(pendingCountry); }} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-xl">Confirmer</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {gameState.playerCountry && (
                <>
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
            <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => setActiveWindow('none')} playerCountry={gameState.playerCountry!} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} onMarkRead={handleMarkRead}/>
            {isSettingsOpen && (
                <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                        <h3 className="text-2xl font-black mb-6 uppercase tracking-tight">Paramètres</h3>
                        <div className="space-y-4">
                            <button onClick={() => saveGame(gameState, fullHistory)} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg">Sauvegarder Cloud ☁️</button>
                            <button onClick={() => setAppMode('portal_dashboard')} className="w-full py-3 text-red-500 font-bold">Retour au QG</button>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-4 bg-black text-white font-bold rounded-xl">Reprendre</button>
                        </div>
                    </div>
                </div>
            )}
            {notification && (<div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] bg-stone-900 text-white px-6 py-2 rounded-full shadow-2xl font-bold text-xs animate-fade-in-down">{notification}</div>)}
        </div>
    );
  }
  return null;
};

export default App;
