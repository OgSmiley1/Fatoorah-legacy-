import { search, SafeSearchType } from 'duck-duck-scrape';
import { insertMerchant, insertEvidence, insertSearchRun, updateSearchRun, MerchantRow } from './database.js';
import { deduplicateBatch, normalizeBusinessName, normalizeUrl, normalizePhone, normalizeEmail, normalizeDomain, normalizeHandle, generateMerchantHash } from './dedupService.js';
import { logger } from './logger.js';

// ─── Types ───

export interface SearchParams {
  keywords: string;
  location: string;
  categories?: string[];
  subCategories?: string[];
  businessAge?: string;
  riskLevel?: string;
  minFollowers?: number;
  platforms?: {
    instagram?: boolean;
    facebook?: boolean;
    telegram?: boolean;
    tiktok?: boolean;
    website?: boolean;
  };
  maxResults?: number;
}

export interface SearchResult {
  searchRunId: string;
  merchants: MerchantRow[];
  totalCandidates: number;
  duplicatesRemoved: number;
  dedupReasons: Record<string, number>;
  errors: string[];
}

// ─── DuckDuckGo search + rule-based extraction ───

interface DDGResult {
  title: string;
  description: string;
  url: string;
}

function extractMerchantFromResult(result: DDGResult, params: SearchParams): any {
  const url = result.url.toLowerCase();

  // Platform detection
  let platform = 'Website';
  if (url.includes('instagram.com')) platform = 'Instagram';
  else if (url.includes('tiktok.com')) platform = 'TikTok';
  else if (url.includes('facebook.com') || url.includes('fb.com')) platform = 'Facebook';
  else if (url.includes('t.me') || url.includes('telegram')) platform = 'Telegram';
  else if (url.includes('maps.google') || url.includes('goo.gl/maps')) platform = 'Google Maps';

  // Skip non-merchant pages
  const skipDomains = ['wikipedia.org', 'youtube.com', 'twitter.com', 'x.com', 'linkedin.com', 'reddit.com', 'pinterest.com', 'news.', 'blog.', 'medium.com'];
  if (skipDomains.some(d => url.includes(d))) return null;

  // Business name: clean up title
  let businessName = result.title
    .replace(/\s*[-|·–—].*$/, '')
    .replace(/\(@[^)]+\)/g, '')
    .replace(/on Instagram:?.*$/i, '')
    .replace(/\| Facebook$/i, '')
    .replace(/- Home$/i, '')
    .replace(/\.\.\.$/, '')
    .trim();

  if (!businessName || businessName.length < 2) return null;

  // Instagram handle from URL
  const instaMatch = result.url.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/);
  const instagramHandle = instaMatch && !['p', 'explore', 'reels', 'stories', 'accounts', 'directory', 'about', 'developer'].includes(instaMatch[1])
    ? instaMatch[1] : null;

  // TikTok handle from URL
  const tiktokMatch = result.url.match(/tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/);
  const tiktokHandle = tiktokMatch ? tiktokMatch[1] : null;

  // Telegram handle
  const telegramMatch = result.url.match(/t\.me\/([a-zA-Z0-9_]{2,30})/);
  const telegramHandle = telegramMatch ? telegramMatch[1] : null;

  const snippet = result.description || '';

  // Phone number from snippet (GCC formats)
  const phonePatterns = [
    /(\+?971[\s-]?\d[\s-]?\d{3}[\s-]?\d{4})/,       // UAE
    /(\+?966[\s-]?\d[\s-]?\d{3}[\s-]?\d{4})/,         // Saudi
    /(\+?968[\s-]?\d{4}[\s-]?\d{4})/,                  // Oman
    /(\+?965[\s-]?\d{4}[\s-]?\d{4})/,                  // Kuwait
    /(\+?973[\s-]?\d{4}[\s-]?\d{4})/,                  // Bahrain
    /(\+?974[\s-]?\d{4}[\s-]?\d{4})/,                  // Qatar
    /(0\d{1,2}[\s-]?\d{7,8})/,                          // Local
  ];
  let phone: string | null = null;
  for (const p of phonePatterns) {
    const match = snippet.match(p) || result.title.match(p);
    if (match) { phone = match[1]; break; }
  }

  // Email from snippet
  const emailMatch = snippet.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  // Followers from snippet
  const followersMatch = snippet.match(/([\d,.]+)\s*[KkMm]?\s*(?:followers|Followers|متابع|Abonnés)/i);
  let followers = 0;
  if (followersMatch) {
    let numStr = followersMatch[0].replace(/,/g, '');
    const numMatch = numStr.match(/([\d.]+)\s*([KkMm]?)/);
    if (numMatch) {
      let num = parseFloat(numMatch[1]);
      const suffix = numMatch[2].toUpperCase();
      if (suffix === 'K') num *= 1000;
      else if (suffix === 'M') num *= 1000000;
      followers = Math.round(num);
    }
  }

  // Website extraction — if platform is social, website is null; if website, url IS the website
  const website = platform === 'Website' ? result.url : null;

  // Google Maps place ID
  const mapsMatch = result.url.match(/place_id[=:]([A-Za-z0-9_-]+)/) || result.url.match(/cid[=:](\d+)/);
  const mapsPlaceId = mapsMatch ? mapsMatch[1] : null;

  // Category from search keywords
  const category = params.categories?.[0] || params.keywords.split(',')[0]?.trim() || '';

  return {
    businessName,
    platform,
    url: result.url,
    instagramHandle,
    tiktokHandle,
    telegramHandle,
    category,
    subCategory: params.subCategories?.[0] || null,
    followers,
    bio: snippet.slice(0, 200),
    email,
    phone,
    whatsapp: phone, // Assume same as phone in GCC
    website,
    location: params.location,
    lastActive: 'Recent',
    isCOD: false,
    paymentMethods: [] as string[],
    contactValidation: {
      status: phone || email ? 'UNVERIFIED' : 'DISCREPANCY',
      sources: ['DuckDuckGo Search']
    },
    mapsPlaceId,
  };
}

