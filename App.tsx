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
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, addDoc, query, limit } from 'firebase/firestore';

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
// 'portal_landing' : Site web façade
// 'portal_dashboard' : Après connexion (Choix du jeu)
// 'game_splash' | 'game_loading' | 'game_running' : Le jeu GeoSim original
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
    // Simple estimation: 100 power -> Rank 1, 0 power -> Rank 195
    // Linear interpolation: Rank = 196 - (power * 1.95)
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
  const [hasSave, setHasSave] = useState(false); // Used for "Continue" button
  const [notification, setNotification] = useState<string | null>(null);
  
  // Settings & Load Menu State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);
  const [availableSaves, setAvailableSaves] = useState<SaveMetadata[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false); // NEW: Global loading state for heavy ops

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
    gameId: '', // Initialize empty
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
    corruption: 30, // Default balanced corruption
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
  
  // WINDOW MANAGEMENT: Only one active at a time
  const [activeWindow, setActiveWindow] = useState<'none' | 'events' | 'history' | 'chat' | 'alliance'>('none');
  const [hasUnreadChat, setHasUnreadChat] = useState(false); // Global indicator
  const [typingParticipants, setTypingParticipants] = useState<string[]>([]);
  
  // MAP CONTROL
  const [focusCountry, setFocusCountry] = useState<string | null>(null);

  const [playerInput, setPlayerInput] = useState("");
  const [pendingOrders, setPendingOrders] = useState<string[]>([]); 
  const [showStartModal, setShowStartModal] = useState(true);
  const [pendingCountry, setPendingCountry] = useState<string | null>(null);

  // UseRef for mounting tracking
  const isMountedRef = useRef(true);

  // --- INIT & SPLASH LOGIC ---
  useEffect(() => {
    isMountedRef.current = true;
    
    // Subscribe to Auth
    const unsubscribe = subscribeToAuthChanges((u) => {
        if (!isMountedRef.current) return;
        setUser(u);
        if (u) {
            setAppMode('portal_dashboard');
            refreshSaves(u); // Fetch cloud saves
            setShowLoginModal(false); // Close modal if open
        } else {
            setAppMode('portal_landing');
            setAvailableSaves([]); // No local saves anymore
            setHasSave(false);
        }
    });

    return () => {
        isMountedRef.current = false;
        unsubscribe();
    };
  }, []);

  // Timer for Game Splash
  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') {
        const timer = setTimeout(() => {
            setCurrentScreen('loading'); 
        }, 2500);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);

  // Timer for Game Loading
  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'loading') {
        const timer = setTimeout(() => {
            setCurrentScreen('game');
        }, 3000);
        return () => clearTimeout(timer);
      }
  }, [appMode, currentScreen]);


  // --- SAVE SYSTEM LOGIC (CLOUD ONLY) ---

  const refreshSaves = async (currentUser: any) => {
      if (!isMountedRef.current || !currentUser || !db) return;
      
      setIsSyncing(true);
      setAvailableSaves([]); 
      
      // Extended Timeout to 15s to handle slow cold starts
      const withTimeout = (promise: Promise<any>, ms: number = 15000) => {
          return Promise.race([
              promise,
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
          ]);
      };

      try {
          // 1. Try fetch optimized metadata with TIMEOUT
          const metaSnapshot = await withTimeout(
              getDocs(collection(db, "users", currentUser.uid, "game_metas"))
          ) as any;
          
          if (isMountedRef.current) {
              if (!metaSnapshot.empty) {
                  const cloudSaves = metaSnapshot.docs.map((d: any) => d.data() as SaveMetadata);
                  cloudSaves.sort((a: SaveMetadata, b: SaveMetadata) => b.lastPlayed - a.lastPlayed);
                  setAvailableSaves(cloudSaves);
                  setHasSave(cloudSaves.length > 0);
              } else {
                  // 2. Fallback: Check legacy 'games' ONLY if metadata is empty.
                  console.log("No metadata found. Checking legacy...");
                  const gameSnapshot = await withTimeout(
                      getDocs(query(collection(db, "users", currentUser.uid, "games"), limit(10)))
                  ) as any;
                  
                  const legacySaves: SaveMetadata[] = [];
                  const batch = writeBatch(db);
                  let needsMigration = false;

                  gameSnapshot.forEach((docSnap: any) => {
                      const data = docSnap.data();
                      if (data.metadata) {
                          legacySaves.push(data.metadata);
                          const metaRef = doc(db, "users", currentUser.uid, "game_metas", docSnap.id);
                          batch.set(metaRef, data.metadata);
                          needsMigration = true;
                      }
                  });

                  if (needsMigration) {
                      batch.commit().catch(e => console.warn("Migration background fail", e));
                  }

                  legacySaves.sort((a, b) => b.lastPlayed - a.lastPlayed);
                  setAvailableSaves(legacySaves);
                  setHasSave(legacySaves.length > 0);
              }
          }
      } catch (e) {
          console.error("Cloud fetch error (or timeout):", e);
          if (isMountedRef.current) showNotification("Erreur Sync Cloud (Connexion?)");
      }
      
      if (isMountedRef.current) setIsSyncing(false);
  };

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      // CLOUD ONLY - REJECT IF NO USER
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
      
      const fullData = { metadata, state, history, aiProvider };
      // Sanitize: removes 'undefined' fields
      const sanitizedData = JSON.parse(JSON.stringify(fullData));

      try {
          const batch = writeBatch(db);
          
          // 1. Save Full Data (Heavy)
          const gameRef = doc(db, "users", user.uid, "games", state.gameId);
          batch.set(gameRef, sanitizedData);

          // 2. Save Metadata Index (Light)
          const metaRef = doc(db, "users", user.uid, "game_metas", state.gameId);
          batch.set(metaRef, metadata);

          // AWAIT COMPLETION before refreshing UI
          await batch.commit();

          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
          
          // Refresh list immediately to reflect changes
          await refreshSaves(user);
      } catch (e) {
          console.error("Cloud save failed", e);
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
          
          refreshSaves(user);
      } catch (e) { console.error("Cloud delete failed", e); }
  };

  const loadGameById = async (id: string) => {
      if (isGlobalLoading) return; 
      
      setIsGlobalLoading(true); 
      let data: any = null;

      if (user && db) {
          try {
              // Timeout fetch to prevent hanging - 15s
              const fetchPromise = getDoc(doc(db, "users", user.uid, "games", id));
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000));
              
              const docSnap = await Promise.race([fetchPromise, timeoutPromise]) as any;
              
              if (docSnap.exists()) {
                  data = docSnap.data();
              }
          } catch (e) {
              console.error("Cloud load error", e);
              showNotification("Erreur chargement Cloud (Timeout/Réseau)");
              setIsGlobalLoading(false);
              return;
          }
      }

      if (data) {
          try {
              // Date reconstruction
              data.state.currentDate = new Date(data.state.currentDate);
              
              setGameState(data.state);
              setFullHistory(data.history);
              if (data.aiProvider) setAiProvider(data.aiProvider);
              setEventQueue([]);
              setShowStartModal(false);
              
              // Launch Game
              setAppMode('game_active');
              startLoadingSequence();
              setIsGlobalLoading(false); 
              showNotification(`Partie chargée: ${data.state.playerCountry}`);
          } catch (e) {
              console.error("Save corrupted", e);
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

  const loadMostRecentGame = () => {
      if (availableSaves.length > 0) {
          loadGameById(availableSaves[0].id);
      }
  };

  const openLoadMenu = () => {
      refreshSaves(user);
      setIsLoadMenuOpen(true);
  };

  const startLoadingSequence = () => {
      setCurrentScreen('loading');
  };

  const showNotification = (msg: string) => {
      setNotification(msg);
      setTimeout(() => setNotification(null), 3000); 
  }

  const handleExitToDashboard = () => {
      setIsSettingsOpen(false);
      setAppMode('portal_dashboard');
      setIsGlobalLoading(false); 
      refreshSaves(user);
  };

  const handleExitApp = () => {
      try { window.close(); } catch (e) {}
      // @ts-ignore
      if (typeof navigator.app !== 'undefined' && navigator.app.exitApp) navigator.app.exitApp();
  };

  // --- AUTH HANDLERS ---
  const handleGoogleLogin = async () => {
      try {
          await loginWithGoogle();
          // Notification handled by auth state change
      } catch (e) {
          showNotification("Erreur Google Login.");
      }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          if (isRegistering) {
              await registerWithEmail(authEmail, authPassword);
          } else {
              await loginWithEmail(authEmail, authPassword);
          }
          // Modal closing is handled by the auth state listener
      } catch (err: any) {
          console.error(err);
          let msg = "Erreur d'authentification.";
          if (err.code === 'auth/invalid-credential') msg = "Email ou mot de passe incorrect.";
          if (err.code === 'auth/email-already-in-use') msg = "Cet email est déjà utilisé.";
          if (err.code === 'auth/weak-password') msg = "Le mot de passe est trop faible.";
          showNotification(msg);
      }
  };

  const handleLogout = async () => {
      await logout();
      showNotification("Déconnecté.");
      setAppMode('portal_landing');
  };

  const handleLogin = () => {
      setAppMode('portal_landing');
      setShowLoginModal(true);
  };

  // --- BUG REPORTING ---
  const handleSendBugReport = async () => {
      if (!bugTitle.trim() || !bugDescription.trim()) {
          showNotification("Veuillez remplir tous les champs.");
          return;
      }

      setIsSendingBug(true);
      
      // Timeout de 5 secondes pour éviter le blocage
      const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Timeout")), 5000)
      );

      try {
          if (db) {
              const reportData = {
                  title: bugTitle,
                  description: bugDescription,
                  userEmail: user?.email || "anonymous",
                  userId: user?.uid || "unknown",
                  timestamp: Date.now(),
                  status: 'new'
              };

              // Race between DB write and Timeout
              await Promise.race([
                  addDoc(collection(db, "bug_reports"), reportData),
                  timeoutPromise
              ]);

              showNotification("Nous vous remercions pour votre signalement");
          } else {
              // Fallback si DB non dispo
              console.warn("DB not available for bug report");
              showNotification("Service indisponible, merci quand même !");
          }
      } catch (e) {
          console.error("Report send issue:", e);
          // On ferme quand même positivement pour ne pas frustrer l'utilisateur (Firestore peut sync plus tard)
          showNotification("Signalement pris en compte.");
      } finally {
          setIsSendingBug(false);
          setShowBugReportModal(false);
          setBugTitle("");
          setBugDescription("");
      }
  };

  // Launch New Game from Dashboard
  const launchGeoSim = () => {
      // RESET STATE FOR A NEW GAME
      setGameState({
        gameId: Date.now().toString(),
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
      setFullHistory([]);
      setEventQueue([]);
      setShowStartModal(true);

      setAppMode('game_active');
      setCurrentScreen('splash'); // Splash -> Loading -> Game (handled by Effects)
  };

  // --- GAMEPLAY EFFECTS ---

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
        
        setGameState(prev => {
            const hasNuke = hasNuclearArsenal(prev.playerCountry!);
            const hasSpace = hasSpaceProgramInitial(prev.playerCountry!);
            const stats = getInitialStats(prev.playerCountry!);

            // CHECK NATO MEMBERSHIP
            const isNatoMember = NATO_MEMBERS_2000.includes(prev.playerCountry!);
            const initialAlliance = isNatoMember ? {
                name: "OTAN",
                type: "Alliance Militaire & Nucléaire",
                members: NATO_MEMBERS_2000,
                leader: "États-Unis"
            } : null;
            
            const newState = {
                ...prev,
                ownedTerritories: [prev.playerCountry!],
                militaryPower: stats.power,
                corruption: stats.corruption,
                hasNuclear: hasNuke,
                hasSpaceProgram: hasSpace,
                militaryRank: calculateRank(stats.power),
                alliance: initialAlliance // Init alliance
            };
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

  // --- DIPLOMATIC CHAT HANDLER ---
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

      setGameState(prev => ({
          ...prev,
          isProcessing: true,
          chatHistory: [...prev.chatHistory, userMsg]
      }));

      setTypingParticipants(targets);

      const context = {
          militaryPower: gameState.militaryPower,
          economyHealth: gameState.economyHealth,
          globalTension: gameState.globalTension,
          hasNuclear: gameState.hasNuclear
      };

      const updatedHistoryForContext = [...gameState.chatHistory, userMsg];

      try {
        const aiPromises = targets.map(async (targetCountry) => {
            const responseText = await sendDiplomaticMessage(
                gameState.playerCountry!,
                targetCountry, 
                targets, 
                message,
                updatedHistoryForContext,
                context,
                aiProvider
            );
            setTypingParticipants(prev => prev.filter(p => p !== targetCountry));
            if (!responseText) return null;
            return {
                id: `msg-${Date.now()}-${targetCountry}`,
                sender: 'ai',
                senderName: targetCountry,
                targets: targets, 
                text: responseText,
                timestamp: Date.now() + Math.floor(Math.random() * 500),
                isRead: false // AI response is unread by default
            } as ChatMessage;
        });

        const aiResponses = await Promise.all(aiPromises);
        const validResponses = aiResponses.filter(r => r !== null) as ChatMessage[];

        setGameState(prev => ({
            ...prev,
            isProcessing: false,
            chatHistory: [...prev.chatHistory, ...validResponses]
        }));
        
        if (validResponses.length > 0) {
            setHasUnreadChat(true);
        }

      } catch (e) {
          console.error("Chat error", e);
          setTypingParticipants([]); 
          setGameState(prev => ({ ...prev, isProcessing: false }));
      }
  };

  // Helper to mark messages as read
  const handleMarkChatRead = (targets: string[]) => {
      if (!gameState.playerCountry) return;
      
      const targetKey = [...targets].sort().join(',');

      setGameState(prev => {
          const newHistory = prev.chatHistory.map(msg => {
              // Normalize participants for the message
              const msgParticipants = msg.sender === 'player' 
                ? msg.targets 
                : [msg.senderName, ...msg.targets.filter(t => t !== prev.playerCountry)];
              
              const msgKey = [...msgParticipants].sort().join(',');
              
              if (msgKey === targetKey && !msg.isRead && msg.sender !== 'player') {
                  return { ...msg, isRead: true };
              }
              return msg;
          });
          
          // Check if any unread remain globally
          const remainingUnread = newHistory.some(m => !m.isRead && m.sender !== 'player');
          setHasUnreadChat(remainingUnread);

          return { ...prev, chatHistory: newHistory };
      });
  };

  // --- TURN PROCESSING ---
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

    const entityDesc = gameState.mapEntities.map(e => `${e.label || e.type} en ${e.country}`);
    const isLandlocked = isCountryLandlocked(gameState.playerCountry);
    const recentChat = gameState.chatHistory.slice(-10).map(m => `${m.sender === 'player' ? 'Joueur' : m.senderName}: ${m.text}`).join(' | ');

    const result = await simulateTurn(
        gameState.playerCountry,
        formattedDate,
        finalOrderString,
        gameState.events,
        gameState.ownedTerritories,
        entityDesc,
        isLandlocked,
        gameState.hasNuclear,
        recentChat,
        gameState.chaosLevel, // Pass Chaos Level
        aiProvider
    );

    // AUTOMATIC DATE INCREMENT FROM AI
    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1); // Default to month if undefined, though schema enforces it

    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({
        id: `turn-${gameState.turn}-ai-${idx}`,
        date: nextDate.toLocaleDateString('fr-FR'),
        type: e.type,
        headline: e.headline,
        description: e.description,
        relatedCountry: e.relatedCountry
    }));

    // PROCESS MAP UPDATES
    let newOwnedTerritories = [...gameState.ownedTerritories];
    let newEntities = [...gameState.mapEntities];
    let newHasNuclear = gameState.hasNuclear;
    let cameraTarget = gameState.playerCountry;

    if (result.mapUpdates) {
        for (const update of result.mapUpdates) {
            
            // ANNEXATION / TRANSFERT / LIBÉRATION
            if (update.type === 'annexation') {
                const target = update.targetCountry;
                const newOwner = update.newOwner || gameState.playerCountry; // Fallback to player if unspecified in classic format

                // 1. Remove from whoever owns it (implicitly logic here, but primarily tracking player's list)
                if (newOwnedTerritories.includes(target)) {
                    // If player owned it, they lose it unless they are the new owner
                    if (newOwner !== gameState.playerCountry) {
                        newOwnedTerritories = newOwnedTerritories.filter(t => t !== target);
                    }
                }

                // 2. Add to new owner if it's the player
                if (newOwner === gameState.playerCountry && !newOwnedTerritories.includes(target)) {
                    newOwnedTerritories.push(target);
                    if (hasNuclearArsenal(target)) {
                        newHasNuclear = true;
                    }
                }
            }

            // CONSTRUCTIONS
            if (['build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense'].includes(update.type)) {
                let mType: MapEntityType = 'factory';
                if (update.type === 'build_port') mType = 'port';
                if (update.type === 'build_airport') mType = 'military_airport';
                if (update.type === 'build_airbase') mType = 'airbase';
                if (update.type === 'build_defense') mType = 'defense';

                newEntities.push({
                    id: `ent-${Date.now()}-${Math.random()}`,
                    type: mType,
                    country: update.targetCountry,
                    lat: update.lat || 0,
                    lng: update.lng || 0,
                    label: update.label
                });
            }
        }
    }

    // PROCESS ALLIANCE UPDATE
    let currentAlliance = gameState.alliance;
    if (result.allianceUpdate) {
        if (result.allianceUpdate.action === 'create' || result.allianceUpdate.action === 'update') {
            if (result.allianceUpdate.name && result.allianceUpdate.members && result.allianceUpdate.leader) {
                currentAlliance = {
                    name: result.allianceUpdate.name,
                    type: result.allianceUpdate.type || 'Militaire',
                    members: result.allianceUpdate.members,
                    leader: result.allianceUpdate.leader
                };
                showNotification(`Alliance mise à jour: ${currentAlliance.name}`);
            }
        } else if (result.allianceUpdate.action === 'dissolve') {
            currentAlliance = null;
            showNotification("Alliance dissoute.");
        }
    }

    // Determine Camera Focus
    if (newAiEvents.length > 0 && newAiEvents[0].relatedCountry) {
        cameraTarget = newAiEvents[0].relatedCountry;
    } else if (result.mapUpdates && result.mapUpdates.length > 0) {
        cameraTarget = result.mapUpdates[0].targetCountry;
    }

    const newHistory = [...fullHistory, playerEvent, ...newAiEvents];
    
    // HANDLE INCOMING MESSAGES
    let newChatHistory = [...gameState.chatHistory];
    if (result.incomingMessages && result.incomingMessages.length > 0) {
        result.incomingMessages.forEach(msg => {
            // NORMALISATION DU NOM DE L'EXPÉDITEUR (USA -> États-Unis)
            const normalizedSender = normalizeCountryName(msg.sender);
            
            // Normalisation des cibles (pour s'assurer que si l'IA cible "USA", ça devient "États-Unis" dans la logique de groupe)
            const normalizedTargets = msg.targets.map(t => normalizeCountryName(t));
            
            // On s'assure que le joueur est inclus dans les cibles si ce n'est pas le cas
            if (!normalizedTargets.includes(gameState.playerCountry!)) {
                normalizedTargets.push(gameState.playerCountry!);
            }

            newChatHistory.push({
                id: `msg-${Date.now()}-${Math.random()}`,
                sender: 'ai',
                senderName: normalizedSender,
                targets: normalizedTargets,
                text: msg.text,
                timestamp: Date.now(),
                isRead: false // Incoming message is unread
            });
            showNotification(`Message diplomatique : ${normalizedSender}`);
        });
        setHasUnreadChat(true);
    }

    setFullHistory(newHistory);

    // CALCULATE NEW STATS
    const newGlobalTension = Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange));
    const newEconomyHealth = Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange));
    const newMilitaryPower = Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange));
    const newPopularity = Math.max(0, Math.min(100, gameState.popularity + (result.popularityChange || 0)));
    const newCorruption = Math.max(0, Math.min(100, gameState.corruption + (result.corruptionChange || 0)));
    
    // Update Space Program status if AI says so
    let newHasSpaceProgram = gameState.hasSpaceProgram;
    if (result.spaceProgramActive === true) {
        newHasSpaceProgram = true;
        if (!gameState.hasSpaceProgram) showNotification("Programme spatial activé !");
    }

    // Update Rank
    const newRank = calculateRank(newMilitaryPower);

    // CHECK GAME OVER CONDITIONS
    let gameOver = false;
    let failReason = null;

    // Condition 1: Lost original country
    if (!newOwnedTerritories.includes(gameState.playerCountry)) {
        gameOver = true;
        failReason = "Votre nation a été entièrement annexée. Votre gouvernement est tombé.";
    } 
    // Condition 2: Stats critical
    else {
        let failCount = 0;
        if (newEconomyHealth <= 0) failCount++;
        if (newMilitaryPower <= 0) failCount++;
        if (newPopularity <= 0) failCount++;
        if (newGlobalTension >= 100) failCount++;
        if (newCorruption >= 100) failCount++; // Corruption makes you a failed state

        if (failCount >= 3) {
            gameOver = true;
            failReason = "Effondrement systémique. L'État a cessé de fonctionner.";
        }
    }

    const newGameState = {
        ...gameState,
        currentDate: nextDate,
        turn: gameState.turn + 1,
        ownedTerritories: newOwnedTerritories,
        mapEntities: newEntities,
        globalTension: newGlobalTension,
        economyHealth: newEconomyHealth,
        militaryPower: newMilitaryPower,
        popularity: newPopularity,
        corruption: newCorruption,
        hasNuclear: newHasNuclear,
        hasSpaceProgram: newHasSpaceProgram,
        militaryRank: newRank,
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
        deleteSave(gameState.gameId);
    }
  };

  const handleRegionSelect = (region: string) => {
    if (!gameState.playerCountry) {
        setPendingCountry(region);
        setShowStartModal(true);
    }
  };

  const confirmCountrySelection = () => {
      if (pendingCountry) {
          setGameState(prev => ({ ...prev, playerCountry: pendingCountry }));
          setPendingCountry(null);
          setFocusCountry(pendingCountry);
      }
  };

  const toggleWindow = (win: 'events' | 'history' | 'chat' | 'alliance') => {
      if (activeWindow === win) {
          setActiveWindow('none');
      } else {
          setActiveWindow(win);
          // Don't auto clear unread when opening window, clear when opening specific chat
      }
  };

  // --- SHARED MODAL RENDERER (Load Menu) ---
  const renderLoadMenuOverlay = () => (
      <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-0 max-w-md w-full border border-stone-200 overflow-hidden flex flex-col max-h-[80vh]">
              {/* Header */}
              <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                      <span>📂</span> Charger une partie
                  </h3>
                  <button onClick={() => setIsLoadMenuOpen(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
                  {isSyncing && availableSaves.length === 0 ? (
                      <div className="text-center text-slate-400 py-10 animate-pulse">Sync avec le Cloud...</div>
                  ) : availableSaves.length === 0 ? (
                      <div className="text-center text-slate-400 py-10 italic">
                          {user ? "Aucune sauvegarde Cloud trouvée." : "Connectez-vous pour voir vos sauvegardes."}
                      </div>
                  ) : (
                      availableSaves.map((save) => (
                          <div key={save.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex items-center gap-3 hover:bg-blue-50 transition-colors group">
                              <div className="w-10 h-7 bg-slate-200 rounded overflow-hidden shadow">
                                    <img src={getFlagUrl(save.country) || ''} alt={save.country} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="font-bold text-slate-800 text-sm truncate">{save.country}</div>
                                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                                      Tour {save.turn} • {save.date}
                                  </div>
                              </div>
                              <div className="flex gap-2">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); loadGameById(save.id); }}
                                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors shadow-sm"
                                >
                                    Charger
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); deleteSave(save.id); }}
                                    className="px-3 py-2 bg-white border border-slate-200 text-red-500 text-xs font-bold rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors shadow-sm"
                                    title="Supprimer"
                                >
                                    🗑
                                </button>
                              </div>
                          </div>
                      ))
                  )}
              </div>
          </div>
      </div>
  );

  // =========================================================
  // --- RENDU 1 : POLITIKA LANDING PAGE (FACADE) ---
  // =========================================================
  if (appMode === 'portal_landing') {
      return (
          <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-black selection:text-white overflow-x-hidden">
              {/* Navbar */}
              <nav className="relative flex items-center justify-center px-6 py-6 max-w-7xl mx-auto">
                  {/* Centered Title */}
                  <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-black rounded-full border-4 border-slate-200"></div>
                      <h1 className="text-2xl font-black tracking-tight uppercase">Politika</h1>
                  </div>

                  {/* Right Button */}
                  {/* Optionnel: Afficher un bouton Login en haut à droite si user est null, sinon logout */}
                  {user && (
                    <button 
                        onClick={handleLogout}
                        className="absolute right-6 text-xs font-bold text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    >
                        Déconnexion
                    </button>
                  )}
              </nav>

              {/* Hero Section */}
              <main className="max-w-7xl mx-auto px-6 mt-10 md:mt-20 flex flex-col md:flex-row items-center gap-12">
                  <div className="flex-1 space-y-6">
                      <h2 className="text-5xl md:text-7xl font-black leading-tight tracking-tighter">
                          RÉÉCRIVEZ<br/>L'HISTOIRE.
                      </h2>
                      <p className="text-lg text-slate-500 max-w-md leading-relaxed">
                          Vous êtes celui qui décidera de l'histoire qu'on retiendra.
                      </p>
                      
                      <div className="flex gap-4 pt-4">
                          <button 
                            onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)}
                            className={`px-8 py-4 rounded-xl font-bold text-lg shadow-xl hover:scale-105 transition-transform flex items-center gap-2 ${
                                user 
                                ? 'bg-black text-white hover:bg-stone-800' 
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                              {user ? "ACCÉDER AU QG" : "JOUER"} <span>➔</span>
                          </button>
                      </div>
                  </div>

                  {/* Visual Arcade Style */}
                  <div className="flex-1 relative w-full aspect-square md:aspect-video bg-slate-50 rounded-3xl border-2 border-slate-100 overflow-hidden shadow-2xl">
                      {/* Stylized World Map Abstract */}
                      <div className="absolute inset-0 opacity-20 bg-[url('https://upload.wikimedia.org/wikipedia/commons/e/ec/World_map_blank_without_borders.svg')] bg-cover bg-center"></div>
                      
                      {/* Floating Cards Mockup */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-white rounded-xl shadow-lg border border-slate-200 p-4 flex flex-col gap-2 rotate-3 hover:rotate-0 transition-transform duration-700">
                           <div className="h-4 w-1/3 bg-slate-200 rounded"></div>
                           <div className="flex-1 bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden relative">
                               <div className="absolute inset-0 bg-blue-50"></div>
                               <div className="z-10 text-6xl">🌍</div>
                               {/* Neural Network Nodes Lines */}
                               <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 100 100">
                                   <circle cx="20" cy="20" r="2" fill="black" />
                                   <circle cx="80" cy="30" r="2" fill="black" />
                                   <circle cx="50" cy="80" r="2" fill="black" />
                                   <line x1="20" y1="20" x2="80" y2="30" stroke="black" strokeWidth="0.5" />
                                   <line x1="80" y1="30" x2="50" y2="80" stroke="black" strokeWidth="0.5" />
                                   <line x1="50" y1="80" x2="20" y2="20" stroke="black" strokeWidth="0.5" />
                               </svg>
                           </div>
                           <div className="h-2 w-full bg-slate-100 rounded"></div>
                           <div className="h-2 w-2/3 bg-slate-100 rounded"></div>
                      </div>
                  </div>
              </main>

              {/* LOGIN MODAL */}
              {showLoginModal && (
                  <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-slate-200">
                          <div className="flex justify-between items-center mb-6">
                              <h3 className="text-xl font-bold text-slate-800">
                                  {isRegistering ? "Créer un compte" : "Connexion"}
                              </h3>
                              <button onClick={() => setShowLoginModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
                          </div>
                          
                          <form onSubmit={handleEmailAuth} className="space-y-4">
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email / Nom d'utilisateur</label>
                                  <input 
                                    type="email" 
                                    required
                                    className="w-full p-3 rounded-lg border border-slate-300 focus:outline-blue-500 bg-slate-50"
                                    placeholder="exemple@email.com"
                                    value={authEmail}
                                    onChange={(e) => setAuthEmail(e.target.value)}
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mot de passe</label>
                                  <input 
                                    type="password" 
                                    required
                                    className="w-full p-3 rounded-lg border border-slate-300 focus:outline-blue-500 bg-slate-50"
                                    placeholder="••••••••"
                                    value={authPassword}
                                    onChange={(e) => setAuthPassword(e.target.value)}
                                  />
                              </div>
                              <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg transition-transform active:scale-95">
                                  {isRegistering ? "S'inscrire" : "Se connecter"}
                              </button>
                          </form>

                          <div className="mt-4 text-center">
                              <button 
                                onClick={() => setIsRegistering(!isRegistering)}
                                className="text-xs text-blue-600 font-bold hover:underline"
                              >
                                  {isRegistering ? "Déjà un compte ? Se connecter" : "Pas de compte ? S'inscrire"}
                              </button>
                          </div>

                          <div className="relative my-6">
                              <div className="absolute inset-0 flex items-center">
                                  <div className="w-full border-t border-slate-200"></div>
                              </div>
                              <div className="relative flex justify-center text-xs">
                                  <span className="px-2 bg-white text-slate-400 font-bold uppercase">Ou se connecter avec</span>
                              </div>
                          </div>

                          <button 
                            onClick={handleGoogleLogin}
                            className="w-full py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                          >
                              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                              Google
                          </button>
                      </div>
                  </div>
              )}

              {/* Footer */}
              <footer className="mt-20 py-10 text-center text-slate-400 text-sm border-t border-slate-100">
                  <p>© 2025 POLITIKA - Powered by Gemini AI</p>
              </footer>
          </div>
      );
  }

  // =========================================================
  // --- RENDU 2 : POLITIKA DASHBOARD (SELECTEUR) ---
  // =========================================================
  if (appMode === 'portal_dashboard') {
      return (
          <div className="min-h-screen bg-slate-50 text-slate-800 font-sans relative">
              
              {/* GLOBAL LOADING OVERLAY FOR DASHBOARD */}
              {isGlobalLoading && (
                  <div className="fixed inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in">
                      <GameLogo size="small" theme="light" />
                      <div className="mt-6 text-emerald-600 font-bold text-lg animate-pulse tracking-widest uppercase">
                          Chargement des données...
                      </div>
                      <p className="text-xs text-slate-400 mt-2">Récupération depuis le Cloud sécurisé</p>
                  </div>
              )}

              {/* Header */}
              <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20">
                  <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-black rounded-full"></div>
                      <h1 className="text-xl font-black uppercase tracking-tight">Politika <span className="text-slate-400 font-normal normal-case ml-2">Tableau de bord</span></h1>
                  </div>
                  
                  {user ? (
                      <div className="flex items-center gap-4">
                          <button 
                            onClick={() => setShowBugReportModal(true)}
                            className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200 transition-colors mr-2 hidden md:block"
                          >
                              🐞 Signaler bug
                          </button>

                          <div className="text-right hidden md:block">
                              <div className="text-sm font-bold">{user.displayName || user.email}</div>
                              <div className="text-[10px] text-slate-500 uppercase">Connecté</div>
                          </div>
                          {user.photoURL ? (
                              <img src={user.photoURL} className="w-10 h-10 rounded-full border border-slate-200" alt="" />
                          ) : (
                              <div className="w-10 h-10 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold">
                                  {user.email ? user.email[0].toUpperCase() : 'U'}
                              </div>
                          )}
                          <button onClick={handleLogout} className="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 p-2 rounded-lg transition-colors">
                              ✕
                          </button>
                      </div>
                  ) : (
                      <button 
                        onClick={handleLogin}
                        className="text-xs font-bold bg-black text-white px-3 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
                      >
                          Se connecter
                      </button>
                  )}
              </header>

              <main className="max-w-6xl mx-auto p-6 md:p-10">
                  <h2 className="text-3xl font-bold mb-8 text-slate-900">Bibliothèque</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      
                      {/* CARD 1: GEOSIM MAIN GAME */}
                      <div 
                        className="group bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-2xl transition-all duration-300 cursor-pointer flex flex-col h-80 relative"
                        onClick={launchGeoSim}
                      >
                          <div className="h-40 bg-slate-800 relative overflow-hidden">
                              <div className="absolute inset-0 opacity-40 bg-[url('https://upload.wikimedia.org/wikipedia/commons/e/ec/World_map_blank_without_borders.svg')] bg-cover bg-center group-hover:scale-105 transition-transform duration-700"></div>
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                              <div className="absolute bottom-4 left-4">
                                  <GameLogo size="small" theme="dark" />
                              </div>
                          </div>
                          <div className="p-6 flex-1 flex flex-col">
                              <div className="flex justify-between items-start mb-2">
                                  <h3 className="text-xl font-bold">GeoSim</h3>
                                  <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded uppercase">Installé</span>
                              </div>
                              <p className="text-sm text-slate-500 mb-4 line-clamp-2">
                                  Simulation géopolitique mondiale alimentée par IA générative. Scénario An 2000.
                              </p>
                              <div className="mt-auto">
                                  <button className="w-full py-3 bg-black text-white font-bold rounded-lg group-hover:bg-blue-600 transition-colors">
                                      LANCER
                                  </button>
                              </div>
                          </div>
                      </div>

                      {/* CARD 2: SAVES LIST */}
                      <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm flex flex-col h-80 col-span-1 md:col-span-1 lg:col-span-2">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                  <span>💾</span> Sauvegardes Cloud
                              </h3>
                              <span className="text-xs text-slate-400 font-mono">
                                {isSyncing ? "Sync..." : `${availableSaves.length} fichiers`}
                              </span>
                          </div>
                          
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                              {isSyncing ? (
                                  <div className="h-full flex items-center justify-center text-slate-400 animate-pulse text-xs">
                                      Chargement des données...
                                  </div>
                              ) : availableSaves.length === 0 ? (
                                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                      <span className="text-2xl opacity-30 mb-2">📂</span>
                                      <p className="text-sm">Aucune partie sauvegardée.</p>
                                  </div>
                              ) : (
                                  availableSaves.map(save => (
                                      <div key={save.id} className="group flex items-center gap-4 p-3 hover:bg-blue-50 rounded-xl transition-colors border border-transparent hover:border-blue-100">
                                          <div className="w-12 h-8 rounded bg-slate-200 overflow-hidden shadow-sm relative shrink-0">
                                              <img src={getFlagUrl(save.country) || ''} alt={save.country} className="w-full h-full object-cover" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                              <div className="font-bold text-slate-800 text-sm truncate">{save.country}</div>
                                              <div className="text-xs text-slate-500">Tour {save.turn} • {save.date}</div>
                                          </div>
                                          <div className="flex gap-2">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); loadGameById(save.id); }}
                                                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors shadow-sm"
                                            >
                                                Charger
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); deleteSave(save.id); }}
                                                className="px-3 py-2 bg-white border border-slate-200 text-red-500 text-xs font-bold rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors shadow-sm"
                                                title="Supprimer"
                                            >
                                                🗑
                                            </button>
                                          </div>
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>

                  </div>
              </main>

              {/* BUG REPORT MODAL */}
              {showBugReportModal && (
                  <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-slate-200 animate-fade-in-up">
                          <div className="flex justify-between items-center mb-4">
                              <h3 className="text-xl font-bold text-red-600 flex items-center gap-2">
                                  <span>🐞</span> Signaler un bug
                              </h3>
                              <button 
                                onClick={() => setShowBugReportModal(false)}
                                className="text-slate-400 hover:text-slate-600 font-bold"
                              >
                                  ✕
                              </button>
                          </div>
                          
                          <div className="space-y-4">
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Titre du problème</label>
                                  <input 
                                    type="text"
                                    className="w-full p-2 rounded-lg border border-slate-300 focus:outline-red-500 bg-slate-50 text-sm"
                                    placeholder="Ex: Le jeu bloque au tour 5"
                                    value={bugTitle}
                                    onChange={(e) => setBugTitle(e.target.value)}
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description détaillée</label>
                                  <textarea 
                                    className="w-full p-2 rounded-lg border border-slate-300 focus:outline-red-500 bg-slate-50 text-sm h-32 resize-none"
                                    placeholder="Décrivez ce qui s'est passé..."
                                    value={bugDescription}
                                    onChange={(e) => setBugDescription(e.target.value)}
                                  />
                              </div>
                              
                              <button 
                                onClick={handleSendBugReport}
                                disabled={isSendingBug}
                                className={`w-full py-3 rounded-lg font-bold text-white shadow-md transition-colors ${
                                    isSendingBug ? 'bg-slate-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
                                }`}
                              >
                                  {isSendingBug ? 'Envoi...' : 'Envoyer le rapport'}
                              </button>
                          </div>
                      </div>
                  </div>
              )}

              {/* NOTIFICATION OVERLAY FOR DASHBOARD (Z-INDEX INCREASED) */}
              {notification && (
                <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-stone-800 text-white px-6 py-2 rounded-full shadow-xl z-[60] animate-fade-in-down text-sm font-bold flex items-center gap-2">
                    <span className="text-emerald-400">✓</span> {notification}
                </div>
              )}
          </div>
      );
  }


  // =========================================================
  // --- RENDU 3 : LE JEU ORIGINAL GEOSIM (INTACT) ---
  // =========================================================
  if (appMode === 'game_active') {

    // --- SUB-RENDERERS DU JEU ORIGINAL ---

    if (currentScreen === 'splash') {
        return (
            <div className="w-screen h-screen bg-slate-50 flex items-center justify-center animate-fade-in">
                <GameLogo size="large" theme="light" />
            </div>
        );
    }

    if (currentScreen === 'loading') {
        return (
            <div className="w-screen h-screen bg-slate-50 flex flex-col items-center justify-center text-emerald-600 font-mono">
                <div className="mb-8">
                    <GameLogo size="small" theme="light" />
                </div>
                <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden mb-4 shadow-inner">
                    <div className="h-full bg-emerald-500 animate-[width_3s_ease-in-out_forwards]" style={{ width: '0%' }}></div>
                </div>
                <div className="text-sm font-bold text-slate-600 animate-pulse">RECALIBRAGE TEMPOREL...</div>
            </div>
        );
    }

    // GAME SCREEN (The actual gameplay loop)
    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
        
        <div className="absolute inset-0 z-0">
            <WorldMap 
                playerCountry={gameState.playerCountry}
                ownedTerritories={gameState.ownedTerritories}
                mapEntities={gameState.mapEntities}
                onRegionClick={handleRegionSelect}
                focusCountry={focusCountry}
            />
        </div>

        {/* GAME OVER MODAL */}
        {gameState.isGameOver && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center animate-fade-in">
                <div className="bg-red-900/30 border-4 border-red-600 rounded-2xl p-8 max-w-lg w-full shadow-[0_0_50px_rgba(220,38,38,0.5)]">
                    <h1 className="text-5xl font-black text-red-500 mb-4 tracking-wider uppercase font-serif drop-shadow-md">
                        ÉCHEC CRITIQUE
                    </h1>
                    <div className="w-full h-1 bg-red-600 mb-6"></div>
                    <p className="text-xl text-stone-200 mb-8 leading-relaxed font-bold">
                        {gameState.gameOverReason}
                    </p>
                    <div className="text-stone-400 text-sm mb-8">
                        Votre mandat s'achève ici, dans les ruines de l'histoire.
                    </div>
                    <button 
                        onClick={handleExitToDashboard}
                        className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-widest rounded shadow-lg transition-transform hover:scale-105 active:scale-95"
                    >
                        Retour au Tableau de bord
                    </button>
                </div>
            </div>
        )}

        {/* START MODAL - INSTRUCTIONS (Top Center, Smaller) */}
        {showStartModal && !gameState.playerCountry && !pendingCountry && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-start pt-16 pointer-events-none animate-fade-in p-4">
                <div className="bg-white/95 backdrop-blur-md p-4 rounded-xl max-w-sm w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto transform scale-90">
                    <div className="flex justify-between items-start mb-2">
                        <h2 className="text-lg font-bold text-stone-800">Sélectionnez votre nation</h2>
                        <button onClick={() => setShowStartModal(false)} className="text-stone-400 hover:text-stone-600 font-bold">✕</button>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm text-stone-600">
                            Touchez un pays sur la carte pour en prendre le contrôle et débuter votre mandat.
                        </p>
                        <div className="flex items-center justify-center gap-2 text-[10px] text-stone-400">
                            <span className="animate-pulse">●</span> En attente de sélection satellite...
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* CONFIRMATION MODAL (Center, Standard) - Only visible when pendingCountry is set */}
        {pendingCountry && !gameState.playerCountry && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none animate-fade-in p-4">
                <div className="bg-white/95 backdrop-blur-md p-4 rounded-xl max-w-xs w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto transform scale-95">
                    <div className="space-y-4">
                        <div className="text-4xl">🌍</div>
                        <div>
                            <p className="text-sm text-stone-500 uppercase tracking-widest font-bold">Candidat Sélectionné</p>
                            <h3 className="text-2xl font-serif font-bold text-blue-800 mt-1">{pendingCountry}</h3>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setPendingCountry(null)}
                                className="flex-1 py-2 border border-stone-300 rounded-lg text-stone-600 font-bold hover:bg-stone-100 text-sm"
                            >
                                Annuler
                            </button>
                            <button 
                                onClick={confirmCountrySelection}
                                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg text-sm"
                            >
                                Confirmer
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* CLICK OUTSIDE OVERLAY (To close windows) */}
        {activeWindow !== 'none' && (
            <div 
                className="absolute inset-0 z-40 bg-black/10" 
                onClick={() => setActiveWindow('none')}
            />
        )}

        {/* WINDOWS */}
        <EventLog 
            isOpen={activeWindow === 'events'}
            onClose={() => setActiveWindow('none')}
            eventQueue={eventQueue}
            onReadEvent={handleReadEvent}
            playerAction={playerInput}
            setPlayerAction={setPlayerInput}
            onAddOrder={handleAddOrder}
            pendingOrders={pendingOrders}
            isProcessing={gameState.isProcessing}
            onGetSuggestions={handleGetSuggestions}
            turn={gameState.turn}
        />

        <HistoryLog
            isOpen={activeWindow === 'history'}
            onClose={() => setActiveWindow('none')}
            history={fullHistory}
        />

        <ChatInterface
            isOpen={activeWindow === 'chat'}
            onClose={() => toggleWindow('chat')}
            playerCountry={gameState.playerCountry || "Moi"}
            chatHistory={gameState.chatHistory}
            onSendMessage={handleSendChatMessage}
            isProcessing={gameState.isProcessing}
            allCountries={ALL_COUNTRIES_LIST}
            typingParticipants={typingParticipants}
            onMarkRead={handleMarkChatRead}
        />

        {gameState.alliance && (
            <AllianceWindow
                isOpen={activeWindow === 'alliance'}
                onClose={() => setActiveWindow('none')}
                alliance={gameState.alliance}
                playerCountry={gameState.playerCountry || ""}
            />
        )}

        {/* HUD ELEMENTS */}
        {gameState.playerCountry && !gameState.isGameOver && (
            <>
                {/* TOP LEFT: GAUGES (Inline) */}
                <div className="absolute top-4 left-4 z-20 flex gap-4 bg-stone-900/90 p-3 rounded-lg border border-stone-700 shadow-xl backdrop-blur-md">
                    {/* Tension */}
                    <div className="flex flex-col gap-1 w-20">
                        <span className="text-[10px] uppercase text-stone-400 font-bold">Tension</span>
                        <div className="w-full h-1.5 bg-stone-700 rounded-full overflow-hidden">
                            <div className={`h-full ${gameState.globalTension > 75 ? 'bg-red-500 animate-pulse' : 'bg-orange-400'}`} style={{width: `${gameState.globalTension}%`}}></div>
                        </div>
                    </div>
                    {/* Economy */}
                    <div className="flex flex-col gap-1 w-20">
                        <span className="text-[10px] uppercase text-stone-400 font-bold">Économie</span>
                        <div className="w-full h-1.5 bg-stone-700 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{width: `${gameState.economyHealth}%`}}></div>
                        </div>
                    </div>
                    {/* Popularity */}
                    <div className="flex flex-col gap-1 w-20">
                        <span className="text-[10px] uppercase text-stone-400 font-bold">Popularité</span>
                        <div className="w-full h-1.5 bg-stone-700 rounded-full overflow-hidden">
                            <div className="h-full bg-pink-500" style={{width: `${gameState.popularity}%`}}></div>
                        </div>
                    </div>
                    {/* Corruption */}
                    <div className="flex flex-col gap-1 w-20">
                        <span className="text-[10px] uppercase text-stone-400 font-bold">Corruption</span>
                        <div className="w-full h-1.5 bg-stone-700 rounded-full overflow-hidden">
                            <div className={`h-full ${gameState.corruption > 50 ? 'bg-purple-600' : 'bg-purple-400'}`} style={{width: `${gameState.corruption}%`}}></div>
                        </div>
                    </div>
                    {/* Military */}
                    <div className="flex flex-col gap-1 w-20">
                        <span className="text-[10px] uppercase text-stone-400 font-bold">Militaire</span>
                        <div className="w-full h-1.5 bg-stone-700 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500" style={{width: `${gameState.militaryPower}%`}}></div>
                        </div>
                    </div>
                </div>

                {/* TOP RIGHT: COUNTRY INFO & ICONS (RESTRUCTURED) */}
                <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-1 pointer-events-none">
                    
                    <div className="flex items-center gap-2 pointer-events-auto">
                        {/* User Avatar (In Game) */}
                        {user && (
                            <div className="w-9 h-9 rounded-full border-2 border-emerald-500 overflow-hidden shadow-lg" title={user.displayName}>
                                {user.photoURL ? (
                                    <img src={user.photoURL} alt="User" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-stone-800 text-white flex items-center justify-center font-bold">
                                        {user.email ? user.email[0].toUpperCase() : 'U'}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Country Name Button */}
                        <button 
                            onClick={() => setIsSettingsOpen(true)}
                            className="flex items-center gap-2 bg-stone-900/90 text-white pl-2 pr-4 py-2 rounded-lg border border-stone-700 shadow-xl backdrop-blur-md hover:bg-stone-800 transition-colors h-9"
                        >
                            <div className="w-6 h-4 bg-stone-700 relative overflow-hidden rounded shadow-sm">
                                <img src={getFlagUrl(gameState.playerCountry) || `https://flagcdn.com/w40/un.png`} 
                                    onError={(e) => (e.currentTarget.style.display = 'none')}
                                    className="object-cover w-full h-full" alt="" />
                            </div>
                            <span className="font-bold text-sm truncate max-w-[150px]">{gameState.playerCountry}</span>
                        </button>
                    </div>

                    {/* Status Icons (Underneath) - Only show if active */}
                    {(gameState.hasNuclear || gameState.hasSpaceProgram || !isCountryLandlocked(gameState.playerCountry) || (gameState.alliance?.name === "OTAN")) && (
                        <div className="pointer-events-auto flex gap-2 bg-black/60 p-1.5 rounded-lg border border-white/10 backdrop-blur-md">
                            {/* NUCLEAR ICON */}
                            {gameState.hasNuclear && (
                                <div 
                                    title="Puissance Nucléaire"
                                    className="text-sm text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.8)] animate-pulse"
                                >
                                    ☢️
                                </div>
                            )}
                            {/* NATO ICON (Displayed next to nuclear) */}
                            {gameState.alliance?.name === "OTAN" && (
                                <div 
                                    title="Membre OTAN"
                                    className="text-sm text-blue-400 drop-shadow-[0_0_5px_rgba(59,130,246,0.8)]"
                                >
                                    🛡️
                                </div>
                            )}
                            {gameState.hasSpaceProgram && (
                                <div 
                                    title="Programme Spatial Actif"
                                    className="text-sm text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]"
                                >
                                    🚀
                                </div>
                            )}
                            {!isCountryLandlocked(gameState.playerCountry) && (
                                <div 
                                    title="Accès Maritime"
                                    className="text-sm text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,1)]"
                                >
                                    ⚓
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* BOTTOM LEFT: ACTION BUTTONS (ROUND WHITE) */}
                <div className="absolute bottom-6 left-6 z-20 flex gap-4">
                    <button 
                        onClick={() => toggleWindow('events')}
                        className={`w-14 h-14 rounded-full shadow-xl border-2 transition-transform flex items-center justify-center hover:scale-105 active:scale-95 ${
                            activeWindow === 'events' 
                            ? 'bg-blue-50 border-blue-400 text-blue-600' 
                            : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                        }`}
                        title="Ordres & Événements"
                    >
                        <span className="text-2xl">📝</span>
                    </button>
                    <div className="relative">
                        <button 
                            onClick={() => toggleWindow('chat')}
                            className={`w-14 h-14 rounded-full shadow-xl border-2 transition-transform flex items-center justify-center hover:scale-105 active:scale-95 ${
                                activeWindow === 'chat' 
                                ? 'bg-blue-50 border-blue-400 text-blue-600' 
                                : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                            }`}
                            title="Diplomatie"
                        >
                            <span className="text-2xl">💬</span>
                        </button>
                        {hasUnreadChat && (
                            <div className="absolute top-0 right-0 w-4 h-4 bg-red-500 border-2 border-white rounded-full animate-pulse"></div>
                        )}
                    </div>
                    <button 
                        onClick={() => toggleWindow('history')}
                        className={`w-14 h-14 rounded-full shadow-xl border-2 transition-transform flex items-center justify-center hover:scale-105 active:scale-95 ${
                            activeWindow === 'history' 
                            ? 'bg-blue-50 border-blue-400 text-blue-600' 
                            : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                        }`}
                        title="Archives"
                    >
                        <span className="text-2xl">📚</span>
                    </button>
                    {/* ALLIANCE BUTTON - Only visible if alliance exists */}
                    {gameState.alliance && (
                        <button 
                            onClick={() => toggleWindow('alliance')}
                            className={`w-14 h-14 rounded-full shadow-xl border-2 transition-transform flex items-center justify-center hover:scale-105 active:scale-95 animate-fade-in ${
                                activeWindow === 'alliance' 
                                ? 'bg-blue-50 border-blue-400 text-blue-600' 
                                : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                            }`}
                            title="Alliance"
                        >
                            <span className="text-2xl">🤝</span>
                        </button>
                    )}
                </div>
            </>
        )}

        {/* SETTINGS MODAL */}
        {isSettingsOpen && (
            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-stone-100 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-stone-300 overflow-y-auto max-h-[90vh]">
                    <h3 className="font-bold text-xl mb-4 text-stone-800 flex items-center gap-2">
                        <span>⚙️</span> Paramètres
                    </h3>
                    
                    {user && (
                        <div className="mb-4 bg-white p-3 rounded-lg flex items-center gap-3 shadow-sm border border-stone-200">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold">
                                    {user.email ? user.email[0].toUpperCase() : 'U'}
                                </div>
                            )}
                            <div className="flex-1">
                                <div className="text-xs font-bold text-stone-800">{user.displayName || user.email}</div>
                                <div className="text-[10px] text-stone-500">{user.email}</div>
                            </div>
                            <button onClick={handleLogout} className="text-red-500 font-bold text-xs hover:bg-red-50 p-1 rounded">Sortir</button>
                        </div>
                    )}

                    <div className="space-y-4">
                        
                        {/* --- IA CONFIG --- */}
                        <div>
                            <label className="block text-xs font-bold uppercase text-stone-500 mb-2">Moteur IA</label>
                            <div className="flex bg-stone-200 rounded-lg p-1">
                                <button 
                                    onClick={() => setAiProvider('gemini')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${aiProvider === 'gemini' ? 'bg-white shadow text-blue-600' : 'text-stone-500'}`}
                                >
                                    Google Gemini
                                </button>
                                <button 
                                    onClick={() => setAiProvider('groq')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${aiProvider === 'groq' ? 'bg-white shadow text-orange-600' : 'text-stone-500'}`}
                                >
                                    Groq (Llama 3)
                                </button>
                            </div>
                        </div>

                        {/* --- CHAOS LEVEL CONFIG (SANDBOX) --- */}
                        <div>
                            <label className="block text-xs font-bold uppercase text-stone-500 mb-2">Niveau de Chaos (IA Behavior)</label>
                            <div className="grid grid-cols-2 gap-2">
                                {['peaceful', 'normal', 'high', 'chaos'].map((level) => (
                                    <button
                                        key={level}
                                        onClick={() => setGameState(prev => ({...prev, chaosLevel: level as ChaosLevel}))}
                                        className={`py-2 px-2 text-xs font-bold rounded-lg border-2 transition-all capitalize ${
                                            gameState.chaosLevel === level 
                                            ? level === 'chaos' ? 'bg-red-100 border-red-500 text-red-600' : 'bg-blue-100 border-blue-500 text-blue-600'
                                            : 'bg-white border-stone-200 text-stone-400 hover:border-stone-300'
                                        }`}
                                    >
                                        {level === 'peaceful' ? '🕊️ Pacifique' : 
                                        level === 'normal' ? '⚖️ Standard' : 
                                        level === 'high' ? '🔥 Tendu' : '💀 Chaos'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-stone-200 flex flex-col gap-2">
                            <button 
                                onClick={() => { setIsSettingsOpen(false); saveGame(gameState, fullHistory, true); }} 
                                className="w-full py-3 text-white font-bold rounded-lg shadow flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500"
                            >
                                ☁️ Sauvegarder (Cloud)
                            </button>
                            <button onClick={() => { setIsSettingsOpen(false); openLoadMenu(); }} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow">Charger une partie</button>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-3 bg-stone-800 text-white font-bold rounded-lg">Reprendre</button>
                            <button onClick={handleExitToDashboard} className="w-full py-3 bg-stone-200 text-stone-600 font-bold rounded-lg">Quitter vers Tableau de bord</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* LOAD GAME MODAL (IN GAME) */}
        {isLoadMenuOpen && renderLoadMenuOverlay()}
        
        {/* NOTIFICATIONS */}
        {notification && (
            <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-stone-800 text-white px-6 py-2 rounded-full shadow-xl z-50 animate-fade-in-down text-sm font-bold flex items-center gap-2">
                <span className="text-emerald-400">✓</span> {notification}
            </div>
        )}

        {/* DATE CONTROLS */}
        {gameState.playerCountry && !gameState.isGameOver && (
            <DateControls 
                currentDate={gameState.currentDate}
                turn={gameState.turn}
                onNextTurn={handleNextTurn}
                isProcessing={gameState.isProcessing}
            />
        )}

        </div>
    );
  }

  // Fallback
  return null;
};

export default App;