
import React, { useState } from 'react';
import WorldMap from '../components/WorldMap';
import EventLog from '../components/EventLog';
import HistoryLog from '../components/HistoryLog';
import ChatInterface from '../components/ChatInterface';
import AllianceWindow from '../components/AllianceWindow';
import DateControls from '../components/DateControls';
import SandboxMenu from '../components/SandboxMenu';
import { GameState, GameEvent, ChatMessage } from '../types';
import { isCountryLandlocked, getFlagUrl, ALL_COUNTRIES_LIST } from '../constants';
import { AIProvider } from '../services/geminiService';
import { SaveMetadata } from '../hooks/useGamePersistence';

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

interface ActiveGameProps {
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>; // Added for Sandbox
    tokenCount: number;
    aiProvider: AIProvider;
    setAiProvider: (p: AIProvider) => void;
    saveGame: (state: GameState, history: GameEvent[]) => void;
    loadGameById: (id: string) => void;
    availableSaves: SaveMetadata[];
    handleExitToDashboard: () => void;
    handleNextTurn: () => void;
    handleRegionSelect: (region: string) => void;
    focusCountry: string | null;
    eventQueue: GameEvent[];
    fullHistory: GameEvent[];
    pendingOrders: string[];
    playerInput: string;
    setPlayerInput: (s: string) => void;
    onAddOrder: () => void;
    onReadEvent: () => void;
    onGetSuggestions: () => Promise<string[]>;
    handleSendChatMessage: (targets: string[], message: string) => void;
    hasUnreadChat: boolean;
    typingParticipants: string[];
    handleMarkChatRead: (targets: string[]) => void;
    
    // Windows State
    activeWindow: string;
    setActiveWindow: (w: any) => void;
    isGameMenuOpen: boolean;
    setIsGameMenuOpen: (b: boolean) => void;
    isLoadMenuOpen: boolean;
    setIsLoadMenuOpen: (b: boolean) => void;

    // Selection Flow
    showStartModal: boolean;
    pendingCountry: string | null;
    setPendingCountry: (s: string | null) => void;
    confirmCountrySelection: () => void;
}

