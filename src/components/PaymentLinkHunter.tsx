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

const SYSTEM_PROMPT_PAYMENT = `You are the PAYMENT LINK HUNTER — an AI specialized exclusively in discovering merchants who still collect money manually and urgently need MyFatoorah Payment Links.

Return ONLY valid JSON. No markdown. No explanation. No extra text.

YOUR MISSION:
Extract keywords for the specific merchant segment the user describes. Focus on niches that:
• Take orders on WhatsApp, Instagram DM, TikTok DM, or Facebook Messenger
• Send bank-transfer details, email invoices, or payment requests manually
• Accept cash on delivery / pay on delivery / collect on delivery
• Have no online checkout — just "DM to order" or "WhatsApp to buy"
• Are freelancers, home businesses, boutiques, online sellers, service providers

SIGNAL WORDS TO INCLUDE IN KEYWORDS (pick relevant ones):
whatsapp order | dm to order | email invoice | bank transfer | cash on delivery | payment request | pay on delivery | send details | order via whatsapp | contact to purchase

ABSOLUTE AVOIDS — never produce keywords that include:
Stripe, PayPal, Telr, PayTabs, Checkout.com, Tap, HyperPay, Network International, payment gateway, PSP, fintech, news, blog, directory, scam, government, free zone, embed, visa payment, mastercard news

JSON schema — return exactly one of these:
{"action":"search","keywords":"tightly scoped merchant keywords WITHOUT location","location":"specific UAE city or country","type":"payment_link"}
{"action":"stats","keywords":"","location":"United Arab Emirates","type":"payment_link"}

Examples of GOOD outputs:
{"action":"search","keywords":"abaya boutique instagram whatsapp order cod","location":"Dubai","type":"payment_link"}
{"action":"search","keywords":"home baker cake delivery payment request","location":"Abu Dhabi","type":"payment_link"}
{"action":"search","keywords":"freelance graphic designer email invoice bank transfer","location":"United Arab Emirates","type":"payment_link"}`;

const QUICK_SEARCHES = [
  { label: '👗 Abaya & Fashion Boutiques', msg: 'abaya boutique fashion shop whatsapp order dm to buy' },
  { label: '🎂 Home Bakers & Food', msg: 'home baker cake sweets food delivery whatsapp order cod' },
  { label: '💄 Beauty & Salon Services', msg: 'salon spa nail lashes beauty service instagram book whatsapp' },
  { label: '📦 Delivery & Logistics', msg: 'delivery courier parcel service cash on delivery bank transfer' },
  { label: '💌 Email Invoice Senders', msg: 'consultant freelancer agency invoice email payment request' },
  { label: '🖨️ Printing & Gifting', msg: 'custom printing gifts corporate merch whatsapp order bank transfer' },
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

    const fallback = fallbackAction(input);

    return {
      action: 'search',
      keywords: String(parsed?.keywords || fallback.keywords).trim(),
      location: String(parsed?.location || fallback.location).trim(),
      type: 'payment_link',
    };
  } catch {
    return fallbackAction(input);
  }
}

function buildPaymentLinkSearchParams(action: HunterAction): SearchParams {
  // The backend payment_link query templates already inject all manual-payment
  // signal terms and gateway exclusions, so keywords stay focused on niche.
  return {
    keywords: action.keywords || 'instagram shops whatsapp order cash on delivery',
    location: action.location || DEFAULT_LOCATION,
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
    return parseAction(data?.response || '', message);
  } catch {
    return fallbackAction(message);
  } finally {
    window.clearTimeout(timer);
  }
}

// Rotate through default auto-hunt queries so each modal open feels fresh
const AUTO_HUNT_DEFAULTS = [
  { keywords: 'abaya boutique fashion instagram whatsapp order', location: 'Dubai' },
  { keywords: 'home baker sweets delivery whatsapp cod', location: 'Abu Dhabi' },
  { keywords: 'salon beauty nail lashes instagram book payment', location: 'Sharjah' },
  { keywords: 'custom printing gifts corporate merch bank transfer', location: 'Dubai' },
  { keywords: 'freelance photographer designer invoice email payment', location: 'United Arab Emirates' },
];

export const PaymentLinkHunter: React.FC<PaymentLinkHunterProps> = ({ onResultsFound, onClose }) => {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: 'assistant',
      content: '🔗 Payment Link Hunter activated. I search exclusively for merchants collecting payments manually — WhatsApp orders, DM checkouts, email invoices, bank transfers, COD. Launching auto-hunt now...',
      timestamp: Date.now(),
    },
  ]);

  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [hunted, setHunted] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-hunt with a rotating default on first open
  React.useEffect(() => {
    if (hunted) return;
    setHunted(true);
    const pick = AUTO_HUNT_DEFAULTS[Math.floor(Math.random() * AUTO_HUNT_DEFAULTS.length)];
    runHunterWithAction({
      action: 'search',
      keywords: pick.keywords,
      location: pick.location,
      type: 'payment_link',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runHunterWithAction(action: HunterAction) {
    if (loading) return;
    setLoading(true);

    try {
      if (action.action === 'stats') {
        const stats = await geminiService.getStats();
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `📊 Pipeline: ${stats.totalMerchants} merchants · ${stats.totalLeads} leads tracked.`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      const searchParams = buildPaymentLinkSearchParams(action);

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `🚀 Hunting payment-link prospects — “${action.keywords}” in ${action.location}.\nUsing 9 search engines + UAE government sources. Firewall active: only verified merchants returned.`,
          timestamp: Date.now(),
        },
      ]);

      const results = await geminiService.searchMerchants(searchParams);
      onResultsFound(results);

      const codCount = results.filter(r => r.isCOD).length;
      const noGateway = results.filter(r => !r.hasGateway).length;

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: results.length > 0
            ? `✅ ${results.length} verified Payment Link prospect${results.length !== 1 ? 's' : ''} found.\n• ${codCount} COD merchants  •  ${noGateway} with no payment gateway\nResults pushed to main grid. Type another niche to hunt more.`
            : '⚠️ No verified payment-link prospects this round. Try a tighter niche: “abaya Dubai WhatsApp order” or “home baker Abu Dhabi COD”.',
          timestamp: Date.now(),
        },
      ]);
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `❌ Hunt failed: ${error?.message || 'unknown error'}.`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function runHunter(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: Date.now() }]);
    setInput('');

    const action = await askAiForAction(msg, messages);
    await runHunterWithAction(action);
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
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
              ✕
            </button>
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
              className="flex items-center gap-2 text-cyan-400 text-sm bg-slate-700/50 rounded-lg px-3 py-2"
            >
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>Scanning 9 engines for manual-payment merchants — firewall active…</span>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/50 max-h-32 overflow-y-auto">
          <p className="text-xs text-slate-500 mb-1">Quick niches:</p>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {QUICK_SEARCHES.map((q, i) => (
              <button
                key={i}
                disabled={loading}
                onClick={() => runHunter(q.msg)}
                className="text-left px-2 py-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-40 transition-colors truncate"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

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