async function ddgSearch(query: string): Promise<DDGResult[]> {
  try {
    const results = await search(query, { safeSearch: SafeSearchType.OFF });
    if (!results.results) return [];
    return results.results.map((r: any) => ({
      title: r.title || '',
      description: r.description || '',
      url: r.url || r.link || '',
    })).filter((r: DDGResult) => r.url && r.title);
  } catch (err: any) {
    logger.error('ddg.search.failed', { query, error: err.message });
    return [];
  }
}

// ─── Scoring ───

function computeContactScore(m: any): {
  score: number;
  bestRoute: string;
  phoneConf: string;
  whatsappConf: string;
  emailConf: string;
  websiteConf: string;
  socialConf: string;
} {
  let score = 0;
  let bestRoute = 'none';
  let bestScore = 0;

  // Phone
  let phoneConf = 'MISSING';
  if (m.phone) {
    const sources = m.contactValidation?.sources || [];
    if (sources.length >= 2) { phoneConf = 'VERIFIED'; score += 30; }
    else if (sources.length === 1) { phoneConf = 'LIKELY'; score += 20; }
    else { phoneConf = 'WEAK'; score += 5; }
    if (score > bestScore) { bestRoute = 'phone'; bestScore = score; }
  }

  // WhatsApp
  let whatsappConf = 'MISSING';
  if (m.whatsapp) {
    whatsappConf = m.phone === m.whatsapp ? phoneConf : 'LIKELY';
    const pts = whatsappConf === 'VERIFIED' ? 25 : whatsappConf === 'LIKELY' ? 15 : 5;
    score += pts;
    if (pts > bestScore) { bestRoute = 'whatsapp'; bestScore = pts; }
  }

  // Email
  let emailConf = 'MISSING';
  if (m.email) {
    const email = m.email.toLowerCase();
    if (email.includes('@gmail') || email.includes('@yahoo') || email.includes('@hotmail')) {
      emailConf = 'GENERIC'; score += 5;
    } else {
      emailConf = 'BUSINESS_EMAIL'; score += 20;
      if (20 > bestScore) { bestRoute = 'email'; bestScore = 20; }
    }
  }

  // Website
  let websiteConf = 'MISSING';
  if (m.website) {
    const url = (m.website || '').toLowerCase();
    if (url.includes('shopify') || url.includes('woocommerce') || url.includes('shop') || url.includes('store')) {
      websiteConf = 'LIVE_STORE'; score += 15;
    } else if (url.includes('.com') || url.includes('.ae') || url.includes('.sa')) {
      websiteConf = 'BUSINESS_SITE'; score += 10;
    } else {
      websiteConf = 'LANDING_PAGE'; score += 5;
    }
  } else if (m.url && !m.website) {
    websiteConf = 'SOCIAL_ONLY'; score += 2;
  }

  // Social
  let socialConf = 'MISSING';
  if (m.instagramHandle || m.tiktokHandle || m.instagramhandle || m.tiktokhandle) {
    const followers = m.followers || 0;
    if (followers > 1000) { socialConf = 'ACTIVE'; score += 10; }
    else if (followers > 0) { socialConf = 'PRESENT'; score += 5; }
    else { socialConf = 'STALE'; score += 1; }
  }

  return {
    score: Math.min(score, 100),
    bestRoute,
    phoneConf,
    whatsappConf,
    emailConf,
    websiteConf,
    socialConf
  };
}

