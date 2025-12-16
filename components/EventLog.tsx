import React, { useState, useEffect } from 'react';
import { GameEvent } from '../types';

interface EventLogProps {
  isOpen: boolean;
  onClose: () => void;
  eventQueue: GameEvent[]; // Only unread events
  onReadEvent: () => void; // Called when user clicks "Next"
  playerAction: string;
  setPlayerAction: (action: string) => void;
  onAddOrder: () => void;
  pendingOrders: string[];
  isProcessing: boolean;
  onGetSuggestions: () => Promise<string[]>;
  turn: number; // Added to track turn changes for resetting suggestions
}

const EventLog: React.FC<EventLogProps> = ({
  isOpen,
  onClose,
  eventQueue,
  onReadEvent,
  playerAction,
  setPlayerAction,
  onAddOrder,
  pendingOrders,
  isProcessing,
  onGetSuggestions,
  turn
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [hasFetchedThisTurn, setHasFetchedThisTurn] = useState(false);

  // Reset suggestions when the turn changes
  useEffect(() => {
    setSuggestions([]);
    setHasFetchedThisTurn(false);
  }, [turn]);

  if (!isOpen) return null;

  const currentEvent = eventQueue.length > 0 ? eventQueue[0] : null;

  const handleFetchSuggestions = async () => {
      if (hasFetchedThisTurn) return;
      
      setLoadingSuggestions(true);
      const res = await onGetSuggestions();
      setSuggestions(res);
      setLoadingSuggestions(false);
      setHasFetchedThisTurn(true);
  };

  const applySuggestion = (text: string) => {
      setPlayerAction(text);
  };

  const handleSendOrder = () => {
      if (!playerAction.trim()) return;
      
      // Remove the used suggestion from the list to avoid duplicates
      if (suggestions.includes(playerAction)) {
          setSuggestions(prev => prev.filter(s => s !== playerAction));
      }

      onAddOrder();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendOrder();
    }
  };

  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[85%] h-[50%] md:w-[380px] md:h-[400px] z-50 flex flex-col animate-scale-in">
      
      <div className="flex-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col">
        
        {/* --- HEADER --- */}
        <div className={`p-3 border-b flex justify-between items-center ${
            currentEvent ? 'bg-stone-100' : 'bg-blue-600 text-white'
        }`}>
          <h2 className="font-serif font-bold text-sm flex items-center gap-2">
            {currentEvent ? (
                <>
                    <span className="text-lg">📨</span> 
                    <span className="text-stone-800">Rapport ({eventQueue.length})</span>
                </>
            ) : (
                <>
                    <span className="text-lg">✍️</span> Bureau Ovale
                </>
            )}
          </h2>
          <button 
            onClick={onClose}
            className={`font-bold p-1 hover:opacity-70 ${currentEvent ? 'text-stone-400' : 'text-blue-200'}`}
          >
            ✕
          </button>
        </div>

        {/* --- CONTENT --- */}
        <div className="flex-1 overflow-y-auto p-3 relative flex flex-col">
            
            {/* MODE 1: READING EVENTS (Queue not empty) */}
            {currentEvent ? (
                <div className="flex flex-col gap-2 h-full">
                    <div className="flex-1 overflow-y-auto">
                        <div className={`w-full h-1 rounded-full mb-2 ${
                            currentEvent.type === 'crisis' ? 'bg-red-500' :
                            currentEvent.type === 'economy' ? 'bg-green-500' :
                            currentEvent.type === 'player' ? 'bg-blue-500' :
                            'bg-stone-500'
                        }`} />
                        
                        <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">
                            {currentEvent.date} — {currentEvent.type}
                        </div>

                        <h3 className="text-lg font-serif font-bold text-stone-900 leading-tight mb-2">
                            {currentEvent.headline}
                        </h3>

                        <p className="text-stone-700 text-sm leading-relaxed">
                            {currentEvent.description}
                        </p>
                    </div>

                    <div className="pt-2 border-t border-stone-100 mt-auto">
                        <button
                            onClick={onReadEvent}
                            className="w-full bg-stone-800 hover:bg-black text-white px-4 py-2 rounded-lg font-bold shadow-lg transform transition-transform active:scale-95 flex items-center justify-center gap-2 text-sm"
                        >
                            {eventQueue.length > 1 ? 'Suivant' : 'Fermer'} ➔
                        </button>
                    </div>
                </div>
            ) : (
                /* MODE 2: INPUT ORDERS */
                <div className="flex flex-col h-full relative">
                    
                    {/* List of Pending Orders (Messages area) */}
                    <div className="flex-1 overflow-y-auto mb-2 pr-1 space-y-2">
                         {pendingOrders.length === 0 && suggestions.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-stone-300 opacity-60">
                                <span className="text-2xl mb-1">📝</span>
                                <span className="text-xs italic">Aucun ordre.</span>
                            </div>
                        )}
                        {pendingOrders.map((order, idx) => (
                            <div key={idx} className="bg-yellow-50 p-2 rounded-lg rounded-tl-none border border-yellow-200 text-xs text-stone-800 shadow-sm ml-2">
                                <div className="text-[9px] text-yellow-600 font-bold uppercase mb-0.5">Ordre validé</div>
                                {order}
                            </div>
                        ))}

                        {/* Suggestions Area */}
                        {suggestions.length > 0 && (
                            <div className="bg-blue-50 p-2 rounded-lg border border-blue-100 my-2 animate-fade-in-up">
                                <div className="text-[9px] font-bold text-blue-500 uppercase mb-1 flex items-center gap-1">
                                    <span>💡</span> Suggestions IA
                                </div>
                                <div className="flex flex-col gap-1">
                                    {suggestions.map((s, i) => (
                                        <button 
                                            key={i}
                                            onClick={() => applySuggestion(s)}
                                            className={`text-left text-[10px] p-1.5 rounded shadow-sm transition-colors border ${
                                                playerAction === s 
                                                ? 'bg-blue-600 text-white border-blue-700' 
                                                : 'bg-white hover:bg-blue-100 text-blue-800 border-blue-200'
                                            }`}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Compact Input Area */}
                    <div className="mt-auto bg-stone-100 p-2 rounded-xl border border-stone-200 shadow-inner flex flex-col gap-1">
                        <div className="flex justify-between items-center ml-1">
                            <label className="text-[9px] font-bold text-stone-500 uppercase">
                                Nouvel Ordre
                            </label>
                            <button 
                                onClick={handleFetchSuggestions}
                                disabled={loadingSuggestions || hasFetchedThisTurn}
                                className={`text-[9px] px-2 py-0.5 rounded-full border flex items-center gap-1 transition-colors ${
                                    hasFetchedThisTurn
                                    ? 'bg-stone-200 text-stone-400 border-stone-300 cursor-not-allowed'
                                    : 'bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border-yellow-300'
                                }`}
                            >
                                {loadingSuggestions ? '...' : hasFetchedThisTurn ? 'Max 1' : '💡 Idées'}
                            </button>
                        </div>
                        
                        <div className="flex gap-2 items-end">
                            <textarea
                                value={playerAction}
                                onChange={(e) => setPlayerAction(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Vos ordres..."
                                className="flex-1 p-2 rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-serif text-stone-800 text-xs h-16 shadow-sm"
                                disabled={isProcessing}
                            />
                            
                            <button
                                onClick={handleSendOrder}
                                disabled={!playerAction.trim() || isProcessing}
                                className={`h-16 w-10 rounded-lg font-bold text-lg shadow-md transition-all active:scale-95 flex items-center justify-center ${
                                    !playerAction.trim() || isProcessing
                                    ? 'bg-stone-300 text-stone-500 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                            >
                                ➤
                            </button>
                        </div>
                        {isProcessing && (
                            <div className="text-center text-[9px] text-stone-400 animate-pulse">
                                Transmission...
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default EventLog;