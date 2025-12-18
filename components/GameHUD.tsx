
import React from 'react';
import { GameState } from '../types';

interface GameHUDProps {
    gameState: GameState;
}

const StatBar = ({ label, value, color, icon }: { label: string, value: number, color: string, icon: string }) => (
    <div className="flex flex-col gap-1 w-20 md:w-24 shrink-0">
        <div className="flex justify-between items-baseline text-[9px] md:text-[10px] font-bold text-stone-600 uppercase tracking-wider">
            <span className="flex items-center gap-1 truncate"><span>{icon}</span> {label}</span>
            <span>{value}%</span>
        </div>
        <div className="h-1.5 w-full bg-stone-200 rounded-full overflow-hidden border border-stone-300">
            <div 
                className={`h-full rounded-full transition-all duration-1000 ease-out ${color}`} 
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
        </div>
    </div>
);

const GameHUD: React.FC<GameHUDProps> = ({ gameState }) => {
    return (
        <div className="absolute top-4 left-4 z-20 pointer-events-none max-w-[calc(100%-160px)]">
            <div className="bg-white/95 backdrop-blur-md p-2 md:p-3 rounded-xl border border-stone-200 shadow-xl pointer-events-auto animate-fade-in-down flex flex-row gap-3 overflow-x-auto scrollbar-hide">
                <StatBar label="Armée" value={gameState.militaryPower} color="bg-blue-600" icon="⚔️" />
                <StatBar label="Éco" value={gameState.economyHealth} color="bg-emerald-500" icon="📈" />
                <StatBar label="Soutien" value={gameState.popularity} color="bg-purple-500" icon="📣" />
                <StatBar label="Corrup." value={gameState.corruption} color="bg-stone-600" icon="🕵️" />
            </div>
        </div>
    );
};

export default GameHUD;
