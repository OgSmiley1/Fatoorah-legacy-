import React from 'react';
import { Send, X, Sparkles, Loader2, Bot, User, Zap, BarChart3, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { geminiService } from '../services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  role: 'user' | 'model';
  text: string;
  isTool?: boolean;
}

interface WizardChatProps {
  onSearch: (keywords: string, location: string) => void;
  onRefreshStats: () => void;
  onUpdateStatus: (id: string, status: any) => void;
}

export const WizardChat: React.FC<WizardChatProps> = ({ onSearch, onRefreshStats, onUpdateStatus }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState<Message[]>([
    { role: 'model', text: "Greetings! I am the SMILEY WIZARD. How can I assist your acquisition mission today? 🧙‍♂️" }
  ]);
  const [loading, setLoading] = React.useState(false);
  const [chat, setChat] = React.useState<any>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const initChat = async () => {
    try {
      const newChat = await geminiService.createWizardChat();
      setChat(newChat);
    } catch (e) {
      console.error("Failed to init Wizard Chat", e);
    }
  };

  React.useEffect(() => {
    initChat();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || !chat || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const response = await chat.sendMessage({ message: userMsg });
      
      // Handle Function Calls
      if (response.functionCalls) {
        for (const call of response.functionCalls) {
          if (call.name === 'search_merchants') {
            const { keywords, location } = call.args as any;
            onSearch(keywords, location);
            setMessages(prev => [...prev, { role: 'model', text: `⚡ Initiating hunt for "${keywords}" in ${location}...`, isTool: true }]);
          } else if (call.name === 'get_pipeline_stats') {
            onRefreshStats();
            setMessages(prev => [...prev, { role: 'model', text: `📊 Fetching latest pipeline intelligence...`, isTool: true }]);
          } else if (call.name === 'update_lead_status') {
            const { leadId, status } = call.args as any;
            onUpdateStatus(leadId, status);
            setMessages(prev => [...prev, { role: 'model', text: `🎯 Updating lead ${leadId} status to ${status}.`, isTool: true }]);
          }
        }
      }

      if (response.text) {
        setMessages(prev => [...prev, { role: 'model', text: response.text }]);
      }
    } catch (e) {
      console.error("Wizard Chat Error:", e);
      setMessages(prev => [...prev, { role: 'model', text: "My magical circuits are flickering. Please try again! ⚠️" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-900/40 z-50 hover:scale-110 transition-transform group"
      >
        {isOpen ? <X className="text-white" /> : <Sparkles className="text-white group-hover:animate-pulse" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 w-96 h-[600px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
                <Bot className="text-blue-400" size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-tight">Smiley Wizard</h3>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-bold text-slate-500 uppercase">AI Core Active</span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col max-w-[85%]",
                    msg.role === 'user' ? "ml-auto items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "p-3 rounded-2xl text-xs leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-blue-600 text-white rounded-tr-none" 
                      : msg.isTool 
                        ? "bg-slate-800 border border-blue-500/30 text-blue-300 italic rounded-tl-none"
                        : "bg-slate-800 text-slate-200 rounded-tl-none"
                  )}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-start gap-2">
                  <div className="bg-slate-800 p-3 rounded-2xl rounded-tl-none">
                    <Loader2 className="animate-spin text-blue-400" size={16} />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/50">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="Command the Wizard..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-4 pr-12 text-xs text-white placeholder:text-slate-600 focus:border-blue-500/50 outline-none transition-all"
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all"
                >
                  <Send size={14} className="text-white" />
                </button>
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {[
                  { icon: <Zap size={10} />, label: "Hunt Abayas" },
                  { icon: <BarChart3 size={10} />, label: "Show Stats" },
                  { icon: <Target size={10} />, label: "Qualify Leads" }
                ].map((btn, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(btn.label)}
                    className="flex-none flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-[9px] font-bold text-slate-400 hover:text-white hover:border-slate-600 transition-all"
                  >
                    {btn.icon}
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
