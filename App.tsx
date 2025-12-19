
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

interface SaveMetadata {
    id: string; country: string; date: string; turn: number; lastPlayed: number;
}

type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';
type GameScreen = 'splash' | 'loading' | 'game';

const getInitialStats = (country: string): { power: number, corruption: number } => {
    const c = country.toLowerCase();
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni')) return { power: 65, corruption: 10 };
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number): number => Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
const isCountryLandlocked = (country: string): boolean => LANDLOCKED_COUNTRIES.some(c => country.includes(c));
const hasNuclearArsenal = (country: string): boolean => NUCLEAR_POWERS.some(c => country.includes(c));
const hasSpaceProgramInitial = (country: string): boolean => SPACE_POWERS.some(c => country.includes(c));
const clamp = (value: number): number => Math.max(0, Math.min(100, value));

const StatGauge = ({ label, value, color }: { label: string, value: number, color: string }) => (
    <div className="flex flex-col gap-1 w-12 md:w-16">
        <div className="flex justify-between items-center">
            <span className="font-bold text-stone-500 text-[7px] uppercase tracking-tighter truncate">{label}</span>
        </div>
        <div className="w-full h-2 bg-stone-800 rounded-full overflow-hidden border border-stone-700/30">
            <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${value}%` }}></div>
        </div>
    </div>
);

const GameLogo = ({ size = 'large', theme = 'dark' }: { size?: 'small' | 'large', theme?: 'dark' | 'light' }) => {
    const isLight = theme === 'light';
    return (
        <div className={`flex flex-col items-center justify-center ${size === 'large' ? 'gap-4' : 'gap-2'}`}>
            <div className={`relative flex items-center justify-center rounded-full border-2 ${isLight ? 'border-emerald-500 bg-white' : 'border-emerald-500 bg-black/80'} ${size === 'large' ? 'w-32 h-32' : 'w-12 h-12'}`}>
                <div className="absolute inset-0 rounded-full border border-emerald-500/30 overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-top-left bg-emerald-500/40 animate-[spin_2s_linear_infinite]" style={{ borderRadius: '100% 0 0 0' }}></div>
                </div>
            </div>
            <h1 className={`font-serif font-bold tracking-widest uppercase ${isLight ? 'text-slate-800' : 'text-white'} ${size === 'large' ? 'text-4xl' : 'text-xl'}`}>GeoSim</h1>
        </div>
    );
};

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>('portal_landing');
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('splash');
  const [notification, setNotification] = useState<string | null>(null);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false); 
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [tokenCount, setTokenCount] = useState(0); 
  const [user, setUser] = useState<any>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  
  const [gameState, setGameState] = useState<GameState>({
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], neutralTerritories: [],
    mapEntities: [], infrastructure: {}, turn: 1, events: [], isProcessing: false, globalTension: 20,
    economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false,
    hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null,
    isGameOver: false, gameOverReason: null
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
      if (!user || !db) return;
      const q = query(collection(db, "users", user.uid, "game_metas"));
      return onSnapshot(q, (snapshot) => {
            const saves: SaveMetadata[] = [];
            snapshot.forEach((doc) => saves.push(doc.data() as SaveMetadata));
            saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
            if (isMountedRef.current) setAvailableSaves(saves);
        });
  }, [user]); 

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') setTimeout(() => setCurrentScreen('loading'), 2500);
      if (appMode === 'game_active' && currentScreen === 'loading') setTimeout(() => setCurrentScreen('game'), 3000);
  }, [appMode, currentScreen]);

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
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

  const loadGameById = async (id: string) => {
      try {
          const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
          if (docSnap.exists()) {
              const data = docSnap.data();
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState(data.state);
              setFullHistory(data.history);
              setAiProvider(data.aiProvider || 'gemini');
              setTokenCount(data.tokenCount || 0);
              setEventQueue([]);
              setShowStartModal(false);
              setAppMode('game_active');
              setIsGameMenuOpen(false);
              setCurrentScreen('loading');
              
              const unread = data.state.chatHistory.some((m: ChatMessage) => !m.isRead && m.sender !== 'player');
              setHasUnreadChat(unread);
              
              showNotification("Partie chargée.");
          }
      } catch (e) { showNotification("Erreur chargement."); }
      setIsLoadMenuOpen(false);
  };

  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); }
  const handleExitToDashboard = () => { setIsGameMenuOpen(false); setAppMode('portal_dashboard'); };
  const openLoadMenu = () => setIsLoadMenuOpen(true);

  const handleMarkChatRead = (targets: string[]) => {
    setGameState(prev => {
        const sortedTargets = [...targets].sort().join(',');
        
        const newHistory = prev.chatHistory.map(msg => {
            if (msg.isRead || msg.sender === 'player') return msg;
            
            const raw = msg.sender === 'player' ? [...msg.targets] : [msg.senderName, ...msg.targets];
            const flat: string[] = [];
            raw.forEach(s => s.split(',').forEach(sub => flat.push(normalizeCountryName(sub.trim()))));
            const msgParticipants = Array.from(new Set(flat.filter(p => p !== prev.playerCountry && p !== ''))).sort().join(',');
            
            if (msgParticipants === sortedTargets) {
                return { ...msg, isRead: true };
            }
            return msg;
        });

        const globalUnread = newHistory.some(m => !m.isRead && m.sender !== 'player');
        setHasUnreadChat(globalUnread);
        
        return { ...prev, chatHistory: newHistory };
    });
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry || gameState.isGameOver) return;
    setActiveWindow('none');
    const allOrders = [...pendingOrders];
    if (playerInput.trim()) allOrders.push(playerInput.trim());
    const finalOrderString = allOrders.join("\n");
    const formattedDate = gameState.currentDate.toLocaleDateString('fr-FR');
    
    setGameState(prev => ({ ...prev, isProcessing: true }));
    
    const entitiesSummary = gameState.mapEntities.length > 0 ? gameState.mapEntities.map(e => `${e.type} en ${e.country}`).join('; ') : "Aucune installation.";
    const recentChat = gameState.chatHistory.slice(-5).map(m => `${m.senderName}: ${m.text}`).join(' | ');

    const result = await simulateTurn(
        gameState.playerCountry, formattedDate, finalOrderString, gameState.events,
        gameState.ownedTerritories, entitiesSummary, isCountryLandlocked(gameState.playerCountry),
        gameState.hasNuclear, recentChat, gameState.chaosLevel, aiProvider,
        gameState.militaryPower, gameState.alliance, gameState.neutralTerritories
    );

    if (result.tokenUsage) setTokenCount(prev => prev + result.tokenUsage!);

    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else if (result.timeIncrement === 'month') nextDate.setMonth(nextDate.getMonth() + 1);
    else nextDate.setDate(nextDate.getDate() + 1);

    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({
        id: `t-${gameState.turn}-${idx}`, date: nextDate.toLocaleDateString('fr-FR'),
        type: e.type, headline: e.headline, description: e.description, relatedCountry: e.relatedCountry
    }));

    let newOwned = [...gameState.ownedTerritories];
    let newNeutral = [...(gameState.neutralTerritories || [])];
    let newEntities = [...gameState.mapEntities];
    let newHasNuclear = gameState.hasNuclear;

    if (result.mapUpdates) {
        for (const update of result.mapUpdates) {
            const target = normalizeCountryName(update.targetCountry);
            if (update.type === 'annexation') {
                newNeutral = newNeutral.filter(t => t !== target);
                if (!newOwned.includes(target)) newOwned.push(target);
                if (hasNuclearArsenal(target)) newHasNuclear = true;
            } else if (update.type === 'dissolve') {
                newOwned = newOwned.filter(t => t !== target);
                if (!newNeutral.includes(target)) newNeutral.push(target);
            } else if (['build_base', 'build_air_base', 'build_defense'].includes(update.type)) {
                const typeMap: Record<string, MapEntityType> = { 
                    'build_base': 'military_base', 'build_air_base': 'air_base', 'build_defense': 'defense_system' 
                };
                newEntities.push({
                    id: `ent-${Date.now()}-${Math.random()}`, type: typeMap[update.type],
                    country: target, lat: update.lat || 0, lng: update.lng || 0, label: update.label
                });
            } else if (update.type === 'remove_entity') {
                newEntities = newEntities.filter(e => e.id !== update.entityId && e.label !== update.label);
            }
        }
    }

    const aiIncomingMessages = result.incomingMessages?.map(m => ({
        id: `im-${Date.now()}-${Math.random()}`, sender: 'ai' as const, senderName: m.sender,
        targets: [gameState.playerCountry!], text: m.text, timestamp: Date.now(), isRead: false
    })) || [];

    if (aiIncomingMessages.length > 0) {
        setHasUnreadChat(true);
    }

    const newGameState = {
        ...gameState, currentDate: nextDate, turn: gameState.turn + 1,
        ownedTerritories: newOwned, neutralTerritories: newNeutral,
        mapEntities: newEntities, hasNuclear: newHasNuclear, isProcessing: false,
        globalTension: clamp(gameState.globalTension + (result.globalTensionChange || 0)),
        economyHealth: clamp(gameState.economyHealth + (result.economyHealthChange || 0)),
        militaryPower: clamp(gameState.militaryPower + (result.militaryPowerChange || 0)),
        popularity: clamp(gameState.popularity + (result.popularityChange || 0)),
        corruption: clamp(gameState.corruption + (result.corruptionChange || 0)),
        chatHistory: [...gameState.chatHistory, ...aiIncomingMessages]
    };

    setGameState(newGameState);
    setEventQueue(newAiEvents);
    setFullHistory([...fullHistory, ...newAiEvents]);
    setPlayerInput(""); setPendingOrders([]);
    setActiveWindow('events');
    saveGame(newGameState, [...fullHistory, ...newAiEvents], false);
  };

  const handleRegionSelect = (region: string) => {
    if (!gameState.playerCountry) { setPendingCountry(region); setShowStartModal(true); }
  };

  const confirmCountrySelection = () => {
      if (pendingCountry) {
          const stats = getInitialStats(pendingCountry);
          setGameState(prev => ({ 
              ...prev, playerCountry: pendingCountry, ownedTerritories: [pendingCountry],
              militaryPower: stats.power, corruption: stats.corruption,
              hasNuclear: hasNuclearArsenal(pendingCountry),
              hasSpaceProgram: hasSpaceProgramInitial(pendingCountry),
              militaryRank: calculateRank(stats.power)
          }));
          setPendingCountry(null); setShowStartModal(false); setFocusCountry(pendingCountry);
      }
  };

  const handleAddOrder = () => {
    if (playerInput.trim()) {
      setPendingOrders(prev => [...prev, playerInput.trim()]);
      setPlayerInput("");
    }
  };

  const handleReadEvent = () => {
    setEventQueue(prev => prev.slice(1));
  };

  const handleGetSuggestions = async (): Promise<string[]> => {
    if (!gameState.playerCountry) return [];
    try {
        const res = await getStrategicSuggestions(gameState.playerCountry, fullHistory, aiProvider);
        setTokenCount(prev => prev + res.usage);
        return res.suggestions;
    } catch (e) {
        return ["Renforcer les frontières", "Développer l'économie"];
    }
  };

  const handleSendChatMessage = async (targets: string[], message: string) => {
    if (!gameState.playerCountry) return;
    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'player',
      senderName: gameState.playerCountry,
      targets,
      text: message,
      timestamp: Date.now(),
      isRead: true
    };
    setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, newMessage] }));
    setTypingParticipants(targets);
    try {
        const response = await sendDiplomaticMessage(
            gameState.playerCountry, targets, message, gameState.chatHistory,
            { tension: gameState.globalTension, power: gameState.militaryPower },
            aiProvider
        );
        setTokenCount(prev => prev + response.usage);
        const aiMessages: ChatMessage[] = response.messages.map((m, idx) => ({
            id: `aimsg-${Date.now()}-${idx}`, sender: 'ai', senderName: m.sender,
            targets: [gameState.playerCountry!], text: m.text, timestamp: Date.now(), isRead: false
        }));
        
        if (aiMessages.length > 0) setHasUnreadChat(true);

        setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, ...aiMessages] }));
    } catch (e) {
        console.error("Chat Error", e);
    } finally {
        setTypingParticipants([]);
    }
  };

  const launchGeoSim = () => {
    const newGameId = `game-${Date.now()}`;
    setGameState({
      gameId: newGameId, currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], neutralTerritories: [],
      mapEntities: [], infrastructure: {}, turn: 1, events: [], isProcessing: false, globalTension: 20,
      economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false,
      hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null,
      isGameOver: false, gameOverReason: null
    });
    setFullHistory([]); setEventQueue([]); setTokenCount(0); setHasUnreadChat(false);
    setShowStartModal(true); setAppMode('game_active'); setCurrentScreen('splash');
  };

  const toggleWindow = (win: any) => setActiveWindow(activeWindow === win ? 'none' : win);

  if (appMode === 'portal_landing') {
      return (
          <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-10">
              <GameLogo />
              <button onClick={() => user ? setAppMode('portal_dashboard') : setShowLoginModal(true)} className="px-10 py-4 bg-black text-white font-bold rounded-xl text-xl hover:scale-105 transition-transform">JOUER ➔</button>
              {showLoginModal && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                      <div className="bg-white p-6 rounded-2xl w-full max-w-sm">
                          <h2 className="text-xl font-bold mb-4">{isRegistering ? "Inscription" : "Connexion"}</h2>
                          <form onSubmit={(e) => { e.preventDefault(); isRegistering ? registerWithEmail(authEmail, authPassword) : loginWithEmail(authEmail, authPassword); }}>
                              <input type="email" placeholder="Email" className="w-full p-3 border mb-2 rounded" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
                              <input type="password" placeholder="Pass" className="w-full p-3 border mb-4 rounded" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
                              <button className="w-full py-3 bg-blue-600 text-white font-bold rounded">{isRegistering ? "S'inscrire" : "Se connecter"}</button>
                          </form>
                          <button onClick={() => setIsRegistering(!isRegistering)} className="w-full mt-2 text-blue-500 text-xs">{isRegistering ? "Déjà un compte ?" : "Créer un compte"}</button>
                          <button onClick={() => setShowLoginModal(false)} className="w-full mt-4 text-stone-400">Annuler</button>
                      </div>
                  </div>
              )}
          </div>
      );
  }

  if (appMode === 'portal_dashboard') {
      return (
          <div className="min-h-screen bg-stone-50 p-10">
              <div className="max-w-4xl mx-auto">
                  <h1 className="text-3xl font-black mb-10">POLITIKA HUB</h1>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-6 rounded-2xl border shadow-sm cursor-pointer hover:shadow-md" onClick={launchGeoSim}>
                          <h2 className="text-xl font-bold mb-4">NOUVELLE PARTIE</h2>
                          <div className="h-32 bg-stone-100 rounded-xl flex items-center justify-center text-3xl">🌍</div>
                      </div>
                      <div className="bg-white p-6 rounded-2xl border shadow-sm">
                          <h2 className="text-xl font-bold mb-4">SAUVEGARDES</h2>
                          <div className="space-y-2 overflow-y-auto max-h-48">
                              {availableSaves.map(s => (
                                  <div key={s.id} onClick={() => loadGameById(s.id)} className="p-2 border rounded hover:bg-stone-50 cursor-pointer flex justify-between">
                                      <span>{s.country}</span> <span className="text-xs text-stone-400">Tour {s.turn}</span>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
        <div className="absolute inset-0 z-0">
            <WorldMap 
              playerCountry={gameState.playerCountry} 
              ownedTerritories={gameState.ownedTerritories} 
              neutralTerritories={gameState.neutralTerritories} 
              mapEntities={gameState.mapEntities} 
              onRegionClick={handleRegionSelect} 
              focusCountry={focusCountry} 
              hasAlliance={!!gameState.alliance}
            />
        </div>

        {activeWindow !== 'none' && <div className="absolute inset-0 z-40" onClick={() => setActiveWindow('none')}></div>}

        {!gameState.isGameOver && gameState.playerCountry && (
            <>
                {/* HUD Jauges Gauche (Épaissi et labels mis à jour) */}
                <div className="absolute top-4 left-4 z-30 flex flex-col gap-2 pointer-events-none">
                    <div className="bg-stone-900/95 backdrop-blur-sm h-11 px-3 rounded-full border border-stone-700 shadow-2xl pointer-events-auto flex flex-row gap-2.5 items-center">
                        <StatGauge label="Tension" value={gameState.globalTension} color="bg-red-500" />
                        <StatGauge label="Economie" value={gameState.economyHealth} color="bg-emerald-500" />
                        <StatGauge label="Armée" value={gameState.militaryPower} color="bg-blue-500" />
                        <StatGauge label="Population" value={gameState.popularity} color="bg-purple-500" />
                        <StatGauge label="Corruption" value={gameState.corruption} color="bg-orange-500" />
                        <div className="h-4 w-px bg-stone-700 mx-0.5"></div>
                        <div className="flex items-center gap-1.5">
                            {gameState.hasNuclear && <span className="text-yellow-500 text-[10px] animate-pulse">☢️</span>}
                            {gameState.alliance && <span className="text-indigo-400 text-[10px]">🛡️</span>}
                        </div>
                    </div>
                </div>

                {/* HUD Profil Droite (Même hauteur, aligné) */}
                <div className="absolute top-4 right-4 z-30 flex flex-row items-center gap-2 pointer-events-none">
                    <div className="bg-stone-900/95 backdrop-blur-sm h-11 pl-4 pr-2 rounded-full border border-stone-700 shadow-2xl pointer-events-auto flex items-center gap-3">
                        <div className="flex flex-col items-end">
                             <div className="text-emerald-400 text-[7px] font-mono px-1 rounded bg-black/50 border border-emerald-900/30">T:{tokenCount}</div>
                        </div>
                        <div className="flex flex-col items-end cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setIsGameMenuOpen(true)}>
                            <span className="text-[6px] text-stone-500 uppercase font-black leading-none mb-0.5 tracking-tighter">PRÉSIDENT</span>
                            <span className="text-[10px] font-black text-white leading-none uppercase truncate max-w-[80px]">{gameState.playerCountry}</span>
                        </div>
                        <img src={getFlagUrl(gameState.playerCountry)} className="w-8 h-8 rounded-full border border-stone-700 object-cover cursor-pointer" onClick={() => setIsGameMenuOpen(true)} />
                    </div>
                </div>
                
                {/* GAME MENU (CENTRE AU MILIEU) */}
                {isGameMenuOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsGameMenuOpen(false)}>
                        <div className="bg-stone-900 border border-stone-600 shadow-2xl rounded-2xl p-6 w-full max-w-xs flex flex-col gap-5" onClick={e => e.stopPropagation()}>
                            <div className="text-center">
                                <h2 className="text-lg font-black text-white uppercase tracking-widest">Menu du Jeu</h2>
                            </div>
                            <div>
                                <h3 className="text-[9px] font-bold text-stone-500 uppercase mb-2">Moteur IA</h3>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {(['gemini', 'groq', 'huggingface'] as AIProvider[]).map(p => (
                                        <button key={p} onClick={() => setAiProvider(p)} className={`p-1.5 rounded text-[9px] font-bold uppercase border ${aiProvider === p ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-stone-800 text-stone-400 border-stone-700 hover:bg-stone-700'}`}>{p}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => { saveGame(gameState, fullHistory); setIsGameMenuOpen(false); }} className="w-full py-2.5 bg-blue-600 text-white font-bold rounded-lg text-xs">💾 Sauvegarder</button>
                                <button onClick={() => { setIsGameMenuOpen(false); openLoadMenu(); }} className="w-full py-2.5 bg-stone-700 text-stone-200 font-bold rounded-lg text-xs">📂 Charger partie</button>
                                <button onClick={() => setIsGameMenuOpen(false)} className="w-full py-2.5 bg-white text-stone-900 font-bold rounded-lg text-xs">Reprendre</button>
                                <button onClick={handleExitToDashboard} className="w-full py-2.5 bg-red-900/40 text-red-200 font-bold rounded-lg border border-red-900 text-xs">Quitter vers Politika</button>
                            </div>
                        </div>
                    </div>
                )}
                
                {isLoadMenuOpen && (
                    <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4" onClick={() => setIsLoadMenuOpen(false)}>
                        <div className="bg-stone-900 p-6 rounded-2xl w-full max-w-sm border border-stone-700 shadow-2xl" onClick={e => e.stopPropagation()}>
                            <h2 className="text-white font-bold mb-4 uppercase text-center">Sauvegardes</h2>
                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-hide">
                                {availableSaves.length === 0 ? <p className="text-stone-500 text-xs text-center py-4">Aucune sauvegarde.</p> : availableSaves.map(s => <div key={s.id} onClick={() => loadGameById(s.id)} className="p-3 bg-stone-800 text-white rounded-lg cursor-pointer hover:bg-stone-700 border border-stone-700 flex justify-between items-center"><span className="text-xs font-bold">{s.country}</span><span className="text-[10px] text-stone-500">T:{s.turn}</span></div>)}
                            </div>
                        </div>
                    </div>
                )}

                <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing} />
                <EventLog isOpen={activeWindow === 'events'} onClose={() => toggleWindow('events')} eventQueue={eventQueue} onReadEvent={() => eventQueue.length > 0 ? handleReadEvent() : setActiveWindow('none')} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={handleAddOrder} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={handleGetSuggestions} turn={gameState.turn} />
                <HistoryLog isOpen={activeWindow === 'history'} onClose={() => toggleWindow('history')} history={fullHistory} />
                <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => toggleWindow('chat')} playerCountry={gameState.playerCountry} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} typingParticipants={typingParticipants} onMarkRead={handleMarkChatRead} />
                
                <div className="absolute bottom-6 left-6 z-30 flex gap-2">
                    <button onClick={() => toggleWindow('events')} className="bg-white text-stone-800 px-4 py-2 rounded-xl border shadow font-bold text-sm h-12 flex items-center gap-2"><span>✍️</span> Ordres {eventQueue.length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{eventQueue.length}</span>}</button>
                    <button onClick={() => toggleWindow('chat')} className="bg-stone-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-stone-600 relative">💬 {hasUnreadChat && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-bounce"></span>}</button>
                    <button onClick={() => toggleWindow('history')} className="bg-stone-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-stone-600">📚</button>
                </div>
            </>
        )}

        {showStartModal && !gameState.playerCountry && !pendingCountry && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-start pt-24 pointer-events-none p-4">
                <div className="bg-white/95 p-4 rounded-xl max-w-sm w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto transform scale-90">
                    <h2 className="text-lg font-bold text-stone-800 mb-2">Sélectionnez votre nation</h2>
                    <p className="text-sm text-stone-600 italic">Touchez un pays sur la carte pour en prendre le contrôle.</p>
                </div>
            </div>
        )}

        {pendingCountry && !gameState.playerCountry && (
            <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
                <div className="bg-white/95 p-4 rounded-xl max-w-xs w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto">
                    <h3 className="text-2xl font-serif font-bold text-blue-800 mb-4 uppercase tracking-tighter">{pendingCountry}</h3>
                    <div className="flex gap-2">
                        <button onClick={() => setPendingCountry(null)} className="flex-1 py-2 border rounded font-bold hover:bg-stone-100 text-xs">Annuler</button>
                        <button onClick={confirmCountrySelection} className="flex-1 py-2 bg-blue-600 text-white rounded font-bold shadow text-xs uppercase">Confirmer</button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}

export default App;
