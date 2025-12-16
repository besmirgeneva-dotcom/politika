import React from 'react';

interface NewsTickerProps {
    text: string;
}

const NewsTicker: React.FC<NewsTickerProps> = ({ text }) => {
    if (!text) return null;

    return (
        <div className="absolute top-0 left-0 w-full h-8 bg-blue-900 z-30 overflow-hidden flex items-center border-b border-blue-800 shadow-lg pointer-events-none">
            <div className="bg-red-600 text-white text-[10px] font-bold px-2 h-full flex items-center z-10 shrink-0 uppercase tracking-widest shadow-md">
                Direct
            </div>
            <div className="flex-1 overflow-hidden relative h-full flex items-center">
                <div className="animate-marquee whitespace-nowrap text-white text-xs font-semibold px-4">
                    {text} • {text} • {text}
                </div>
            </div>
        </div>
    );
};

export default NewsTicker;