import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { search as ddgLibSearch } from 'duck-duck-scrape';
import db from '../db';
import { checkDuplicate, normalizeName } from './dedupService';
import { computeFitScore, computeContactScore, computeConfidence } from './scoringService';
import { logger } from './logger';
import { scrapeInvestInDubai } from './investInDubaiService';
import {
  type SearchResult,
  decodeHtml,
  stripTags,
  parseDdgHtml,
  parseBingHtml,
  detectCod,
  detectGateways,
  extractContacts,
  PHONE_RE,
  EMAIL_RE,
} from './searchParsers';
import { extractJsonLd, extractMeta } from './actors/jsonLdExtractor';
import { searchNominatim } from './actors/nominatimActor';
import { parseInstagramHtml, parseInstagramWebProfileJson } from './actors/instagramActor';
import { braveSearch } from './actors/braveSearch';
import { startpageSearch } from './actors/startpageSearch';
import { mojeekSearch } from './actors/mojeekSearch';
import { searxSearch } from './actors/searxMetaSearch';
import { verifyEmail } from './actors/emailVerifier';
import { verifyWhatsApp } from './actors/whatsappVerifier';
import {
  buildConsensus,
  identityKey,
  type RawLead,
  type SourceLabel,
  type ConsensusLead,
} from './verificationService';

// Re-export pure helpers so existing callers & tests keep working
export {
  decodeHtml,
  stripTags,
  parseDdgHtml,
  parseBingHtml,
  detectCod,
  detectGateways,
  extractContacts,
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- HTTP helper with tight timeout ---
async function safeFetch(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      maxRedirects: 3,
      validateStatus: s => s >= 200 && s < 400,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return typeof res.data === 'string' ? res.data : null;
  } catch {
    return null;
  }
}

// --- DuckDuckGo HTML endpoint (stable, no JS) ---
async function ddgHtmlSearch(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await safeFetch(url, 8000);
  return html ? parseDdgHtml(html) : [];
}

