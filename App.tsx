
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

// --- SCREENS ---
type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';
type GameScreen = 'splash' | 'loading' | 'game';

// Helper to determine initial power & corruption - AN 2000 CONTEXT
const getInitialStats = (country: string): { power: number, corruption: number } => {
    const c = country.toLowerCase();
    
    // Tier 1: Superpowers & Major Powers (Low corruption)
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni') || c.includes('allemagne') || c.includes('japon') || c.includes('canada')) return { power: 65, corruption: 10 };
    
    // Tier 2: Rising Powers / Transition (Medium corruption)
    if (c.includes('chine')) return { power: 60, corruption: 50 }; // En 2000
    if (c.includes('russie')) return { power: 70, corruption: 60 }; // Post-soviétique 2000
    if (c.includes('inde')) return { power: 50, corruption: 55 };
    if (c.includes('brésil')) return { power: 45, corruption: 50 };

    // Default
    return { power: 30, corruption: 40 }; 
};

// Helper to determine initial rank based on power
const calculateRank = (power: number): number => {
    return Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
};

// Check if landlocked
const isCountryLandlocked = (country: string): boolean => {
    return LANDLOCKED_COUNTRIES.some(c => country.includes(c));
}

// Check nuclear
const hasNuclearArsenal = (country: string): boolean => {
    return NUCLEAR_POWERS.some(c => country.includes(c));
}

// Check space program
const hasSpaceProgramInitial = (country: string): boolean => {
    return SPACE_POWERS.some(c => country.includes(c));
}

// Token saving: Map readable type to short string
const getShortEntityName = (t: MapEntityType) => {
    switch(t) {
        case 'military_base': return 'Base';
        case 'defense_system': return 'Défense';
        default: return 'Autre';
    }
}

// Helper to keep values between 0 and 100
const clamp = (value: number): number => Math.max(0, Math.min(100, value));

// --- COMPONENT HELPERS ---
// MODIF: Jauges épurées (pas d'icône, pas de chiffre)
const StatGauge = ({ label, value, color }: { label: string, value: number, color: string }) => (
    <div className="flex flex-col gap-1 w-16 md:w-20">
        <div className="flex justify-between items-center">
            <span className="font-bold text-stone-400 text-[9px] uppercase tracking-wider truncate">{label}</span>
        </div>
        <div className="w-full h-1 bg-stone-800 rounded-full overflow-hidden border border-stone-700/50">
            <div 
                className={`h-full ${color} transition-all duration-500`} 
                style={{ width: `${value}%` }}
            ></div>
        </div>
    </div>
);

// --- LOGO COMPONENT ---
const GameLogo = ({ size = 'large', theme = 'dark' }: { size?: 'small' | 'large', theme?: 'dark' | 'light' }) => {
    const isLight = theme === 'light';
    return (
        <div className={`flex flex-col items-center justify-center ${size === 'large' ? 'gap-4' : 'gap-2'}`}>
            <div className={`
                relative flex items-center justify-center rounded-full border-2 
                ${isLight ? 'border-emerald-500 bg-white shadow-xl' : 'border-emerald-500 bg-black/80 shadow-[0_0_20px_rgba(16,185,129,0.5)]'}
                ${size === 'large' ? 'w-32 h-32' : 'w-12 h-12'}
            `}>
                {/* Radar Sweep Animation */}
                <div className="absolute inset-0 rounded-full border border-emerald-500/30 overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-top-left bg-gradient-to-r from-transparent to-emerald-500/40 animate-[spin_2s_linear_infinite]" style={{ borderRadius: '100% 0 0 0' }}></div>
                </div>
                {/* Crosshair */}
                <div className="absolute w-full h-[1px] bg-emerald-500/30"></div>
                <div className="absolute h-full w-[1px] bg-emerald-500/30"></div>
                {/* Dot */}
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping absolute top-1/4 right-1/4"></div>
            </div>
            <h1 className={`font-serif font-bold tracking-widest uppercase ${isLight ? 'text-slate-800' : 'text-white'} ${size === 'large' ? 'text-4xl' : 'text-xl'}`}>
                GeoSim
            </h1>
        </div>
    );
};

