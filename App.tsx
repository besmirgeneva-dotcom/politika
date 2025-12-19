
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

const getInitialStats = (country: string) => {
    const c = country.toLowerCase();
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni')) return { power: 65, corruption: 10 };
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number) => Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));

const GameLogo = ({ size = 'large', theme = 'dark' }: { size?: 'small' | 'large', theme?: 'dark' | 'light' }) => {
    const isLight = theme === 'light';
    return (
        <div className={`flex flex-col items-center justify-center ${size === 'large' ? 'gap-4' : 'gap-2'}`}>
            <div className={`relative flex items-center justify-center rounded-full border-2 ${isLight ? 'border-emerald-500 bg-white shadow-xl' : 'border-emerald-500 bg-black/80 shadow-[0_0_20px_rgba(16,185,129,0.5)]'} ${size === 'large' ? 'w-32 h-32' : 'w-12 h-12'}`}>
                <div className="absolute inset-0 rounded-full border border-emerald-500/30 overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-top-left bg-gradient-to-r from-transparent to-emerald-500/40 animate-[spin_2s_linear_infinite]" style={{ borderRadius: '100% 0 0 0' }}></div>
                </div>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
            </div>
            <h1 className={`font-serif font-bold tracking-widest uppercase ${isLight ? 'text-slate-800' : 'text-white'} ${size === 'large' ? 'text-4xl' : 'text-xl'}`}>GeoSim</h1>
        </div>
    );
};

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>('portal_landing');
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('splash');
  const [tokenCount, setTokenCount] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');

  const [gameState, setGameState] = useState<GameState>({
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], neutralTerritories: [], mapEntities: [], infrastructure: {}, turn: 1, events: [], isProcessing: false, globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false, hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null
  });

  const [eventQueue, setEventQueue] = useState<GameEvent[]>([]);
  const [fullHistory, setFullHistory] = useState<GameEvent[]>([]);
  const [activeWindow, setActiveWindow] = useState<'none' | 'events' | 'history' | 'chat' | 'alliance'>('none');
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [focusCountry, setFocusCountry] = useState<string | null>(null);
  const [playerInput, setPlayerInput] = useState("");
  const [pendingOrders, setPendingOrders] = useState<string[]>([]); 
  const [showStartModal, setShowStartModal] = useState(true);
  const [pendingCountry, setPendingCountry] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((u) => {
        setUser(u);
        if (u) { setAppMode('portal_dashboard'); setShowLoginModal(false); }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && db) {
        const q = query(collection(db, "users", user.uid, "game_metas"));
        return onSnapshot(q, (snapshot) => {
            const saves: SaveMetadata[] = [];
            snapshot.forEach((doc) => saves.push(doc.data() as SaveMetadata));
            setAvailableSaves(saves.sort((a, b) => b.lastPlayed - a.lastPlayed));
        });
    }
  }, [user]);

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) return;
      const metadata: SaveMetadata = { id: state.gameId, country: state.playerCountry || "Inconnu", date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now() };
      const sanitizedData = JSON.parse(JSON.stringify({ metadata, state, history, aiProvider, tokenCount }));
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), sanitizedData);
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Cloud Sync OK");
      } catch (e) {}
  };

  const loadGameById = async (id: string) => {
      if (!user || !db) return;
      try {
          const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
          if (docSnap.exists()) {
              const data = docSnap.data();
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState({ ...gameState, ...data.state });
              setFullHistory(data.history);
              if (data.tokenCount) setTokenCount(data.tokenCount);
              setAppMode('game_active');
              setCurrentScreen('loading');
              setTimeout(() => setCurrentScreen('game'), 2000);
          }
      } catch (e) {}
  };

  const launchGeoSim = () => {
      setGameState({ gameId: Date.now().toString(), currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], neutralTerritories: [], mapEntities: [], infrastructure: {}, turn: 1, events: [], isProcessing: false, globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false, hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null });
      setFullHistory([]); setEventQueue([]); setShowStartModal(true); setAppMode('game_active'); setCurrentScreen('splash'); setTokenCount(0);
      setTimeout(() => setCurrentScreen('loading'), 2000);
      setTimeout(() => setCurrentScreen('game'), 4000);
  };

  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };
  const handleExitToDashboard = () => setAppMode('portal_dashboard');
  const handleLogout = async () => { await logout(); setAppMode('portal_landing'); };

  const handleSendChatMessage = async (targets: string[], message: string) => {
      if (!gameState.playerCountry) return;
      const userMsg: ChatMessage = { id: `msg-${Date.now()}`, sender: 'player', senderName: gameState.playerCountry, targets, text: message, timestamp: Date.now(), isRead: true };
      setGameState(prev => ({ ...prev, isProcessing: true, chatHistory: [...prev.chatHistory, userMsg] }));
      try {
        const aiResponses = await sendDiplomaticMessage(gameState.playerCountry!, targets, message, [...gameState.chatHistory, userMsg], {}, aiProvider);
        let tkUsed = 0;
        const newMessages: ChatMessage[] = aiResponses.map(resp => {
            tkUsed = resp.tokens;
            return { id: `msg-${Date.now()}-${resp.sender}`, sender: 'ai', senderName: resp.sender, targets, text: resp.text, timestamp: Date.now(), isRead: false };
        });
        setTokenCount(prev => prev + tkUsed);
        setGameState(prev => ({ ...prev, isProcessing: false, chatHistory: [...prev.chatHistory, ...newMessages] }));
        setHasUnreadChat(true);
      } catch (e) { setGameState(prev => ({ ...prev, isProcessing: false })); }
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry) return;
    setActiveWindow('none');
    setGameState(prev => ({ ...prev, isProcessing: true }));
    const formattedDate = gameState.currentDate.toLocaleDateString('fr-FR');
    const result = await simulateTurn(gameState.playerCountry, formattedDate, playerInput, gameState.events, gameState.ownedTerritories, "", false, gameState.hasNuclear, "", gameState.chaosLevel, aiProvider, gameState.militaryPower, gameState.alliance);
    if (result.tokenUsage) setTokenCount(prev => prev + result.tokenUsage!);
    const nextDate = new Date(gameState.currentDate);
    nextDate.setMonth(nextDate.getMonth() + 1);
    const newGameState = { ...gameState, currentDate: nextDate, turn: gameState.turn + 1, globalTension: Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange)), economyHealth: Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange)), militaryPower: Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange)), popularity: Math.max(0, Math.min(100, gameState.popularity + (result.popularityChange || 0))), isProcessing: false };
    setGameState(newGameState);
    setPlayerInput("");
    saveGame(newGameState, fullHistory, false);
  };

  if (appMode === 'portal_landing') {
    return (
      <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col items-center justify-center p-6 text-center">
          <GameLogo size="large" theme="light" />
          <h2 className="text-4xl font-black mt-8 tracking-tighter">RÉÉCRIVEZ L'HISTOIRE.</h2>
          <p className="text-slate-500 mt-4 max-w-md">Prenez les commandes d'une nation en l'an 2000 et affrontez le monde simulé par IA.</p>
          <button onClick={() => setShowLoginModal(true)} className="mt-10 px-10 py-4 bg-blue-600 text-white font-bold rounded-xl shadow-xl hover:scale-105 transition-transform">COMMENCER LA MISSION</button>
          
          {showLoginModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
                  <h3 className="text-2xl font-bold mb-6">{isRegistering ? "Créer un compte" : "Connexion"}</h3>
                  <input type="email" placeholder="Email" className="w-full p-3 border rounded-lg mb-3" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
                  <input type="password" placeholder="Mot de passe" className="w-full p-3 border rounded-lg mb-6" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
                  <button onClick={async () => { try { isRegistering ? await registerWithEmail(authEmail, authPassword) : await loginWithEmail(authEmail, authPassword); } catch (e) { showNotification("Erreur Auth"); } }} className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg mb-3">VALIDER</button>
                  <button onClick={handleGoogleLogin} className="w-full py-3 border border-slate-300 font-bold rounded-lg flex items-center justify-center gap-2 mb-4"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt=""/>Google</button>
                  <button onClick={() => setIsRegistering(!isRegistering)} className="text-sm text-blue-600 font-bold">{isRegistering ? "Déjà un compte ? Se connecter" : "Pas de compte ? S'inscrire"}</button>
                  <button onClick={() => setShowLoginModal(false)} className="block w-full mt-6 text-slate-400">Annuler</button>
               </div>
            </div>
          )}
      </div>
    );
  }

  if (appMode === 'portal_dashboard') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
          <header className="bg-white border-b p-4 flex justify-between items-center px-8">
              <div className="flex items-center gap-3"><GameLogo size="small" theme="light" /><span className="font-black uppercase tracking-tight">Politika QG</span></div>
              <div className="flex items-center gap-4">
                  <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                      <span className="text-[10px] font-mono font-bold text-emerald-700">TOTAL_TOKENS: {tokenCount}</span>
                  </div>
                  <button onClick={handleLogout} className="text-red-500 font-bold text-sm">Déconnexion</button>
              </div>
          </header>
          <main className="p-10 max-w-6xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="md:col-span-2 space-y-6">
                  <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200">
                      <h2 className="text-3xl font-black mb-2">NOUVELLE MISSION</h2>
                      <p className="text-slate-400 mb-8">Initialisez une simulation géopolitique globale.</p>
                      <button onClick={launchGeoSim} className="w-full py-5 bg-blue-600 text-white font-black text-xl rounded-2xl shadow-lg hover:bg-blue-700 transition-colors">🚀 INITIALISER GEOSIM</button>
                  </div>
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
                      <h3 className="font-bold text-lg mb-6">Sauvegardes Cloud</h3>
                      <div className="space-y-3">
                          {availableSaves.map(s => (
                              <div key={s.id} onClick={() => loadGameById(s.id)} className="p-4 border rounded-xl hover:border-blue-400 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-all">
                                  <div className="flex items-center gap-4"><img src={getFlagUrl(s.country) || ''} className="w-10 h-6 object-cover rounded shadow-sm" alt="" /><div><div className="font-bold">{s.country}</div><div className="text-[10px] text-slate-400">Tour {s.turn} • {s.date}</div></div></div>
                                  <div className="text-blue-600 font-black text-xs uppercase">Charger</div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
              <div className="space-y-6">
                  <div className="bg-stone-900 p-6 rounded-3xl text-white shadow-xl">
                      <h3 className="text-[10px] uppercase font-bold text-stone-500 tracking-widest mb-4">Statut Système</h3>
                      <div className="space-y-2 text-sm font-mono"><div className="flex justify-between"><span>SATELLITE</span><span className="text-emerald-400">ONLINE</span></div><div className="flex justify-between"><span>IA_CORE</span><span className="text-blue-400">{aiProvider.toUpperCase()}</span></div></div>
                  </div>
              </div>
          </main>
      </div>
    );
  }

  if (appMode === 'game_active') {
    if (currentScreen !== 'game') return <div className="w-screen h-screen bg-stone-950 flex flex-col items-center justify-center text-emerald-500 font-mono"><GameLogo size="large" theme="dark" /><div className="mt-10 animate-pulse tracking-widest uppercase text-sm">Synchronisation Satellite en cours...</div></div>;

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
            <div className="absolute inset-0 z-0">
                <WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} neutralTerritories={gameState.neutralTerritories} mapEntities={gameState.mapEntities} onRegionClick={(r) => { if (!gameState.playerCountry) { setPendingCountry(r); setShowStartModal(true); } }} focusCountry={focusCountry} />
            </div>

            {/* TOP RIGHT HUD - TOKEN COUNTER NEXT TO PROFILE */}
            <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
                <div className="bg-black/80 backdrop-blur-md border border-emerald-900/50 px-3 py-2 rounded-lg flex items-center gap-2 shadow-2xl">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]"></div>
                    <span className="text-[10px] font-mono text-emerald-400 font-bold tracking-tighter">TOKENS: {tokenCount.toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-2">
                    {user && (
                        <div className="w-9 h-9 rounded-full border-2 border-white/20 overflow-hidden shadow-lg">
                            {user.photoURL ? <img src={user.photoURL} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-stone-800 text-white flex items-center justify-center font-bold">{user.email ? user.email[0].toUpperCase() : 'U'}</div>}
                        </div>
                    )}
                    <button onClick={() => setIsSettingsOpen(true)} className="bg-stone-900/90 text-white px-4 py-2 rounded-lg border border-stone-700 shadow-xl backdrop-blur-md font-bold text-sm flex items-center gap-2">
                        {gameState.playerCountry && <img src={getFlagUrl(gameState.playerCountry) || ''} className="w-5 h-3 object-cover rounded" alt="" />}
                        {gameState.playerCountry || "Mandat"}
                    </button>
                </div>
            </div>

            {/* LEFT HUD - STATS */}
            {gameState.playerCountry && (
                <div className="absolute top-4 left-4 z-20 flex gap-4 bg-stone-900/90 p-3 rounded-xl border border-stone-700 shadow-xl backdrop-blur-md">
                    <div className="flex flex-col gap-1 w-16"><span className="text-[9px] uppercase text-stone-400 font-bold">Pop.</span><div className="w-full h-1 bg-stone-700 rounded-full overflow-hidden"><div className="h-full bg-pink-500" style={{width: `${gameState.popularity}%`}}></div></div></div>
                    <div className="flex flex-col gap-1 w-16"><span className="text-[9px] uppercase text-stone-400 font-bold">Eco.</span><div className="w-full h-1 bg-stone-700 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{width: `${gameState.economyHealth}%`}}></div></div></div>
                    <div className="flex flex-col gap-1 w-16"><span className="text-[9px] uppercase text-stone-400 font-bold">Mil.</span><div className="w-full h-1 bg-stone-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{width: `${gameState.militaryPower}%`}}></div></div></div>
                </div>
            )}

            {/* ACTION MODALS */}
            {pendingCountry && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm">
                        <div className="text-4xl mb-4">🌍</div>
                        <h3 className="text-2xl font-bold mb-2">{pendingCountry}</h3>
                        <p className="text-slate-500 mb-6">Confirmez-vous la prise de mandat pour cette nation ?</p>
                        <div className="flex gap-3">
                            <button onClick={() => setPendingCountry(null)} className="flex-1 py-3 border rounded-xl font-bold">Annuler</button>
                            <button onClick={() => { setGameState(p => ({ ...p, playerCountry: pendingCountry, ownedTerritories: [pendingCountry!] })); setPendingCountry(null); setFocusCountry(pendingCountry); }} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg">Confirmer</button>
                        </div>
                    </div>
                </div>
            )}

            <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={() => setEventQueue(q => q.slice(1))} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={() => { if(playerInput) setPendingOrders(o => [...o, playerInput]); setPlayerInput(""); }} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={async () => { const res = await getStrategicSuggestions(gameState.playerCountry!, fullHistory, aiProvider); setTokenCount(prev => prev + res.tokens); return res.suggestions; }} turn={gameState.turn} />
            <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => setActiveWindow('none')} playerCountry={gameState.playerCountry || "Moi"} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} onMarkRead={(t) => setHasUnreadChat(false)} />
            <HistoryLog isOpen={activeWindow === 'history'} onClose={() => setActiveWindow('none')} history={fullHistory} />

            <div className="absolute bottom-6 left-6 z-20 flex gap-4">
                <button onClick={() => setActiveWindow(activeWindow === 'events' ? 'none' : 'events')} className="w-14 h-14 bg-white rounded-full shadow-2xl border-2 flex items-center justify-center text-2xl hover:scale-110 transition-transform">📝</button>
                <button onClick={() => setActiveWindow(activeWindow === 'chat' ? 'none' : 'chat')} className="w-14 h-14 bg-white rounded-full shadow-2xl border-2 flex items-center justify-center text-2xl hover:scale-110 transition-transform relative">💬{hasUnreadChat && <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-bounce"></span>}</button>
                <button onClick={() => setActiveWindow(activeWindow === 'history' ? 'none' : 'history')} className="w-14 h-14 bg-white rounded-full shadow-2xl border-2 flex items-center justify-center text-2xl hover:scale-110 transition-transform">📚</button>
            </div>

            <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing} />

            {isSettingsOpen && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white p-8 rounded-3xl w-full max-w-sm shadow-2xl">
                        <h3 className="font-black text-2xl mb-6">PARAMÈTRES</h3>
                        <button onClick={() => { saveGame(gameState, fullHistory, true); setIsSettingsOpen(false); }} className="w-full py-4 bg-emerald-600 text-white font-bold rounded-xl mb-3 shadow-lg">☁️ SAUVEGARDER CLOUD</button>
                        <button onClick={handleExitToDashboard} className="w-full py-4 bg-red-100 text-red-600 font-bold rounded-xl mb-6">QUITTER LA MISSION</button>
                        <button onClick={() => setIsSettingsOpen(false)} className="w-full py-3 text-slate-400 font-bold">Retour</button>
                    </div>
                </div>
            )}
        </div>
    );
  }
  return null;
};

const handleGoogleLogin = async () => { try { await loginWithGoogle(); } catch (e) {} };

export default App;
