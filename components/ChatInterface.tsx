import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage } from '../types';
import { getFlagUrl } from '../constants';

interface ChatInterfaceProps {
  isOpen: boolean;
  onClose: () => void;
  playerCountry: string;
  chatHistory: ChatMessage[];
  onSendMessage: (targets: string[], message: string) => void;
  isProcessing: boolean;
  allCountries: string[];
  typingParticipants?: string[]; // Added typing prop
  onMarkRead?: (targets: string[]) => void; // New prop for marking read
}

// --- COMPONENT ---

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  isOpen,
  onClose,
  playerCountry,
  chatHistory,
  onSendMessage,
  isProcessing,
  allCountries,
  typingParticipants = [],
  onMarkRead
}) => {
  // VIEW STATE: 'list' (conversations) | 'new' (select countries) | 'chat' (active thread)
  const [viewMode, setViewMode] = useState<'list' | 'new' | 'chat'>('list');
  
  // CURRENT SELECTION
  const [activeParticipants, setActiveParticipants] = useState<string[]>([]);
  const [newChatSelection, setNewChatSelection] = useState<string[]>([]);
  
  const [inputText, setInputText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Helper to normalize participant list for grouping
  const getParticipants = (msg: ChatMessage): string[] => {
    const raw = msg.sender === 'player' ? [...msg.targets] : [msg.senderName, ...msg.targets];
    const flat: string[] = [];
    raw.forEach(s => s.split(',').forEach(sub => flat.push(sub.trim())));
    const unique = Array.from(new Set(flat.filter(p => p !== playerCountry && p !== '')));
    return unique.sort();
  };

  // Derive unique conversations from history
  const historyConversations = useMemo(() => {
    const map = new Map<string, { targets: string[], lastMsg: ChatMessage }>();
    
    chatHistory.forEach(msg => {
        const participants = getParticipants(msg);
        const key = participants.join(',');
        
        if (!map.has(key) || msg.timestamp > map.get(key)!.lastMsg.timestamp) {
            map.set(key, { targets: participants, lastMsg: msg });
        }
    });

    return Array.from(map.values()).sort((a, b) => b.lastMsg.timestamp - a.lastMsg.timestamp);
  }, [chatHistory, playerCountry]);

  // COMBINED CONVERSATIONS: History + Active Draft
  const displayedConversations = useMemo(() => {
      const list = [...historyConversations];
      
      // Check if current activeParticipants are already in the list
      if (activeParticipants.length > 0) {
          // IMPORTANT: Copy array before sort!
          const activeKey = [...activeParticipants].sort().join(',');
          const exists = list.some(c => [...c.targets].sort().join(',') === activeKey);
          
          // If not in history, prepend it as a draft
          if (!exists) {
              list.unshift({
                  targets: activeParticipants,
                  lastMsg: { 
                      id: 'draft',
                      sender: 'player', 
                      senderName: playerCountry,
                      targets: activeParticipants,
                      text: "Nouvelle discussion...", 
                      timestamp: Date.now() 
                  }
              });
          }
      }
      return list;
  }, [historyConversations, activeParticipants, playerCountry]);

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, activeParticipants, viewMode, typingParticipants]);

  // Reset view when closed
  useEffect(() => {
      if (!isOpen) {
          setViewMode('list');
          setActiveParticipants([]);
      }
  }, [isOpen]);

  if (!isOpen) return null;

  // --- HANDLERS ---

  const handleOpenNewChat = () => {
      setNewChatSelection([]);
      setSearchTerm("");
      setViewMode('new');
  };

  const toggleNewChatSelection = (country: string) => {
      if (newChatSelection.includes(country)) {
          setNewChatSelection(prev => prev.filter(c => c !== country));
      } else {
          setNewChatSelection(prev => [...prev, country]);
      }
  };

  const startNewChat = () => {
      if (newChatSelection.length === 0) return;
      setActiveParticipants(newChatSelection);
      setViewMode('chat');
  };

  const selectConversation = (targets: string[]) => {
      setActiveParticipants(targets);
      setViewMode('chat');
      // Mark as read immediately when selecting
      if (onMarkRead) onMarkRead(targets);
  };

  const handleSend = () => {
      if (!inputText.trim() || activeParticipants.length === 0) return;
      onSendMessage(activeParticipants, inputText);
      setInputText("");
      // Also mark read when sending to clear any lingering notification
      if (onMarkRead) onMarkRead(activeParticipants);
  };

  // Filter messages for current active thread
  const activeThreadMessages = chatHistory.filter(msg => {
      if (activeParticipants.length === 0) return false;
      const participants = getParticipants(msg);
      return JSON.stringify(participants) === JSON.stringify([...activeParticipants].sort());
  });

  const filteredCountries = allCountries
    .filter(c => c !== playerCountry)
    .filter(c => c.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort();

  // Filter typing participants relevant to current chat
  const currentTypingList = typingParticipants.filter(p => activeParticipants.includes(p));

  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[85%] h-[50%] md:w-[380px] md:h-[400px] z-50 flex flex-col animate-scale-in">
      <div className="flex-1 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-stone-300">
        
        {/* --- LEFT SIDEBAR (Conversations List) --- */}
        <div className={`
            flex flex-col bg-stone-100 border-r border-stone-200 md:w-1/3
            ${viewMode === 'list' ? 'flex w-full h-full' : 'hidden md:flex'}
        `}>
            {/* Header */}
            <div className="p-2 bg-white border-b border-stone-200 flex justify-between items-center shadow-sm">
                <h2 className="font-bold text-stone-700 text-xs">Discussions</h2>
                <button 
                    onClick={handleOpenNewChat}
                    className="w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center font-bold text-sm shadow transition-transform active:scale-95"
                    title="Nouveau"
                >
                    +
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
                {displayedConversations.length === 0 ? (
                    <div className="p-4 text-center opacity-50 flex flex-col items-center">
                        <span className="text-2xl mb-1">📭</span>
                        <p className="text-[10px] text-stone-500">Vide.</p>
                        <button onClick={handleOpenNewChat} className="mt-2 text-blue-600 text-[10px] font-bold underline">
                            Lancer
                        </button>
                    </div>
                ) : (
                    displayedConversations.map((conv, idx) => {
                        // IMPORTANT: Copy array before sort!
                        const isActive = JSON.stringify([...conv.targets].sort()) === JSON.stringify([...activeParticipants].sort()) && viewMode !== 'new';
                        const flag = getFlagUrl(conv.targets[0]);
                        const isMulti = conv.targets.length > 1;
                        const isDraft = conv.lastMsg.id === 'draft';
                        
                        // Calculate unread count specifically for this conversation
                        const unreadCount = chatHistory.filter(m => 
                            !m.isRead && 
                            m.sender !== 'player' &&
                            JSON.stringify(getParticipants(m)) === JSON.stringify(conv.targets)
                        ).length;

                        return (
                            <button
                                key={idx}
                                onClick={() => selectConversation(conv.targets)}
                                className={`w-full p-2 text-left border-b border-stone-200 hover:bg-white transition-colors flex gap-2 items-center ${isActive ? 'bg-white border-l-4 border-l-blue-600' : 'bg-transparent'}`}
                            >
                                <div className="relative">
                                    {flag ? (
                                        <img src={flag} alt="flag" className="w-6 h-4 rounded shadow-sm object-cover" />
                                    ) : (
                                        <div className="w-6 h-4 bg-stone-300 rounded flex items-center justify-center text-[10px]">?</div>
                                    )}
                                    {isMulti && (
                                        <div className="absolute -bottom-1 -right-1 bg-stone-700 text-white text-[8px] rounded-full px-1">
                                            +{conv.targets.length - 1}
                                        </div>
                                    )}
                                    {/* Unread Indicator */}
                                    {unreadCount > 0 && (
                                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 border border-white rounded-full flex items-center justify-center animate-bounce shadow-sm">
                                            {/* Optional: Show number if space permits, currently just a dot for cleanliness */}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline">
                                        <div className={`text-xs font-bold truncate ${unreadCount > 0 ? 'text-stone-900' : 'text-stone-800'}`}>
                                            {conv.targets.join(', ')}
                                        </div>
                                    </div>
                                    <div className={`text-[10px] truncate ${isDraft ? 'text-blue-500 italic' : unreadCount > 0 ? 'text-stone-800 font-bold' : 'text-stone-500'}`}>
                                        {isDraft ? 'Nouveau...' : conv.lastMsg.text}
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
            
            {/* Mobile Close Button */}
            <div className="p-1 border-t border-stone-200 md:hidden">
                <button onClick={onClose} className="w-full py-1 bg-stone-200 text-stone-600 rounded font-bold text-xs">Fermer</button>
            </div>
        </div>

        {/* --- MAIN AREA (Chat OR New Selection) --- */}
        <div className={`
            flex-1 flex flex-col bg-stone-50 relative
            ${viewMode !== 'list' ? 'flex w-full h-full' : 'hidden md:flex'}
        `}>
            
            {/* MODE: NEW CONVERSATION SELECTION */}
            {viewMode === 'new' && (
                <div className="absolute inset-0 z-10 bg-white flex flex-col animate-fade-in">
                    <div className="p-2 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
                        <button onClick={() => setViewMode('list')} className="md:hidden text-stone-500 font-bold px-2">←</button>
                        <input 
                            type="text" 
                            placeholder="Pays..." 
                            className="flex-1 p-1 rounded border border-stone-300 text-xs focus:outline-blue-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus
                        />
                        <button onClick={() => setViewMode('list')} className="hidden md:block text-stone-400 hover:text-stone-600 font-bold px-2">✕</button>
                    </div>

                    <div className="p-1 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
                        <span className="text-[10px] text-blue-800 font-bold ml-1">
                            {newChatSelection.length === 0 
                                ? "Choisir participants" 
                                : `${newChatSelection.length} choix`}
                        </span>
                        <button 
                            onClick={startNewChat}
                            disabled={newChatSelection.length === 0}
                            className={`px-3 py-0.5 rounded text-[10px] font-bold transition-all ${
                                newChatSelection.length > 0 
                                ? 'bg-blue-600 text-white shadow-md transform active:scale-95' 
                                : 'bg-stone-300 text-stone-500 cursor-not-allowed'
                            }`}
                        >
                            OK
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1 content-start">
                        {filteredCountries.map(country => {
                            const flag = getFlagUrl(country);
                            const isSelected = newChatSelection.includes(country);
                            return (
                                <button
                                    key={country}
                                    onClick={() => toggleNewChatSelection(country)}
                                    className={`p-1 rounded border flex items-center gap-2 transition-all ${
                                        isSelected 
                                        ? 'bg-blue-100 border-blue-500 shadow-inner' 
                                        : 'bg-white border-stone-200 hover:border-stone-400'
                                    }`}
                                >
                                    {flag ? (
                                        <img src={flag} alt="" className="w-5 h-3 object-cover rounded shadow-sm" />
                                    ) : (
                                        <div className="w-5 h-3 bg-stone-200 rounded"></div>
                                    )}
                                    <span className={`text-[10px] truncate ${isSelected ? 'font-bold text-blue-900' : 'text-stone-700'}`}>
                                        {country}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* MODE: ACTIVE CHAT */}
            {(viewMode === 'chat' || (viewMode === 'list' && activeParticipants.length > 0 && window.innerWidth >= 768)) && activeParticipants.length > 0 ? (
                <>
                    {/* Chat Header */}
                    <div className="bg-white border-b border-stone-200 p-2 shadow-sm flex items-center justify-between z-10">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setViewMode('list')} className="md:hidden text-stone-500 font-bold pr-1">←</button>
                            <div className="flex -space-x-1 overflow-hidden">
                                {activeParticipants.slice(0, 3).map(p => (
                                    <img key={p} src={getFlagUrl(p) || ''} alt="" className="inline-block h-5 w-7 rounded shadow-md object-cover ring-1 ring-white" />
                                ))}
                            </div>
                            <div>
                                <h3 className="font-bold text-stone-800 text-xs leading-tight">
                                    {activeParticipants.join(', ')}
                                </h3>
                            </div>
                        </div>
                        <button onClick={onClose} className="hidden md:block text-stone-400 hover:text-red-500 px-1 font-bold">✕</button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-2 bg-stone-100 flex flex-col" ref={scrollRef}>
                        {activeThreadMessages.length === 0 ? (
                            <div className="m-auto text-center opacity-50">
                                <p className="text-xs text-stone-500 font-bold">Début canal.</p>
                            </div>
                        ) : (
                            activeThreadMessages.map(msg => (
                                <div key={msg.id} className={`flex flex-col mb-2 ${msg.sender === 'player' ? 'items-end' : 'items-start'}`}>
                                    <div className={`max-w-[85%] rounded-xl p-2 text-xs shadow-sm relative ${
                                        msg.sender === 'player' 
                                        ? 'bg-blue-600 text-white rounded-br-none' 
                                        : 'bg-white text-stone-800 border border-stone-200 rounded-bl-none'
                                    }`}>
                                        {msg.sender === 'ai' && activeParticipants.length > 1 && (
                                            <div className="text-[9px] font-bold text-orange-600 mb-0.5">
                                                {msg.senderName}
                                            </div>
                                        )}
                                        {msg.text}
                                    </div>
                                    <span className="text-[8px] text-stone-400 mt-0.5 mx-1">
                                        {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </span>
                                </div>
                            ))
                        )}
                        
                        {/* TYPING INDICATOR AREA */}
                        {currentTypingList.length > 0 && (
                            <div className="flex flex-col gap-1 mt-1 animate-pulse">
                                {currentTypingList.map(p => (
                                    <div key={`typing-${p}`} className="text-[9px] text-stone-500 italic ml-2 flex items-center gap-1">
                                        <span className="w-1 h-1 bg-stone-400 rounded-full inline-block"></span>
                                        {p} est en train d'écrire...
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Input Area */}
                    <div className="p-2 bg-white border-t border-stone-200 flex gap-2">
                        <input 
                            type="text"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder="..."
                            className="flex-1 p-2 rounded-full border border-stone-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-stone-50"
                            disabled={isProcessing}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={!inputText.trim() || isProcessing}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-md transition-all ${
                                !inputText.trim() || isProcessing
                                ? 'bg-stone-200 text-stone-400'
                                : 'bg-blue-600 hover:bg-blue-700 text-white active:scale-95'
                            }`}
                        >
                            ➤
                        </button>
                    </div>
                </>
            ) : (
                /* Empty State (Desktop right side) */
                <div className="hidden md:flex w-full h-full flex-col items-center justify-center text-stone-300">
                    <span className="text-4xl mb-2 grayscale opacity-20">🌍</span>
                    <p className="text-stone-400 font-bold text-xs">Sélectionnez une conversation</p>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;