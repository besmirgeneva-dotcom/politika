
import React, { useState, useEffect, useRef } from 'react';
import WorldMap from './components/WorldMap';
import EventLog from './components/EventLog';
import HistoryLog from './components/HistoryLog';
import ChatInterface from './components/ChatInterface';
import AllianceWindow from './components/AllianceWindow';
import DateControls from './components/DateControls';
import { GameState, GameEvent, MapEntity, ChatMessage, ChaosLevel, MapEntityType } from './types';
import { simulateTurn, AIProvider } from './services/geminiService';
import { LANDLOCKED_COUNTRIES, NUCLEAR_POWERS, SPACE_POWERS } from './constants';
import { logout, subscribeToAuthChanges, db } from './services/authService';
import { collection, doc, getDoc, writeBatch, query, onSnapshot } from 'firebase/firestore';

const INITIAL_DATE = new Date('2000-01-01');

const App: React.FC = () => {
  const [appMode, setAppMode] = useState<'portal_landing' | 'portal_dashboard' | 'game_active'>('portal_landing');
  const [currentScreen, setCurrentScreen] = useState<'splash' | 'loading' | 'game'>('splash');
  const [user, setUser] = useState<any>(null);
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  
  const [gameState, setGameState] = useState<GameState>({
    gameId: '', currentDate: INITIAL_DATE, playerCountry: null, ownedTerritories: [], mapEntities: [], infrastructure: {},
    worldSummary: "Situation stable.", turn: 1, events: [], isProcessing: false, globalTension: 20, economyHealth: 50, militaryPower: 50, popularity: 60, corruption: 30,
    hasNuclear: false, hasSpaceProgram: false, militaryRank: 100, chatHistory: [], chaosLevel: 'normal', alliance: null, isGameOver: false, gameOverReason: null, strategicSuggestions: []
  });

  const [eventQueue, setEventQueue] = useState<GameEvent[]>([]);
  const [fullHistory, setFullHistory] = useState<GameEvent[]>([]);
  const [activeWindow, setActiveWindow] = useState<'none' | 'events' | 'history' | 'chat' | 'alliance'>('none');
  const [playerInput, setPlayerInput] = useState("");
  const [pendingOrders, setPendingOrders] = useState<string[]>([]); 
  const [showStartModal, setShowStartModal] = useState(true);
  const [pendingCountry, setPendingCountry] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((u) => {
        setUser(u);
        if (u) setAppMode('portal_dashboard');
    });
    return () => unsubscribe();
  }, []);

  const handleNextTurn = async () => {
    if (gameState.isProcessing || !gameState.playerCountry || gameState.isGameOver) return;
    
    const finalOrderString = [...pendingOrders, playerInput.trim()].filter(Boolean).join("\n");
    setGameState(prev => ({ ...prev, isProcessing: true }));

    // POINT 3: RÉSUMÉ COMPACT (B=Base, D=Défense, I=Infra)
    const summaryMap: Record<string, Record<string, number>> = {};
    gameState.mapEntities.forEach(ent => {
        const code = ent.type === 'military_base' ? 'B' : 'D';
        if (!summaryMap[ent.country]) summaryMap[ent.country] = {};
        summaryMap[ent.country][code] = (summaryMap[ent.country][code] || 0) + 1;
    });
    const entitiesSummary = Object.entries(summaryMap).map(([c, counts]) => 
        `${c.slice(0,3).toUpperCase()}:${Object.entries(counts).map(([k,v]) => `${k}${v}`).join('')}`
    ).join('|');

    const result = await simulateTurn(
        gameState.playerCountry, gameState.currentDate.toLocaleDateString('fr-FR'), finalOrderString, fullHistory,
        entitiesSummary, gameState.chaosLevel, aiProvider, gameState.militaryPower, gameState.alliance, gameState.worldSummary
    );

    const nextDate = new Date(gameState.currentDate);
    if (result.timeIncrement === 'day') nextDate.setDate(nextDate.getDate() + 1);
    else if (result.timeIncrement === 'year') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setMonth(nextDate.getMonth() + 1);

    const playerEvent: GameEvent = { id: `p-${gameState.turn}`, date: gameState.currentDate.toLocaleDateString('fr-FR'), type: 'player', headline: 'Ordres', description: finalOrderString || "Rien." };
    const newAiEvents: GameEvent[] = result.events.map((e, i) => ({ ...e, id: `ai-${gameState.turn}-${i}`, date: nextDate.toLocaleDateString('fr-FR') }));

    setGameState(prev => ({
        ...prev, currentDate: nextDate, turn: prev.turn + 1, worldSummary: result.worldSummary, strategicSuggestions: result.strategicSuggestions,
        globalTension: Math.max(0, Math.min(100, prev.globalTension + result.globalTensionChange)),
        economyHealth: Math.max(0, Math.min(100, prev.economyHealth + result.economyHealthChange)),
        militaryPower: Math.max(0, Math.min(100, prev.militaryPower + result.militaryPowerChange)),
        isProcessing: false
    }));

    setEventQueue([playerEvent, ...newAiEvents]);
    setFullHistory(prev => [...prev, playerEvent, ...newAiEvents]);
    setPlayerInput(""); setPendingOrders([]); setActiveWindow('events');
  };

  const handleRegionSelect = (region: string) => { if (!gameState.playerCountry) { setPendingCountry(region); setShowStartModal(true); } };

  if (appMode === 'portal_landing') return (
    <div className="min-h-screen bg-blue-100 flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-4xl font-bold mb-4">GeoSim</h1>
        <button onClick={() => setAppMode('portal_dashboard')} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold">Démarrer</button>
    </div>
  );

  if (appMode === 'portal_dashboard') return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center justify-center">
        <button onClick={() => { setGameState({...gameState, gameId: Date.now().toString()}); setAppMode('game_active'); setCurrentScreen('splash'); }} className="p-10 bg-white shadow rounded-2xl font-bold text-xl">Nouvelle Partie</button>
    </div>
  );

  if (appMode === 'game_active') {
    if (currentScreen === 'splash') { setTimeout(() => setCurrentScreen('game'), 1000); return <div className="h-screen w-screen flex items-center justify-center bg-white font-bold">GeoSim</div>; }
    
    return (
        <div className="relative w-screen h-screen overflow-hidden bg-stone-900">
            <WorldMap playerCountry={gameState.playerCountry} ownedTerritories={gameState.ownedTerritories} mapEntities={gameState.mapEntities} onRegionClick={handleRegionSelect} focusCountry={null}/>
            <EventLog isOpen={activeWindow === 'events'} onClose={() => setActiveWindow('none')} eventQueue={eventQueue} onReadEvent={() => setEventQueue(eventQueue.slice(1))} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={() => { setPendingOrders([...pendingOrders, playerInput]); setPlayerInput(""); }} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={async () => gameState.strategicSuggestions} turn={gameState.turn}/>
            <DateControls currentDate={gameState.currentDate} turn={gameState.turn} onNextTurn={handleNextTurn} isProcessing={gameState.isProcessing}/>
            
            {showStartModal && !gameState.playerCountry && !pendingCountry && <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center"><div className="bg-white p-6 rounded-2xl shadow-xl">Sélectionnez un pays sur la carte</div></div>}
            {pendingCountry && <div className="absolute inset-0 z-50 flex items-center justify-center"><div className="bg-white p-6 rounded-2xl shadow-xl">Jouer avec {pendingCountry} ? <button onClick={() => { setGameState({...gameState, playerCountry: pendingCountry, ownedTerritories: [pendingCountry]}); setPendingCountry(null); }} className="bg-blue-600 text-white p-2 rounded">Confirmer</button></div></div>}
        </div>
    );
  }
  return null;
};

export default App;
