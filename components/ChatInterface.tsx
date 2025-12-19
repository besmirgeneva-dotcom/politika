
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage } from '../types';
import { getFlagUrl, normalizeCountryName } from '../constants';

interface ChatInterfaceProps {
  isOpen: boolean;
  onClose: () => void;
  playerCountry: string;
  chatHistory: ChatMessage[];
  onSendMessage: (targets: string[], message: string) => void;
  isProcessing: boolean;
  allCountries: string[];
  typingParticipants?: string[];
  onMarkRead?: (targets: string[]) => void;
}

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
  const [viewMode, setViewMode] = useState<'list' | 'new' | 'chat'>('list');
  const [activeParticipants, setActiveParticipants] = useState<string[]>([]);
  const [newChatSelection, setNewChatSelection] = useState<string[]>([]);
  const [inputText, setInputText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const getParticipants = (msg: ChatMessage): string[] => {
    const raw = msg.sender === 'player' ? [...msg.targets] : [msg.senderName, ...msg.targets];
    const flat: string[] = [];
    raw.forEach(s => {
        if (s && typeof s === 'string') {
            s.split(',').forEach(sub => flat.push(normalizeCountryName(sub.trim())));
        }
    });
    const unique = Array.from(new Set(flat.filter(p => p !== playerCountry && p !== '')));
    return unique.sort();
  };

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

  const displayedConversations = useMemo(() => {
      const list = [...historyConversations];
      if (activeParticipants.length > 0) {
          const activeKey = [...activeParticipants].sort().join(',');
          const exists = list.some(c => [...c.targets].sort().join(',') === activeKey);
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, activeParticipants, viewMode, typingParticipants]);

  useEffect(() => {
    if (viewMode === 'chat' && activeParticipants.length > 0 && onMarkRead) {
         const hasUnread = chatHistory.some(m => 
            !m.isRead && 
            m.sender !== 'player' && 
            activeParticipants.includes(normalizeCountryName(m.senderName))
         );
         if (hasUnread) {
             onMarkRead(activeParticipants);
         }
    }
  }, [chatHistory, viewMode, activeParticipants, onMarkRead]);

  useEffect(() => {
      if (!isOpen) {
          setViewMode('list');
          setActiveParticipants([]);
      }
  }, [isOpen]);

  if (!isOpen) return null;

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
      if (onMarkRead) onMarkRead(targets);
  };

  const handleSend = () => {
      if (!inputText.trim() || activeParticipants.length === 0) return;
      onSendMessage(activeParticipants, inputText);
      setInputText("");
      if (onMarkRead) onMarkRead(activeParticipants);
  };

  const activeThreadMessages = chatHistory.filter(msg => {
      if (activeParticipants.length === 0) return false;
      const participants = getParticipants(msg);
      return JSON.stringify(participants) === JSON.stringify([...activeParticipants].sort());
  });

  const filteredCountries = allCountries
    .filter(c => c !== playerCountry)
    .filter(c => c.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort();

  const currentTypingList = typingParticipants.filter(p => activeParticipants.includes(p));

  return (
    <div className="w-full max-w-2xl h-[450px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-stone-300 animate-scale-in pointer-events-auto">
        <div className={`flex flex-col bg-stone-100 border-r border-stone-200 md:w-[200px] shrink-0 ${viewMode === 'list' ? 'flex w-full h-full' : 'hidden md:flex'}`}>
            <div className="p-2 bg-white border-b border-stone-200 flex justify-between items-center shadow-sm">
                <h2 className="font-bold text-stone-700 text-xs">Discussions</h2>
                <button onClick={handleOpenNewChat} className="w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center font-bold text-sm">+</button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {displayedConversations.length === 0 ? (
                    <div className="p-4 text-center opacity-50 flex flex-col items-center">
                        <p className="text-[10px] text-stone-500">Vide.</p>
                    </div>
                ) : (
                    displayedConversations.map((conv, idx) => {
                        const isActive = JSON.stringify([...conv.targets].sort()) === JSON.stringify([...activeParticipants].sort()) && viewMode !== 'new';
                        const flag = getFlagUrl(conv.targets[0]);
                        const isMulti = conv.targets.length > 1;
                        const isDraft = conv.lastMsg.id === 'draft';
                        const unreadCount = chatHistory.filter(m => !m.isRead && m.sender !== 'player' && JSON.stringify(getParticipants(m)) === JSON.stringify(conv.targets)).length;
                        return (
                            <button key={idx} onClick={() => selectConversation(conv.targets)} className={`w-full p-2 text-left border-b border-stone-200 hover:bg-white flex gap-2 items-center ${isActive ? 'bg-white border-l-4 border-l-blue-600' : 'bg-transparent'}`}>
                                <div className="relative">
                                    <img src={flag || ''} alt="" className="w-6 h-4 rounded shadow-sm object-cover" />
                                    {isMulti && <div className="absolute -bottom-1 -right-1 bg-stone-700 text-white text-[8px] rounded-full px-1">+{conv.targets.length - 1}</div>}
                                    {unreadCount > 0 && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 border border-white rounded-full animate-bounce"></div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-bold truncate text-stone-800">{conv.targets.join(', ')}</div>
                                    <div className={`text-[10px] truncate ${isDraft ? 'text-blue-500 italic' : unreadCount > 0 ? 'text-stone-800 font-bold' : 'text-stone-500'}`}>{isDraft ? 'Nouveau...' : conv.lastMsg.text}</div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
        <div className={`flex-1 flex flex-col bg-stone-50 relative ${viewMode !== 'list' ? 'flex w-full h-full' : 'hidden md:flex'}`}>
            {viewMode === 'new' && (
                <div className="absolute inset-0 z-10 bg-white flex flex-col">
                    <div className="p-2 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
                        <input type="text" placeholder="Pays..." className="flex-1 p-1 rounded border border-stone-300 text-xs focus:outline-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoFocus />
                        <button onClick={() => setViewMode('list')} className="text-stone-400 font-bold px-2">✕</button>
                    </div>
                    <div className="p-1 bg-blue-50 flex justify-between items-center px-2">
                        <span className="text-[10px] text-blue-800 font-bold">{newChatSelection.length} participants</span>
                        <button onClick={startNewChat} disabled={newChatSelection.length === 0} className="px-3 py-0.5 rounded text-[10px] bg-blue-600 text-white font-bold">OK</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1 content-start">
                        {filteredCountries.map(country => (
                            <button key={country} onClick={() => toggleNewChatSelection(country)} className={`p-1 rounded border flex items-center gap-2 ${newChatSelection.includes(country) ? 'bg-blue-100 border-blue-500' : 'bg-white border-stone-200'}`}>
                                <img src={getFlagUrl(country) || ''} alt="" className="w-5 h-3 object-cover rounded" />
                                <span className="text-[10px] truncate">{country}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {activeParticipants.length > 0 && (
                <>
                    <div className="bg-white border-b border-stone-200 p-2 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setViewMode('list')} className="md:hidden text-stone-500 font-bold pr-1">←</button>
                            <h3 className="font-bold text-stone-800 text-xs truncate max-w-[150px]">{activeParticipants.join(', ')}</h3>
                        </div>
                        <button onClick={onClose} className="text-stone-400 font-bold px-1 hover:text-red-500">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 bg-stone-100 flex flex-col" ref={scrollRef}>
                        {activeThreadMessages.map(msg => (
                            <div key={msg.id} className={`flex flex-col mb-2 ${msg.sender === 'player' ? 'items-end' : 'items-start'}`}>
                                <div className={`max-w-[85%] rounded-xl p-2 text-xs shadow-sm ${msg.sender === 'player' ? 'bg-blue-600 text-white' : 'bg-white text-stone-800 border border-stone-200'}`}>
                                    {msg.sender === 'ai' && activeParticipants.length > 1 && <div className="text-[9px] font-bold text-orange-600 mb-0.5">{msg.senderName}</div>}
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        {currentTypingList.length > 0 && <div className="text-[9px] text-stone-500 italic ml-2 mt-1 animate-pulse">En train d'écrire...</div>}
                    </div>
                    <div className="p-2 bg-white border-t border-stone-200 flex gap-2">
                        <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="..." className="flex-1 p-2 rounded-full border border-stone-300 text-xs bg-stone-50" disabled={isProcessing} onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
                        <button onClick={handleSend} disabled={!inputText.trim() || isProcessing} className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">➤</button>
                    </div>
                </>
            )}
        </div>
    </div>
  );
};

export default ChatInterface;
