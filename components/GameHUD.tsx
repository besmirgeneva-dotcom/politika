
import React from 'react';
import { GameState } from '../types';

interface GameHUDProps {
    gameState: GameState;
}

const StatBar = ({ label, value, color, icon }: { label: string, value: number, color: string, icon: string }) => (
    <div className="flex flex-col gap-1 w-24 md:w-32">
        <div className="flex justify-between text-[10px] font-bold text-stone-600 uppercase tracking-wider">
            <span className="flex items-center gap-1"><span>{icon}</span> {label}</span>
            <span>{value}%</span>
        </div>
        <div className="h-2 w-full bg-stone-200 rounded-full overflow-hidden border border-stone-300">
            <div 
                className={`h-full rounded-full transition-all duration-1000 ease-out ${color}`} 
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
        </div>
    </div>
);

const GameHUD: React.FC<GameHUDProps> = ({ gameState }) => {
    return (
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 pointer-events-none">
            
            {/* GLOBAL TENSION CARD */}
            <div className="bg-white/95 backdrop-blur-md p-3 rounded-xl border border-stone-200 shadow-xl pointer-events-auto animate-fade-in-down w-fit">
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full animate-pulse ${
                        gameState.globalTension > 75 ? 'bg-red-600 shadow-[0_0_10px_red]' : 
                        gameState.globalTension > 40 ? 'bg-orange-500' : 'bg-emerald-500'
                    }`} />
                    <div>
                        <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">Tension Mondiale</div>
                        <div className="text-sm font-black text-stone-800 font-serif leading-none">
                            Niveau {gameState.globalTension}%
                        </div>
                    </div>
                </div>
            </div>

            {/* PLAYER STATS CARD */}
            <div className="bg-white/95 backdrop-blur-md p-3 rounded-xl border border-stone-200 shadow-xl pointer-events-auto animate-fade-in-down delay-100 flex flex-col gap-3">
                
                {/* Header Rank */}
                <div className="flex justify-between items-center border-b border-stone-100 pb-2">
                    <div className="text-xs font-bold text-stone-500">Rang Mondial</div>
                    <div className="text-sm font-black bg-stone-800 text-white px-2 py-0.5 rounded">#{gameState.militaryRank}</div>
                </div>

                {/* Gauges Grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <StatBar label="Armée" value={gameState.militaryPower} color="bg-blue-600" icon="⚔️" />
                    <StatBar label="Économie" value={gameState.economyHealth} color="bg-emerald-500" icon="📈" />
                    <StatBar label="Soutien" value={gameState.popularity} color="bg-purple-500" icon="📣" />
                    <StatBar label="Corruption" value={gameState.corruption} color="bg-stone-600" icon="🕵️" />
                </div>

                {/* Badges (Nuke / Space) */}
                {(gameState.hasNuclear || gameState.hasSpaceProgram) && (
                    <div className="flex gap-2 pt-2 border-t border-stone-100">
                        {gameState.hasNuclear && (
                            <div className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 flex items-center gap-1" title="Arsenal Nucléaire Actif">
                                ☢️ Nucléaire
                            </div>
                        )}
                        {gameState.hasSpaceProgram && (
                            <div className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200 flex items-center gap-1" title="Programme Spatial Actif">
                                🚀 Spatial
                            </div>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
};

export default GameHUD;
