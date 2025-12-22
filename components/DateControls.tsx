
import React from 'react';

interface DateControlsProps {
  currentDate: Date | string; // Accepte string au cas où la sérialisation a échoué
  turn: number;
  onNextTurn: () => void;
  isProcessing: boolean;
}

const DateControls: React.FC<DateControlsProps> = ({ 
    currentDate, 
    turn,
    onNextTurn, 
    isProcessing 
}) => {
  
  // Sécurisation de la date pour éviter le crash "toLocaleDateString is not a function"
  const dateObj = currentDate instanceof Date ? currentDate : new Date(currentDate);
  const isValidDate = !isNaN(dateObj.getTime());

  const formattedDate = isValidDate ? dateObj.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) : 'Date Inconnue';

  return (
    <div className="absolute bottom-6 right-6 z-30 flex flex-col items-end gap-2">
      
      {/* Main Control Bar */}
      <div className="flex items-center bg-white/95 backdrop-blur-md border border-stone-300 rounded-full shadow-xl p-1 gap-1">
        
        {/* Date Display (Center) */}
        <div className="flex flex-col items-center justify-center pl-4 pr-2 min-w-[80px]">
           <span className="text-[9px] font-bold text-stone-400 uppercase tracking-widest leading-none mb-[1px]">
               t:{turn}
           </span>
           <span className="font-serif text-sm font-bold text-stone-800 capitalize leading-none">
              {formattedDate}
           </span>
        </div>
        
        {/* Next Button (Auto) */}
        <button 
          onClick={() => !isProcessing && onNextTurn()}
          disabled={isProcessing}
          title="Passer le tour (L'IA décide de la durée)"
          className={`
              group flex items-center justify-center h-8 px-4 rounded-full transition-all shadow-sm
              ${isProcessing 
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed' 
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 hover:shadow-md'
              }
          `}
        >
          {isProcessing ? (
             <span className="animate-pulse text-xs">...</span>
          ) : (
             <div className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
             </div>
          )}
        </button>

      </div>
    </div>
  );
};

export default DateControls;