// --- Bing HTML fallback ---
async function bingHtmlSearch(query: string): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`;
  const html = await safeFetch(url, 8000);
  return html ? parseBingHtml(html) : [];
}

// --- DDG library fallback (uses their JSON endpoint — different code path than HTML) ---
async function ddgLibrarySearch(query: string): Promise<SearchResult[]> {
  try {
    const res: any = await Promise.race([
      ddgLibSearch(query, { safeSearch: 0 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ddg_lib_timeout')), 9000)),
    ]);
    const items = (res?.results || []) as any[];
    return items.slice(0, 20).map(r => ({
      url: r.url,
      title: (r.title || '').trim(),
      description: (r.description || '').trim(),
    })).filter(r => r.url && r.url.startsWith('http'));
  } catch {
    return [];
  }
}

// Each SearchResult is tagged with the set of engines that returned it.
// When the same URL surfaces on >=2 engines that is itself a verification signal.
export interface TaggedResult extends SearchResult {
  sources: SourceLabel[];
}

// Primary search: run 7 keyless engines in parallel, merge by URL, tag with sources.
async function webSearch(query: string): Promise<TaggedResult[]> {
  const engines: { label: SourceLabel; fn: () => Promise<SearchResult[]> }[] = [
    { label: 'ddg',       fn: () => ddgHtmlSearch(query) },
    { label: 'bing',      fn: () => bingHtmlSearch(query) },
    { label: 'ddg-lib',   fn: () => ddgLibrarySearch(query) },
    { label: 'brave',     fn: () => braveSearch(query) },
    { label: 'startpage', fn: () => startpageSearch(query) },
    { label: 'mojeek',    fn: () => mojeekSearch(query) },
    { label: 'searx',     fn: () => searxSearch(query) },
  ];

  const settled = await Promise.allSettled(engines.map(e => e.fn()));

  const byUrl = new Map<string, TaggedResult>();
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled') return;
    for (const r of s.value) {
      if (!r.url || !r.url.startsWith('http')) continue;
      const existing = byUrl.get(r.url);
      if (existing) {
        if (!existing.sources.includes(engines[i].label)) {
          existing.sources.push(engines[i].label);
        }
      } else {
        byUrl.set(r.url, { ...r, sources: [engines[i].label] });
      }
    }
  });

  const perEngine: Record<string, number> = {};
  engines.forEach((e, i) => {
    perEngine[e.label] = settled[i].status === 'fulfilled'
      ? (settled[i] as PromiseFulfilledResult<SearchResult[]>).value.length
      : 0;
  });
  logger.debug('multi_engine_search_done', {
    query,
    perEngine,
    unique: byUrl.size,
  });
  return Array.from(byUrl.values());
}

// Fetch root + /contact in parallel — tight timeout
async function enrichFromWebsite(websiteUrl: string): Promise<any> {
  if (!websiteUrl) return {};
  let base = websiteUrl;
  if (!base.startsWith('http')) base = 'https://' + base;

  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return {};
  }

  const candidates = [base, `${origin}/contact`, `${origin}/contact-us`];
  const pages = await Promise.allSettled(
    candidates.map(u => safeFetch(u, 5000))
  );

  const merged: any = {};
  const gatewaysFound = new Set<string>();
  let isCod = false;
  const codEvidence: string[] = [];
  // Apify-style: layer structured-data extraction on top of regex scrape
  let structured: any = null;
  let meta: any = null;

  for (const p of pages) {
    if (p.status !== 'fulfilled' || !p.value) continue;
    const html = p.value;

    const c = extractContacts(html);
    for (const k of Object.keys(c)) {
      if (!merged[k] && c[k]) merged[k] = c[k];
    }

    const cod = detectCod(html);
    if (cod.isCod) {
      isCod = true;
      for (const e of cod.evidence) if (!codEvidence.includes(e)) codEvidence.push(e);
    }

    const gw = detectGateways(html);
    for (const g of gw.gateways) gatewaysFound.add(g);

    // JSON-LD / schema.org gives canonical name, telephone, address, sameAs (socials)
    if (!structured) {
      const s = extractJsonLd(html);
      if (s) structured = s;
    }
    if (!meta) meta = extractMeta(html);
  }

  merged.isCod = isCod;
  merged.codEvidence = codEvidence;
  merged.paymentGateways = Array.from(gatewaysFound);
  merged.hasGateway = gatewaysFound.size > 0;
  merged.structured = structured;
  merged.meta = meta;
  return merged;
}

// Fetch Instagram profile data. Tries the public web_profile_info JSON endpoint
// first (gives accurate follower counts), then falls back to og:description HTML.
async function enrichFromInstagram(handle: string): Promise<any> {
  if (!handle) return null;
  const clean = handle.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[a-zA-Z0-9._]+$/.test(clean)) return null;

  // Path 1: web_profile_info — the same endpoint instagram.com uses for profile cards.
  try {
    const res = await axios.get(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(clean)}`,
      {
        timeout: 6000,
        headers: {
          'User-Agent': 'Instagram 219.0.0.12.117 Android',
          'X-IG-App-ID': '936619743392459',
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      }
    );
    const profile = parseInstagramWebProfileJson(clean, res.data);
    if (profile && profile.followers !== undefined) return profile;
  } catch (e: any) {
    logger.debug('ig_web_profile_failed', { handle: clean, error: e?.message });
  }

  // Path 2: HTML og:description fallback.
  const html = await safeFetch(`https://www.instagram.com/${clean}/?hl=en`, 6000);
  if (!html) return null;
  return parseInstagramHtml(clean, html);
}

