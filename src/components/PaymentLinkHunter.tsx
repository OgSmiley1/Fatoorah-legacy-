import React from 'react';
import { Send, Loader2, Sparkles, TrendingUp, Link2, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Merchant } from '../types';
import { geminiService } from '../services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PaymentLinkHunterProps {
  onResultsFound: (merchants: Merchant[]) => void;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const SYSTEM_PROMPT_PAYMENT = `You are the PAYMENT LINK HUNTER — specialized in finding businesses that collect payments via digital links.
Your mission: Discover merchants who rely on manual payment collection methods and would benefit from MyFatoorah Payment Links.

Target Signals:
- Businesses using WhatsApp/Email for payment collection
- No integrated payment gateway
- Digital-first (Instagram, TikTok, Facebook shops)
- Services industries (consultants, freelancers, agencies)
- E-commerce with manual checkout process

Exclusions: Already using Stripe, Telr, PayTabs, 2Checkout, PayPal

When asked to SEARCH, reply ONLY with JSON:
{"action":"search","keywords":"...","location":"...","type":"payment_link"}

For STATS: {"action":"stats"}`;

const QUICK_SEARCHES = [
  { label: '💌 Email Invoice Users', msg: 'Find consultants and agencies sending payment links via email in UAE' },
  { label: '📲 WhatsApp Payment Collectors', msg: 'Hunt for businesses collecting payments through WhatsApp DM in Dubai' },
  { label: '🛒 Manual Checkout Shops', msg: 'Find Instagram shops without integrated payment processing' },
  { label: '💼 Freelance Services', msg: 'Locate freelancers and service providers in GCC needing payment links' },
];

export const PaymentLinkHunter: React.FC<PaymentLinkHunterProps> = ({ onResultsFound, onClose }) => {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: 'assistant',
      content: "🔗 **Payment Link Hunter** — Find businesses sending invoices & payment requests via email, WhatsApp, or social DMs.\n\nThese merchants are perfect for MyFatoorah Payment Links — they'll reduce manual follow-ups by 80%.",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: 'user', content: msg, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: SYSTEM_PROMPT_PAYMENT
        })
      });

      if (!res.ok) throw new Error('Server error');

      const data = await res.json();
      const responseText: string = data.response || '';

      const jsonMatch = responseText.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const action = JSON.parse(jsonMatch[0]);
          if (action.action === 'search' && action.keywords) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `🚀 Hunting for **${action.keywords}** in **${action.location || 'UAE'}**...\n\nLooking for businesses using payment links, email invoicing, and WhatsApp payment requests.`,
              timestamp: Date.now()
            }]);
            // Trigger actual search through parent
            onResultsFound([]);
          }
        } catch (e) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: responseText || 'Search initiated.',
            timestamp: Date.now()
          }]);
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: responseText,
          timestamp: Date.now()
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Connection error. Check server status.',
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-end p-4"
    >
      <div className="w-full max-w-md bg-slate-900 rounded-lg shadow-2xl border border-slate-700 flex flex-col h-96">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 rounded-t-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-white" />
              <h3 className="font-bold text-white">Payment Link Hunter</h3>
            </div>
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-800/50">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "max-w-xs rounded-lg p-3 text-sm",
                  msg.role === 'user'
                    ? 'ml-auto bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-100'
                )}
              >
                {msg.content}
              </motion.div>
            ))}
          </AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-slate-400 text-sm"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing businesses...
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Searches */}
        {messages.length === 1 && (
          <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/50 max-h-24 overflow-y-auto">
            <div className="grid grid-cols-1 gap-1 text-xs">
              {QUICK_SEARCHES.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q.msg)}
                  className="text-left px-2 py-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-slate-700 p-3 bg-slate-900 rounded-b-lg flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Describe your hunt..."
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white p-2 rounded transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};
