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
// `strong` patterns (CDN/SDK domains, deterministic identifiers) count as
// high-confidence evidence even when the merchant only mentions the gateway
// in passing copy. `weak` patterns are name-only mentions (`\btap\b`) that
// alone aren't enough — they must be confirmed by a strong signal or by a
// checkout URL pattern (see CHECKOUT_URL_PATTERNS below).
export const GATEWAY_SIGNATURES: { name: string; strong: RegExp[]; weak?: RegExp[] }[] = [
  { name: 'myfatoorah', strong: [/myfatoorah\.com/i, /portal\.myfatoorah/i, /sbpaymentapi\.myfatoorah/i] },
  { name: 'stripe',     strong: [/js\.stripe\.com/i, /api\.stripe\.com/i, /checkout\.stripe\.com/i, /m\.stripe\.network/i], weak: [/\bstripe\b/i] },
  { name: 'paypal',     strong: [/paypal\.com\/sdk/i, /paypalobjects\.com/i, /\.paypal\.com/i, /www\.paypal\.com\/checkoutnow/i] },
  { name: 'tabby',      strong: [/checkout\.tabby\.ai/i, /api\.tabby\.ai/i, /tabby\.ai\/promos/i], weak: [/\btabby\b/i] },
  { name: 'tamara',     strong: [/cdn\.tamara\.co/i, /api\.tamara\.co/i, /tamara\.co\/checkout/i], weak: [/\btamara\b/i] },
  { name: 'checkout',   strong: [/checkout\.com\/api/i, /js\.checkout\.com/i, /cko\.checkout/i, /api\.checkout\.com/i] },
  { name: 'payfort',    strong: [/payfort\.com/i, /sbpaymentservices\.payfort/i, /paymentservices\.payfort/i] },
  { name: 'telr',       strong: [/secure\.telr\.com/i, /telr\.com\/gateway/i], weak: [/\btelr\b/i] },
  { name: 'networkintl',strong: [/network-international\.com/i, /networkintl\.com/i, /n-genius/i] },
  { name: 'amazon_pay', strong: [/payments-amazon\.com/i, /static-na\.payments-amazon/i] },
  { name: 'apple_pay',  strong: [/applepay\.cdn-apple\.com/i, /js-apple-pay/i], weak: [/apple[\s\-]?pay/i] },
  { name: 'google_pay', strong: [/pay\.google\.com\/gp\/p\/js/i, /gpay\.api/i], weak: [/google[\s\-]?pay/i] },
  { name: 'mada',       strong: [/mada-payment/i], weak: [/\bmada\b/i] },
  { name: 'knet',       strong: [/kpay\.com\.kw/i, /knet\.com\.kw/i], weak: [/\bknet\b/i] },
  { name: 'tap',        strong: [/secure\.gosell\.io/i, /go\.tap\.company/i, /tap\.company\/api/i], weak: [/\btap[\s\-]?payments?\b/i] },
  { name: 'paytabs',    strong: [/secure-global\.paytabs\.com/i, /paytabs\.com\/api/i, /paytabs\.com\/payment/i], weak: [/\bpaytabs\b/i] },
  { name: 'hyperpay',   strong: [/oppwa\.com/i, /eu-test\.oppwa\.com/i, /hyperpay\.com\/payment/i], weak: [/\bhyperpay\b/i] },
  { name: 'adyen',      strong: [/checkoutshopper-live\.adyen/i, /adyen\.com\/hpp/i, /pal-live\.adyenpayments/i], weak: [/\badyen\b/i] },
  { name: 'twocheckout',strong: [/2checkout\.com/i, /secure\.2co\.com/i, /verifone\.cloud/i], weak: [/\b2checkout\b/i] },
  { name: 'razorpay',   strong: [/checkout\.razorpay\.com/i, /api\.razorpay\.com/i] },
  { name: 'square',     strong: [/squareup\.com\/payments/i, /web\.squarecdn\.com/i] },
  { name: 'worldpay',   strong: [/secure\.worldpay\.com/i, /\bworldpay\b/i] },
  { name: 'shopify_pay',strong: [/shop\.app\/checkout/i, /shopifycdn\.com\/s\/files/i, /shopify\.com\/payments/i] },
  { name: 'woo_payments',strong: [/woocommerce\.com\/payments/i, /wcpay\.com/i] },
];

