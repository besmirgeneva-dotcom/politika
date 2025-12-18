
import React, { useState, useEffect } from 'react';
import { GameEvent } from '../types';

interface EventLogProps {
  isOpen: boolean;
  onClose: () => void;
  eventQueue: GameEvent[];
  onReadEvent: () => void;
  playerAction: string;
  setPlayerAction: (action: string) => void;
  onAddOrder: () => void;
  pendingOrders: string[];
  isProcessing: boolean;
  onGetSuggestions: () => Promise<string[]>; // Point 4: Suggestions pré-générées
  turn: number;
}

const EventLog: React.FC<EventLogProps> = ({
  isOpen, onClose, eventQueue, onReadEvent, playerAction, setPlayerAction, onAddOrder, pendingOrders, isProcessing, onGetSuggestions, turn
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hasFetchedThisTurn, setHasFetchedThisTurn] = useState(false);

  useEffect(() => {
    setSuggestions([]);
    setHasFetchedThisTurn(false);
  }, [turn]);

  if (!isOpen) return null;

  const currentEvent = eventQueue.length > 0 ? eventQueue[0] : null;

  const handleFetchSuggestions = async () => {
      if (hasFetchedThisTurn) return;
      const res = await onGetSuggestions(); // Récupère les suggestions déjà générées au tour précédent
      setSuggestions(res || []);
      setHasFetchedThisTurn(true);
  };

  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[85%] h-[50%] md:w-[380px] md:h-[400px] z-50 flex flex-col animate-scale-in">
      <div className="flex-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col">
        <div className={`p-3 border-b flex justify-between items-center ${currentEvent ? 'bg-stone-100' : 'bg-blue-600 text-white'}`}>
          <h2 className="font-serif font-bold text-sm flex items-center gap-2">{currentEvent ? `Rapport (${eventQueue.length})` : 'Bureau Ovale'}</h2>
          <button onClick={onClose} className="font-bold p-1 hover:opacity-70 text-stone-400">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col">
            {currentEvent ? (
                <div className="flex flex-col gap-2 h-full">
                    <div className="flex-1">
                        <div className="text-[10px] font-bold uppercase text-stone-400 mb-1">{currentEvent.date} — {currentEvent.type}</div>
                        <h3 className="text-lg font-serif font-bold text-stone-900 leading-tight mb-2">{currentEvent.headline}</h3>
                        <p className="text-stone-700 text-sm">{currentEvent.description}</p>
                    </div>
                    <button onClick={onReadEvent} className="w-full bg-stone-800 text-white py-2 rounded-lg font-bold text-sm">Suivant ➔</button>
                </div>
            ) : (
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto mb-2 space-y-2">
                        {pendingOrders.map((order, idx) => (
                            <div key={idx} className="bg-yellow-50 p-2 rounded-lg border border-yellow-200 text-xs text-stone-800 shadow-sm ml-2">
                                <div className="text-[9px] text-yellow-600 font-bold uppercase">Ordre validé</div>{order}
                            </div>
                        ))}
                        {suggestions.length > 0 && (
                            <div className="bg-blue-50 p-2 rounded-lg border border-blue-100 my-2 animate-fade-in-up">
                                <div className="text-[9px] font-bold text-blue-500 uppercase mb-1">💡 Conseillers</div>
                                <div className="flex flex-col gap-1">
                                    {suggestions.map((s, i) => (
                                        <button key={i} onClick={() => setPlayerAction(s)} className="text-left text-[10px] p-1.5 rounded bg-white border border-blue-200 hover:bg-blue-100 transition-colors shadow-sm">{s}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-stone-100 p-2 rounded-xl border border-stone-200">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-[9px] font-bold text-stone-500">NOUVEL ORDRE</label>
                            <button onClick={handleFetchSuggestions} disabled={hasFetchedThisTurn} className="text-[9px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-300">💡 Conseiller</button>
                        </div>
                        <div className="flex gap-2 items-end">
                            <textarea value={playerAction} onChange={(e) => setPlayerAction(e.target.value)} placeholder="..." className="flex-1 p-2 rounded-lg border border-stone-300 text-xs h-16 resize-none" disabled={isProcessing} />
                            <button onClick={onAddOrder} disabled={!playerAction.trim() || isProcessing} className="h-16 w-10 rounded-lg bg-blue-600 text-white font-bold">➤</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default EventLog;
