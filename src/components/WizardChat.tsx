import React from 'react';
import { Send, X, Loader2, Sparkles, Bot, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WizardChatProps {
  onSearch: (keywords: string, location: string) => void;
  onRefreshStats: () => void;
  onUpdateStatus: (id: string, updates: any) => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: 'gemini' | 'groq' | 'none';
  timestamp: number;
}

const SYSTEM_PROMPT = `You are the SMILEY WIZARD, the intelligent core of the MyFatoorah Acquisition Engine.

Your mission: help sales teams find, qualify, and manage merchants across the UAE.

When the user asks you to SEARCH or HUNT for merchants, reply with ONLY this JSON (no markdown, no extra text):
{"action":"search","keywords":"...","location":"..."}

When the user asks for STATS or PIPELINE, reply with ONLY:
{"action":"stats"}

For all other questions, answer in clear, professional English. Use bullet points for lists. Be concise.`;

export const WizardChat: React.FC<WizardChatProps> = ({ onSearch, onRefreshStats, onUpdateStatus }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: 'assistant',
      content: "Hello! I'm the **SMILEY WIZARD**. I can help you hunt for merchants, check pipeline stats, or answer questions about your leads.\n\nTry: *\"Hunt for abayas shops in Dubai\"* or *\"Show me the pipeline stats\"*",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [messages, isOpen]);

  React.useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, systemPrompt: SYSTEM_PROMPT })
      });

      const data = await res.json();
      const responseText: string = data.response || 'No response received.';
      const provider = data.provider;

      // Try to parse action JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const action = JSON.parse(jsonMatch[0]);
          if (action.action === 'search' && action.keywords) {
            const location = action.location || 'United Arab Emirates';
            onSearch(action.keywords, location);
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Launching hunt for **${action.keywords}** in **${location}**. Watch the dashboard for live results.`,
              provider,
              timestamp: Date.now()
            }]);
          } else if (action.action === 'stats') {
            onRefreshStats();
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: 'Stats refreshed. Check the pipeline panel for the latest numbers.',
              provider,
              timestamp: Date.now()
            }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: responseText, provider, timestamp: Date.now() }]);
          }
        } catch {
          setMessages(prev => [...prev, { role: 'assistant', content: responseText, provider, timestamp: Date.now() }]);
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: responseText, provider, timestamp: Date.now() }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection error. Make sure `GEMINI_API_KEY` or `GROQ_API_KEY` is set in your `.env` file.',
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <>
      {/* Toggle button */}
      <motion.button
        onClick={() => setIsOpen(v => !v)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 shadow-lg flex items-center justify-center text-white hover:scale-110 transition-transform"
        whileTap={{ scale: 0.95 }}
        title="Open Wizard Chat"
      >
        <AnimatePresence mode="wait">
          {isOpen
            ? <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}><ChevronDown size={22} /></motion.span>
            : <motion.span key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}><Sparkles size={22} /></motion.span>
          }
        </AnimatePresence>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[520px] flex flex-col rounded-2xl border border-white/10 bg-gray-900/95 backdrop-blur shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-900/60 to-violet-900/60 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Bot size={18} className="text-blue-400" />
                <span className="text-sm font-bold text-white">Smiley Wizard</span>
                <span className="text-xs text-gray-400">AI Assistant</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-gray-700">
              {messages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] px-3 py-2 rounded-xl text-sm',
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                  )}>
                    {msg.role === 'assistant'
                      ? <ReactMarkdown className="prose prose-invert prose-sm max-w-none">{msg.content}</ReactMarkdown>
                      : <p>{msg.content}</p>
                    }
                    {msg.provider && msg.provider !== 'none' && (
                      <span className={cn(
                        'mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded font-mono',
                        msg.provider === 'gemini' ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300'
                      )}>
                        via {msg.provider}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-800 px-3 py-2 rounded-xl rounded-bl-sm flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                    <span className="text-xs text-gray-400">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-3 py-3 border-t border-white/10 bg-gray-900/80">
              <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Hunt merchants, check stats..."
                  disabled={loading}
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  className="text-blue-400 hover:text-blue-300 disabled:opacity-30 transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