// Common in-cart / checkout URL patterns — independent evidence that a
// gateway is wired up, even when no SDK is loaded on the homepage.
export const CHECKOUT_URL_PATTERNS: RegExp[] = [
  /\/checkout(?:\/|\?|$)/i,
  /\/cart\/checkout/i,
  /\/order\/?(?:pay|payment|checkout)/i,
  /\/pay(?:ment)?\/(?:complete|success|return)/i,
  /\/process[_-]?payment/i,
  /\?action=checkout/i,
];

// Phrases that establish "this page is talking about payments" — used to
// promote weak (name-only) gateway mentions to a confirmed detection.
// Without one of these, "stripe" in a news article won't false-positive.
export const PAYMENT_CONTEXT_PATTERNS: RegExp[] = [
  /\bpay(?:\s+with|\s+by|\s+via|\s+using)\b/i,
  /\bpowered\s+by\b/i,
  /\bwe\s+accept\b/i,
  /\baccept(?:ed)?\s+(?:via\s+)?(?:cards?|payments?)\b/i,
  /\bcheckout\s+with\b/i,
  /\bsecure\s+(?:checkout|payment)\b/i,
  /\bpayment\s+(?:methods?|options?|gateway)\b/i,
];

export function detectCod(html: string): { isCod: boolean; evidence: string[] } {
  const lower = html.toLowerCase();
  const hits: string[] = [];
  for (const kw of COD_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return { isCod: hits.length > 0, evidence: hits.slice(0, 4) };
}

export interface GatewayDetection {
  hasGateway: boolean;
  gateways: string[];
  // Per-gateway evidence: which signal type fired ('strong' | 'weak+checkout' | 'script-src')
  evidence: Record<string, string[]>;
  // Did we see any in-cart / checkout URL pattern? Independent gateway signal.
  hasCheckoutUrl: boolean;
}

// Pull every <script src="..."> URL out of the HTML so we can match SDK
// domains directly — much higher precision than scanning the whole document.
function extractScriptSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

export function detectGateways(html: string): GatewayDetection {
  const found = new Set<string>();
  const evidence: Record<string, string[]> = {};
  const scripts = extractScriptSrcs(html);

  // Detect in-cart URLs surfaced anywhere in the HTML (links, redirects, JSON).
  const hasCheckoutUrl = CHECKOUT_URL_PATTERNS.some(p => p.test(html));
  // Page-level "we accept X" / "pay with Y" cue — confirms weak mentions.
  const paymentContext = PAYMENT_CONTEXT_PATTERNS.some(p => p.test(html));

  const addEvidence = (name: string, kind: string) => {
    if (!evidence[name]) evidence[name] = [];
    if (!evidence[name].includes(kind)) evidence[name].push(kind);
    found.add(name);
  };

  for (const sig of GATEWAY_SIGNATURES) {
    // Strong signals always count
    if (sig.strong.some(p => p.test(html))) {
      addEvidence(sig.name, 'strong');
    }
    // Script-src signals are extra-strong evidence — note them separately
    if (sig.strong.some(p => scripts.some(s => p.test(s)))) {
      addEvidence(sig.name, 'script-src');
    }
    // Weak signals only count when confirmed by a checkout URL OR a
    // payment-context phrase ("pay with", "we accept", "powered by"...).
    if (sig.weak && sig.weak.some(p => p.test(html))) {
      if (hasCheckoutUrl) addEvidence(sig.name, 'weak+checkout');
      else if (paymentContext) addEvidence(sig.name, 'weak+context');
    }
  }

  return {
    hasGateway: found.size > 0,
    gateways: Array.from(found),
    evidence,
    hasCheckoutUrl,
  };
}