const App: React.FC = () => {
  // --- APP LEVEL STATE (POLITIKA WRAPPER) ---
  const [appMode, setAppMode] = useState<AppMode>('portal_landing');
  
  // --- GAME INTERNAL STATE ---
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('splash');
  const [hasSave, setHasSave] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  
  // Settings & Load Menu State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false); // NOUVEAU: Menu In-Game
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [isSyncing, setIsSyncing] = useState(true);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [tokenCount, setTokenCount] = useState(0); 

  // Bug Report State
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [bugTitle, setBugTitle] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [isSendingBug, setIsSendingBug] = useState(false);

  // Auth State
  const [user, setUser] = useState<any>(null);
  
  // --- LOGIN MODAL STATE ---
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  
  // Game State
  const [gameState, setGameState] = useState<GameState>({
    gameId: '',
    currentDate: INITIAL_DATE,
    playerCountry: null,
    ownedTerritories: [],
    neutralTerritories: [],
    mapEntities: [],
    infrastructure: {},
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

  // --- INIT ---
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
    return () => { isMountedRef.current = false; unsubscribe(); };
  }, []);

  // --- SAVE LISTENER ---
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
            snapshot.forEach((doc) => saves.push(doc.data() as SaveMetadata));
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

  // Timers for Visuals
  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') {
        const timer = setTimeout(() => setCurrentScreen('loading'), 2500);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'loading') {
        const timer = setTimeout(() => setCurrentScreen('game'), 3000);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);


  // --- SAVE OPERATIONS ---
  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) {
          showNotification("Connexion requise pour sauvegarder !");
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
      const fullData = { metadata, state, history, aiProvider, tokenCount };
      const sanitizedData = JSON.parse(JSON.stringify(fullData));
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
              showNotification("Erreur de chargement (Réseau)");
              setIsGlobalLoading(false);
              return;
          }
      }

      if (data) {
          try {
              data.state.currentDate = new Date(data.state.currentDate);
              const migratedState = {
                  ...gameState,
                  ...data.state,
                  neutralTerritories: data.state.neutralTerritories || [],
                  infrastructure: data.state.infrastructure || {}
              };
              setGameState(migratedState);
              setFullHistory(data.history);
              if (data.aiProvider) setAiProvider(data.aiProvider);
              if (data.tokenCount) setTokenCount(data.tokenCount);
              setEventQueue([]);
              setShowStartModal(false);
              setAppMode('game_active');
              setIsGameMenuOpen(false); // Close in-game menu if open
              startLoadingSequence();
              setIsGlobalLoading(false); 
              showNotification(`Partie chargée: ${data.state.playerCountry}`);
          } catch (e) {
              showNotification("Erreur de sauvegarde (Corrompue)");
              setIsGlobalLoading(false);
          }
      } else {
          showNotification("Données introuvables.");
          setIsGlobalLoading(false); 
      }
      setIsSettingsOpen(false);
      setIsLoadMenuOpen(false);
  };

  const startLoadingSequence = () => setCurrentScreen('loading');
  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); }
  const handleExitToDashboard = () => { setIsSettingsOpen(false); setIsGameMenuOpen(false); setAppMode('portal_dashboard'); setIsGlobalLoading(false); };
  
  const openLoadMenu = () => setIsLoadMenuOpen(true);

  const renderLoadMenuOverlay = () => (
      <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsLoadMenuOpen(false)}>
          <div className="bg-stone-900 border border-stone-600 shadow-2xl rounded-2xl p-6 w-full max-w-lg flex flex-col gap-4 animate-scale-in" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center border-b border-stone-700 pb-2">
                  <h2 className="text-xl font-bold text-white uppercase">Charger une partie</h2>
                  <button onClick={() => setIsLoadMenuOpen(false)} className="text-stone-400 hover:text-white font-bold">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[60vh] space-y-2">
                  {availableSaves.length === 0 && <div className="text-stone-500 text-center py-4">Aucune sauvegarde trouvée.</div>}
                  {availableSaves.map(save => (
                      <div key={save.id} className="flex items-center gap-3 p-3 bg-stone-800 rounded hover:bg-stone-700 border border-stone-700 cursor-pointer" onClick={() => loadGameById(save.id)}>
                          <div className="w-10 h-7 bg-stone-600"><img src={getFlagUrl(save.country) || ''} className="w-full h-full object-cover" /></div>
                          <div className="flex-1">
                              <div className="font-bold text-stone-200 text-sm">{save.country}</div>
                              <div className="text-xs text-stone-500">Tour {save.turn} • {save.date}</div>
                          </div>
                          <button onClick={(e) => {e.stopPropagation(); deleteSave(save.id)}} className="text-red-500 hover:text-red-400 p-2">🗑</button>
                      </div>
                  ))}
              </div>
          </div>
      </div>
  );

  const handleContinueAsNewCountry = () => {
      setGameState(prev => ({
          ...prev, isGameOver: false, playerCountry: null, ownedTerritories: [],
      }));
      setShowStartModal(true);
      setPendingCountry(null);
  }

  // --- AUTH ---
  const handleGoogleLogin = async () => { try { await loginWithGoogle(); } catch (e) { showNotification("Erreur Google Login."); } };
  const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          if (isRegistering) await registerWithEmail(authEmail, authPassword);
          else await loginWithEmail(authEmail, authPassword);
      } catch (err: any) { showNotification("Erreur d'authentification."); }
  };
  const handleLogout = async () => { await logout(); showNotification("Déconnecté."); setAppMode('portal_landing'); };
  const handleLogin = () => { setAppMode('portal_landing'); setShowLoginModal(true); };

  // --- BUG REPORT ---
  const handleSendBugReport = async () => {
      if (!bugTitle.trim() || !bugDescription.trim()) { showNotification("Remplir tous les champs."); return; }
      setIsSendingBug(true);
      try {
          if (db) await addDoc(collection(db, "bug_reports"), {
              title: bugTitle, description: bugDescription, userEmail: user?.email || "anon", timestamp: Date.now()
          });
          showNotification("Signalement envoyé !");
      } catch (e) { showNotification("Erreur envoi."); } 
      finally { setIsSendingBug(false); setShowBugReportModal(false); setBugTitle(""); setBugDescription(""); }
  };

  const launchGeoSim = () => {
      setGameState({
        gameId: Date.now().toString(),
        currentDate: INITIAL_DATE,
        playerCountry: null,
        ownedTerritories: [],
        neutralTerritories: [],
        mapEntities: [],
        infrastructure: {},
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
      setFullHistory([]);
      setEventQueue([]);
      setShowStartModal(true);
      setAppMode('game_active');
      setCurrentScreen('splash'); 
      setTokenCount(0);
      setIsGameMenuOpen(false);
  };

  // --- GAMEPLAY ---
  useEffect(() => {
    if (appMode === 'game_active' && currentScreen === 'game' && gameState.playerCountry && fullHistory.length === 0 && gameState.turn === 1) {
        const initialEvent: GameEvent = {
            id: 'init-1',
            date: INITIAL_DATE.toLocaleDateString('fr-FR'),
            type: 'world',
            headline: "Passage à l'an 2000",
            description: `Le monde entre dans un nouveau millénaire. Les craintes du bug de l'an 2000 sont dissipées, mais de nouveaux défis géopolitiques émergent pour ${gameState.playerCountry}.`
        };
        setEventQueue([initialEvent]);
        setActiveWindow('events');
        
        const stats = getInitialStats(gameState.playerCountry!);
        const isNatoMember = NATO_MEMBERS_2000.includes(gameState.playerCountry!);
        const initialAlliance = isNatoMember ? {
            name: "OTAN",
            type: "Alliance Militaire & Nucléaire",
            members: NATO_MEMBERS_2000,
            leader: "États-Unis"
        } : null;

        setGameState(prev => ({
            ...prev,
            ownedTerritories: [prev.playerCountry!],
            militaryPower: stats.power,
            corruption: stats.corruption,
            hasNuclear: hasNuclearArsenal(prev.playerCountry!),
            hasSpaceProgram: hasSpaceProgramInitial(prev.playerCountry!),
            militaryRank: calculateRank(stats.power),
            alliance: initialAlliance
        }));
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
      const res = await getStrategicSuggestions(gameState.playerCountry, fullHistory, aiProvider);
      setTokenCount(prev => prev + res.usage);
      return res.suggestions;
  }

  const handleSendChatMessage = async (targets: string[], message: string) => {
      if (!gameState.playerCountry) return;
      const userMsg: ChatMessage = {
          id: `msg-${Date.now()}-p`,
          sender: 'player',
          senderName: gameState.playerCountry,
          targets: targets,
          text: message,
          timestamp: Date.now(),
          isRead: true
      };
      setGameState(prev => ({ ...prev, isProcessing: true, chatHistory: [...prev.chatHistory, userMsg] }));
      setTypingParticipants(targets);
      
      const context = {
          militaryPower: gameState.militaryPower,
          economyHealth: gameState.economyHealth,
          globalTension: gameState.globalTension,
          hasNuclear: gameState.hasNuclear,
          playerAllies: gameState.alliance ? gameState.alliance.members : [] 
      };
      const updatedHistoryForContext = [...gameState.chatHistory, userMsg];

      try {
        const { messages: aiResponses, usage } = await sendDiplomaticMessage(
            gameState.playerCountry!, targets, message, updatedHistoryForContext, context, aiProvider
        );
        setTokenCount(prev => prev + usage);
        const newMessages: ChatMessage[] = aiResponses.map(resp => ({
            id: `msg-${Date.now()}-${resp.sender}`,
            sender: 'ai',
            senderName: resp.sender,
            targets: targets,
            text: resp.text,
            timestamp: Date.now() + Math.floor(Math.random() * 500),
            isRead: false
        }));
        setTypingParticipants([]);
        setGameState(prev => ({ ...prev, isProcessing: false, chatHistory: [...prev.chatHistory, ...newMessages] }));
        if (newMessages.length > 0) setHasUnreadChat(true);
      } catch (e) {
          setTypingParticipants([]); 
          setGameState(prev => ({ ...prev, isProcessing: false }));
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
    
    const playerEvent: GameEvent = {
        id: `turn-${gameState.turn}-player`,
        date: formattedDate,
        type: 'player',
        headline: 'Décrets émis',
        description: finalOrderString || "Aucun ordre."
    };

    setGameState(prev => ({ ...prev, isProcessing: true }));

    const shouldSendFullContext = gameState.turn === 1 || gameState.turn % 10 === 0;
    let entitiesSummary = "UNCHANGED_FROM_PREVIOUS_REPORTS"; 

    if (shouldSendFullContext) {
        const summaryMap: Record<string, Record<string, number>> = {};
        gameState.mapEntities.forEach(ent => {
            if (!summaryMap[ent.country]) summaryMap[ent.country] = {};
            const label = getShortEntityName(ent.type);
            summaryMap[ent.country][label] = (summaryMap[ent.country][label] || 0) + 1;
        });
        if (gameState.infrastructure) {
            Object.entries(gameState.infrastructure).forEach(([country, infraTypes]) => {
                if (!summaryMap[country]) summaryMap[country] = {};
                Object.entries(infraTypes).forEach(([type, count]) => {
                    summaryMap[country][type] = (summaryMap[country][type] || 0) + count;
                });
            });
        }
        entitiesSummary = Object.entries(summaryMap).map(([country, counts]) => {
            return `${country}: ${Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', ')}`;
        }).join('; ');
    }

    const recentChat = gameState.chatHistory.slice(-10).map(m => `${m.sender === 'player' ? 'Joueur' : m.senderName}: ${m.text}`).join(' | ');

    const result = await simulateTurn(
        gameState.playerCountry,
        formattedDate,
        finalOrderString,
        gameState.events,
        gameState.ownedTerritories,
        entitiesSummary,
        isCountryLandlocked(gameState.playerCountry),
        gameState.hasNuclear,
        recentChat,
        gameState.chaosLevel,
        aiProvider,
        gameState.militaryPower,
        gameState.alliance,
        gameState.neutralTerritories
    );

    if (result.tokenUsage) setTokenCount(prev => prev + (result.tokenUsage || 0));

    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1);

    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({
        id: `turn-${gameState.turn}-ai-${idx}`,
        date: nextDate.toLocaleDateString('fr-FR'),
        type: e.type,
        headline: e.headline,
        description: e.description,
        relatedCountry: e.relatedCountry
    }));

    let newOwnedTerritories = [...gameState.ownedTerritories];
    let newNeutralTerritories = [...(gameState.neutralTerritories || [])];
    let newEntities = [...gameState.mapEntities];
    let newInfrastructure = JSON.parse(JSON.stringify(gameState.infrastructure || {}));
    let newHasNuclear = gameState.hasNuclear;
    let annexationHappened = false;

    if (result.mapUpdates) {
        for (const update of result.mapUpdates) {
            if (update.type === 'dissolve') {
                const target = normalizeCountryName(update.targetCountry);
                newOwnedTerritories = newOwnedTerritories.filter(t => t !== target);
                if (!newNeutralTerritories.includes(target)) newNeutralTerritories.push(target);
                showNotification(`Territoire détruit : ${target}`);
            } else if (update.type === 'annexation') {
                const target = normalizeCountryName(update.targetCountry); 
                const newOwner = update.newOwner ? normalizeCountryName(update.newOwner) : gameState.playerCountry;
                newNeutralTerritories = newNeutralTerritories.filter(t => t !== target);
                if (newOwnedTerritories.includes(target)) {
                    if (newOwner !== gameState.playerCountry) newOwnedTerritories = newOwnedTerritories.filter(t => t !== target);
                }
                if (newOwner === gameState.playerCountry && !newOwnedTerritories.includes(target)) {
                    newOwnedTerritories.push(target);
                    if (hasNuclearArsenal(target)) newHasNuclear = true;
                    annexationHappened = true;
                }
            } else if (update.type === 'remove_entity') {
                newEntities = newEntities.filter(e => e.id !== update.entityId && e.label !== update.label);
            } else if (update.type === 'build_base' || update.type === 'build_defense') {
                const entityType: MapEntityType = update.type === 'build_base' ? 'military_base' : 'defense_system';
                let finalLabel = update.label;
                if (!finalLabel || finalLabel.toLowerCase().includes('build_') || finalLabel === 'build_base' || finalLabel === 'build_defense') {
                    finalLabel = update.type === 'build_base' ? 'Base Militaire' : 'Système de Défense';
                }
                newEntities.push({
                    id: `ent-${Date.now()}-${Math.random()}`,
                    type: entityType,
                    country: normalizeCountryName(update.targetCountry),
                    lat: update.lat || 0,
                    lng: update.lng || 0,
                    label: finalLabel
                });
            }
        }
    }

    if (result.infrastructureUpdates) {
        for (const update of result.infrastructureUpdates) {
            const country = normalizeCountryName(update.country);
            if (!newInfrastructure[country]) newInfrastructure[country] = {};
            const newCount = Math.max(0, (newInfrastructure[country][update.type] || 0) + update.change);
            if (newCount === 0) delete newInfrastructure[country][update.type];
            else newInfrastructure[country][update.type] = newCount;
        }
    }

    let currentAlliance = gameState.alliance;
    if (result.allianceUpdate) {
        if (result.allianceUpdate.action === 'create' || result.allianceUpdate.action === 'update') {
            if (result.allianceUpdate.name) {
                currentAlliance = {
                    name: result.allianceUpdate.name,
                    type: result.allianceUpdate.type || 'Militaire',
                    members: (result.allianceUpdate.members || []).map(m => normalizeCountryName(m)),
                    leader: normalizeCountryName(result.allianceUpdate.leader || gameState.playerCountry)
                };
                showNotification(`Alliance : ${currentAlliance.name}`);
            }
        } else if (result.allianceUpdate.action === 'dissolve') {
            currentAlliance = null;
            showNotification("Alliance dissoute.");
        }
    }

    let cameraTarget = gameState.playerCountry;
    if (newAiEvents.length > 0 && newAiEvents[0].relatedCountry) cameraTarget = normalizeCountryName(newAiEvents[0].relatedCountry);
    else if (result.mapUpdates && result.mapUpdates.length > 0) cameraTarget = normalizeCountryName(result.mapUpdates[0].targetCountry.split(':')[0]);

    const newHistory = [...fullHistory, playerEvent, ...newAiEvents];
    let newChatHistory = [...gameState.chatHistory];
    
    if (result.incomingMessages && result.incomingMessages.length > 0) {
        result.incomingMessages.forEach(msg => {
            const normalizedSender = normalizeCountryName(msg.sender);
            if (normalizedSender === gameState.playerCountry) return;
            const normalizedTargets = msg.targets.map(t => normalizeCountryName(t));
            if (!normalizedTargets.includes(gameState.playerCountry!)) normalizedTargets.push(gameState.playerCountry!);
            newChatHistory.push({
                id: `msg-${Date.now()}-${Math.random()}`,
                sender: 'ai', senderName: normalizedSender, targets: normalizedTargets, text: msg.text, timestamp: Date.now(), isRead: false 
            });
            showNotification(`Message diplomatique : ${normalizedSender}`);
        });
        setHasUnreadChat(true);
    }

    setFullHistory(newHistory);

    let calcTension = gameState.globalTension + (result.globalTensionChange || 0) + 1; // Drift +1
    let calcCorruption = gameState.corruption + (result.corruptionChange || 0) + 1; // Drift +1
    let calcEconomy = gameState.economyHealth + (result.economyHealthChange || 0) + (gameState.turn % 2 === 0 ? -5 : 0);
    let calcPopularity = gameState.popularity + (result.popularityChange || 0) + (gameState.turn % 2 === 0 ? -5 : 0);
    let calcMilitary = gameState.militaryPower + (result.militaryPowerChange || 0);

    const hasWarEvent = newAiEvents.some(e => e.type === 'war');
    if (annexationHappened || hasWarEvent) calcTension += 50;
    if (hasWarEvent) { calcEconomy -= 20; calcPopularity -= 20; }
    
    const combinedDesc = newAiEvents.map(e => (e.description || '').toLowerCase()).join(' ');
    if (combinedDesc.includes('bombarde')) calcMilitary -= 15;
    if (combinedDesc.includes('nucléaire') && combinedDesc.includes('subi')) calcMilitary -= 70;

    let newHasSpaceProgram = gameState.hasSpaceProgram;
    if (result.spaceProgramActive) { newHasSpaceProgram = true; showNotification("Programme spatial activé !"); }
    
    if (!newHasNuclear && (result.nuclearAcquired || finalOrderString.toLowerCase().includes("nucléaire"))) {
        newHasNuclear = true;
        showNotification("⚠️ ARME NUCLÉAIRE OPÉRATIONNELLE ⚠️");
        const nukeEvent: GameEvent = {
            id: `nuke-acq-${Date.now()}`,
            date: nextDate.toLocaleDateString('fr-FR'),
            type: 'war',
            headline: "Dissuasion Nucléaire",
            description: "Nos scientifiques ont réussi. Nous sommes désormais une puissance nucléaire."
        };
        newAiEvents.push(nukeEvent);
        newHistory.push(nukeEvent);
    }

    const newEconomyHealth = clamp(calcEconomy);
    const newMilitaryPower = clamp(calcMilitary);
    const newPopularity = clamp(calcPopularity);
    const newGlobalTension = clamp(calcTension);
    const newCorruption = clamp(calcCorruption);

    let gameOver = false;
    let failReason = null;
    if (!newOwnedTerritories.includes(gameState.playerCountry)) {
        gameOver = true; failReason = "Votre nation a été entièrement annexée.";
    } else {
        let failCount = 0;
        if (newEconomyHealth <= 0) failCount++;
        if (newMilitaryPower <= 0) failCount++;
        if (newPopularity <= 0) failCount++;
        if (newGlobalTension >= 100) failCount++;
        if (newCorruption >= 100) failCount++;
        if (failCount >= 3) { gameOver = true; failReason = "Effondrement systémique."; }
    }

    const newGameState = {
        ...gameState,
        currentDate: nextDate,
        turn: gameState.turn + 1,
        ownedTerritories: newOwnedTerritories,
        neutralTerritories: newNeutralTerritories,
        mapEntities: newEntities,
        infrastructure: newInfrastructure,
        globalTension: newGlobalTension,
        economyHealth: newEconomyHealth,
        militaryPower: newMilitaryPower,
        popularity: newPopularity,
        corruption: newCorruption,
        hasNuclear: newHasNuclear,
        hasSpaceProgram: newHasSpaceProgram,
        militaryRank: calculateRank(newMilitaryPower),
        isProcessing: false,
        chatHistory: newChatHistory,
        alliance: currentAlliance,
        isGameOver: gameOver,
        gameOverReason: failReason
    };

    setGameState(newGameState);
    setEventQueue([playerEvent, ...newAiEvents]);
    setPlayerInput("");
    setPendingOrders([]);
    setFocusCountry(cameraTarget); 
    
    if (!gameOver) {
        setActiveWindow('events');
        saveGame(newGameState, newHistory, false);
    } else {
        setActiveWindow('none');
    }
  };

  const handleRegionSelect = (region: string) => {
    if (region.includes(':')) return; 
    if (!gameState.playerCountry || (gameState.isGameOver && !gameState.playerCountry)) {
        setPendingCountry(region);
        setShowStartModal(true);
    }
  };

  const confirmCountrySelection = () => {
      if (pendingCountry) {
          const stats = getInitialStats(pendingCountry);
          const isNatoMember = NATO_MEMBERS_2000.includes(pendingCountry);
          const initialAlliance = isNatoMember ? {
                name: "OTAN", type: "Alliance Militaire", members: NATO_MEMBERS_2000, leader: "États-Unis"
          } : null;
          
          setGameState(prev => ({ 
              ...prev, 
              playerCountry: pendingCountry,
              ownedTerritories: [pendingCountry], 
              militaryPower: stats.power,
              corruption: stats.corruption,
              economyHealth: 50, popularity: 60,
              hasNuclear: hasNuclearArsenal(pendingCountry),
              hasSpaceProgram: hasSpaceProgramInitial(pendingCountry),
              alliance: initialAlliance,
              militaryRank: calculateRank(stats.power),
              isGameOver: false, gameOverReason: null
          }));
          
          setPendingCountry(null);
          setFocusCountry(pendingCountry);
          setShowStartModal(false);
          setActiveWindow('events');
      }
  };

  const toggleWindow = (win: 'events' | 'history' | 'chat' | 'alliance') => setActiveWindow(activeWindow === win ? 'none' : win);

  // --- RENDER ---
  if (appMode === 'portal_landing') {
      return (
          <div className="min-h-screen bg-white text-slate-900 font-sans overflow-x-hidden">
              <nav className="relative flex items-center justify-center px-6 py-6 max-w-7xl mx-auto">
                  <div className="flex items-center gap-2"><div className="w-8 h-8 bg-black rounded-full border-4 border-slate-200"></div><h1 className="text-2xl font-black uppercase">Politika</h1></div>
                  {user && <button onClick={handleLogout} className="absolute right-6 text-xs font-bold text-red-500 border border-red-200 px-3 py-1.5 rounded-lg">Déconnexion</button>}
              </nav>
              <main className="max-w-7xl mx-auto px-6 mt-10 flex flex-col md:flex-row items-center gap-12">
                  <div className="flex-1 space-y-6">
                      <h2 className="text-5xl md:text-7xl font-black leading-tight">RÉÉCRIVEZ<br/>L'HISTOIRE.</h2>
                      <div className="flex gap-4 pt-4"><button onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)} className="px-8 py-4 bg-black text-white rounded-xl font-bold text-lg hover:scale-105 transition-transform flex items-center gap-2">{user ? "ACCÉDER AU QG" : "JOUER"} <span>➔</span></button></div>
                  </div>
                  <div className="flex-1 relative w-full aspect-square bg-slate-50 rounded-3xl border-2 border-slate-100 shadow-2xl overflow-hidden">
                      <div className="absolute inset-0 bg-[url('https://upload.wikimedia.org/wikipedia/commons/e/ec/World_map_blank_without_borders.svg')] bg-cover opacity-20"></div>
                  </div>
              </main>
              {showLoginModal && (
                  <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
                          <h3 className="text-xl font-bold mb-6">{isRegistering ? "Créer un compte" : "Connexion"}</h3>
                          <form onSubmit={handleEmailAuth} className="space-y-4">
                              <input type="email" required className="w-full p-3 rounded bg-slate-50 border" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                              <input type="password" required className="w-full p-3 rounded bg-slate-50 border" placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded shadow">{isRegistering ? "S'inscrire" : "Se connecter"}</button>
                          </form>
                          <button onClick={() => setIsRegistering(!isRegistering)} className="mt-4 text-xs text-blue-600 font-bold block w-full text-center">{isRegistering ? "Déjà un compte ?" : "Pas de compte ?"}</button>
                          <button onClick={handleGoogleLogin} className="w-full mt-4 py-3 border font-bold rounded flex justify-center gap-2">Google</button>
                          <button onClick={() => setShowLoginModal(false)} className="w-full mt-2 text-slate-400 text-xs font-bold">Annuler</button>
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
                  <div className="flex items-center gap-2"><div className="w-6 h-6 bg-black rounded-full"></div><h1 className="text-xl font-black uppercase">Politika <span className="text-slate-400 font-normal ml-2">Dashboard</span></h1></div>
                  {user && (
                      <div className="flex items-center gap-4">
                          <div className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">TOKENS: {tokenCount}</div>
                          <div className="text-right"><div className="text-sm font-bold">{user.displayName || user.email}</div></div>
                          <button onClick={handleLogout} className="bg-slate-100 text-slate-600 p-2 rounded">✕</button>
                      </div>
                  )}
              </header>
              <main className="max-w-6xl mx-auto p-10">
                  <h2 className="text-3xl font-bold mb-8">Bibliothèque</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white rounded-2xl overflow-hidden border shadow-sm hover:shadow-2xl cursor-pointer h-80 flex flex-col relative" onClick={launchGeoSim}>
                          <div className="h-40 bg-slate-800 flex items-center justify-center text-white"><GameLogo size="small" theme="dark" /></div>
                          <div className="p-6 flex-1 flex flex-col justify-between">
                              <h3 className="text-xl font-bold">GeoSim</h3>
                              <button className="w-full py-3 bg-black text-white font-bold rounded">LANCER</button>
                          </div>
                      </div>
                      <div className="bg-white rounded-2xl border shadow-sm col-span-2 flex flex-col h-80">
                          <div className="p-4 border-b bg-slate-50 font-bold flex justify-between"><span>Sauvegardes</span><span className="text-xs font-mono">{isSyncing ? "Sync..." : availableSaves.length}</span></div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                              {availableSaves.map(save => (
                                  <div key={save.id} className="flex items-center gap-4 p-3 hover:bg-blue-50 rounded border border-transparent hover:border-blue-100">
                                      <div className="w-12 h-8 bg-slate-200"><img src={getFlagUrl(save.country) || ''} className="w-full h-full object-cover" /></div>
                                      <div className="flex-1"><div className="font-bold text-sm">{save.country}</div><div className="text-xs text-slate-500">Tour {save.turn} • {save.date}</div></div>
                                      <div className="flex gap-2">
                                          <button onClick={(e) => {e.stopPropagation(); loadGameById(save.id)}} className="px-3 py-1 bg-white border font-bold text-xs rounded">Charger</button>
                                          <button onClick={(e) => {e.stopPropagation(); deleteSave(save.id)}} className="px-2 py-1 bg-white border text-red-500 font-bold text-xs rounded">🗑</button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </main>
              {notification && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-black text-white px-6 py-2 rounded-full shadow-xl z-50">{notification}</div>}
        </div>
    );
  }

  if (appMode === 'game_active') {
    if (currentScreen === 'splash' || currentScreen === 'loading') {
        return <div className="w-screen h-screen bg-slate-50 flex items-center justify-center flex-col"><GameLogo size="large" theme="light" /><div className="mt-4 text-emerald-600 font-mono animate-pulse">CHARGEMENT...</div></div>;
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
            />
        </div>

        {/* NOUVEAU: Backdrop invisible pour fermer les fenêtres au clic extérieur */}
        {activeWindow !== 'none' && (
            <div className="absolute inset-0 z-40" onClick={() => setActiveWindow('none')}></div>
        )}

        {!gameState.isGameOver && gameState.playerCountry && (
            <>
                {/* HUD Jauges Gauche (Épuré) */}
                <div className="absolute top-6 left-6 z-30 flex flex-col gap-2 pointer-events-none">
                    <div className="bg-stone-900/90 backdrop-blur-md p-3 rounded-xl border border-stone-700 shadow-2xl pointer-events-auto flex flex-row gap-4 items-center">
                        <StatGauge label="Tension" value={gameState.globalTension} color="bg-red-500" />
                        <StatGauge label="Éco" value={gameState.economyHealth} color="bg-emerald-500" />
                        <StatGauge label="Armée" value={gameState.militaryPower} color="bg-blue-500" />
                        <StatGauge label="Pop" value={gameState.popularity} color="bg-purple-500" />
                        <div className="h-8 w-px bg-stone-700 mx-1"></div>
                        <div className="flex items-center gap-3 pr-2">
                            {!isCountryLandlocked(gameState.playerCountry) && <span title="Accès Maritime" className="text-blue-400 text-lg drop-shadow cursor-help">⚓</span>}
                            {gameState.hasNuclear && <span title="Puissance Nucléaire" className="text-yellow-500 text-lg drop-shadow animate-pulse cursor-help">☢️</span>}
                            {gameState.alliance && <span title={`Membre de l'alliance: ${gameState.alliance.name}`} className="text-indigo-400 text-lg drop-shadow cursor-help">🛡️</span>}
                        </div>
                    </div>
                </div>

                {/* HUD Profil Droite (Compact + Menu Trigger) */}
                <div className="absolute top-6 right-6 z-30 flex flex-row items-center gap-2 pointer-events-none">
                    <div className="bg-stone-900/90 backdrop-blur-md p-1.5 pl-3 pr-2 rounded-full border border-stone-700 shadow-2xl pointer-events-auto flex items-center gap-2">
                        <div className="flex flex-col items-end mr-1">
                             <div className="bg-black/50 text-emerald-400 text-[8px] font-mono px-1 py-0.5 rounded border border-emerald-900/50 mb-0.5">TOKENS: {tokenCount}</div>
                        </div>
                        <div 
                            className="flex flex-col items-end cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setIsGameMenuOpen(true)} // Ouvre le menu au lieu de quitter
                        >
                            <span className="text-[8px] text-stone-400 uppercase font-bold tracking-widest">Président</span>
                            <span className="text-xs font-bold text-white leading-none uppercase">{gameState.playerCountry}</span>
                        </div>
                        <img 
                            src={getFlagUrl(gameState.playerCountry)} 
                            className="w-8 h-8 rounded-full border-2 border-stone-600 object-cover cursor-pointer hover:border-stone-400" 
                            onClick={() => setIsGameMenuOpen(true)}
                        />
                    </div>
                </div>
                
                {/* GAME MENU MODAL (Échap / Profil Click) */}
                {isGameMenuOpen && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsGameMenuOpen(false)}>
                        <div className="bg-stone-900 border border-stone-600 shadow-2xl rounded-2xl p-6 w-full max-w-sm flex flex-col gap-6 animate-scale-in" onClick={e => e.stopPropagation()}>
                            <div className="text-center border-b border-stone-800 pb-4">
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">Menu Système</h2>
                                <p className="text-xs text-stone-500 font-mono mt-1">ID: {gameState.gameId}</p>
                            </div>

                            {/* Section IA */}
                            <div>
                                <h3 className="text-xs font-bold text-stone-400 uppercase mb-3">Moteur Intelligence Artificielle</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['gemini', 'groq', 'huggingface'] as AIProvider[]).map(provider => (
                                        <button 
                                            key={provider}
                                            onClick={() => setAiProvider(provider)}
                                            className={`p-2 rounded text-[10px] font-bold uppercase transition-colors border ${
                                                aiProvider === provider 
                                                ? 'bg-emerald-600 text-white border-emerald-500' 
                                                : 'bg-stone-800 text-stone-400 border-stone-700 hover:bg-stone-700'
                                            }`}
                                        >
                                            {provider}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-2">
                                <button 
                                    onClick={() => saveGame(gameState, fullHistory)}
                                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <span>💾</span> Sauvegarder
                                </button>
                                <button 
                                    onClick={() => { setIsGameMenuOpen(false); openLoadMenu(); }}
                                    className="w-full py-3 bg-stone-700 hover:bg-stone-600 text-stone-200 font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <span>📂</span> Charger une partie
                                </button>
                                <div className="h-px bg-stone-800 my-1"></div>
                                <button 
                                    onClick={() => setIsGameMenuOpen(false)}
                                    className="w-full py-3 bg-white text-stone-900 font-bold rounded-lg hover:bg-stone-200 transition-colors"
                                >
                                    Reprendre
                                </button>
                                <button 
                                    onClick={handleExitToDashboard}
                                    className="w-full py-3 bg-red-900/50 hover:bg-red-900 text-red-200 font-bold rounded-lg border border-red-900 transition-colors"
                                >
                                    Quitter vers Politika
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                
                {isLoadMenuOpen && renderLoadMenuOverlay()}

                {/* Main UI Components */}
                <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing} />
                <EventLog isOpen={activeWindow === 'events'} onClose={() => toggleWindow('events')} eventQueue={eventQueue} onReadEvent={handleReadEvent} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={handleAddOrder} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={handleGetSuggestions} turn={gameState.turn} />
                <HistoryLog isOpen={activeWindow === 'history'} onClose={() => toggleWindow('history')} history={fullHistory} />
                <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => toggleWindow('chat')} playerCountry={gameState.playerCountry} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} typingParticipants={typingParticipants} onMarkRead={handleMarkChatRead} />
                {gameState.alliance && <AllianceWindow isOpen={activeWindow === 'alliance'} onClose={() => toggleWindow('alliance')} alliance={gameState.alliance} playerCountry={gameState.playerCountry} />}
                
                <div className="absolute bottom-6 left-6 z-30 flex gap-2">
                    <button onClick={() => toggleWindow('events')} className="bg-white text-stone-800 px-4 py-2 rounded-xl border shadow font-bold text-sm h-12 flex items-center gap-2"><span>✍️</span> Ordres {eventQueue.length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{eventQueue.length}</span>}</button>
                    <button onClick={() => toggleWindow('chat')} className="bg-stone-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-stone-600 relative">💬 {hasUnreadChat && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-bounce"></span>}</button>
                    <button onClick={() => toggleWindow('history')} className="bg-stone-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-stone-600">📚</button>
                    {gameState.alliance && <button onClick={() => toggleWindow('alliance')} className="bg-blue-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-blue-600">🛡</button>}
                </div>
            </>
        )}

        {gameState.isGameOver && (
            <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-8 text-center">
                <div className="bg-red-900/30 border-4 border-red-600 rounded-2xl p-8 max-w-lg w-full">
                    <h1 className="text-5xl font-black text-red-500 mb-4 uppercase">ÉCHEC CRITIQUE</h1>
                    <p className="text-xl text-stone-200 mb-8 font-bold">{gameState.gameOverReason}</p>
                    <div className="flex flex-col gap-3">
                        <button onClick={handleContinueAsNewCountry} className="px-8 py-4 bg-emerald-600 text-white font-black uppercase rounded shadow-lg">Incarner une autre nation</button>
                        <button onClick={handleExitToDashboard} className="px-8 py-3 bg-stone-700 text-stone-300 font-bold uppercase rounded shadow">Quitter</button>
                    </div>
                </div>
            </div>
        )}

        {showStartModal && !gameState.playerCountry && !pendingCountry && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-start pt-24 pointer-events-none p-4">
                <div className="bg-white/95 p-4 rounded-xl max-w-sm w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto transform scale-90">
                    <h2 className="text-lg font-bold text-stone-800 mb-2">Sélectionnez votre nation</h2>
                    <p className="text-sm text-stone-600">Touchez un pays sur la carte pour en prendre le contrôle.</p>
                </div>
            </div>
        )}

        {pendingCountry && !gameState.playerCountry && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none p-4">
                <div className="bg-white/95 p-4 rounded-xl max-w-xs w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto">
                    <div className="text-4xl mb-4">🌍</div>
                    <h3 className="text-2xl font-serif font-bold text-blue-800 mb-4">{pendingCountry}</h3>
                    <div className="flex gap-2">
                        <button onClick={() => setPendingCountry(null)} className="flex-1 py-2 border rounded font-bold hover:bg-stone-100 text-sm">Annuler</button>
                        <button onClick={confirmCountrySelection} className="flex-1 py-2 bg-blue-600 text-white rounded font-bold shadow text-sm">Confirmer</button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
  }
  return null;
}

export default App;
