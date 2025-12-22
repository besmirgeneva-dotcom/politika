
import React from 'react';
import { GameState, ChaosLevel } from '../types';

interface SandboxMenuProps {
    isOpen: boolean;
    onClose: () => void;
    gameState: GameState;
    setGameState: React.Dispatch<React.SetStateAction<GameState>>;
}

const SandboxMenu: React.FC<SandboxMenuProps> = ({ isOpen, onClose, gameState, setGameState }) => {
    if (!isOpen) return null;

    const updateStat = (key: keyof GameState, value: any) => {
        setGameState(prev => ({ ...prev, [key]: value }));
    };

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>, key: keyof GameState) => {
        updateStat(key, parseInt(e.target.value));
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-stone-900 border-2 border-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.5)] rounded-2xl w-full max-w-sm overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
                
                {/* Header Style "Matrix/God Mode" */}
                <div className="bg-purple-900/20 p-4 border-b border-purple-500/30 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">⚡</span>
                        <h2 className="font-black text-white uppercase tracking-widest text-sm">Contrôle Divin</h2>
                    </div>
                    <button onClick={onClose} className="text-purple-300 hover:text-white font-bold">✕</button>
                </div>

                <div className="p-6 space-y-6 text-white max-h-[70vh] overflow-y-auto">
                    
                    {/* Section Statistiques */}
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">Modifier la Réalité</h3>
                        
                        {[
                            { label: "Tension Mondiale", key: 'globalTension', color: 'accent-red-500' },
                            { label: "Santé Économique", key: 'economyHealth', color: 'accent-emerald-500' },
                            { label: "Puissance Militaire", key: 'militaryPower', color: 'accent-blue-500' },
                            { label: "Popularité", key: 'popularity', color: 'accent-pink-500' },
                            { label: "Corruption", key: 'corruption', color: 'accent-orange-500' },
                        ].map((stat) => (
                            <div key={stat.key} className="space-y-1">
                                <div className="flex justify-between text-xs font-bold text-stone-300">
                                    <span>{stat.label}</span>
                                    <span>{(gameState as any)[stat.key]}%</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="100" 
                                    value={(gameState as any)[stat.key]} 
                                    onChange={(e) => handleSliderChange(e, stat.key as keyof GameState)}
                                    className={`w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer ${stat.color}`}
                                />
                            </div>
                        ))}
                    </div>

                    {/* Section Technologies */}
                    <div className="grid grid-cols-2 gap-3">
                         <button 
                            onClick={() => updateStat('hasNuclear', !gameState.hasNuclear)}
                            className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-2 transition-all ${gameState.hasNuclear ? 'bg-red-900/50 border-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.4)]' : 'bg-stone-800 border-stone-700 text-stone-500'}`}
                         >
                            <span className="text-xl">☢️</span>
                            <span className="text-[9px] font-bold uppercase">Nucléaire</span>
                         </button>

                         <button 
                            onClick={() => updateStat('hasSpaceProgram', !gameState.hasSpaceProgram)}
                            className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-2 transition-all ${gameState.hasSpaceProgram ? 'bg-blue-900/50 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-stone-800 border-stone-700 text-stone-500'}`}
                         >
                            <span className="text-xl">🚀</span>
                            <span className="text-[9px] font-bold uppercase">Spatial</span>
                         </button>
                    </div>

                    {/* Section Niveau de Chaos IA */}
                    <div>
                        <h3 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">Comportement IA</h3>
                        <div className="grid grid-cols-3 gap-1">
                            {(['peaceful', 'normal', 'chaos'] as ChaosLevel[]).map(level => (
                                <button
                                    key={level}
                                    onClick={() => updateStat('chaosLevel', level)}
                                    className={`py-2 text-[9px] font-bold uppercase rounded border ${
                                        gameState.chaosLevel === level 
                                        ? 'bg-purple-600 text-white border-purple-400' 
                                        : 'bg-stone-800 text-stone-400 border-stone-700'
                                    }`}
                                >
                                    {level}
                                </button>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default SandboxMenu;
