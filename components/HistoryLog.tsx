
import React, { useRef, useEffect } from 'react';
import { GameEvent } from '../types';

interface HistoryLogProps {
  isOpen: boolean;
  onClose: () => void;
  history: GameEvent[];
}

const HistoryLog: React.FC<HistoryLogProps> = ({ isOpen, onClose, history }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, isOpen]);

  // CLICK OUTSIDE TO CLOSE
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
              onClose();
          }
      };
      if (isOpen) {
          document.addEventListener('mousedown', handleClickOutside);
      }
      return () => {
          document.removeEventListener('mousedown', handleClickOutside);
      };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[85%] h-[50%] md:w-[380px] md:h-[400px] z-50 flex flex-col animate-scale-in">
      
      <div ref={containerRef} className="flex-1 bg-stone-100/95 backdrop-blur-md rounded-xl shadow-2xl border border-stone-300 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-stone-800 p-3 flex justify-between items-center text-white">
          <h2 className="font-serif font-bold text-sm flex items-center gap-2">
            <span>📚</span> Archives
          </h2>
          <button onClick={onClose} className="text-stone-400 hover:text-white font-bold p-1">
            ✕
          </button>
        </div>

        {/* List */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-stone-50">
          {history.length === 0 && (
              <p className="text-stone-400 text-center italic mt-10 text-xs">Archives vides.</p>
          )}
          {history.map((event) => {
            const isPlayer = event.type === 'player';
            
            return (
              <div key={event.id} className={`p-2 rounded border-l-2 shadow-sm text-xs transition-all ${
                isPlayer 
                  ? 'bg-emerald-100 border-emerald-600 text-stone-900 font-bold' // Joueur: Vert et Gras
                  : 'bg-white border-stone-300 text-stone-600' // IA: Blanc et Normal
              }`}>
                <div className="flex justify-between items-center mb-0.5 opacity-70 text-[9px] uppercase tracking-wider">
                    <span>{event.date}</span>
                    <span>{isPlayer ? 'PRÉSIDENT' : event.type}</span>
                </div>
                <div className={`font-serif text-sm leading-tight ${isPlayer ? 'font-black' : 'font-bold'}`}>
                    {event.headline}
                </div>
                <div className={`mt-0.5 leading-snug text-[10px] ${isPlayer ? 'font-bold text-emerald-900' : ''}`}>
                    {event.description}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HistoryLog;
