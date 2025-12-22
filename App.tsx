
import React, { useState, useEffect, useRef } from 'react';
import { GameState, GameEvent, ChatMessage, MapEntityType } from './types';
import { simulateTurn, getStrategicSuggestions, sendDiplomaticMessage, AIProvider } from './services/geminiService';
import { NUCLEAR_POWERS, SPACE_POWERS, normalizeCountryName, isCountryLandlocked } from './constants';
import { subscribeToAuthChanges, logout } from './services/authService';
import { useGamePersistence } from './hooks/useGamePersistence';
import { PortalLanding } from './screens/PortalLanding';
import { PortalDashboard } from './screens/PortalDashboard';
import { ActiveGame } from './screens/ActiveGame';

const INITIAL_DATE = new Date('2000-01-01');

type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';
type GameScreen = 'splash' | 'loading' | 'game';

const getInitialStats = (country: string): { power: number, corruption: number } => {
    const c = country.toLowerCase();
    if (c.includes('états-unis') || c.includes('usa')) return { power: 95, corruption: 15 };
    if (c.includes('france') || c.includes('royaume-uni')) return { power: 65, corruption: 10 };
    return { power: 30, corruption: 40 }; 
};

const calculateRank = (power: number): number => Math.max(1, Math.min(195, Math.floor(196 - (power * 1.95))));

