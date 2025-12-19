
import React from 'react';
import { Alliance } from '../types';
import { getFlagUrl } from '../constants';

interface AllianceWindowProps {
  isOpen: boolean;
  onClose: () => void;
  alliance: Alliance;
  playerCountry: string;
}

const AllianceWindow: React.FC<AllianceWindowProps> = ({ isOpen, onClose, alliance, playerCountry }) => {
  if (!isOpen) return null;

  return (
    <div className="w-full max-w-sm h-[400px] bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-blue-400 overflow-hidden flex flex-col animate-scale-in pointer-events-auto">
        <div className="bg-blue-800 p-4 text-white flex justify-between items-center">
             <div>
                 <div className="text-[10px] uppercase font-bold text-blue-300 tracking-widest mb-1">Alliance Active</div>
                 <h2 className="font-serif font-bold text-xl leading-tight">{alliance.name}</h2>
                 <span className="text-[10px] bg-blue-700 px-2 py-0.5 rounded-full border border-blue-500">{alliance.type}</span>
             </div>
             <button onClick={onClose} className="text-blue-300 hover:text-white font-bold text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-stone-50">
            <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-sm mb-4">
                <div className="text-[10px] uppercase font-bold text-stone-400 mb-2">Présidence</div>
                <div className="flex items-center gap-3">
                    <img src={getFlagUrl(alliance.leader) || ''} alt="" className="w-8 h-5 object-cover rounded shadow" />
                    <div className="font-bold text-stone-800 text-sm">{alliance.leader}</div>
                    {alliance.leader === playerCountry && <span className="ml-auto text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">C'est vous</span>}
                </div>
            </div>
            <div>
                <div className="text-[10px] uppercase font-bold text-stone-400 mb-2">Membres ({alliance.members.length})</div>
                <div className="grid grid-cols-1 gap-2">
                    {alliance.members.map((member) => (
                        <div key={member} className="flex items-center gap-3 bg-white p-2 rounded-lg border border-stone-200">
                             <img src={getFlagUrl(member) || ''} alt="" className="w-6 h-4 object-cover rounded shadow-sm" />
                             <span className={`text-xs font-medium ${member === playerCountry ? 'text-blue-600 font-bold' : 'text-stone-700'}`}>{member}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
        <div className="p-3 bg-stone-100 border-t border-stone-200 text-center">
            <p className="text-[9px] text-stone-500 italic">Défense mutuelle active.</p>
        </div>
    </div>
  );
};

export default AllianceWindow;