function computeFitScore(m: any, location: string): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // Active online seller (+20)
  if (m.instagramHandle || m.tiktokHandle || m.website) {
    score += 20;
    reasons.push('active online seller');
  }

  // Payment friction signals (+20)
  const isCOD = m.isCOD || m.is_cod;
  const methods = m.paymentMethods || [];
  const hasModernPayment = methods.some((p: string) =>
    p.toLowerCase().includes('stripe') || p.toLowerCase().includes('paypal') ||
    p.toLowerCase().includes('checkout') || p.toLowerCase().includes('tap')
  );
  if (isCOD || methods.length === 0 || (!hasModernPayment && methods.length <= 2)) {
    score += 20;
    reasons.push(isCOD ? 'COD-dependent' : 'limited payment options');
  }

  // Reachable contact (+15)
  if (m.phone || m.whatsapp || m.email) {
    score += 15;
    reasons.push('reachable contact');
  }

  // Location fit (+15)
  const loc = (location || m.location || '').toLowerCase();
  const uaeCities = ['dubai', 'abu dhabi', 'sharjah', 'ajman', 'ras al', 'fujairah', 'umm al', 'uae'];
  const gccCountries = ['saudi', 'riyadh', 'jeddah', 'kuwait', 'bahrain', 'manama', 'qatar', 'doha', 'oman', 'muscat'];
  if (uaeCities.some(c => loc.includes(c))) {
    score += 15;
    reasons.push('UAE location');
  } else if (gccCountries.some(c => loc.includes(c))) {
    score += 10;
    reasons.push('GCC location');
  }

  // Social activity (+10)
  const followers = m.followers || 0;
  if (followers > 500) {
    score += 10;
    reasons.push(`${followers.toLocaleString()} followers`);
  }

  // No existing strong payment (+10)
  if (!hasModernPayment) {
    score += 10;
    reasons.push('no modern payment gateway');
  }

  // Follower sweet spot (+10)
  if (followers >= 1000 && followers <= 100000) {
    score += 10;
    reasons.push('ideal follower range for payment link need');
  }

  const reason = reasons.length > 0
    ? reasons.slice(0, 3).join(', ') + ' — strong MyFatoorah candidate'
    : 'Needs further evaluation';

  return { score: Math.min(score, 100), reason };
}

function computeRisk(m: any): { score: number; category: string; factors: string[] } {
  const followers = m.followers || 0;
  let score = 30;
  const factors: string[] = [];
  let category = 'HIGH';

  if (followers > 10000) {
    category = 'LOW'; score = 90;
    factors.push('High follower count indicates established presence');
  } else if (followers > 1000) {
    category = 'MEDIUM'; score = 65;
    factors.push('Moderate follower count');
  } else {
    factors.push('Low follower count increases risk profile');
  }
  if (m.website) { score += 10; factors.push('Website present'); }
  if (m.phone || m.email) { score += 5; factors.push('Contact info available'); }

  return { score: Math.min(score, 100), category, factors };
}

