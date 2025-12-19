import React, { useState, useEffect } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import DateControls from './components/DateControls';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import NewsTicker from './components/NewsTicker';
import AllianceWindow from './components/AllianceWindow';
import { GameState, GameEvent, MapEntity, MapEntityType, ChatMessage, SimulationResponse } from './types';
import { simulateTurn, sendDiplomaticMessage, getStrategicSuggestions } from './services/geminiService';
import { normalizeCountryName, ALL_COUNTRIES_LIST } from './constants';

const START_DATE = new Date('2025-01-01');

function App() {
  // Game State
  const [gameState, setGameState] = useState<GameState>({
    gameId: 'game-1',
    currentDate: START_DATE,
    playerCountry: 'France', // Default
    ownedTerritories: ['France'],
    neutralTerritories: [],
    mapEntities: [],
    infrastructure: {},
    turn: 1,
    events: [],
    isProcessing: false,
    globalTension: 50,
    economyHealth: 50,
    militaryPower: 50,
    popularity: 50,
    corruption: 10,
    hasNuclear: true,
    hasSpaceProgram: true,
    militaryRank: 5,
    chatHistory: [],
    chaosLevel: 'normal',
    alliance: null,
    isGameOver: false,
    gameOverReason: null
  });

  // UI State
  const [isEventLogOpen, setIsEventLogOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAllianceOpen, setIsAllianceOpen] = useState(false);
  const [eventQueue, setEventQueue] = useState<GameEvent[]>([]);
  const [playerAction, setPlayerAction] = useState("");
  const [pendingOrders, setPendingOrders] = useState<string[]>([]);
  const [newsTickerText, setNewsTickerText] = useState("Bienvenue dans GeoSim. Le monde est en paix pour le moment.");
  const [focusCountry, setFocusCountry] = useState<string | null>(null);

  // Initial greeting
  useEffect(() => {
    setEventQueue([{
      id: 'init',
      date: START_DATE.toLocaleDateString(),
      type: 'world',
      headline: 'Début de mandat',
      description: `Vous avez pris les fonctions de chef d'état de ${gameState.playerCountry}.`
    }]);
    setIsEventLogOpen(true);
  }, []);

  const handleNextTurn = async () => {
    if (gameState.isProcessing) return;

    setGameState(prev => ({ ...prev, isProcessing: true }));
    
    // Convert pending orders to a single string for AI
    const actionText = pendingOrders.length > 0 ? pendingOrders.join(". ") : playerAction;
    setPendingOrders([]);
    setPlayerAction("");

    // Simulate
    const entitiesSummary = gameState.mapEntities.map(e => `${e.type} en ${e.country}`).join(', ');
    
    try {
        const result: SimulationResponse = await simulateTurn(
            gameState.playerCountry || 'France',
            gameState.currentDate.toLocaleDateString(),
            actionText,
            gameState.events,
            gameState.ownedTerritories,
            entitiesSummary,
            false, // isLandlocked (simplified)
            gameState.hasNuclear,
            "", // diplomaticContext
            gameState.chaosLevel,
            'gemini',
            gameState.militaryPower,
            gameState.alliance,
            gameState.neutralTerritories
        );

        // Process Result
        const newDate = new Date(gameState.currentDate);
        if (result.timeIncrement === 'month') newDate.setMonth(newDate.getMonth() + 1);
        else if (result.timeIncrement === 'year') newDate.setFullYear(newDate.getFullYear() + 1);
        else newDate.setDate(newDate.getDate() + 1); // Default day

        // Map Updates Logic
        let newEntities = [...gameState.mapEntities];
        let newOwned = [...gameState.ownedTerritories];
        let newNeutral = [...gameState.neutralTerritories];

        if (result.mapUpdates) {
            for (const update of result.mapUpdates) {
                if (update.type === 'annexation') {
                   // Add to owned, remove from neutral if present
                   const target = normalizeCountryName(update.targetCountry);
                   if (!newOwned.includes(target)) newOwned.push(target);
                   newNeutral = newNeutral.filter(c => c !== target);
                } else if (update.type === 'dissolve') {
                   // Remove from owned (if not player country), add to neutral
                   const target = normalizeCountryName(update.targetCountry);
                   if (target !== gameState.playerCountry) {
                       newOwned = newOwned.filter(c => c !== target);
                       if (!newNeutral.includes(target)) newNeutral.push(target);
                   }
                } else if (update.type === 'remove_entity') {
                    newEntities = newEntities.filter(e => e.id !== update.entityId && e.label !== update.label);
                } else if (update.type === 'build_base' || update.type === 'build_defense') {
                    // CORRECTION: Mapper l'action 'build_base' vers le type d'entité 'military_base'
                    const entityType: MapEntityType = update.type === 'build_base' ? 'military_base' : 'defense_system';
                    
                    let finalLabel = update.label;
                    // Si le label est générique ou vide, on met un nom propre
                    if (!finalLabel || finalLabel.toLowerCase().includes('build_') || finalLabel === 'build_base' || finalLabel === 'build_defense') {
                        finalLabel = update.type === 'build_base' ? 'Base Militaire' : 'Système de Défense';
                    }
                    
                    newEntities.push({
                        id: `ent-${Date.now()}-${Math.random()}`,
                        type: entityType, // Utilisation du type converti
                        country: normalizeCountryName(update.targetCountry),
                        lat: update.lat || 0,
                        lng: update.lng || 0,
                        label: finalLabel
                    });
                }
            }
        }

        // Convert events for display
        const newGameEvents: GameEvent[] = result.events.map((e, idx) => ({
            id: `ev-${gameState.turn}-${idx}`,
            date: newDate.toLocaleDateString(),
            type: e.type,
            headline: e.headline,
            description: e.description,
            relatedCountry: e.relatedCountry
        }));

        // Incoming Messages
        const newMessages: ChatMessage[] = (result.incomingMessages || []).map((msg, idx) => ({
            id: `msg-${gameState.turn}-${idx}`,
            sender: 'ai',
            senderName: msg.sender,
            targets: msg.targets,
            text: msg.text,
            timestamp: Date.now(),
            isRead: false
        }));

        // State Update
        setGameState(prev => ({
            ...prev,
            currentDate: newDate,
            turn: prev.turn + 1,
            events: [...prev.events, ...newGameEvents],
            mapEntities: newEntities,
            ownedTerritories: newOwned,
            neutralTerritories: newNeutral,
            isProcessing: false,
            globalTension: Math.max(0, Math.min(100, prev.globalTension + result.globalTensionChange)),
            economyHealth: Math.max(0, Math.min(100, prev.economyHealth + result.economyHealthChange)),
            militaryPower: Math.max(0, Math.min(100, prev.militaryPower + result.militaryPowerChange)),
            chatHistory: [...prev.chatHistory, ...newMessages],
            alliance: result.allianceUpdate ? {
                name: result.allianceUpdate.name || prev.alliance?.name || 'Alliance',
                type: result.allianceUpdate.type || prev.alliance?.type || 'Militaire',
                members: result.allianceUpdate.members || [],
                leader: result.allianceUpdate.leader || prev.alliance?.leader || ''
            } : (result.allianceUpdate?.action === 'dissolve' ? null : prev.alliance)
        }));

        setEventQueue(newGameEvents);
        if (newGameEvents.length > 0) {
            setNewsTickerText(newGameEvents[0].headline);
            setIsEventLogOpen(true);
        }

    } catch (error) {
        console.error("Simulation failed", error);
        setGameState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const handleSendMessage = async (targets: string[], message: string) => {
      const newMsg: ChatMessage = {
          id: `sent-${Date.now()}`,
          sender: 'player',
          senderName: gameState.playerCountry || 'Moi',
          targets: targets,
          text: message,
          timestamp: Date.now(),
          isRead: true
      };
      setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, newMsg] }));
      
      try {
          const response = await sendDiplomaticMessage(
              gameState.playerCountry || 'France', 
              targets, 
              message, 
              gameState.chatHistory, 
              gameState // Context
          );
          
          const replies = response.messages.map((r, i) => ({
             id: `reply-${Date.now()}-${i}`,
             sender: 'ai' as const,
             senderName: r.sender,
             targets: [gameState.playerCountry || 'France'],
             text: r.text,
             timestamp: Date.now() + 1000,
             isRead: false
          }));
          
          setGameState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, ...replies] }));

      } catch (e) { console.error("Message send failed", e); }
  };

  const handleGetSuggestions = async (): Promise<string[]> => {
      const res = await getStrategicSuggestions(gameState.playerCountry || 'France', gameState.events);
      return res.suggestions;
  }

  const handleRegionClick = (region: string) => {
      setFocusCountry(region);
  };

  const handleAddOrder = () => {
      if (playerAction.trim()) {
          setPendingOrders(prev => [...prev, playerAction]);
          setPlayerAction("");
      }
  };

  const handleMarkRead = (targets: string[]) => {
      // Simplified: Just forcing re-render or status update if needed
      setGameState(prev => ({ ...prev })); 
  };

  // Status Bar Data
  const stats = [
      { label: 'Tension', value: gameState.globalTension, color: 'text-red-600' },
      { label: 'Économie', value: gameState.economyHealth, color: 'text-green-600' },
      { label: 'Armée', value: gameState.militaryPower, color: 'text-blue-600' },
      { label: 'Popularité', value: gameState.popularity, color: 'text-purple-600' },
  ];

  return (
    <div className="w-screen h-screen overflow-hidden bg-stone-900 relative font-sans text-stone-800">
      
      <NewsTicker text={newsTickerText} />

      {/* MAP LAYER */}
      <div className="absolute inset-0 z-0">
          <WorldMap 
            onRegionClick={handleRegionClick}
            playerCountry={gameState.playerCountry}
            ownedTerritories={gameState.ownedTerritories}
            neutralTerritories={gameState.neutralTerritories}
            mapEntities={gameState.mapEntities}
            focusCountry={focusCountry}
          />
      </div>

      {/* HUD OVERLAY */}
      <div className="absolute top-10 left-4 z-20 flex flex-col gap-2 pointer-events-none">
          {/* Stats Card */}
          <div className="bg-white/90 backdrop-blur p-3 rounded-xl shadow-lg border border-stone-200 pointer-events-auto w-48">
              <h1 className="font-serif font-bold text-lg leading-none mb-2">{gameState.playerCountry}</h1>
              <div className="space-y-1">
                  {stats.map(s => (
                      <div key={s.label} className="flex justify-between text-xs">
                          <span className="font-bold text-stone-500">{s.label}</span>
                          <span className={`font-bold ${s.color}`}>{s.value}%</span>
                      </div>
                  ))}
              </div>
          </div>
          
          {/* Action Buttons */}
          <div className="pointer-events-auto flex flex-col gap-2 items-start">
             <button onClick={() => setIsChatOpen(true)} className="bg-blue-600 text-white p-2 rounded-lg shadow-lg hover:bg-blue-500 font-bold text-xs flex items-center gap-2">
                 <span>💬</span> Communications
                 {gameState.chatHistory.some(m => !m.isRead) && <span className="w-2 h-2 bg-red-500 rounded-full"></span>}
             </button>
             <button onClick={() => setIsHistoryOpen(true)} className="bg-stone-700 text-white p-2 rounded-lg shadow-lg hover:bg-stone-600 font-bold text-xs">
                 <span>📚</span> Archives
             </button>
             {gameState.alliance && (
                 <button onClick={() => setIsAllianceOpen(true)} className="bg-indigo-600 text-white p-2 rounded-lg shadow-lg hover:bg-indigo-500 font-bold text-xs">
                     <span>🤝</span> Alliance: {gameState.alliance.name}
                 </button>
             )}
          </div>
      </div>

      <DateControls 
          currentDate={gameState.currentDate}
          turn={gameState.turn}
          onNextTurn={handleNextTurn}
          isProcessing={gameState.isProcessing}
      />

      {/* MODALS */}
      <EventLog 
          isOpen={isEventLogOpen}
          onClose={() => setIsEventLogOpen(false)}
          eventQueue={eventQueue}
          onReadEvent={() => {
              if (eventQueue.length > 1) {
                  setEventQueue(prev => prev.slice(1));
              } else {
                  setIsEventLogOpen(false);
              }
          }}
          playerAction={playerAction}
          setPlayerAction={setPlayerAction}
          onAddOrder={handleAddOrder}
          pendingOrders={pendingOrders}
          isProcessing={gameState.isProcessing}
          onGetSuggestions={handleGetSuggestions}
          turn={gameState.turn}
      />

      <HistoryLog 
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          history={gameState.events}
      />

      <ChatInterface 
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          playerCountry={gameState.playerCountry || 'France'}
          chatHistory={gameState.chatHistory}
          onSendMessage={handleSendMessage}
          isProcessing={gameState.isProcessing}
          allCountries={ALL_COUNTRIES_LIST}
          onMarkRead={handleMarkRead}
      />

      {gameState.alliance && (
        <AllianceWindow 
            isOpen={isAllianceOpen}
            onClose={() => setIsAllianceOpen(false)}
            alliance={gameState.alliance}
            playerCountry={gameState.playerCountry || 'France'}
        />
      )}

    </div>
  );
}

export default App;
