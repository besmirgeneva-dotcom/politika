
import React, { useState, useEffect } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import GameHUD from './components/GameHUD';
import { GameState, GameEvent, ChatMessage, Alliance } from './types';
import { simulateTurn, getStrategicSuggestions, sendDiplomaticMessage } from './services/geminiService';
import { NUCLEAR_POWERS, LANDLOCKED_COUNTRIES, SPACE_POWERS, ALL_COUNTRIES_LIST, getFlagUrl } from './constants';
import { loginWithGoogle, subscribeToAuthChanges } from './services/authService';

const INITIAL_DATE = new Date('2000-01-01');

type AppMode = 'portal_landing' | 'portal_dashboard' | 'game_active';

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
  const [user, setUser] = useState<any>(null);
  
  // Game State
  const [gameState, setGameState] = useState<GameState>({
    gameId: 'local_game',
    currentDate: INITIAL_DATE,
    playerCountry: null,
    ownedTerritories: [],
    mapEntities: [],
    infrastructure: {},
    worldSummary: "L'an 2000 marque le début d'une nouvelle ère.",
    strategicSuggestions: [],
    turn: 1,
    events: [],
    isProcessing: false,
    globalTension: 10,
    economyHealth: 50,
    militaryPower: 50,
    popularity: 50,
    corruption: 0,
    hasNuclear: false,
    hasSpaceProgram: false,
    militaryRank: 100,
    chatHistory: [],
    chaosLevel: 'normal',
    alliance: null,
    isGameOver: false,
    gameOverReason: null
  });

  // UI State
  const [playerAction, setPlayerAction] = useState("");
  const [pendingOrders, setPendingOrders] = useState<string[]>([]);
  const [showEventLog, setShowEventLog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showAlliance, setShowAlliance] = useState(false);
  const [unreadEvents, setUnreadEvents] = useState<GameEvent[]>([]);
  const [typingParticipants, setTypingParticipants] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((u) => {
      setUser(u);
      setAppMode(u ? 'portal_dashboard' : 'portal_landing');
    });
    return () => unsubscribe();
  }, []);

  const handleStartGame = (country: string) => {
    const stats = getInitialStats(country);
    const isNuclear = hasNuclearArsenal(country);
    const isSpace = hasSpaceProgramInitial(country);
    
    setGameState({
        ...gameState,
        playerCountry: country,
        ownedTerritories: [country],
        militaryPower: stats.power,
        corruption: stats.corruption,
        hasNuclear: isNuclear,
        hasSpaceProgram: isSpace,
        militaryRank: calculateRank(stats.power),
        events: [{
            id: 'init',
            date: INITIAL_DATE.toLocaleDateString('fr-FR'),
            type: 'world',
            headline: `Prise de fonction : ${country}`,
            description: "Vous avez été élu. Le destin de la nation est entre vos mains.",
            relatedCountry: country
        }],
        worldSummary: `En l'an 2000, ${country} entre dans une nouvelle phase politique sous votre commandement.`,
        turn: 1,
        currentDate: INITIAL_DATE
    });
    setAppMode('game_active');
    setUnreadEvents([{
        id: 'init',
        date: INITIAL_DATE.toLocaleDateString('fr-FR'),
        type: 'world',
        headline: `Bienvenue Président`,
        description: `Vous prenez la tête de ${country}. Gérez l'économie, la diplomatie et l'armée.`,
        relatedCountry: country
    }]);
    setShowEventLog(true);
  };

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry) return;

    setGameState(prev => ({ ...prev, isProcessing: true }));

    const entitiesSummary = gameState.mapEntities.length > 0 
        ? gameState.mapEntities.map(e => `${e.type === 'military_base' ? 'B' : 'D'}(${e.country})`).join(', ') 
        : "Aucune base majeure.";

    const recentChat = gameState.chatHistory.slice(-5).map(m => `${m.senderName}: ${m.text}`).join('\n');
    const orders = pendingOrders.join(' ');
    
    setPendingOrders([]);
    setPlayerAction("");

    try {
        const simRes = await simulateTurn(
            gameState.playerCountry,
            gameState.currentDate.toLocaleDateString('fr-FR'),
            orders || "Gérer les affaires courantes.",
            gameState.events,
            gameState.ownedTerritories,
            entitiesSummary,
            isCountryLandlocked(gameState.playerCountry),
            gameState.hasNuclear,
            recentChat,
            gameState.chaosLevel,
            'gemini',
            gameState.militaryPower,
            gameState.alliance,
            gameState.worldSummary
        );

        const nextDate = new Date(gameState.currentDate);
        if (simRes.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
        else if (simRes.timeIncrement === 'month') nextDate.setMonth(nextDate.getMonth() + 1);
        else nextDate.setDate(nextDate.getDate() + 14);

        const newEvents: GameEvent[] = simRes.events.map((e, idx) => ({
            id: `${gameState.turn}-${idx}`,
            date: nextDate.toLocaleDateString('fr-FR'),
            type: e.type,
            headline: e.headline,
            description: e.description,
            relatedCountry: e.relatedCountry
        }));

        let newEntities = [...gameState.mapEntities];
        let newOwned = [...gameState.ownedTerritories];

        if (simRes.mapUpdates) {
            simRes.mapUpdates.forEach(update => {
                if (update.type === 'annexation' && update.newOwner) {
                     newOwned = newOwned.filter(c => c !== update.targetCountry);
                     if (update.newOwner === gameState.playerCountry) {
                         newOwned.push(update.targetCountry);
                     }
                } else if (update.type === 'build_base' || update.type === 'build_defense') {
                    if (update.lat && update.lng) {
                        newEntities.push({
                            id: `ent-${Date.now()}-${Math.random()}`,
                            type: update.type === 'build_base' ? 'military_base' : 'defense_system',
                            country: update.targetCountry,
                            lat: update.lat,
                            lng: update.lng,
                            label: update.label
                        });
                    }
                }
            });
        }

        let newAlliance = gameState.alliance;
        if (simRes.allianceUpdate) {
            if (simRes.allianceUpdate.action === 'dissolve') {
                newAlliance = null;
            } else if (simRes.allianceUpdate.action === 'create' || simRes.allianceUpdate.action === 'update') {
                 if (simRes.allianceUpdate.name && simRes.allianceUpdate.members && simRes.allianceUpdate.leader) {
                     newAlliance = {
                         name: simRes.allianceUpdate.name,
                         type: simRes.allianceUpdate.type || "Militaire",
                         members: simRes.allianceUpdate.members,
                         leader: simRes.allianceUpdate.leader
                     };
                 }
            }
        }

        const newMessages: ChatMessage[] = (simRes.incomingMessages || []).map((msg, i) => ({
            id: `msg-${gameState.turn}-${i}`,
            sender: 'ai',
            senderName: msg.sender,
            targets: msg.targets.includes(gameState.playerCountry!) ? msg.targets : [...msg.targets, gameState.playerCountry!],
            text: msg.text,
            timestamp: Date.now(),
            isRead: false
        }));

        setGameState(prev => ({
            ...prev,
            currentDate: nextDate,
            turn: prev.turn + 1,
            events: [...prev.events, ...newEvents],
            mapEntities: newEntities,
            ownedTerritories: newOwned,
            alliance: newAlliance,
            worldSummary: simRes.worldSummary,
            strategicSuggestions: simRes.strategicSuggestions,
            globalTension: Math.max(0, Math.min(100, prev.globalTension + simRes.globalTensionChange)),
            economyHealth: Math.max(0, Math.min(100, prev.economyHealth + simRes.economyHealthChange)),
            militaryPower: Math.max(0, Math.min(100, prev.militaryPower + simRes.militaryPowerChange)),
            popularity: Math.max(0, Math.min(100, prev.popularity + simRes.popularityChange)),
            corruption: Math.max(0, Math.min(100, prev.corruption + simRes.corruptionChange)),
            hasSpaceProgram: simRes.spaceProgramActive ?? prev.hasSpaceProgram,
            chatHistory: [...prev.chatHistory, ...newMessages],
            isProcessing: false
        }));

        if (newEvents.length > 0) {
            setUnreadEvents(newEvents);
            setShowEventLog(true);
        }

    } catch (e) {
        console.error("Simulation failed", e);
        setGameState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const handleAddOrder = () => {
    if (playerAction.trim()) {
        setPendingOrders([...pendingOrders, playerAction]);
        setPlayerAction("");
    }
  };

  const handleSendMessage = async (targets: string[], message: string) => {
    if (!gameState.playerCountry) return;
    
    const userMsg: ChatMessage = {
        id: `out-${Date.now()}`,
        sender: 'player',
        senderName: gameState.playerCountry,
        targets: targets,
        text: message,
        timestamp: Date.now(),
        isRead: true
    };

    setGameState(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, userMsg]
    }));
    
    setTypingParticipants(targets);
    
    try {
        const responses = await sendDiplomaticMessage(
            gameState.playerCountry, 
            targets, 
            message, 
            gameState.chatHistory, 
            {}, 
            'gemini'
        );
        
        setTimeout(() => {
            const aiMsgs: ChatMessage[] = responses.map((r, i) => ({
                id: `in-${Date.now()}-${i}`,
                sender: 'ai',
                senderName: r.sender,
                targets: targets,
                text: r.text,
                timestamp: Date.now(),
                isRead: false
            }));
            
            setGameState(prev => ({
                ...prev,
                chatHistory: [...prev.chatHistory, ...aiMsgs]
            }));
            setTypingParticipants([]);
        }, 2000);

    } catch (e) {
        setTypingParticipants([]);
    }
  };

  const handleMarkRead = (targets: string[]) => {
      setGameState(prev => ({
          ...prev,
          chatHistory: prev.chatHistory.map(m => {
              const isRelevant = m.sender !== 'player' && !m.isRead && targets.includes(m.senderName);
              return isRelevant ? { ...m, isRead: true } : m;
          })
      }));
  };

  if (appMode === 'portal_landing') {
      return (
          <div className="w-full h-screen bg-stone-900 flex flex-col items-center justify-center text-white">
              <GameLogo />
              <div className="mt-8 flex gap-4">
                  <button onClick={loginWithGoogle} className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded font-bold">
                      Connexion Google
                  </button>
                  <button onClick={() => setAppMode('portal_dashboard')} className="bg-stone-700 hover:bg-stone-600 px-6 py-2 rounded font-bold">
                      Invité (Test)
                  </button>
              </div>
          </div>
      );
  }

  if (appMode === 'portal_dashboard') {
      return (
          <div className="w-full h-screen bg-stone-900 flex flex-col items-center justify-center text-white p-4">
              <h2 className="text-2xl font-serif mb-6">Nouveau mandat</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl">
                  {['France', 'États-Unis', 'Chine', 'Russie', 'Allemagne', 'Brésil', 'Inde', 'Japon'].map(c => (
                      <button 
                        key={c} 
                        onClick={() => handleStartGame(c)}
                        className="p-4 bg-stone-800 hover:bg-stone-700 rounded-xl border border-stone-600 flex flex-col items-center gap-2 transition-all hover:scale-105"
                      >
                          <img src={getFlagUrl(c) || ''} alt={c} className="w-12 h-8 object-cover rounded shadow" />
                          <span className="font-bold">{c}</span>
                      </button>
                  ))}
              </div>
          </div>
      );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-stone-900 font-sans">
      
      <WorldMap 
        onRegionClick={(region) => console.log("Region clicked:", region)}
        playerCountry={gameState.playerCountry}
        ownedTerritories={gameState.ownedTerritories}
        mapEntities={gameState.mapEntities}
        focusCountry={gameState.playerCountry}
      />

      <GameHUD gameState={gameState} />

      {/* --- PROFILE / COUNTRY DISPLAY (TOP RIGHT) --- */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md p-2 md:p-3 rounded-xl border border-stone-200 shadow-xl flex items-center gap-3 animate-fade-in-down pointer-events-auto">
               <img src={getFlagUrl(gameState.playerCountry) || ''} alt="flag" className="w-8 h-5 md:w-10 md:h-6 object-cover rounded shadow-sm" />
               <div className="flex flex-col">
                   <span className="text-[10px] uppercase font-bold text-stone-400 leading-none mb-0.5">Président</span>
                   <span className="font-serif font-bold text-stone-800 text-sm md:text-base leading-none truncate max-w-[120px]">
                       {gameState.playerCountry}
                   </span>
               </div>
          </div>
      </div>

      <div className="absolute bottom-6 left-6 z-30 flex gap-2">
          <button 
            onClick={() => setShowChat(!showChat)}
            className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-stone-100 relative"
            title="Diplomatie"
          >
              <span className="text-xl">📞</span>
              {gameState.chatHistory.some(m => !m.isRead) && (
                  <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-ping"></span>
              )}
          </button>
          
          <button 
            onClick={() => setShowEventLog(true)}
            className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-stone-100"
            title="Bureau Ovale"
          >
              <span className="text-xl">🏛️</span>
          </button>

          <button 
            onClick={() => setShowHistory(true)}
            className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-stone-100"
            title="Archives"
          >
              <span className="text-xl">📚</span>
          </button>
          
          {gameState.alliance && (
            <button 
                onClick={() => setShowAlliance(true)}
                className="w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:bg-blue-500 border-2 border-white"
                title="Alliance"
            >
                <span className="text-xl">🛡️</span>
            </button>
          )}
      </div>

      <DateControls 
        currentDate={gameState.currentDate}
        turn={gameState.turn}
        onNextTurn={handleNextTurn}
        isProcessing={gameState.isProcessing}
      />

      <EventLog 
        isOpen={showEventLog}
        onClose={() => setShowEventLog(false)}
        eventQueue={unreadEvents}
        onReadEvent={() => setUnreadEvents(prev => prev.slice(1))}
        playerAction={playerAction}
        setPlayerAction={setPlayerAction}
        onAddOrder={handleAddOrder}
        pendingOrders={pendingOrders}
        isProcessing={gameState.isProcessing}
        onGetSuggestions={() => getStrategicSuggestions(gameState.playerCountry!, gameState.events)}
        turn={gameState.turn}
      />

      <ChatInterface 
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        playerCountry={gameState.playerCountry || "Inconnu"}
        chatHistory={gameState.chatHistory}
        onSendMessage={handleSendMessage}
        isProcessing={gameState.isProcessing}
        allCountries={ALL_COUNTRIES_LIST}
        typingParticipants={typingParticipants}
        onMarkRead={handleMarkRead}
      />

      <HistoryLog 
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        history={gameState.events}
      />

      {gameState.alliance && (
        <AllianceWindow 
            isOpen={showAlliance}
            onClose={() => setShowAlliance(false)}
            alliance={gameState.alliance}
            playerCountry={gameState.playerCountry || ""}
        />
      )}

    </div>
  );
};

export default App;