function computeLeakage(m: any): { loss: number; missing: string[] } {
  const followers = m.followers || 0;
  const volume = followers * 0.5;
  const methods = (m.paymentMethods || []).map((p: string) => p.toLowerCase());
  const missing: string[] = [];

  if (!methods.some((p: string) => p.includes('tabby') || p.includes('tamara'))) missing.push('BNPL (Tabby/Tamara)');
  if (!methods.some((p: string) => p.includes('apple') || p.includes('google'))) missing.push('Digital Wallets');
  if (!methods.some((p: string) => p.includes('card') || p.includes('visa'))) missing.push('Credit Cards');

  const bnplLoss = missing.includes('BNPL (Tabby/Tamara)') ? volume * 0.49 * 0.15 : 0;
  const walletLoss = missing.includes('Digital Wallets') ? volume * 0.30 * 0.10 : 0;

  return { loss: Math.round(bnplLoss + walletLoss), missing };
}

function generateScripts(m: any): { arabic: string; english: string; whatsapp: string; instagram: string } {
  const name = m.businessName || m.business_name || 'there';
  const platform = m.platform || 'social media';
  return {
    arabic: `مرحبا ${name}! 👋\n\nشفت حساب ${name} على ${platform} - المنتجات رائعة! 💫\n\nسؤال سريع: هل تستخدمون طرق دفع متعددة (تابي + غيرها) ولا طريقة واحدة؟\n\nنحن نساعد متاجر مثلكم تقبل ١٥+ طريقة دفع من تكاملة واحدة.\nمنهم: تابي، أبل باي، مدى، فيزا، MasterCard\n\nهل يناسبك مكالمة ١٠ دقائق هذا الأسبوع؟`,
    english: `Hi ${name}! 👋\n\nLoved ${name} on ${platform} – amazing products! 💫\n\nQuick question: Do you use multiple payment gateways (Tabby + others) or just one?\n\nWe help brands like yours accept 15+ payment methods with 1 integration.\nIncluding: Tabby, Apple Pay, Mada, Visa, MasterCard\n\nWorth a 10-min chat this week?`,
    whatsapp: `Hey ${name}! 🚀 Love your products on ${platform}. Quick question: are you still waiting 7 days for your payouts? MyFatoorah can get you paid DAILY. Want to see a quick comparison?`,
    instagram: `Hi ${name}! 🌟 Your feed is amazing. Noticed you're only accepting COD/Bank Transfer. Did you know 49% of UAE shoppers prefer Tabby/Tamara? We can help you activate it in 24h. Interested?`
  };
}

// ─── Main search function ───