// Exported for discovery.ts — kept backward compatible
export async function enrichMerchantContacts(m: any) {
  const websiteUrl = m.website || (m.platform === 'website' ? m.url : null);
  const sources: string[] = [];

  if (websiteUrl) {
    try {
      const webContacts = await enrichFromWebsite(websiteUrl);
      m.phone = m.phone || webContacts.phone || null;
      m.email = m.email || webContacts.email || null;
      m.whatsapp = m.whatsapp || webContacts.whatsapp || null;
      m.instagramHandle = m.instagramHandle || webContacts.instagram || null;
      m.facebookUrl = m.facebookUrl || webContacts.facebook || null;
      m.tiktokHandle = m.tiktokHandle || webContacts.tiktok || null;

      // COD + gateway intelligence — the core Apify-grade qualification
      m.isCOD = Boolean(webContacts.isCod);
      m.codEvidence = webContacts.codEvidence || [];
      m.paymentMethods = webContacts.paymentGateways || [];
      m.hasGateway = Boolean(webContacts.hasGateway);

      // Layer JSON-LD structured data — highest-fidelity signal when present
      const s = webContacts.structured;
      if (s) {
        if (!m.phone && s.telephone) m.phone = s.telephone;
        if (!m.email && s.email) m.email = s.email;
        if (s.name && (!m.businessName || m.businessName.length < s.name.length)) {
          m.businessName = s.name;
        }
        const addrParts = [s.address, s.addressLocality, s.addressRegion, s.addressCountry]
          .filter(Boolean)
          .join(', ');
        if (addrParts && !m.physicalAddress) m.physicalAddress = addrParts;
        m.structuredData = s;
        // sameAs links → fill in missing socials
        for (const link of s.sameAs || []) {
          if (!m.instagramHandle && /instagram\.com\//i.test(link)) {
            const h = link.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
            if (h) m.instagramHandle = h[1];
          }
          if (!m.facebookUrl && /facebook\.com\//i.test(link)) m.facebookUrl = link;
          if (!m.tiktokHandle && /tiktok\.com\/@/i.test(link)) {
            const h = link.match(/tiktok\.com\/@([a-zA-Z0-9._]+)/i);
            if (h) m.tiktokHandle = h[1];
          }
        }
        sources.push('JSON-LD');
      }
      if (webContacts.meta) m.metaSignals = webContacts.meta;

      if (webContacts.phone || webContacts.email || s) sources.push('Website Scraping');
    } catch (e: any) {
      logger.debug('website_enrichment_failed', { url: websiteUrl, error: e.message });
    }
  }

  // Instagram profile enrichment — pulls bio, followers, external URL
  if (m.instagramHandle) {
    try {
      const ig = await enrichFromInstagram(m.instagramHandle);
      if (ig) {
        m.instagramProfile = ig;
        if (ig.followers && !m.followers) m.followers = ig.followers;
        if (ig.bio && !m.bio) m.bio = ig.bio;
        if (ig.externalUrl && !m.website) m.website = ig.externalUrl;
        if (ig.category && !m.category) m.category = ig.category;
        // bio commonly contains phone / email not present elsewhere
        if (ig.bio) {
          if (!m.phone) {
            const ph = ig.bio.match(PHONE_RE);
            if (ph) m.phone = ph[0].replace(/[\s\-]/g, '');
          }
          if (!m.email) {
            const em = ig.bio.match(EMAIL_RE);
            if (em) m.email = em[0];
          }
        }
        sources.push('Instagram Profile');
      }
    } catch (e: any) {
      logger.debug('instagram_enrichment_failed', { handle: m.instagramHandle, error: e.message });
    }
  }

  if (m.phone || m.email) {
    m.contactValidation = {
      status: 'VERIFIED',
      sources: sources.length ? sources : ['Scraper'],
    };
  }
  return m;
}

// Run an async task list with bounded concurrency
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e: any) {
        out[i] = undefined as any;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// Run a promise with a hard timeout
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

interface SearchParams {
  keywords: string;
  location: string;
  maxResults?: number;
  // Sales-pipeline mode: drop merchants that already have a payment gateway
  // (Stripe/Tap/PayTabs/Checkout/etc.) since those aren't MyFatoorah prospects.
  // Default true — this is a MyFatoorah lead hunter.
  onlyQualified?: boolean;
}

export async function huntMerchants(
  params: SearchParams,
  onProgress?: (count: number, stage?: string) => void
) {
  const { keywords, location, maxResults = 25 } = params;
  const runId = uuidv4();
  const HARD_DEADLINE_MS = 90_000;

  logger.info('hunt_started', { runId, keywords, location, maxResults });
  onProgress?.(0, 'searching');

  try {
    return await withTimeout(
      runHunt(params, runId, onProgress),
      HARD_DEADLINE_MS,
      'hunt'
    );
  } catch (error: any) {
    logger.error('hunt_failed', { runId, error: error.message });
    try {
      db.prepare(
        `INSERT INTO search_runs (id, query, source, status, error_message) VALUES (?, ?, ?, ?, ?)`
      ).run(runId, `${keywords} ${location}`, 'scraper', 'FAILED', error.message);
    } catch {}
    // Surface a graceful empty result rather than a 500 — the UI can show "no results"
    return { runId, merchants: [], newLeadsCount: 0, error: error.message };
  }
}

async function runHunt(
  params: SearchParams,
  runId: string,
  onProgress?: (count: number, stage?: string) => void
) {
  const { location, maxResults = 25, onlyQualified = true } = params;
  // Use provided keywords or fall back to broad UAE merchant terms so Hunt works with empty input
  const kw = (params.keywords || '').trim() || 'boutique shop store brand';

  const isUAE = /dubai|uae|emirates|abu\s*dhabi|sharjah|ajman|fujairah|khaimah/i.test(
    location
  );

  // Queries target merchants who sell via COD/WhatsApp/Instagram DM — prime MyFatoorah candidates.
  const queries: string[] = [
    `${kw} ${location} "cash on delivery" OR "pay on delivery" whatsapp`,
    `${kw} ${location} site:instagram.com "dm to order" OR "whatsapp to order"`,
    `${kw} ${location} "order on whatsapp" OR "bank transfer" buy online`,
    `${kw} ${location} instagram shop small business cod contact`,
    `${kw} ${location} "apple pay" OR "google pay" NOT available boutique`,
  ];

  // Run all searches in parallel across 7 engines (see webSearch)
  const searchStart = Date.now();
  const searchResults = await Promise.allSettled(queries.map((q) => webSearch(q)));

  // Global URL → sources map: if same URL hits from multiple engines, that is a vote
  const urlVotes = new Map<string, TaggedResult>();
  for (const r of searchResults) {
    if (r.status !== 'fulfilled') continue;
    for (const tr of r.value) {
      if (!tr.url) continue;
      const existing = urlVotes.get(tr.url);
      if (existing) {
        for (const s of tr.sources) {
          if (!existing.sources.includes(s)) existing.sources.push(s);
        }
      } else {
        urlVotes.set(tr.url, { ...tr, sources: [...tr.sources] });
      }
    }
  }

  // Run InvestInDubai + HERE Geocoding in parallel — both are UAE-only sources
  if (isUAE) {
    const govSources = await Promise.allSettled([
      withTimeout(scrapeInvestInDubai(kw, 10), 10_000, 'investindubai'),
      withTimeout(
        searchNominatim({ query: `${kw} ${location}`, countryCode: 'ae', limit: 15 }),
        9_000,
        'here-geocoding'
      ),
    ]);

    if (govSources[0].status === 'fulfilled') {
      for (const r of govSources[0].value) {
        const url = `https://investindubai.gov.ae/en/business-directory?search=${encodeURIComponent(
          r.businessName
        )}`;
        const existing = urlVotes.get(url);
        if (existing) {
          if (!existing.sources.includes('invest-in-dubai')) existing.sources.push('invest-in-dubai');
          existing.businessName = existing.businessName || r.businessName;
          existing.dulNumber = existing.dulNumber || r.dulNumber;
          existing.category = existing.category || r.category;
        } else {
          urlVotes.set(url, {
            url,
            title: r.businessName,
            description: `DUL: ${r.dulNumber} | Category: ${r.category}`,
            businessName: r.businessName,
            category: r.category,
            dulNumber: r.dulNumber,
            isInvestInDubai: true,
            sources: ['invest-in-dubai'],
          });
        }
      }
    } else {
      logger.debug('investindubai_skipped', { error: (govSources[0] as any).reason?.message });
    }

    if (govSources[1].status === 'fulfilled') {
      for (const p of govSources[1].value) {
        const url = p.website || `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(p.displayName)}`;
        const existing = urlVotes.get(url);
        if (existing) {
          if (!existing.sources.includes('here-geocoding')) existing.sources.push('here-geocoding');
        } else {
          urlVotes.set(url, {
            url,
            title: p.name,
            description: `${p.category} — ${p.displayName}${p.phone ? ` — ${p.phone}` : ''}`,
            businessName: p.name,
            category: p.category,
            sources: ['here-geocoding'],
          });
        }
      }
    } else {
      logger.debug('here_geocoding_skipped', { error: (govSources[1] as any).reason?.message });
    }
  }

  logger.info('hunt_search_done', {
    runId,
    rawCount: urlVotes.size,
    elapsedMs: Date.now() - searchStart,
  });

  // Build candidate list, drop noise, keep top 3x maxResults so the verifier
  // has plenty to winnow down from.
  const candidates: TaggedResult[] = [];
  for (const r of urlVotes.values()) {
    if (!r.url) continue;
    if (/^(https?:\/\/)?(www\.)?(google|wikipedia|youtube)\./i.test(r.url)) continue;
    candidates.push(r);
  }
  // Prefer URLs with more engine votes first — those are already partially verified
  candidates.sort((a, b) => b.sources.length - a.sources.length);
  candidates.splice(maxResults * 3);

  onProgress?.(0, 'enriching');

  // Build base merchants with their engine-vote sources carried through
  const baseMerchants = candidates.map(result => {
    const title = result.title || '';
    const snippet = result.description || '';
    const businessName =
      result.businessName || title.split(/[\|\-\(]/)[0].trim() || '';

    let platform = 'website';
    if (result.isInvestInDubai) platform = 'invest_in_dubai';
    else if (result.url.includes('instagram.com')) platform = 'instagram';
    else if (result.url.includes('facebook.com')) platform = 'facebook';
    else if (result.url.includes('tiktok.com')) platform = 'tiktok';
    else if (result.url.includes('t.me')) platform = 'telegram';

    let instagramHandle: string | null = null;
    if (platform === 'instagram') {
      const m = result.url.match(/instagram\.com\/([^\/\?]+)/);
      if (m) instagramHandle = m[1];
    }

    const phoneMatch = snippet.match(PHONE_RE);
    const phone = phoneMatch ? phoneMatch[0].replace(/[\s\-]/g, '') : null;

    const emailMatch = snippet.match(EMAIL_RE);
    const email = emailMatch ? emailMatch[0] : null;

    return {
      businessName,
      platform,
      url: result.url,
      website: platform === 'website' ? result.url : null,
      instagramHandle,
      phone,
      whatsapp: phone,
      email,
      category: result.category || kw.split(' ')[0],
      evidence: [snippet].filter(Boolean),
      dulNumber: result.dulNumber || null,
      facebookUrl: null,
      tiktokHandle: null,
      physicalAddress: null,
      verifiedSources: [...result.sources] as SourceLabel[],
    } as any;
  }).filter(m => m.businessName && m.businessName.length >= 2);

  // Enrich in parallel with concurrency 4 — each path adds its own source vote
  let enrichedCount = 0;
  const enriched = await mapLimit(baseMerchants, 4, async (m) => {
    const enrichedM: any = await enrichMerchantContacts(m);
    if (!enrichedM.verifiedSources) enrichedM.verifiedSources = m.verifiedSources || [];

    // Each enrichment path contributes an independent source vote
    if (enrichedM.structuredData) {
      if (!enrichedM.verifiedSources.includes('json-ld')) enrichedM.verifiedSources.push('json-ld');
    }
    if (enrichedM.instagramProfile) {
      if (!enrichedM.verifiedSources.includes('instagram')) enrichedM.verifiedSources.push('instagram');
    }
    if (enrichedM.metaSignals || (enrichedM.structuredData || enrichedM.isCOD || enrichedM.hasGateway)) {
      if (!enrichedM.verifiedSources.includes('website')) enrichedM.verifiedSources.push('website');
    }

    // DNS MX check — keyless email deliverability
    if (enrichedM.email) {
      try {
        const ev = await verifyEmail(enrichedM.email, 4000);
        enrichedM.emailVerification = ev;
        if (ev.status === 'deliverable' && !enrichedM.verifiedSources.includes('dns-mx')) {
          enrichedM.verifiedSources.push('dns-mx');
        }
      } catch {}
    }

    // WhatsApp liveness check — keyless HTTP check against wa.me
    const phoneForWa = enrichedM.whatsapp || enrichedM.phone;
    if (phoneForWa) {
      try {
        const wv = await verifyWhatsApp(phoneForWa, 5000);
        enrichedM.whatsappVerification = wv;
        if (wv.status === 'live' && !enrichedM.verifiedSources.includes('whatsapp-live')) {
          enrichedM.verifiedSources.push('whatsapp-live');
        }
      } catch {}
    }

    // Final cross-source agreement score
    const uniq: SourceLabel[] = Array.from(new Set<SourceLabel>(enrichedM.verifiedSources));
    enrichedM.verifiedSources = uniq;
    enrichedM.agreementScore = uniq.length;
    enrichedM.verifiedStatus =
      uniq.length >= 3 ? 'VERIFIED' : uniq.length === 2 ? 'LIKELY' : 'UNVERIFIED';

    enrichedCount++;
    onProgress?.(enrichedCount, 'enriching');
    return enrichedM;
  });

  // Sort enriched leads: VERIFIED first, then LIKELY, then by agreementScore
  enriched.sort((a: any, b: any) => {
    if (!a || !b) return 0;
    const order: Record<string, number> = { VERIFIED: 0, LIKELY: 1, UNVERIFIED: 2 };
    const sa = order[a.verifiedStatus || 'UNVERIFIED'];
    const sb = order[b.verifiedStatus || 'UNVERIFIED'];
    if (sa !== sb) return sa - sb;
    return (b.agreementScore || 0) - (a.agreementScore || 0);
  });

  // Persist — filter out dupes, cap at maxResults
  const finalMerchants: any[] = [];
  let newLeadsCount = 0;

  for (const m of enriched) {
    if (!m) continue;
    if (finalMerchants.length >= maxResults) break;

    // MyFatoorah lead filter: skip merchants that already have a gateway.
    // These are not onboardable prospects for a payment-gateway sales pitch.
    if (onlyQualified && (m as any).hasGateway) continue;

    const dupCheck = checkDuplicate(m);
    if (dupCheck.isDuplicate) continue;

    const merchantId = uuidv4();
    const fitScore = computeFitScore(m.platform, m.followers || 0);
    const contactScore = computeContactScore(m);
    const confidenceScore = computeConfidence(m);
    const contactValidation = m.contactValidation || {
      status: m.phone || m.email ? 'VERIFIED' : 'UNVERIFIED',
      sources: ['Scraper', m.platform],
    };

    // Apify-grade qualification signals — COD shops with no gateway are prime targets
    const isCod = Boolean((m as any).isCOD);
    const hasGateway = Boolean((m as any).hasGateway);
    const paymentMethods: string[] = (m as any).paymentMethods || [];
    // Fit-score boost: COD-only merchants without a gateway are bullseye for MyFatoorah
    const qualifiedBoost = isCod && !hasGateway ? 20 : (isCod ? 10 : 0);
    const gatewayPenalty = hasGateway ? 15 : 0;
    const adjustedFitScore = Math.max(
      0,
      Math.min(100, fitScore + qualifiedBoost - gatewayPenalty)
    );

    // MyFatoorah-ready prospect: no existing gateway AND has a reachable contact.
    // This is the signal a sales rep acts on.
    const mfReady = !hasGateway && Boolean(m.phone || m.whatsapp || m.email);

    const metadata = {
      risk: {
        score: 20,
        category: 'LOW',
        emoji: '🛡️',
        color: 'emerald',
        factors: ['New discovery'],
      },
      scripts: { arabic: '', english: '', whatsapp: '', instagram: '' },
      revenue: { monthly: 0, annual: 0 },
      pricing: { setupFee: 0, transactionRate: '2.5%', settlementCycle: 'T+1' },
      roi: {
        feeSavings: 0,
        bnplUplift: 0,
        cashFlowGain: 0,
        totalMonthlyGain: 0,
        annualImpact: 0,
      },
      paymentMethods,
      isCOD: isCod,
      hasGateway,
      mfReady,
      codEvidence: (m as any).codEvidence || [],
      // Multi-source verification signals
      verifiedStatus: (m as any).verifiedStatus || 'UNVERIFIED',
      agreementScore: (m as any).agreementScore || 0,
      verifiedSources: (m as any).verifiedSources || [],
      emailVerification: (m as any).emailVerification || null,
      whatsappVerification: (m as any).whatsappVerification || null,
      otherProfiles: [],
      foundDate: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
    };

    try {
      db.prepare(`
        INSERT INTO merchants (
          id, business_name, normalized_name, source_platform, source_url,
          phone, whatsapp, email, instagram_handle, github_url,
          facebook_url, tiktok_handle, physical_address,
          category, dul_number, confidence_score, contactability_score,
          myfatoorah_fit_score, followers, evidence_json, contact_validation_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        merchantId,
        m.businessName,
        normalizeName(m.businessName),
        m.platform,
        m.url,
        m.phone,
        m.whatsapp || m.phone,
        m.email,
        m.instagramHandle,
        (m as any).githubUrl || null,
        m.facebookUrl,
        m.tiktokHandle,
        m.physicalAddress,
        m.category || kw.split(' ')[0],
        m.dulNumber || null,
        confidenceScore,
        contactScore,
        adjustedFitScore,
        typeof m.followers === 'number' && m.followers > 0 ? m.followers : null,
        JSON.stringify(m.evidence || []),
        JSON.stringify(contactValidation),
        JSON.stringify(metadata)
      );

      const leadId = uuidv4();
      db.prepare(
        `INSERT INTO leads (id, merchant_id, run_id, status) VALUES (?, ?, ?, 'NEW')`
      ).run(leadId, merchantId, runId);

      newLeadsCount++;
      finalMerchants.push({
        ...m,
        id: merchantId,
        status: 'NEW',
        contactValidation,
        confidenceScore,
        contactScore,
        fitScore: adjustedFitScore,
        ...metadata,
      });
      onProgress?.(finalMerchants.length, 'saving');
    } catch (e: any) {
      logger.warn('merchant_insert_failed', { name: m.businessName, error: e.message });
    }
  }

  db.prepare(
    `INSERT INTO search_runs (id, query, source, results_count, new_leads_count, status) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    `${kw} ${location}`,
    'scraper',
    finalMerchants.length,
    newLeadsCount,
    'COMPLETED'
  );

  logger.info('hunt_completed', { runId, newLeadsCount, finalCount: finalMerchants.length });
  return { runId, merchants: finalMerchants, newLeadsCount };
}
