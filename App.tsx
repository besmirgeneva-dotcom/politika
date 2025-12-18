
import React, { useState } from 'react';
import { GameState, GameEvent, MapEntity, MapEntityType, Alliance, ChatMessage } from './types';
import { simulateTurn } from './services/geminiService';
import { LANDLOCKED_COUNTRIES } from './constants';
import WorldMap from './components/WorldMap';
import DateControls from './components/DateControls';
import EventLog from './components/EventLog';

// --- UTILS ---
const isCountryLandlocked = (country: string) => LANDLOCKED_COUNTRIES.includes(country);
const saveGame = (state: GameState, events: GameEvent[], notify: boolean) => {
    console.log("Saving game...", state);
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    gameId: '1',
    currentDate: new Date(2000, 0, 1),
    playerCountry: 'France',
    ownedTerritories: ['France'],
    mapEntities: [],
    infrastructure: {},
    turn: 1,
    events: [],
    isProcessing: false,
    globalTension: 20,
    economyHealth: 70,
    militaryPower: 60,
    popularity: 50,
    corruption: 10,
    hasNuclear: true,
    chaosLevel: 'normal',
    chatHistory: [],
    alliance: null,
    isGameOver: false
  });

  const [activeWindow, setActiveWindow] = useState<string>('none');
  const [pendingOrders, setPendingOrders] = useState<string[]>([]);
  const [playerInput, setPlayerInput] = useState("");
  const [eventQueue, setEventQueue] = useState<GameEvent[]>([]);
  const [fullHistory, setFullHistory] = useState<GameEvent[]>([]);
  const [aiProvider] = useState<'gemini' | 'groq'>('gemini');

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

    // OPTIMIZATION: Only send full infrastructure summary every 10 turns
    const shouldSendFullContext = gameState.turn === 1 || gameState.turn % 10 === 0;
    let entitiesSummary = "UNCHANGED"; 

    if (shouldSendFullContext) {
        const summaryMap: Record<string, Record<string, number>> = {};
        gameState.mapEntities.forEach(ent => {
            if (!summaryMap[ent.country]) summaryMap[ent.country] = {};
            const label = ent.type === 'military_base' ? 'Base' : 'Def';
            summaryMap[ent.country][label] = (summaryMap[ent.country][label] || 0) + 1;
        });
        if (gameState.infrastructure) {
            Object.entries(gameState.infrastructure).forEach(([country, infra]) => {
                if (!summaryMap[country]) summaryMap[country] = {};
                Object.entries(infra).forEach(([type, count]) => {
                    summaryMap[country][type] = (summaryMap[country][type] || 0) + count;
                });
            });
        }
        entitiesSummary = Object.entries(summaryMap).map(([c, counts]) => 
            `${c}:${Object.entries(counts).map(([t, v]) => `${v}${t}`).join(',')}`
        ).join('|');
    }

    const isLandlocked = isCountryLandlocked(gameState.playerCountry);
    const recentChat = gameState.chatHistory.slice(-5).map(m => `${m.senderName}:${m.text}`).join('|');

    const result = await simulateTurn(
        gameState.playerCountry,
        formattedDate,
        finalOrderString,
        gameState.events,
        gameState.ownedTerritories,
        entitiesSummary,
        isLandlocked,
        gameState.hasNuclear,
        recentChat,
        gameState.chaosLevel,
        aiProvider,
        gameState.militaryPower,
        gameState.alliance
    );

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
    let newEntities = [...gameState.mapEntities];
    let newInfrastructure = JSON.parse(JSON.stringify(gameState.infrastructure || {}));

    if (result.mapUpdates) {
        for (const update of result.mapUpdates) {
            if (update.type === 'annexation') {
                const target = update.targetCountry;
                const newOwner = update.newOwner || gameState.playerCountry;
                if (newOwnedTerritories.includes(target) && newOwner !== gameState.playerCountry) {
                    newOwnedTerritories = newOwnedTerritories.filter(t => t !== target);
                }
                if (newOwner === gameState.playerCountry && !newOwnedTerritories.includes(target)) {
                    newOwnedTerritories.push(target);
                }
            } else if (update.type === 'build_base' || update.type === 'build_defense') {
                newEntities.push({
                    id: `ent-${Date.now()}-${Math.random()}`,
                    type: update.type as MapEntityType,
                    country: update.targetCountry,
                    lat: update.lat || 0,
                    lng: update.lng || 0,
                    label: update.label
                });
            }
        }
    }

    if (result.infrastructureUpdates) {
        for (const update of result.infrastructureUpdates) {
            if (!newInfrastructure[update.country]) newInfrastructure[update.country] = {};
            const current = newInfrastructure[update.country][update.type] || 0;
            newInfrastructure[update.country][update.type] = Math.max(0, current + update.change);
        }
    }

    const updatedGameState: GameState = {
        ...gameState,
        currentDate: nextDate,
        turn: gameState.turn + 1,
        ownedTerritories: newOwnedTerritories,
        mapEntities: newEntities,
        infrastructure: newInfrastructure,
        globalTension: Math.max(0, Math.min(100, gameState.globalTension + result.globalTensionChange)),
        economyHealth: Math.max(0, Math.min(100, gameState.economyHealth + result.economyHealthChange)),
        militaryPower: Math.max(0, Math.min(100, gameState.militaryPower + result.militaryPowerChange)),
        popularity: Math.max(0, Math.min(100, gameState.popularity + (result.popularityChange || 0))),
        corruption: Math.max(0, Math.min(100, gameState.corruption + (result.corruptionChange || 0))),
        isProcessing: false,
        events: [...gameState.events, playerEvent, ...newAiEvents].slice(-10)
    };

    setGameState(updatedGameState);
    setEventQueue([playerEvent, ...newAiEvents]);
    setFullHistory(prev => [...prev, playerEvent, ...newAiEvents]);
    setPendingOrders([]);
    setPlayerInput("");
    setActiveWindow('events');
    saveGame(updatedGameState, updatedGameState.events, false);
  };

  return (
    <div className="w-screen h-screen relative bg-stone-900 text-stone-100 overflow-hidden font-sans">
      <WorldMap 
        onRegionClick={(r) => console.log(r)} 
        playerCountry={gameState.playerCountry} 
        ownedTerritories={gameState.ownedTerritories} 
        mapEntities={gameState.mapEntities} 
        focusCountry={null} 
      />
      <DateControls 
        currentDate={gameState.currentDate} 
        turn={gameState.turn} 
        onNextTurn={handleNextTurn} 
        isProcessing={gameState.isProcessing} 
      />
      <EventLog 
        isOpen={activeWindow === 'events'} 
        onClose={() => setActiveWindow('none')}
        eventQueue={eventQueue}
        onReadEvent={() => setEventQueue(prev => prev.slice(1))}
        playerAction={playerInput}
        setPlayerAction={setPlayerInput}
        onAddOrder={() => {
            if (playerInput) {
                setPendingOrders(prev => [...prev, playerInput]);
                setPlayerInput("");
            }
        }}
        pendingOrders={pendingOrders}
        isProcessing={gameState.isProcessing}
        onGetSuggestions={async () => []}
        turn={gameState.turn}
      />
    </div>
  );
};

export default App;