export async function searchMerchants(params: SearchParams): Promise<SearchResult> {
  const searchRunId = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();
  const errors: string[] = [];

  logger.info('search.started', { runId: searchRunId, query: params.keywords, location: params.location });

  insertSearchRun({
    id: searchRunId,
    query: params.keywords,
    location: params.location,
    categories: JSON.stringify(params.categories || []),
    platforms: JSON.stringify(params.platforms || {}),
    filters: JSON.stringify({ businessAge: params.businessAge, riskLevel: params.riskLevel, minFollowers: params.minFollowers }),
  });

  const maxResults = params.maxResults || 30;

  // Build search queries for 3 strategies (DuckDuckGo — free, no API key)
  const keywords = params.keywords;
  const location = params.location;

  const strategies = [
    {
      name: 'Social & Web',
      queries: [
        `${keywords} ${location} site:instagram.com`,
        `${keywords} ${location} site:tiktok.com`,
        `${keywords} ${location} online shop store`,
      ]
    },
    {
      name: 'Directories',
      queries: [
        `${keywords} ${location} business directory contact phone`,
        `${keywords} ${location} yellow pages listing`,
      ]
    },
    {
      name: 'Niche & Industry',
      queries: [
        `${keywords} ${location} shop buy delivery ecommerce`,
        `${keywords} ${location} small business seller`,
      ]
    }
  ];

  // Execute all strategy queries in parallel
  const allSearchPromises = strategies.map(async (strategy) => {
    const strategyResults: DDGResult[] = [];
    try {
      const queryPromises = strategy.queries.map(q => ddgSearch(q));
      const queryResults = await Promise.allSettled(queryPromises);

      for (const qr of queryResults) {
        if (qr.status === 'fulfilled') {
          strategyResults.push(...qr.value);
        }
      }

      logger.info('search.strategy.completed', {
        runId: searchRunId,
        strategy: strategy.name,
        candidates: strategyResults.length
      });
    } catch (err: any) {
      const errMsg = `Strategy "${strategy.name}" failed: ${err.message || err}`;
      logger.error('search.strategy.failed', { runId: searchRunId, strategy: strategy.name, error: errMsg });
      errors.push(errMsg);
    }
    return { name: strategy.name, results: strategyResults };
  });

  const strategyResults = await Promise.allSettled(allSearchPromises);

  // Parse and extract merchants from DDG results
  let rawMerchants: any[] = [];
  const seenUrls = new Set<string>();

  for (const sr of strategyResults) {
    if (sr.status === 'fulfilled') {
      for (const ddgResult of sr.value.results) {
        // Skip duplicate URLs
        const normalizedUrl = ddgResult.url.toLowerCase().replace(/\/$/, '');
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        const merchant = extractMerchantFromResult(ddgResult, params);
        if (merchant) {
          rawMerchants.push(merchant);
        }
      }
    } else {
      errors.push(`Strategy search rejected: ${sr.reason}`);
    }
  }

  // Limit to maxResults
  rawMerchants = rawMerchants.slice(0, maxResults);

  const totalCandidates = rawMerchants.length;
  logger.info('search.candidates.received', { runId: searchRunId, total: totalCandidates });

  if (totalCandidates === 0) {
    updateSearchRun(searchRunId, {
      total_candidates: 0, duplicates_removed: 0, new_merchants_saved: 0,
      status: errors.length > 0 ? 'failed' : 'completed',
      error_detail: errors.join('; ')
    });
    return { searchRunId, merchants: [], totalCandidates: 0, duplicatesRemoved: 0, dedupReasons: {}, errors };
  }

  // Deduplicate
  const { unique, duplicates, reasons } = deduplicateBatch(rawMerchants, searchRunId);

  // Enrich and save
  const savedMerchants: MerchantRow[] = [];
  const now = new Date().toISOString();

  for (const m of unique) {
    const norm = m._normalized || {};
    const risk = computeRisk(m);
    const contact = computeContactScore(m);
    const fit = computeFitScore(m, params.location);
    const leakage = computeLeakage(m);
    const scripts = generateScripts(m);

    const riskCategory = risk.category;
    const pricing = {
      setupFee: riskCategory === 'LOW' ? 1500 : riskCategory === 'MEDIUM' ? 3500 : 5500,
      rate: riskCategory === 'LOW' ? '2.49%' : riskCategory === 'MEDIUM' ? '2.75%' : '3.00%',
      settlement: riskCategory === 'LOW' ? 'T+1' : riskCategory === 'MEDIUM' ? 'T+3' : 'T+7'
    };

    const followers = m.followers || 0;
    const monthlyRevenue = followers * 0.5;

    const merchantRow: MerchantRow = {
      id: norm.hash || generateMerchantHash(m),
      business_name: m.businessName,
      normalized_name: norm.name || normalizeBusinessName(m.businessName),
      platform: m.platform || '',
      url: m.url || '',
      normalized_url: norm.url || normalizeUrl(m.url || ''),
      maps_place_id: m.mapsPlaceId || null,
      instagram_handle: m.instagramHandle || '',
      normalized_instagram: norm.instagram || normalizeHandle(m.instagramHandle || ''),
      tiktok_handle: m.tiktokHandle || '',
      normalized_tiktok: norm.tiktok || normalizeHandle(m.tiktokHandle || ''),
      telegram_handle: m.telegramHandle || '',
      category: m.category || '',
      sub_category: m.subCategory || '',
      followers,
      bio: m.bio || '',
      email: m.email || '',
      normalized_email: norm.email || normalizeEmail(m.email || ''),
      phone: m.phone || '',
      normalized_phone: norm.phone || normalizePhone(m.phone || ''),
      whatsapp: m.whatsapp || '',
      normalized_whatsapp: normalizePhone(m.whatsapp || ''),
      website: m.website || '',
      normalized_domain: norm.domain || normalizeDomain(m.website || m.url || ''),
      location: m.location || params.location,
      country: extractCountry(m.location || params.location),
      city: extractCity(m.location || params.location),
      last_active: m.lastActive || '',
      is_cod: m.isCOD ? 1 : 0,
      payment_methods: JSON.stringify(m.paymentMethods || []),
      other_profiles: JSON.stringify(m.otherProfiles || []),
      registration_info: m.registrationInfo || '',
      trade_license: m.tradeLicense || '',
      risk_score: risk.score,
      risk_category: risk.category,
      risk_factors: JSON.stringify(risk.factors),
      contact_score: contact.score,
      contact_best_route: contact.bestRoute,
      phone_confidence: contact.phoneConf,
      whatsapp_confidence: contact.whatsappConf,
      email_confidence: contact.emailConf,
      website_confidence: contact.websiteConf,
      social_confidence: contact.socialConf,
      fit_score: fit.score,
      fit_reason: fit.reason,
      revenue_monthly: monthlyRevenue,
      revenue_annual: monthlyRevenue * 12,
      setup_fee: pricing.setupFee,
      transaction_rate: pricing.rate,
      settlement_cycle: pricing.settlement,
      leakage_monthly_loss: leakage.loss,
      leakage_missing_methods: JSON.stringify(leakage.missing),
      status: 'NEW',
      discovery_run_id: searchRunId,
      search_session_id: now.split('T')[0],
      first_found_date: now,
      last_validated_date: now,
      scripts_arabic: scripts.arabic,
      scripts_english: scripts.english,
      scripts_whatsapp: scripts.whatsapp,
      scripts_instagram: scripts.instagram,
    };

    const inserted = insertMerchant(merchantRow);
    if (inserted) {
      savedMerchants.push(merchantRow);

      // Save evidence
      const evidence = m.contactValidation?.sources || [];
      if (m.url) {
        insertEvidence(merchantRow.id, 'web_search', m.businessName, m.url);
      }
      if (m.mapsPlaceId) {
        insertEvidence(merchantRow.id, 'google_maps', m.businessName, `https://maps.google.com/?cid=${m.mapsPlaceId}`);
      }
      for (const source of evidence) {
        if (typeof source === 'string') {
          insertEvidence(merchantRow.id, 'other', source, '');
        }
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info('search.completed', {
    runId: searchRunId,
    totalCandidates,
    duplicatesRemoved: duplicates,
    newMerchantsSaved: savedMerchants.length,
    duration: `${duration}s`,
    errors: errors.length
  });

  updateSearchRun(searchRunId, {
    total_candidates: totalCandidates,
    duplicates_removed: duplicates,
    new_merchants_saved: savedMerchants.length,
    status: errors.length > 0 && savedMerchants.length === 0 ? 'failed' : 'completed',
    error_detail: errors.join('; ')
  });

  return {
    searchRunId,
    merchants: savedMerchants,
    totalCandidates,
    duplicatesRemoved: duplicates,
    dedupReasons: reasons,
    errors
  };
}

// ─── Helpers ───

function extractCountry(location: string): string {
  const loc = location.toLowerCase();
  if (loc.includes('uae') || loc.includes('emirates') || loc.includes('dubai') || loc.includes('abu dhabi') || loc.includes('sharjah') || loc.includes('ajman')) return 'UAE';
  if (loc.includes('saudi') || loc.includes('riyadh') || loc.includes('jeddah')) return 'Saudi Arabia';
  if (loc.includes('kuwait')) return 'Kuwait';
  if (loc.includes('bahrain') || loc.includes('manama')) return 'Bahrain';
  if (loc.includes('qatar') || loc.includes('doha')) return 'Qatar';
  if (loc.includes('oman') || loc.includes('muscat')) return 'Oman';
  return 'GCC';
}

function extractCity(location: string): string {
  const loc = location.toLowerCase();
  const cities = ['dubai', 'abu dhabi', 'sharjah', 'ajman', 'riyadh', 'jeddah', 'kuwait city', 'manama', 'doha', 'muscat'];
  for (const city of cities) {
    if (loc.includes(city)) return city.charAt(0).toUpperCase() + city.slice(1);
  }
  return location.split(',')[0]?.trim() || location;
}