const hasNuclearArsenal = (country: string): boolean => NUCLEAR_POWERS.some(c => country.includes(c));
const hasSpaceProgramInitial = (country: string): boolean => SPACE_POWERS.some(c => country.includes(c));
const clamp = (value: number): number => Math.max(0, Math.min(100, value));

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>('portal_landing');
  const [currentScreen, setCurrentScreen] = useState<GameScreen>('splash');
  
  // Auth State
  const [user, setUser] = useState<any>(null);
  
  // Game Persistence Hook
  const { availableSaves, saveGame: persistGame, deleteGame, loadGameData, notification } = useGamePersistence(user);
  
  // Local State for Game Logic
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [tokenCount, setTokenCount] = useState(0);
  
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
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isLoadMenuOpen, setIsLoadMenuOpen] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const unsubscribe = subscribeToAuthChanges((u) => {
        if (!isMountedRef.current) return;
        setUser(u);
        if (u) { setAppMode('portal_dashboard'); }
        else { setAppMode('portal_landing'); }
    });
    return () => { isMountedRef.current = false; unsubscribe(); };
  }, []);

  useEffect(() => {
      if (appMode === 'game_active' && currentScreen === 'splash') setTimeout(() => setCurrentScreen('loading'), 2500);
      if (appMode === 'game_active' && currentScreen === 'loading') setTimeout(() => setCurrentScreen('game'), 3000);
  }, [appMode, currentScreen]);

  const saveGame = (state: GameState, history: GameEvent[]) => {
      persistGame(state, history, aiProvider, tokenCount);
  };

  const loadGameById = async (id: string) => {
      const data = await loadGameData(id);
      if (data) {
          setGameState(data.state);
          setFullHistory(data.history);
          setAiProvider(data.aiProvider || 'gemini');
          setTokenCount(data.tokenCount || 0);
          setEventQueue([]);
          setShowStartModal(false);
          setAppMode('game_active');
          setIsGameMenuOpen(false);
          setIsLoadMenuOpen(false);
          setCurrentScreen('loading');
          
          const unread = data.state.chatHistory.some((m: ChatMessage) => !m.isRead && m.sender !== 'player');
          setHasUnreadChat(unread);
      }
  };

  const handleExitToDashboard = () => { setIsGameMenuOpen(false); setAppMode('portal_dashboard'); };

  const handleMarkChatRead = (targets: string[]) => {
    setGameState(prev => {
        const sortedTargets = [...targets].sort().join(',');
        
        const newHistory = prev.chatHistory.map(msg => {
            if (msg.isRead || msg.sender === 'player') return msg;
            
            const raw = msg.sender === 'player' ? [...msg.targets] : [msg.senderName, ...msg.targets];
            const flat: string[] = [];
            raw.forEach(s => {
                if (s && typeof s === 'string') {
                    s.split(',').forEach(sub => flat.push(normalizeCountryName(sub.trim())));
                }
            });
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
    
    // OPTIMISATION TOKENS: Regroupement des entités pour éviter une liste kilométrique
    const entitiesSummary = gameState.mapEntities.length > 0 
        ? Object.entries(gameState.mapEntities.reduce((acc, e) => {
            if (!acc[e.country]) acc[e.country] = {};
            acc[e.country][e.type] = (acc[e.country][e.type] || 0) + 1;
            return acc;
        }, {} as Record<string, Record<string, number>>))
        .map(([country, types]) => {
            const typeStr = Object.entries(types).map(([t, c]) => `${t} x${c}`).join(', ');
            return `${country}[${typeStr}]`;
        }).join('; ')
        : "Aucune installation.";

    const recentChat = gameState.chatHistory.slice(-5).map(m => `${m.senderName}: ${m.text}`).join(' | ');

    // --- APPEL IA ---
    const result = await simulateTurn(
        gameState.playerCountry, formattedDate, finalOrderString, gameState.events,
        gameState.ownedTerritories, entitiesSummary, isCountryLandlocked(gameState.playerCountry),
        gameState.hasNuclear, recentChat, gameState.chaosLevel, aiProvider,
        gameState.militaryPower, gameState.alliance, gameState.neutralTerritories
    );

    if (result.tokenUsage) setTokenCount(prev => prev + result.tokenUsage!);

    // --- CALCUL DES MÉCANIQUES DE JEU (Règles Déterministes) ---
    const playerLower = gameState.playerCountry.toLowerCase();
    
    // 1. Variations Passives
    const isEvenTurn = (gameState.turn + 1) % 2 === 0;
    
    let deltaTension = 1; // Tension +1% automatique
    let deltaCorruption = 1; // Corruption +1% automatique
    let deltaEconomy = isEvenTurn ? -5 : 0; // Economie -5% tous les 2 tours
    let deltaPopularity = isEvenTurn ? -5 : 0; // Popularité -5% tous les 2 tours
    let deltaMilitary = 0;

    // 2. Détection des Événements Critiques (Triggers)
    const hasAnnexed = result.mapUpdates?.some(u => u.type === 'annexation' && normalizeCountryName(u.newOwner || '') === gameState.playerCountry);
    
    if (hasAnnexed) {
        deltaTension += 50; // Annexion = Tension +50%
    }

    result.events.forEach(e => {
        const txt = (e.headline + " " + e.description).toLowerCase();
        const concernsPlayer = txt.includes(playerLower) || e.relatedCountry === gameState.playerCountry;
        
        // Guerre : Si le joueur est impliqué
        if (e.type === 'war' && concernsPlayer) {
            deltaEconomy -= 20;    // Guerre = Eco -20%
            deltaPopularity -= 20; // Guerre = Pop -20%
            deltaTension += 50;    // Guerre = Tension +50%
        }
        
        // Dommages Militaires
        if (concernsPlayer) {
            if (txt.includes('nucléaire') || txt.includes('nuclear') || txt.includes('atomique')) {
                deltaMilitary -= 70; // Frappe Nucléaire = -70% Armée
            } else if (txt.includes('bombarde') || txt.includes('airstrike') || txt.includes('frappe')) {
                deltaMilitary -= 15; // Bombardement = -15% Armée
            } else if (txt.includes('pertes') || txt.includes('losses') || txt.includes('défaite')) {
                deltaMilitary -= 5;  // Pertes standards = -5% Armée
            }
        }
    });

    // 3. Application des Changements (IA + Mécaniques)
    const newGlobalTension = clamp(gameState.globalTension + (result.globalTensionChange || 0) + deltaTension);
    const newEconomyHealth = clamp(gameState.economyHealth + (result.economyHealthChange || 0) + deltaEconomy);
    const newMilitaryPower = clamp(gameState.militaryPower + (result.militaryPowerChange || 0) + deltaMilitary);
    const newPopularity = clamp(gameState.popularity + (result.popularityChange || 0) + deltaPopularity);
    const newCorruption = clamp(gameState.corruption + (result.corruptionChange || 0) + deltaCorruption);

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
    let newHasSpaceProgram = gameState.hasSpaceProgram;

    // --- MISE A JOUR DES CAPACITÉS SPÉCIALES (SANDBOX) ---
    if (result.nuclearAcquired) newHasNuclear = true;
    if (result.spaceProgramActive) newHasSpaceProgram = true;

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
        mapEntities: newEntities, hasNuclear: newHasNuclear, hasSpaceProgram: newHasSpaceProgram,
        isProcessing: false,
        globalTension: newGlobalTension,
        economyHealth: newEconomyHealth,
        militaryPower: newMilitaryPower,
        popularity: newPopularity,
        corruption: newCorruption,
        chatHistory: [...gameState.chatHistory, ...aiIncomingMessages]
    };

    setGameState(newGameState);
    setEventQueue(newAiEvents);
    setFullHistory([...fullHistory, ...newAiEvents]);
    setPlayerInput(""); setPendingOrders([]);
    setActiveWindow('events');
    
    // SAUVEGARDE AUTOMATIQUE TOUS LES 4 TOURS SEULEMENT
    if (newGameState.turn % 4 === 0) {
        persistGame(newGameState, [...fullHistory, ...newAiEvents], aiProvider, tokenCount + (result.tokenUsage || 0), false);
    }
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

  return (
      <>
        {appMode === 'portal_landing' && (
            <PortalLanding onLoginSuccess={() => setAppMode('portal_dashboard')} user={user} />
        )}

        {appMode === 'portal_dashboard' && (
            <PortalDashboard 
                user={user} 
                logout={logout} 
                launchGeoSim={launchGeoSim} 
                availableSaves={availableSaves} 
                loadGameById={loadGameById} 
                deleteGame={deleteGame} 
            />
        )}

        {appMode === 'game_active' && (
            <ActiveGame
                gameState={gameState}
                setGameState={setGameState} // NOUVEAU: On passe le setter pour le mode Sandbox
                tokenCount={tokenCount}
                aiProvider={aiProvider}
                setAiProvider={setAiProvider}
                saveGame={saveGame}
                loadGameById={loadGameById}
                availableSaves={availableSaves}
                handleExitToDashboard={handleExitToDashboard}
                handleNextTurn={handleNextTurn}
                handleRegionSelect={handleRegionSelect}
                focusCountry={focusCountry}
                eventQueue={eventQueue}
                fullHistory={fullHistory}
                pendingOrders={pendingOrders}
                playerInput={playerInput}
                setPlayerInput={setPlayerInput}
                onAddOrder={handleAddOrder}
                onReadEvent={handleReadEvent}
                onGetSuggestions={handleGetSuggestions}
                handleSendChatMessage={handleSendChatMessage}
                hasUnreadChat={hasUnreadChat}
                typingParticipants={typingParticipants}
                handleMarkChatRead={handleMarkChatRead}
                activeWindow={activeWindow}
                setActiveWindow={setActiveWindow}
                isGameMenuOpen={isGameMenuOpen}
                setIsGameMenuOpen={setIsGameMenuOpen}
                isLoadMenuOpen={isLoadMenuOpen}
                setIsLoadMenuOpen={setIsLoadMenuOpen}
                showStartModal={showStartModal}
                pendingCountry={pendingCountry}
                setPendingCountry={setPendingCountry}
                confirmCountrySelection={confirmCountrySelection}
            />
        )}

        {notification && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 bg-white text-stone-900 font-bold rounded-full shadow-2xl animate-fade-in-up border border-stone-200">
                {notification}
            </div>
        )}
      </>
  );
}

export default App;