export const ActiveGame: React.FC<ActiveGameProps> = ({
    gameState, setGameState, tokenCount, aiProvider, setAiProvider, saveGame, loadGameById, availableSaves,
    handleExitToDashboard, handleNextTurn, handleRegionSelect, focusCountry, eventQueue,
    fullHistory, pendingOrders, playerInput, setPlayerInput, onAddOrder, onReadEvent,
    onGetSuggestions, handleSendChatMessage, hasUnreadChat, typingParticipants, handleMarkChatRead,
    activeWindow, setActiveWindow, isGameMenuOpen, setIsGameMenuOpen, isLoadMenuOpen, setIsLoadMenuOpen,
    showStartModal, pendingCountry, setPendingCountry, confirmCountrySelection
}) => {
    
    const [isSandboxOpen, setIsSandboxOpen] = useState(false);

    const toggleWindow = (win: any) => setActiveWindow(activeWindow === win ? 'none' : win);

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

            {activeWindow !== 'none' && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={() => setActiveWindow('none')}></div>}

            {!gameState.isGameOver && gameState.playerCountry && (
                <>
                    {/* HUD Jauges Gauche */}
                    <div className="absolute top-4 left-4 z-30 flex flex-col gap-2 pointer-events-none">
                        <div className="bg-stone-900/95 backdrop-blur-sm h-11 px-3 rounded-full border border-stone-700 shadow-2xl pointer-events-auto flex flex-row gap-2.5 items-center">
                            <StatGauge label="Tension" value={gameState.globalTension} color="bg-red-500" />
                            <StatGauge label="Economie" value={gameState.economyHealth} color="bg-emerald-500" />
                            <StatGauge label="Armée" value={gameState.militaryPower} color="bg-blue-500" />
                            <StatGauge label="Population" value={gameState.popularity} color="bg-purple-500" />
                            <StatGauge label="Corruption" value={gameState.corruption} color="bg-orange-500" />
                        </div>
                    </div>

                    {/* HUD Profil Droite */}
                    <div className="absolute top-4 right-4 z-30 flex flex-row items-center gap-2 pointer-events-none">
                        <div className="bg-stone-900/95 backdrop-blur-sm h-auto py-1.5 pl-4 pr-2 rounded-2xl border border-stone-700 shadow-2xl pointer-events-auto flex items-center gap-3 min-w-[140px]">
                            <div className="flex flex-col items-end">
                                 <div className="text-emerald-400 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-black/50 border border-emerald-900/30 mb-1">T:{tokenCount}</div>
                            </div>
                            <div className="flex flex-col items-end cursor-pointer hover:opacity-80 transition-opacity flex-1" onClick={() => setIsGameMenuOpen(true)}>
                                <span className="text-[6px] text-stone-500 uppercase font-black leading-none mb-0.5 tracking-tighter">PRÉSIDENT</span>
                                <span className="text-[10px] font-black text-white leading-none uppercase truncate max-w-[90px]">{gameState.playerCountry}</span>
                                <div className="flex gap-1.5 mt-1 justify-end">
                                    {!isCountryLandlocked(gameState.playerCountry) && <span className="text-[10px]" title="Accès Mer">⚓</span>}
                                    {gameState.hasNuclear && <span className="text-[10px] animate-pulse" title="Nucléaire">☢️</span>}
                                    {gameState.alliance && <span className="text-[10px]" title="Alliance">🛡️</span>}
                                </div>
                            </div>
                            <img src={getFlagUrl(gameState.playerCountry)} className="w-9 h-9 rounded-full border border-stone-700 object-cover cursor-pointer" onClick={() => setIsGameMenuOpen(true)} />
                        </div>
                    </div>
                    
                    {/* GAME MENU */}
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
                                    <button onClick={() => { setIsGameMenuOpen(false); setIsLoadMenuOpen(true); }} className="w-full py-2.5 bg-stone-700 text-stone-200 font-bold rounded-lg text-xs">📂 Charger partie</button>
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
                    
                    <SandboxMenu isOpen={isSandboxOpen} onClose={() => setIsSandboxOpen(false)} gameState={gameState} setGameState={setGameState} />

                    {activeWindow === 'events' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
                            <div className="pointer-events-auto w-full max-w-sm">
                                <EventLog isOpen={true} onClose={() => toggleWindow('events')} eventQueue={eventQueue} onReadEvent={onReadEvent} playerAction={playerInput} setPlayerAction={setPlayerInput} onAddOrder={onAddOrder} pendingOrders={pendingOrders} isProcessing={gameState.isProcessing} onGetSuggestions={onGetSuggestions} turn={gameState.turn} />
                            </div>
                        </div>
                    )}

                    {activeWindow === 'history' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
                            <div className="pointer-events-auto w-full max-w-sm">
                                <HistoryLog isOpen={true} onClose={() => toggleWindow('history')} history={fullHistory} />
                            </div>
                        </div>
                    )}

                    {activeWindow === 'chat' && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
                            <div className="pointer-events-auto w-full max-w-3xl">
                                <ChatInterface isOpen={true} onClose={() => toggleWindow('chat')} playerCountry={gameState.playerCountry!} chatHistory={gameState.chatHistory} onSendMessage={handleSendChatMessage} isProcessing={gameState.isProcessing} allCountries={ALL_COUNTRIES_LIST} typingParticipants={typingParticipants} onMarkRead={handleMarkChatRead} />
                            </div>
                        </div>
                    )}

                    {activeWindow === 'alliance' && gameState.alliance && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
                            <div className="pointer-events-auto w-full max-w-sm">
                                <AllianceWindow isOpen={true} onClose={() => toggleWindow('alliance')} alliance={gameState.alliance} playerCountry={gameState.playerCountry!} />
                            </div>
                        </div>
                    )}
                    
                    <div className="absolute bottom-6 left-6 z-30 flex gap-2">
                        <button onClick={() => toggleWindow('events')} className="bg-white text-stone-800 px-4 py-2 rounded-xl border shadow font-bold text-sm h-12 flex items-center gap-2"><span>✍️</span> Ordres {eventQueue.length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{eventQueue.length}</span>}</button>
                        <button onClick={() => toggleWindow('chat')} className="bg-stone-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-stone-600 relative">💬 {hasUnreadChat && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-bounce"></span>}</button>
                        <button onClick={() => toggleWindow('history')} className="bg-stone-800 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-stone-600">📚</button>
                        {gameState.alliance && <button onClick={() => toggleWindow('alliance')} className="bg-blue-600 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow border border-blue-400">🛡️</button>}
                        {/* BOUTON SANDBOX */}
                        <button onClick={() => setIsSandboxOpen(true)} className="bg-purple-900 text-white w-12 h-12 flex items-center justify-center rounded-xl shadow-lg border border-purple-500 hover:bg-purple-800 transition-colors">⚡</button>
                    </div>
                </>
            )}

            {showStartModal && !gameState.playerCountry && !pendingCountry && (
                <div className="fixed inset-0 z-50 flex flex-col items-center justify-start pt-24 pointer-events-none p-4">
                    <div className="bg-white/95 p-4 rounded-xl max-w-sm w-full shadow-2xl border-2 border-stone-300 text-center pointer-events-auto transform scale-90">
                        <h2 className="text-lg font-bold text-stone-800 mb-2">Sélectionnez votre nation</h2>
                        <p className="text-sm text-stone-600 italic">Touchez un pays sur la carte pour en prendre le contrôle.</p>
                    </div>
                </div>
            )}

            {pendingCountry && !gameState.playerCountry && (
                <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
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

export default ActiveGame;
