// Pure parsers + detectors — no network, no DB imports. Safe to unit-test.

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  businessName?: string;
  category?: string;
  dulNumber?: string;
  isInvestInDubai?: boolean;
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/');
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

// DuckDuckGo HTML endpoint parser (html.duckduckgo.com/html)
export function parseDdgHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultRegex =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null) {
    let href = match[1];
    // DDG wraps links: //duckduckgo.com/l/?uddg=<encoded>&...
    const ud = href.match(/uddg=([^&]+)/);
    if (ud) {
      try { href = decodeURIComponent(ud[1]); } catch { /* keep original */ }
    }
    if (!href.startsWith('http')) continue;
    results.push({
      url: href,
      title: decodeHtml(stripTags(match[2])).trim(),
      description: decodeHtml(stripTags(match[3])).trim(),
    });
    if (results.length >= 20) break;
  }
  return results;
}

// Bing HTML parser (www.bing.com/search)
export function parseBingHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultRegex =
    /<li[^>]+class="b_algo"[\s\S]*?<h2>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href.startsWith('http')) continue;
    results.push({
      url: href,
      title: decodeHtml(stripTags(match[2])).trim(),
      description: decodeHtml(stripTags(match[3])).trim(),
    });
    if (results.length >= 20) break;
  }
  return results;
}

// --- Contact extraction ---
export const PHONE_RE =
  /(?:(?:\+971|00971|0)[\s\-]?(?:50|52|54|55|56|58|2|3|4|6|7|9)[\s\-]?\d(?:[\s\-]?\d){6})|(?:800[\s\-]?\d(?:[\s\-]?\d){5})/g;
export const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function extractContacts(html: string) {
  const contacts: any = {
    phone: null,
    email: null,
    whatsapp: null,
    instagram: null,
    facebook: null,
    tiktok: null,
  };

  const phone = html.match(PHONE_RE);
  if (phone) contacts.phone = phone[0].replace(/[\s\-]/g, '');

  const email = html.match(EMAIL_RE);
  if (email) {
    contacts.email = email.find(e => !e.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) || email[0];
  }

  const wa = html.match(/wa\.me\/(\d+)|api\.whatsapp\.com\/send\?phone=(\d+)/);
  if (wa) contacts.whatsapp = wa[1] || wa[2];

  const ig = html.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
  if (ig && !['p', 'reel', 'explore', 'stories'].includes(ig[1])) contacts.instagram = ig[1];

  const fb = html.match(/facebook\.com\/([a-zA-Z0-9._]+)/);
  if (fb && !['sharer', 'tr', 'plugins'].includes(fb[1])) contacts.facebook = fb[1];

  const tt = html.match(/tiktok\.com\/@([a-zA-Z0-9._]+)/);
  if (tt) contacts.tiktok = tt[1];

  return contacts;
}

// --- COD / Gateway detection ---
export const COD_KEYWORDS = [
  'cash on delivery', 'cod only', 'cash only', 'no online payment',
  'bank transfer only', 'pay on delivery', 'cod available',
  'كاش عند الاستلام', 'الدفع نقد', 'كاش فقط', 'الدفع عند الاستلام',
  'نقبل الكاش', 'تحويل بنكي فقط', 'الدفع كاش',
];

// Gateway signatures — names, CDN domains, widget hooks, script tags.
export const GATEWAY_SIGNATURES: { name: string; patterns: RegExp[] }[] = [
  { name: 'myfatoorah', patterns: [/myfatoorah\.com/i, /myfatoorah/i] },
  { name: 'stripe',     patterns: [/stripe\.com/i, /js\.stripe\.com/i, /\bstripe\b/i] },
  { name: 'paypal',     patterns: [/paypal\.com/i, /paypalobjects\.com/i] },
  { name: 'tabby',      patterns: [/tabby\.ai/i, /checkout\.tabby/i, /\btabby\b/i] },
  { name: 'tamara',     patterns: [/tamara\.co/i, /\btamara\b/i] },
  { name: 'checkout',   patterns: [/checkout\.com/i, /cko\.checkout/i] },
  { name: 'payfort',    patterns: [/payfort\.com/i, /\bpayfort\b/i] },
  { name: 'telr',       patterns: [/telr\.com/i, /\btelr\b/i] },
  { name: 'networkintl',patterns: [/network-international/i, /networkintl/i] },
  { name: 'amazon_pay', patterns: [/payments-amazon\.com/i, /amazonpay/i] },
  { name: 'apple_pay',  patterns: [/apple[\s\-]?pay/i, /applepay/i] },
  { name: 'google_pay', patterns: [/google[\s\-]?pay/i, /googlepay/i] },
  { name: 'mada',       patterns: [/\bmada\b/i] },
  { name: 'knet',       patterns: [/\bknet\b/i, /knet\.com/i] },
];

export function detectCod(html: string): { isCod: boolean; evidence: string[] } {
  const lower = html.toLowerCase();
  const hits: string[] = [];
  for (const kw of COD_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return { isCod: hits.length > 0, evidence: hits.slice(0, 4) };
}

export function detectGateways(html: string): { hasGateway: boolean; gateways: string[] } {
  const found = new Set<string>();
  for (const sig of GATEWAY_SIGNATURES) {
    if (sig.patterns.some(p => p.test(html))) found.add(sig.name);
  }
  return { hasGateway: found.size > 0, gateways: Array.from(found) };
}
