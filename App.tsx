
import React, { useState, useEffect, useRef } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import { GameState, GameEvent, MapEntity, ChatMessage, ChaosLevel, MapEntityType } from './types';
import { simulateTurn, AIProvider } from './services/geminiService';
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

const calculateRank = (power: number): number => Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));
const isCountryLandlocked = (country: string): boolean => LANDLOCKED_COUNTRIES.some(c => country.includes(c));
const hasNuclearArsenal = (country: string): boolean => NUCLEAR_POWERS.some(c => country.includes(c));
const hasSpaceProgramInitial = (country: string): boolean => SPACE_POWERS.some(c => country.includes(c));

const GameLogo = ({ size = 'large', theme = 'dark' }: { size?: 'small' | 'large', theme?: 'dark' | 'light' }) => {
    const isLight = theme === 'light';
    return (
        <div className={`flex flex-col items-center justify-center ${size === 'large' ? 'gap-4' : 'gap-2'}`}>
            <div className={`relative flex items-center justify-center rounded-full border-2 ${isLight ? 'border-emerald-500 bg-white shadow-xl' : 'border-emerald-500 bg-black/80 shadow-[0_0_20px_rgba(16,185,129,0.5)]'} ${size === 'large' ? 'w-32 h-32' : 'w-12 h-12'}`}>
                <div className="absolute inset-0 rounded-full border border-emerald-500/30 overflow-hidden"><div className="absolute top-1/2 left-1/2 w-1/2 h-1/2 origin-top-left bg-gradient-to-r from-transparent to-emerald-500/40 animate-[spin_2s_linear_infinite]" style={{ borderRadius: '100% 0 0 0' }}></div></div>
                <div className="absolute w-full h-[1px] bg-emerald-500/30"></div><div className="absolute h-full w-[1px] bg-emerald-500/30"></div>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping absolute top-1/4 right-1/4"></div>
            </div>
            <h1 className={`font-serif font-bold tracking-widest uppercase ${isLight ? 'text-slate-800' : 'text-white'} ${size === 'large' ? 'text-4xl' : 'text-xl'}`}>GeoSim</h1>
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
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], infrastructure: {},
    worldSummary: "Situation mondiale stable.", strategicSuggestions: [], // NOUVEAUX CHAMPS
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
            snapshot.forEach((doc) => saves.push(doc.data() as SaveMetadata));
            saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
            if (isMountedRef.current) { setAvailableSaves(saves); setHasSave(saves.length > 0); setIsSyncing(false); }
        }, 
        (error) => { console.error(error); if (isMountedRef.current) setIsSyncing(false); }
      );
      return () => unsubscribe();
  }, [user]); 

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') { const timer = setTimeout(() => setCurrentScreen('loading'), 2500); return () => clearTimeout(timer); }
  }, [appMode, currentScreen]);

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'loading') { const timer = setTimeout(() => setCurrentScreen('game'), 3000); return () => clearTimeout(timer); }
  }, [appMode, currentScreen]);

  const saveGame = async (state: GameState, history: GameEvent[], showNotif = true) => {
      if (!user || !db) { if (showNotif) showNotification("Connexion requise pour sauvegarder !"); if (!user) setShowLoginModal(true); return; }
      const metadata: SaveMetadata = { id: state.gameId, country: state.playerCountry || "Inconnu", date: state.currentDate.toLocaleDateString('fr-FR'), turn: state.turn, lastPlayed: Date.now() };
      const fullData = { metadata, state, history, aiProvider };
      try {
          const batch = writeBatch(db);
          batch.set(doc(db, "users", user.uid, "games", state.gameId), JSON.parse(JSON.stringify(fullData)));
          batch.set(doc(db, "users", user.uid, "game_metas", state.gameId), metadata);
          await batch.commit();
          if (showNotif) showNotification("Sauvegarde Cloud réussie !");
      } catch (e) { showNotification("Échec Sauvegarde Cloud"); }
  };

  const deleteSave = async (id: string) => {
      if (!user || !db) return;
      try { const batch = writeBatch(db); batch.delete(doc(db, "users", user.uid, "games", id)); batch.delete(doc(db, "users", user.uid, "game_metas", id)); await batch.commit(); } catch (e) {}
  };

  const loadGameById = async (id: string) => {
      if (isGlobalLoading) return; 
      setIsGlobalLoading(true); 
      let data: any = null;
      if (user && db) { try { const docSnap = await getDoc(doc(db, "users", user.uid, "games", id)); if (docSnap.exists()) data = docSnap.data(); } catch (e) { setIsGlobalLoading(false); return; } }
      if (data) {
          try {
              data.state.currentDate = new Date(data.state.currentDate);
              setGameState(data.state); setFullHistory(data.history); if (data.aiProvider) setAiProvider(data.aiProvider);
              setEventQueue([]); setShowStartModal(false); setAppMode('game_active'); startLoadingSequence(); setIsGlobalLoading(false); 
              showNotification(`Partie chargée: ${data.state.playerCountry}`);
          } catch (e) { showNotification("Erreur de sauvegarde (Corrompue)"); setIsGlobalLoading(false); }
      } else { showNotification("Données introuvables."); setIsGlobalLoading(false); }
      setIsSettingsOpen(false); setIsLoadMenuOpen(false);
  };

  const loadMostRecentGame = () => { if (availableSaves.length > 0) loadGameById(availableSaves[0].id); };
  const openLoadMenu = () => setIsLoadMenuOpen(true);
  const startLoadingSequence = () => setCurrentScreen('loading');
  const showNotification = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); }
  const handleExitToDashboard = () => { setIsSettingsOpen(false); setAppMode('portal_dashboard'); setIsGlobalLoading(false); };
  const handleExitApp = () => { try { window.close(); } catch (e) {} };
  
  const handleGoogleLogin = async () => { try { await loginWithGoogle(); } catch (e) { showNotification("Erreur Google Login."); } };
  const handleEmailAuth = async (e: React.FormEvent) => {
      e.preventDefault();
      try { isRegistering ? await registerWithEmail(authEmail, authPassword) : await loginWithEmail(authEmail, authPassword); } 
      catch (err: any) { showNotification("Erreur d'authentification."); }
  };
  const handleLogout = async () => { await logout(); showNotification("Déconnecté."); setAppMode('portal_landing'); };
  const handleLogin = () => { setAppMode('portal_landing'); setShowLoginModal(true); };

  const handleSendBugReport = async () => {
      if (!bugTitle.trim() || !bugDescription.trim()) { showNotification("Veuillez remplir tous les champs."); return; }
      setIsSendingBug(true);
      try { if (db) await addDoc(collection(db, "bug_reports"), { title: bugTitle, description: bugDescription, userEmail: user?.email || "anonymous", userId: user?.uid || "unknown", timestamp: Date.now(), status: 'new' }); showNotification("Signalement pris en compte."); } catch (e) { showNotification("Erreur d'envoi."); } 
      finally { setIsSendingBug(false); setShowBugReportModal(false); setBugTitle(""); setBugDescription(""); }
  };

  const launchGeoSim = () => {
      setGameState({
        gameId: Date.now().toString(), currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], infrastructure: {},
        worldSummary: "Début de partie.", strategicSuggestions: [],
        turn: 1, events: [], isProcessing: false, globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30,
        hasNuclear: false, hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null
      });
      setFullHistory([]); setEventQueue([]); setShowStartModal(true); setAppMode('game_active'); setCurrentScreen('splash'); 
  };

  useEffect(() => {
    if (appMode === 'game_active' && currentScreen === 'game' && gameState.playerCountry && fullHistory.length === 0 && gameState.turn === 1) {
        const initialEvent: GameEvent = { id: 'init-1', date: INITIAL_DATE.toLocaleDateString('fr-FR'), type: 'world', headline: "Passage à l'an 2000", description: `Le monde entre dans un nouveau millénaire. Les craintes du bug de l'an 2000 sont dissipées, mais de nouveaux défis géopolitiques émergent pour ${gameState.playerCountry}.` };
        setEventQueue([initialEvent]); setActiveWindow('events');
        setGameState(prev => {
            const stats = getInitialStats(prev.playerCountry!);
            const isNatoMember = NATO_MEMBERS_2000.includes(prev.playerCountry!);
            const initialAlliance = isNatoMember ? { name: "OTAN", type: "Alliance Militaire", members: NATO_MEMBERS_2000, leader: "États-Unis" } : null;
            const newState = { ...prev, ownedTerritories: [prev.playerCountry!], militaryPower: stats.power, corruption: stats.corruption, hasNuclear: hasNuclearArsenal(prev.playerCountry!), hasSpaceProgram: hasSpaceProgramInitial(prev.playerCountry!), militaryRank: calculateRank(stats.power), alliance: initialAlliance };
            saveGame(newState, [], false);
            return newState;
        });
        setFocusCountry(gameState.playerCountry);
    }
  }, [gameState.playerCountry, currentScreen, appMode]);

  const handleReadEvent = () => {
    if (eventQueue.length === 0) return;
    const eventToArchive = eventQueue[0];
    setFullHistory(prev => [...prev, eventToArchive]);
    setGameState(prev => { const updatedEvents = [...prev.events, eventToArchive]; if (updatedEvents.length > 10) updatedEvents.shift(); return { ...prev, events: updatedEvents }; });
    setEventQueue(eventQueue.slice(1));
  };

  const handleAddOrder = () => { if (!playerInput.trim()) return; setPendingOrders(prev => [...prev, playerInput.trim()]); setPlayerInput(""); };

  // OPTIMISATION: Utiliser les suggestions stockées si disponibles
  const handleGetSuggestions = async () => {
      if (gameState.strategicSuggestions && gameState.strategicSuggestions.length > 0) {
          return gameState.strategicSuggestions;
      }
      return ["Analyser la situation", "Renforcer la diplomatie", "Investir dans l'industrie"];
  }

  const handleSendChatMessage = async (targets: string[], message: string) => {
      if (!gameState.playerCountry) return;
      const userMsg: ChatMessage = { id: `msg-${Date.now()}-p`, sender: 'player', senderName: gameState.playerCountry, targets: targets, text: message, timestamp: Date.now(), isRead: true };
      setGameState(prev => ({ ...prev, isProcessing: true, chatHistory: [...prev.chatHistory, userMsg] }));
      setTypingParticipants(targets);
      
      try {
        // Envoi simple pour la diplomatie (optimisé côté service)
        const aiResponses = await import('./services/geminiService').then(m => m.sendDiplomaticMessage(
            gameState.playerCountry!, targets, message, [...gameState.chatHistory, userMsg], {}, aiProvider
        ));
        const newMessages: ChatMessage[] = aiResponses.map(resp => ({
            id: `msg-${Date.now()}-${resp.sender}`, sender: 'ai', senderName: resp.sender, targets: targets, text: resp.text, timestamp: Date.now() + Math.random() * 500, isRead: false
        }));
        setTypingParticipants([]);
        setGameState(prev => ({ ...prev, isProcessing: false, chatHistory: [...prev.chatHistory, ...newMessages] }));
        if (newMessages.length > 0) setHasUnreadChat(true);
      } catch (e) { setTypingParticipants([]); setGameState(prev => ({ ...prev, isProcessing: false })); }
  };

  const handleMarkChatRead = (conversationPartners: string[]) => {
      if (!gameState.playerCountry) return;
      setGameState(prev => {
          const newHistory = prev.chatHistory.map(msg => {
              if (msg.isRead || msg.sender === 'player') return msg;
              if (conversationPartners.includes(normalizeCountryName(msg.senderName))) return { ...msg, isRead: true };
              return msg;
          });
          const remainingUnread = newHistory.some(m => !m.isRead && m.sender !== 'player');
          setHasUnreadChat(remainingUnread);
          return { ...prev, chatHistory: newHistory };
      });
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry || gameState.isGameOver) return;
    setActiveWindow('none');

    const finalOrderString = [...pendingOrders, playerInput.trim()].filter(Boolean).join("\n");
    const formattedDate = gameState.currentDate.toLocaleDateString('fr-FR');
    const playerEvent: GameEvent = { id: `turn-${gameState.turn}-player`, date: formattedDate, type: 'player', headline: 'Décrets émis', description: finalOrderString || "Aucun ordre." };

    setGameState(prev => ({ ...prev, isProcessing: true }));

    // OPTIMISATION: COMPRESSION DE L'INFRASTRUCTURE EN CODES COURTS
    const summaryMap: Record<string, Record<string, number>> = {};
    // Carte
    gameState.mapEntities.forEach(ent => {
        if (!summaryMap[ent.country]) summaryMap[ent.country] = {};
        const code = ent.type === 'military_base' ? 'B' : 'D';
        summaryMap[ent.country][code] = (summaryMap[ent.country][code] || 0) + 1;
    });
    // Infra Mémoire
    if (gameState.infrastructure) {
        Object.entries(gameState.infrastructure).forEach(([country, infraTypes]) => {
            if (!summaryMap[country]) summaryMap[country] = {};
            Object.entries(infraTypes).forEach(([type, count]) => {
                // On garde les 3 premières lettres pour l'infra (ex: USI, POR, ECO) pour économiser des tokens
                const code = type.substring(0, 3).toUpperCase();
                summaryMap[country][code] = (summaryMap[country][code] || 0) + count;
            });
        });
    }
    // String compacte: "FRA:B2,D1,USI5"
    const entitiesSummary = Object.entries(summaryMap).map(([c, counts]) => {
        return `${c.substring(0,3).toUpperCase()}:${Object.entries(counts).map(([k,v]) => `${k}${v}`).join(',')}`;
    }).join('|');

    // On passe le worldSummary existant pour que l'IA le mette à jour
    const result = await simulateTurn(
        gameState.playerCountry, formattedDate, finalOrderString, gameState.events,
        entitiesSummary,
        isCountryLandlocked(gameState.playerCountry), gameState.hasNuclear, 
        gameState.chatHistory.slice(-5).map(m => `${m.sender}: ${m.text}`).join('|'), // Chat très court
        gameState.chaosLevel, aiProvider, gameState.militaryPower, gameState.alliance,
        gameState.worldSummary // Envoi du contexte
    );

    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1);

    const newAiEvents: GameEvent[] = result.events.map((e, idx) => ({ ...e, id: `turn-${gameState.turn}-ai-${idx}`, date: nextDate.toLocaleDateString('fr-FR') }));

    let newOwnedTerritories = [...gameState.ownedTerritories];
    let newEntities = [...gameState.mapEntities];
    let newInfrastructure = JSON.parse(JSON.stringify(gameState.infrastructure || {})); 
    let newHasNuclear = gameState.hasNuclear;
    let cameraTarget = gameState.playerCountry;

    if (result.mapUpdates) {
        for (const update of result.mapUpdates) {
            if (update.type === 'annexation') {
                const target = update.targetCountry;
                const newOwner = update.newOwner || gameState.playerCountry;
                if (newOwnedTerritories.includes(target) && newOwner !== gameState.playerCountry) newOwnedTerritories = newOwnedTerritories.filter(t => t !== target);
                if (newOwner === gameState.playerCountry && !newOwnedTerritories.includes(target)) { newOwnedTerritories.push(target); if (hasNuclearArsenal(target)) newHasNuclear = true; }
            } else if (update.type === 'remove_entity') {
                newEntities = newEntities.filter(e => e.id !== update.entityId && e.label !== update.label);
            } else if (update.type === 'build_base' || update.type === 'build_defense') {
                newEntities.push({ id: `ent-${Date.now()}-${Math.random()}`, type: update.type as MapEntityType, country: update.targetCountry, lat: update.lat || 0, lng: update.lng || 0, label: update.label });
            }
        }
    }

    if (result.infrastructureUpdates) {
        for (const update of result.infrastructureUpdates) {
            if (!newInfrastructure[update.country]) newInfrastructure[update.country] = {};
            const val = newInfrastructure[update.country][update.type] || 0;
            newInfrastructure[update.country][update.type] = Math.max(0, val + update.change);
        }
    }

    let currentAlliance = gameState.alliance;
    if (result.allianceUpdate) {
        if (result.allianceUpdate.action === 'dissolve') currentAlliance = null;
        else if (result.allianceUpdate.name && result.allianceUpdate.members && result.allianceUpdate.leader) {
            currentAlliance = { name: result.allianceUpdate.name, type: result.allianceUpdate.type || 'Alliance', members: result.allianceUpdate.members, leader: result.allianceUpdate.leader };
            showNotification(`Alliance: ${currentAlliance.name}`);
        }
    }

    if (newAiEvents.length > 0 && newAiEvents[0].relatedCountry) cameraTarget = newAiEvents[0].relatedCountry;
    else if (result.mapUpdates && result.mapUpdates.length > 0) cameraTarget = result.mapUpdates[0].targetCountry;

    const newChatHistory = [...gameState.chatHistory];
    if (result.incomingMessages) {
        result.incomingMessages.forEach(msg => {
            const sender = normalizeCountryName(msg.sender);
            if (ALL_COUNTRIES_LIST.includes(sender) || ["ONU", "UE", "OTAN"].includes(sender.toUpperCase())) {
                newChatHistory.push({ id: `msg-${Date.now()}-${Math.random()}`, sender: 'ai', senderName: sender, targets: msg.targets.map(t => normalizeCountryName(t)), text: msg.text, timestamp: Date.now(), isRead: false });
            }
        });
        if (result.incomingMessages.length > 0) setHasUnreadChat(true);
    }

    const newHistory = [...fullHistory, playerEvent, ...newAiEvents];
    const newRank = calculateRank(gameState.militaryPower + result.militaryPowerChange);
    
    // Check Game Over
    let gameOver = false;
    let failReason = null;
    if (!newOwnedTerritories.includes(gameState.playerCountry)) { gameOver = true; failReason = "Annexion totale."; }
    else if (gameState.economyHealth + result.economyHealthChange <= 0 && gameState.popularity + result.popularityChange <= 0) { gameOver = true; failReason = "Effondrement."; }

    const newGameState = {
        ...gameState, currentDate: nextDate, turn: gameState.turn + 1, ownedTerritories: newOwnedTerritories, mapEntities: newEntities, infrastructure: newInfrastructure,
        worldSummary: result.worldSummary || gameState.worldSummary, // Mise à jour du résumé
        strategicSuggestions: result.strategicSuggestions || [], // Mise à jour des suggestions
        globalTension: Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange)),
        economyHealth: Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange)),
        militaryPower: Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange)),
        popularity: Math.max(0, Math.min(100, gameState.popularity + result.popularityChange)),
        corruption: Math.max(0, Math.min(100, gameState.corruption + result.corruptionChange)),
        hasNuclear: newHasNuclear, hasSpaceProgram: result.spaceProgramActive || gameState.hasSpaceProgram, militaryRank: newRank,
        isProcessing: false, chatHistory: newChatHistory, alliance: currentAlliance, isGameOver: gameOver, gameOverReason: failReason
    };

    setGameState(newGameState); setEventQueue([playerEvent, ...newAiEvents]); setPlayerInput(""); setPendingOrders([]); setFocusCountry(cameraTarget); 
    if (!gameOver) { setActiveWindow('events'); saveGame(newGameState, newHistory, false); } else { setActiveWindow('none'); deleteSave(gameState.gameId); }
  };

  const handleRegionSelect = (region: string) => { if (!gameState.playerCountry) { setPendingCountry(region); setShowStartModal(true); } };
  const confirmCountrySelection = () => { if (pendingCountry) { setGameState(prev => ({ ...prev, playerCountry: pendingCountry })); setPendingCountry(null); setFocusCountry(pendingCountry); } };
  const toggleWindow = (win: 'events' | 'history' | 'chat' | 'alliance') => { setActiveWindow(activeWindow === win ? 'none' : win); };

  const renderLoadMenuOverlay = () => (
      <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-0 max-w-md w-full border border-stone-200 overflow-hidden flex flex-col max-h-[80vh]">
              <div className="bg-slate-800 text-white p-4 flex justify-between items-center"><h3 className="font-bold text-lg">📂 Charger</h3><button onClick={() => setIsLoadMenuOpen(false)}>✕</button></div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
                  {availableSaves.map((save) => (
                      <div key={save.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex items-center gap-3">
                          <img src={getFlagUrl(save.country) || ''} alt={save.country} className="w-10 h-7 object-cover rounded" />
                          <div className="flex-1"><div className="font-bold text-sm">{save.country}</div><div className="text-xs text-slate-500">Tour {save.turn}</div></div>
                          <button onClick={() => loadGameById(save.id)} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-bold">Go</button>
                      </div>
                  ))}
              </div>
          </div>
      </div>
  );

  if (appMode === 'portal_landing') return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col items-center justify-center p-6 text-center">
          <h1 className="text-5xl font-black mb-6">POLITIKA</h1>
          <button onClick={user ? () => setAppMode('portal_dashboard') : () => setShowLoginModal(true)} className="bg-black text-white px-8 py-4 rounded-xl font-bold text-xl hover:scale-105 transition-transform">JOUER</button>
          {showLoginModal && <div className="absolute inset-0 bg-black/80 flex items-center justify-center"><div className="bg-white p-8 rounded-xl max-w-sm w-full"><h3 className="text-xl font-bold mb-4">Connexion</h3><button onClick={handleGoogleLogin} className="w-full bg-blue-600 text-white py-3 rounded font-bold mb-2">Google</button><button onClick={() => setShowLoginModal(false)} className="text-sm underline">Fermer</button></div></div>}
      </div>
  );

  if (appMode === 'portal_dashboard') return (
      <div className="min-h-screen bg-slate-50 p-6">
          <header className="flex justify-between items-center mb-10"><h1 className="text-2xl font-bold">QG</h1><div className="flex gap-2">{user && <span className="text-sm font-bold bg-white px-3 py-1 rounded border">{user.email}</span>}<button onClick={handleLogout}>✕</button></div></header>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div onClick={launchGeoSim} className="bg-black text-white p-8 rounded-2xl cursor-pointer hover:scale-[1.02] transition-transform"><h2 className="text-3xl font-bold mb-2">GeoSim</h2><p className="opacity-70">Simulation 2000</p></div>
              <div className="bg-white p-6 rounded-2xl border border-slate-200"><h3 className="font-bold mb-4">Sauvegardes</h3>{availableSaves.length === 0 ? <p className="text-slate-400 text-sm">Vide.</p> : availableSaves.map(s => <div key={s.id} onClick={() => loadGameById(s.id)} className="p-2 border-b cursor-pointer hover:bg-slate-50 flex justify-between"><span>{s.country}</span><span className="text-slate-400 text-xs">T.{s.turn}</span></div>)}</div>
          </div>
      </div>
  );

  if (appMode === 'game_active') {
    if (currentScreen === 'splash' || currentScreen === 'loading') return <div className="h-screen w-screen flex items-center justify-center bg-white"><GameLogo size="large" theme="light"/></div>;
    
    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900 font-sans">
            <WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} onRegionClick={handleRegionSelect} focusCountry={focusCountry}/>
            
            {showStartModal && !gameState.playerCountry && !pendingCountry && <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"><div className="bg-white p-6 rounded-xl shadow-xl pointer-events-auto">Sélectionnez un pays sur la carte.</div></div>}
            {pendingCountry && <div className="absolute inset-0 z-50 flex items-center justify-center"><div className="bg-white p-6 rounded-xl shadow-xl text-center"><h3 className="text-xl font-bold mb-4">{pendingCountry}</h3><div className="flex gap-2"><button onClick={confirmCountrySelection} className="bg-blue-600 text-white px-4 py-2 rounded font-bold">Confirmer</button><button onClick={() => setPendingCountry(null)} className="bg-stone-200 px-4 py-2 rounded font-bold">Annuler</button></div></div></div>}

            {gameState.playerCountry && !gameState.isGameOver && (
                <>
                    <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={handleReadEvent} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={handleAddOrder} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={handleGetSuggestions} turn={gameState.turn}/>
                    <HistoryLog isOpen={activeWindow === 'history'} onClose={() => setActiveWindow('none')} history={fullHistory}/>
                    <ChatInterface isOpen={activeWindow === 'chat'} onClose={() => toggleWindow('chat')} playerCountry={gameState.playerCountry} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} typingParticipants={typingParticipants} onMarkRead={handleMarkChatRead}/>
                    {gameState.alliance && <AllianceWindow isOpen={activeWindow === 'alliance'} onClose={() => setActiveWindow('none')} alliance={gameState.alliance} playerCountry={gameState.playerCountry}/>}
                    
                    <div className="absolute bottom-6 left-6 z-20 flex gap-4">
                        <button onClick={() => toggleWindow('events')} className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl border-2 ${activeWindow === 'events' ? 'bg-blue-50 border-blue-400' : 'bg-white border-stone-200'}`}>📝</button>
                        <div className="relative"><button onClick={() => toggleWindow('chat')} className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl border-2 ${activeWindow === 'chat' ? 'bg-blue-50 border-blue-400' : 'bg-white border-stone-200'}`}>💬</button>{hasUnreadChat && <div className="absolute top-0 right-0 w-4 h-4 bg-red-500 border-2 border-white rounded-full"></div>}</div>
                        <button onClick={() => toggleWindow('history')} className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl border-2 ${activeWindow === 'history' ? 'bg-blue-50 border-blue-400' : 'bg-white border-stone-200'}`}>📚</button>
                        {gameState.alliance && <button onClick={() => toggleWindow('alliance')} className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl border-2 ${activeWindow === 'alliance' ? 'bg-blue-50 border-blue-400' : 'bg-white border-stone-200'}`}>🤝</button>}
                    </div>

                    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                        {user && <div className="w-8 h-8 rounded-full bg-stone-800 text-white flex items-center justify-center font-bold text-xs">{user.email[0].toUpperCase()}</div>}
                        <button onClick={() => setIsSettingsOpen(true)} className="bg-stone-900/90 text-white px-4 py-2 rounded-lg border border-stone-700 shadow-xl font-bold text-sm flex items-center gap-2"><img src={getFlagUrl(gameState.playerCountry)} className="w-5 h-3 object-cover rounded"/> {gameState.playerCountry}</button>
                    </div>

                    <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing}/>
                </>
            )}

            {isSettingsOpen && (
                <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-xl max-w-xs w-full">
                        <h3 className="font-bold text-lg mb-4">Paramètres</h3>
                        <div className="space-y-2">
                            <button onClick={() => { setIsSettingsOpen(false); saveGame(gameState, fullHistory, true); }} className="w-full py-3 bg-emerald-600 text-white rounded font-bold">Sauvegarder</button>
                            <button onClick={() => { setIsSettingsOpen(false); openLoadMenu(); }} className="w-full py-3 bg-blue-600 text-white rounded font-bold">Charger</button>
                            <button onClick={handleExitToDashboard} className="w-full py-3 bg-stone-200 rounded font-bold">Quitter</button>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-2 text-stone-500 text-sm">Fermer</button>
                        </div>
                    </div>
                </div>
            )}
            {isLoadMenuOpen && renderLoadMenuOverlay()}
            {notification && <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-stone-800 text-white px-6 py-2 rounded-full shadow-xl z-50 text-sm font-bold animate-fade-in-down">{notification}</div>}
        </div>
    );
  }
  return null;
};

export default App;
