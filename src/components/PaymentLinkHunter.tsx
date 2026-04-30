import React from 'react';
import { Send, Loader2, Link2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Merchant, SearchParams } from '../types';
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

interface HunterAction {
  action: 'search' | 'stats';
  keywords: string;
  location: string;
  type: 'payment_link';
}

const DEFAULT_LOCATION = 'United Arab Emirates';

const SYSTEM_PROMPT_PAYMENT = `You are the PAYMENT LINK HUNTER — specialized in finding businesses that still collect payments manually and would benefit from MyFatoorah Payment Links.

Return ONLY JSON. No markdown. No explanation.

Target Signals:
- WhatsApp order / DM to order
- Email invoice / send invoice / payment request
- Bank transfer / cash on delivery / pay on delivery
- Instagram, TikTok, Facebook shops with manual checkout
- Consultants, freelancers, agencies, home businesses, online sellers

Avoid:
- Stripe, PayPal, Telr, PayTabs, Checkout.com, Tap, Network International, HyperPay
- PSP blogs, payment companies, directories, government pages

JSON schema:
{"action":"search","keywords":"merchant segment to search","location":"UAE city/country","type":"payment_link"}

For STATS:
{"action":"stats","keywords":"","location":"United Arab Emirates","type":"payment_link"}`;

const QUICK_SEARCHES = [
  { label: '💌 Email Invoice Users', msg: 'consultants agencies service providers sending invoices by email' },
  { label: '📲 WhatsApp Collectors', msg: 'instagram shops whatsapp to order cash on delivery' },
  { label: '🛒 Manual Checkout Shops', msg: 'online boutiques dm to order bank transfer no checkout' },
  { label: '💼 Freelance Services', msg: 'freelancers home businesses payment request whatsapp UAE' },
];

const LOCATION_HINTS = [
  'Dubai',
  'Abu Dhabi',
  'Sharjah',
  'Ajman',
  'Ras Al Khaimah',
  'Fujairah',
  'Umm Al Quwain',
  'Al Ain',
  'United Arab Emirates',
  'UAE',
  'Saudi Arabia',
  'Kuwait',
  'Qatar',
  'Bahrain',
  'Oman',
  'GCC',
];

function cleanKeywordText(input: string): string {
  return input
    .replace(/\b(find|hunt|search|locate|businesses|companies|clients|merchants|users|in|at|around|near|for|please|payment|links?|myfatoorah)\b/gi, ' ')
    .replace(/\b(dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|umm al quwain|al ain|uae|united arab emirates|gcc|qatar|kuwait|bahrain|oman|saudi arabia)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferLocation(input: string): string {
  const lower = input.toLowerCase();
  const found = LOCATION_HINTS.find(loc => lower.includes(loc.toLowerCase()));
  if (!found) return DEFAULT_LOCATION;
  return found === 'UAE' ? DEFAULT_LOCATION : found;
}

function fallbackAction(input: string): HunterAction {
  const keywords = cleanKeywordText(input) || input.trim() || 'instagram shops whatsapp order cash on delivery';
  return {
    action: 'search',
    keywords,
    location: inferLocation(input),
    type: 'payment_link',
  };
}

function parseAction(raw: string, input: string): HunterAction {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return fallbackAction(input);

  try {
    const parsed = JSON.parse(match[0]);
    if (parsed?.action === 'stats') {
      return {
        action: 'stats',
        keywords: '',
        location: parsed.location || DEFAULT_LOCATION,
        type: 'payment_link',
      };
    }

    return {
      action: 'search',
      keywords: String(parsed?.keywords || fallbackAction(input).keywords).trim(),
      location: String(parsed?.location || inferLocation(input)).trim(),
      type: 'payment_link',
    };
  } catch {
    return fallbackAction(input);
  }
}

function buildPaymentLinkSearchParams(action: HunterAction): SearchParams {
  const base = action.keywords || 'instagram shops whatsapp order cash on delivery';
  const location = action.location || DEFAULT_LOCATION;

  return {
    keywords: [
      base,
      location,
      '"whatsapp to order" OR "dm to order" OR "cash on delivery" OR "pay on delivery" OR "bank transfer" OR "email invoice"',
      '-stripe -paypal -paytabs -telr -"checkout.com" -"payment gateway"',
    ].join(' '),
    location,
    maxResults: 25,
    onlyQualified: true,
    hunterType: 'payment_link',
  };
}

async function askAiForAction(message: string, history: Message[]): Promise<HunterAction> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        history: history.map(m => ({ role: m.role, content: m.content })),
        systemPrompt: SYSTEM_PROMPT_PAYMENT,
      }),
    });

    if (!res.ok) return fallbackAction(message);

    const data = await res.json();
    const responseText = data?.response || '';
    return parseAction(responseText, message);
  } catch {
    return fallbackAction(message);
  } finally {
    window.clearTimeout(timer);
  }
}

export const PaymentLinkHunter: React.FC<PaymentLinkHunterProps> = ({ onResultsFound, onClose }) => {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: 'assistant',
      content: '🔗 Payment Link Hunter ready. I will search for merchants using WhatsApp, DM, email invoices, COD, or bank transfer instead of a proper checkout.',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function runHunter(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: 'user', content: msg, timestamp: Date.now() };
    const nextMessages = [...messages, userMsg];

    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const action = await askAiForAction(msg, nextMessages);
      if (action.action === 'stats') {
        const stats = await geminiService.getStats();
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📊 Pipeline now has ${stats.totalMerchants} merchants and ${stats.totalLeads} leads.`,
          timestamp: Date.now(),
        }]);
        return;
      }

      const searchParams = buildPaymentLinkSearchParams(action);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `🚀 Running real hunt: ${action.keywords} — ${action.location}. Filtering for manual-payment signals and excluding merchants that already show gateway evidence.`,
        timestamp: Date.now(),
      }]);

      const results = await geminiService.searchMerchants(searchParams);
      onResultsFound(results);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: results.length > 0
          ? `✅ Found ${results.length} Payment Link prospects. I pushed them into the main results grid.`
          : '⚠️ No clean Payment Link prospects found. Try a narrower niche like “abaya shops Dubai WhatsApp order” or “home bakery Sharjah COD”.',
        timestamp: Date.now(),
      }]);
    } catch (error: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Hunt failed: ${error?.message || 'unknown error'}. Check /api/stats runtime.lastError and server logs.`,
        timestamp: Date.now(),
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
      <div className="w-full max-w-md bg-slate-900 rounded-lg shadow-2xl border border-slate-700 flex flex-col h-[32rem]">
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 rounded-t-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-white" />
              <h3 className="font-bold text-white">Payment Link Hunter</h3>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-800/50">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div
                key={`${msg.timestamp}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'max-w-xs rounded-lg p-3 text-sm whitespace-pre-wrap',
                  msg.role === 'user' ? 'ml-auto bg-blue-600 text-white' : 'bg-slate-700 text-slate-100'
                )}
              >
                {msg.content}
              </motion.div>
            ))}
          </AnimatePresence>
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching public signals...
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length === 1 && (
          <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/50 max-h-28 overflow-y-auto">
            <div className="grid grid-cols-1 gap-1 text-xs">
              {QUICK_SEARCHES.map((q, i) => (
                <button
                  key={i}
                  onClick={() => runHunter(q.msg)}
                  className="text-left px-2 py-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-slate-700 p-3 bg-slate-900 rounded-b-lg flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && runHunter()}
              placeholder="e.g. abaya shops Dubai WhatsApp order"
              className="w-full bg-slate-800 border border-slate-600 rounded pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => runHunter()}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white p-2 rounded transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
