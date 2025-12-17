
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

// --- TYPES FOR SAVE SYSTEM ---
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

const isCountryLandlocked = (country: string): boolean => {
    return LANDLOCKED_COUNTRIES.some(c => country.includes(c));
}

const hasNuclearArsenal = (country: string): boolean => {
    return NUCLEAR_POWERS.some(c => country.includes(c));
}

const hasSpaceProgramInitial = (country: string): boolean => {
    return SPACE_POWERS.some(c => country.includes(c));
}

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
    gameId: '',
    currentDate: INITIAL_DATE,
    playerCountry: null,
    ownedTerritories: [],
    mapEntities: [],
    turn: 1,
    events: [],
    isProcessing: false,
    globalTension: 20,
    economyHealth: 50,
    militaryPower: 50,
    popularity: 60,
    corruption: 30,
    hasNuclear: false,
    hasSpaceProgram: false,
    militaryRank: 100,
    chatHistory: [],
    chaosLevel: 'normal',
    alliance: null,
    isGameOver: false,
    gameOverReason: null
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
        if (u) {
            setAppMode('portal_dashboard');
            setShowLoginModal(false);
        } else {
            setAppMode('portal_landing');
            setAvailableSaves([]);
            setHasSave(false);
        }
    });
    return () => {
        isMountedRef.current = false;
        unsubscribe();
    };
  }, []);

  useEffect(() => {
      if (!user || !db) {
          setAvailableSaves([]);
          setIsSyncing(false);
          return;
      }
      setIsSyncing(true);
      const q = query(collection(db, "users", user.uid, "game_metas"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
            const saves: SaveMetadata[] = [];
            snapshot.forEach((doc) => { saves.push(doc.data() as SaveMetadata); });
            saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
            if (isMountedRef.current) {
                setAvailableSaves(saves);
                setHasSave(saves.length > 0);
                setIsSyncing(false);
            }
        }, (error) => {
            if (isMountedRef.current) setIsSyncing(false);
        }
      );
      return () => unsubscribe();
  }, [user]); 

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') {
        const timer = setTimeout(() => { setCurrentScreen('loading'); }, 2500);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'loading') {
        const timer = setTimeout(() => { setCurrentScreen('game'); }, 3000);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) {
          if (!user) setShowLoginModal(true);
          return;
      }
      const metadata: SaveMetadata = {
          id: state.gameId,
          country: state.playerCountry || "Inconnu",
          date: state.currentDate.toLocaleDateString('fr-FR'),
          turn: state.turn,
          lastPlayed: Date.now()
      };
      const fullData = { metadata, state, history, aiProvider };
      const sanitizedData = JSON.parse(JSON.stringify(fullData));
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), sanitizedData);
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
      } catch (e) {
          showNotification("Échec Sauvegarde Cloud");
      }
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
      if (isGlobalLoading) return; 
      setIsGlobalLoading(true); 
      let data: any = null;
      if (user && db) {
          try {
              const docSnap = await getDoc(doc(db, "users", user.uid, "games", id));
              if (docSnap.exists()) data = docSnap.data();
          } catch (e) {
              showNotification("Erreur de chargement");
              setIsGlobalLoading(false);
              return;
          }
      }
      if (data) {
          data.state.currentDate = new Date(data.state.currentDate);
          setGameState(data.state);
          setFullHistory(data.history);
          if (data.aiProvider) setAiProvider(data.aiProvider);
          setEventQueue([]);
          setShowStartModal(false);
          setAppMode('game_active');
          setCurrentScreen('loading');
          setIsGlobalLoading(false); 
          showNotification(`Partie chargée: ${data.state.playerCountry}`);
      } else {
          showNotification("Données introuvables.");
          setIsGlobalLoading(false); 
      }
      setIsSettingsOpen(false);
      setIsLoadMenuOpen(false);
  };

  const showNotification = (msg: string) => {
      setNotification(msg);
      setTimeout(() => setNotification(null), 3000); 
  }

  const handleExitToDashboard = () => {
      setIsSettingsOpen(false);
      setAppMode('portal_dashboard');
      setIsGlobalLoading(false); 
  };

  const handleGoogleLogin = async () => { try { await loginWithGoogle(); } catch (e) {} };
  const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          if (isRegistering) await registerWithEmail(authEmail, authPassword);
          else await loginWithEmail(authEmail, authPassword);
      } catch (err: any) { showNotification("Erreur d'authentification."); }
  };
  const handleLogout = async () => { await logout(); setAppMode('portal_landing'); };
  const handleLogin = () => { setAppMode('portal_landing'); setShowLoginModal(true); };

  const handleSendBugReport = async () => {
      if (!bugTitle.trim() || !bugDescription.trim()) return;
      setIsSendingBug(true);
      try {
          if (db) {
              await addDoc(collection(db, "bug_reports"), {
                  title: bugTitle, description: bugDescription, userEmail: user?.email, userId: user?.uid, timestamp: Date.now(), status: 'new'
              });
          }
          showNotification("Signalement envoyé");
      } catch (e) { showNotification("Erreur d'envoi"); } finally {
          setIsSendingBug(false); setShowBugReportModal(false); setBugTitle(""); setBugDescription("");
      }
  };

  const launchGeoSim = () => {
      setGameState({
        gameId: Date.now().toString(), currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], turn: 1, events: [], isProcessing: false, globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30, hasNuclear: false, hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null
      });
      setFullHistory([]); setEventQueue([]); setShowStartModal(true); setAppMode('game_active'); setCurrentScreen('splash'); 
  };

  useEffect(() => {
    if (appMode === 'game_active' && currentScreen === 'game' && gameState.playerCountry && fullHistory.length === 0 && gameState.turn === 1) {
        const initialEvent: GameEvent = {
            id: 'init-1', date: INITIAL_DATE.toLocaleDateString('fr-FR'), type: 'world', headline: "Passage à l'an 2000", description: `Le monde entre dans un nouveau millénaire pour ${gameState.playerCountry}.`
        };
        setEventQueue([initialEvent]);
        setActiveWindow('events');
        setGameState(prev => {
            const hasNuke = hasNuclearArsenal(prev.playerCountry!);
            const hasSpace = hasSpaceProgramInitial(prev.playerCountry!);
            const stats = getInitialStats(prev.playerCountry!);
            const initialAlliance = NATO_MEMBERS_2000.includes(prev.playerCountry!) ? { name: "OTAN", type: "Alliance Militaire & Nucléaire", members: NATO_MEMBERS_2000, leader: "États-Unis" } : null;
            const newState = { ...prev, ownedTerritories: [prev.playerCountry!], militaryPower: stats.power, corruption: stats.corruption, hasNuclear: hasNuke, hasSpaceProgram: hasSpace, militaryRank: calculateRank(stats.power), alliance: initialAlliance };
            saveGame(newState, [], false);
            return newState;
        });
        setFocusCountry(gameState.playerCountry);
    }
  }, [gameState.playerCountry, currentScreen, appMode]);

  const handleReadEvent = () => {
    if (eventQueue.length === 0) return;
    const eventToArchive = eventQueue[0];
    const newQueue = eventQueue.slice(1);
    setFullHistory(prev => [...prev, eventToArchive]);
    setGameState(prev => {
        const updatedEvents = [...prev.events, eventToArchive];
        if (updatedEvents.length > 10) updatedEvents.shift(); 
        return { ...prev, events: updatedEvents };
    });
    setEventQueue(newQueue);
  };

  const handleAddOrder = () => {
      if (!playerInput.trim()) return;
      setPendingOrders(prev => [...prev, playerInput.trim()]);
      setPlayerInput("");
  };

  const handleGetSuggestions = async () => {
      if (!gameState.playerCountry) return [];
      return await getStrategicSuggestions(gameState.playerCountry, fullHistory, aiProvider);
  }

  const handleSendChatMessage = async (targets: string[], message: string) => {
      if (!gameState.playerCountry) return;
      const userMsg: ChatMessage = { id: `msg-${Date.now()}-p`, sender: 'player', senderName: gameState.playerCountry, targets: targets, text: message, timestamp: Date.now(), isRead: true };
      setGameState(prev => ({ ...prev, isProcessing: true, chatHistory: [...prev.chatHistory, userMsg] }));
      setTypingParticipants(targets);
      try {
        const aiPromises = targets.map(async (targetCountry) => {
            const responseText = await sendDiplomaticMessage(gameState.playerCountry!, targetCountry, targets, message, [...gameState.chatHistory, userMsg], { militaryPower: gameState.militaryPower, economyHealth: gameState.economyHealth, globalTension: gameState.globalTension, hasNuclear: gameState.hasNuclear }, aiProvider);
            setTypingParticipants(prev => prev.filter(p => p !== targetCountry));
            if (!responseText) return null;
            return { id: `msg-${Date.now()}-${targetCountry}`, sender: 'ai', senderName: targetCountry, targets: targets, text: responseText, timestamp: Date.now() + Math.floor(Math.random() * 500), isRead: false } as ChatMessage;
        });
        const aiResponses = await Promise.all(aiPromises);
        const validResponses = aiResponses.filter(r => r !== null) as ChatMessage[];
        setGameState(prev => ({ ...prev, isProcessing: false, chatHistory: [...prev.chatHistory, ...validResponses] }));
        if (validResponses.length > 0) setHasUnreadChat(true);
      } catch (e) {
          setTypingParticipants([]); setGameState(prev => ({ ...prev, isProcessing: false }));
      }
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
    const formattedDate = gameState.currentDate.toLocaleDateString('fr-FR');
    const playerEvent: GameEvent = { id: `turn-${gameState.turn}-player`, date: formattedDate, type: 'player', headline: 'Décrets émis', description: finalOrderString || "Maintien de l'ordre." };

    setGameState(prev => ({ ...prev, isProcessing: true }));

    const entityDesc = gameState.mapEntities.map(e => `${e.label || e.type} en ${e.country}`);
    const result = await simulateTurn(
        gameState.playerCountry, formattedDate, finalOrderString, gameState.events, gameState.ownedTerritories, entityDesc, isCountryLandlocked(gameState.playerCountry), gameState.hasNuclear, gameState.chatHistory.slice(-10).map(m => `${m.senderName}: ${m.text}`).join(' | '), gameState.chaosLevel, aiProvider, gameState.militaryPower
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
    let cameraTarget = gameState.playerCountry;

    if (result.mapUpdates) {
        for (const update of result.mapUpdates) {
            if (update.type === 'annexation') {
                const target = update.targetCountry;
                const newOwner = update.newOwner || gameState.playerCountry;
                if (newOwnedTerritories.includes(target) && newOwner !== gameState.playerCountry) newOwnedTerritories = newOwnedTerritories.filter(t => t !== target);
                if (newOwner === gameState.playerCountry && !newOwnedTerritories.includes(target)) {
                    newOwnedTerritories.push(target);
                    if (hasNuclearArsenal(target)) newHasNuclear = true;
                }
            } else if (update.type === 'remove_entity') {
                newEntities = newEntities.filter(e => e.id !== update.entityId && e.label !== update.label);
            } else if (update.type.startsWith('build_')) {
                let mType: MapEntityType = 'military_factory';
                if (update.type === 'build_port') mType = 'military_port';
                else if (update.type === 'build_airport') mType = 'military_base';
                else if (update.type === 'build_airbase') mType = 'airbase';
                else if (update.type === 'build_defense') mType = 'defense_system';
                
                newEntities.push({
                    id: `ent-${Date.now()}-${Math.random()}`,
                    type: mType, country: update.targetCountry, lat: update.lat || 0, lng: update.lng || 0, label: update.label
                });
            }
        }
    }

    let currentAlliance = gameState.alliance;
    if (result.allianceUpdate) {
        if (result.allianceUpdate.action === 'create' || result.allianceUpdate.action === 'update') {
            if (result.allianceUpdate.name && result.allianceUpdate.members && result.allianceUpdate.leader) {
                currentAlliance = { name: result.allianceUpdate.name, type: result.allianceUpdate.type || 'Militaire', members: result.allianceUpdate.members, leader: result.allianceUpdate.leader };
            }
        } else if (result.allianceUpdate.action === 'dissolve') currentAlliance = null;
    }

    if (newAiEvents.length > 0 && newAiEvents[0].relatedCountry) cameraTarget = newAiEvents[0].relatedCountry;
    else if (result.mapUpdates && result.mapUpdates.length > 0) cameraTarget = result.mapUpdates[0].targetCountry;

    const newHistory = [...fullHistory, playerEvent, ...newAiEvents];
    let newChatHistory = [...gameState.chatHistory];
    
    if (result.incomingMessages && result.incomingMessages.length > 0) {
        result.incomingMessages.forEach(msg => {
            const normSender = normalizeCountryName(msg.sender);
            const normTargets = msg.targets.map(t => normalizeCountryName(t));
            if (!normTargets.includes(gameState.playerCountry!)) normTargets.push(gameState.playerCountry!);
            newChatHistory.push({ id: `msg-${Date.now()}-${Math.random()}`, sender: 'ai', senderName: normSender, targets: normTargets, text: msg.text, timestamp: Date.now(), isRead: false });
        });
        setHasUnreadChat(true);
    }

    const newGameState = {
        ...gameState, currentDate: nextDate, turn: gameState.turn + 1, ownedTerritories: newOwnedTerritories, mapEntities: newEntities, globalTension: Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange)), economyHealth: Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange)), militaryPower: Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange)), popularity: Math.max(0, Math.min(100, gameState.popularity + (result.popularityChange || 0))), corruption: Math.max(0, Math.min(100, gameState.corruption + (result.corruptionChange || 0))), hasNuclear: newHasNuclear, hasSpaceProgram: result.spaceProgramActive || gameState.hasSpaceProgram, militaryRank: calculateRank(gameState.militaryPower), isProcessing: false, chatHistory: newChatHistory, alliance: currentAlliance, isGameOver: !newOwnedTerritories.includes(gameState.playerCountry!), gameOverReason: !newOwnedTerritories.includes(gameState.playerCountry!) ? "Votre nation a été annexée." : null
    };

    setGameState(newGameState); setEventQueue([playerEvent, ...newAiEvents]); setPlayerInput(""); setPendingOrders([]); setFocusCountry(cameraTarget); 
    if (!newGameState.isGameOver) { setActiveWindow('events'); saveGame(newGameState, newHistory, false); }
    else { setActiveWindow('none'); deleteSave(gameState.gameId); }
  };

  const handleRegionSelect = (region: string) => { if (!gameState.playerCountry) { setPendingCountry(region); setShowStartModal(true); } };
  const confirmCountrySelection = () => { if (pendingCountry) { setGameState(prev => ({ ...prev, playerCountry: pendingCountry })); setPendingCountry(null); setFocusCountry(pendingCountry); } };
  const toggleWindow = (win: 'events' | 'history' | 'chat' | 'alliance') => setActiveWindow(activeWindow === win ? 'none' : win);

  if (appMode === 'portal_landing') {
      return (
          <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-black selection:text-white overflow-x-hidden">
              <nav className="relative flex items-center justify-center px-6 py-6 max-w-7xl mx-auto">
                  <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-black rounded-full border-4 border-slate-200"></div>
                      <h1 className="text-2xl font-black tracking-tight uppercase">Politika</h1>
                  </div>
              </nav>
              <main className="max-w-7xl mx-auto px-6 mt-10 md:mt-20 flex flex-col md:flex-row items-center gap-12">
                  <div className="flex-1 space-y-6 text-center md:text-left">
                      <h2 className="text-5xl md:text-7xl font-black leading-tight tracking-tighter">RÉÉCRIVEZ<br/>L'HISTOIRE.</h2>
                      <p className="text-lg text-slate-500 max-w-md mx-auto md:mx-0">Le destin des nations est entre vos mains.</p>
                      <button onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)} className="px-8 py-4 rounded-xl font-bold text-lg shadow-xl bg-blue-600 text-white hover:bg-blue-700 transition-transform hover:scale-105">
                          {user ? "ACCÉDER AU QG" : "JOUER"} <span>➔</span>
                      </button>
                  </div>
              </main>
              {showLoginModal && (
                  <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
                          <h3 className="text-xl font-bold mb-4">{isRegistering ? "S'inscrire" : "Connexion"}</h3>
                          <form onSubmit={handleEmailAuth} className="space-y-4">
                              <input type="email" required className="w-full p-3 rounded-lg border" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                              <input type="password" required className="w-full p-3 rounded-lg border" placeholder="Mot de passe" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg">{isRegistering ? "Créer compte" : "Entrer"}</button>
                          </form>
                          <button onClick={() => setIsRegistering(!isRegistering)} className="mt-4 text-xs text-blue-600 font-bold w-full">{isRegistering ? "Déjà un compte ?" : "Pas encore de compte ?"}</button>
                          <button onClick={handleGoogleLogin} className="mt-4 w-full py-2 bg-white border font-bold rounded-lg flex items-center justify-center gap-2">Google</button>
                      </div>
                  </div>
              )}
          </div>
      );
  }

  if (appMode === 'portal_dashboard') {
      return (
          <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
              <header className="bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-20">
                  <h1 className="text-xl font-black uppercase">Politika</h1>
                  <div className="flex items-center gap-4">
                      <button onClick={handleLogout} className="text-red-500 font-bold text-xs">Déconnexion</button>
                  </div>
              </header>
              <main className="max-w-6xl mx-auto p-6 md:p-10 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white rounded-2xl p-6 border shadow-sm hover:shadow-xl transition-all cursor-pointer h-64 flex flex-col" onClick={launchGeoSim}>
                      <h3 className="text-2xl font-bold mb-2">GeoSim</h3>
                      <p className="text-sm text-slate-500 flex-1">Simulation globale An 2000.</p>
                      <button className="w-full py-3 bg-black text-white font-bold rounded-lg">LANCER</button>
                  </div>
                  <div className="col-span-1 md:col-span-2 bg-white rounded-2xl border p-4">
                      <h3 className="font-bold mb-4">Sauvegardes Cloud</h3>
                      <div className="space-y-2">
                        {availableSaves.map(save => (
                            <div key={save.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div><div className="font-bold text-sm">{save.country}</div><div className="text-[10px]">{save.date}</div></div>
                                <button onClick={() => loadGameById(save.id)} className="px-4 py-1.5 bg-blue-600 text-white rounded font-bold text-xs">Charger</button>
                            </div>
                        ))}
                      </div>
                  </div>
              </main>
          </div>
      );
  }

  if (appMode === 'game_active') {
    if (currentScreen === 'splash') return <div className="w-screen h-screen bg-white flex items-center justify-center"><GameLogo size="large" theme="light" /></div>;
    if (currentScreen === 'loading') return <div className="w-screen h-screen bg-white flex flex-col items-center justify-center"><div className="w-64 h-1 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 animate-[width_3s_ease-in-out_forwards]" style={{width: '0%'}}></div></div><div className="text-[10px] mt-2 font-bold animate-pulse">RECALIBRAGE...</div></div>;

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900">
            <WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} onRegionClick={handleRegionSelect} focusCountry={focusCountry} />
            <div className="absolute top-4 left-4 z-20 flex gap-2 bg-black/60 p-2 rounded-lg border border-white/10 backdrop-blur-md">
                {['Tension', 'Économie', 'Popularité', 'Militaire'].map(stat => (
                    <div key={stat} className="flex flex-col w-16">
                        <span className="text-[8px] uppercase text-stone-300 font-bold">{stat}</span>
                        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{width: `${stat === 'Tension' ? gameState.globalTension : stat === 'Économie' ? gameState.economyHealth : stat === 'Popularité' ? gameState.popularity : gameState.militaryPower}%`}}></div>
                        </div>
                    </div>
                ))}
            </div>
            <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing} />
            <div className="absolute bottom-6 left-6 z-20 flex gap-3">
                <button onClick={() => toggleWindow('events')} className={`w-12 h-12 rounded-full shadow-xl flex items-center justify-center bg-white text-xl ${activeWindow === 'events' ? 'ring-2 ring-blue-500' : ''}`}>📝</button>
                <div className="relative">
                    <button onClick={() => toggleWindow('chat')} className={`w-12 h-12 rounded-full shadow-xl flex items-center justify-center bg-white text-xl ${activeWindow === 'chat' ? 'ring-2 ring-blue-500' : ''}`}>💬</button>
                    {hasUnreadChat && <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-pulse border border-white"></div>}
                </div>
                <button onClick={() => toggleWindow('history')} className="w-12 h-12 rounded-full shadow-xl flex items-center justify-center bg-white text-xl">📚</button>
                {gameState.alliance && <button onClick={() => toggleWindow('alliance')} className="w-12 h-12 rounded-full shadow-xl flex items-center justify-center bg-white text-xl">🤝</button>}
            </div>
            <button onClick={() => setIsSettingsOpen(true)} className="absolute top-4 right-4 z-20 p-2 bg-black/60 text-white rounded-full">⚙️</button>
            <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={handleReadEvent} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={handleAddOrder} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={handleGetSuggestions} turn={gameState.turn} />
            <HistoryLog isOpen={activeWindow === 'history'} onClose={() => setActiveWindow('none')} history={fullHistory} />
            <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => setActiveWindow('none')} playerCountry={gameState.playerCountry || "Moi"} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} typingParticipants={typingParticipants} onMarkRead={handleMarkChatRead} />
            {gameState.alliance && <AllianceWindow isOpen={activeWindow === 'alliance'} onClose={() => setActiveWindow('none')} alliance={gameState.alliance} playerCountry={gameState.playerCountry || ""} />}
            {isSettingsOpen && (
                <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl p-6 max-w-xs w-full">
                        <h3 className="font-bold mb-4">Réglages</h3>
                        <button onClick={() => { setIsSettingsOpen(false); saveGame(gameState, fullHistory, true); }} className="w-full py-2 mb-2 bg-emerald-600 text-white rounded font-bold">Sauvegarde Cloud</button>
                        <button onClick={handleExitToDashboard} className="w-full py-2 bg-stone-100 text-stone-600 rounded">Sortir</button>
                        <button onClick={() => setIsSettingsOpen(false)} className="w-full py-2 mt-4 font-bold border rounded">Fermer</button>
                    </div>
                </div>
            )}
        </div>
    );
  }
  return null;
};

export default App;
