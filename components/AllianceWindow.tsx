
import React, { useRef, useEffect } from 'react';
import { Alliance } from '../types';
import { getFlagUrl } from '../constants';

interface AllianceWindowProps {
  isOpen: boolean;
  onClose: () => void;
  alliance: Alliance;
  playerCountry: string;
}

const AllianceWindow: React.FC<AllianceWindowProps> = ({ isOpen, onClose, alliance, playerCountry }) => {
  const containerRef = useRef<HTMLDivElement>(null);

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
      <div ref={containerRef} className="flex-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-blue-400 overflow-hidden flex flex-col">
        
        {/* HEADER */}
        <div className="bg-blue-800 p-4 text-white flex justify-between items-center">
             <div>
                 <div className="text-[10px] uppercase font-bold text-blue-300 tracking-widest mb-1">Alliance Active</div>
                 <h2 className="font-serif font-bold text-xl">{alliance.name}</h2>
                 <span className="text-xs bg-blue-700 px-2 py-0.5 rounded-full border border-blue-500">{alliance.type}</span>
             </div>
             <button onClick={onClose} className="text-blue-300 hover:text-white font-bold text-xl">✕</button>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto p-4 bg-stone-50">
            
            {/* LEADER */}
            <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-sm mb-4">
                <div className="text-[10px] uppercase font-bold text-stone-400 mb-2">Présidence Tournante</div>
                <div className="flex items-center gap-3">
                    <img src={getFlagUrl(alliance.leader) || ''} alt="" className="w-10 h-7 object-cover rounded shadow" />
                    <div>
                        <div className="font-bold text-stone-800">{alliance.leader}</div>
                        <div className="text-xs text-stone-500">Leader Actuel</div>
                    </div>
                    {alliance.leader === playerCountry && (
                        <span className="ml-auto text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">C'est vous</span>
                    )}
                </div>
            </div>

            {/* MEMBERS */}
            <div>
                <div className="text-[10px] uppercase font-bold text-stone-400 mb-2 flex justify-between">
                    <span>États Membres ({alliance.members.length})</span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                    {alliance.members.map((member) => (
                        <div key={member} className="flex items-center gap-3 bg-white p-2 rounded-lg border border-stone-200">
                             <img src={getFlagUrl(member) || ''} alt="" className="w-8 h-5 object-cover rounded shadow-sm" />
                             <span className={`text-sm font-medium ${member === playerCountry ? 'text-blue-600 font-bold' : 'text-stone-700'}`}>
                                 {member}
                             </span>
                        </div>
                    ))}
                </div>
            </div>

        </div>

        {/* FOOTER */}
        <div className="p-3 bg-stone-100 border-t border-stone-200 text-center">
            <p className="text-[10px] text-stone-500 italic">
                L'adhésion à cette alliance implique des obligations de défense mutuelle.
            </p>
        </div>

      </div>
    </div>
  );
};

export default AllianceWindow;
