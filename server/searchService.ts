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
import { parseInstagramHtml } from './actors/instagramActor';

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

// Primary search: try DDG HTML, then Bing, then DDG library — merge all
async function webSearch(query: string): Promise<SearchResult[]> {
  // Run all three engines in parallel so the slowest doesn't gate the others
  const settled = await Promise.allSettled([
    ddgHtmlSearch(query),
    bingHtmlSearch(query),
    ddgLibrarySearch(query),
  ]);

  const merged: SearchResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') merged.push(...s.value);
  }

  // Dedupe by URL
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of merged) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }

  logger.debug('web_search_done', {
    query,
    ddg: settled[0].status === 'fulfilled' ? settled[0].value.length : 0,
    bing: settled[1].status === 'fulfilled' ? settled[1].value.length : 0,
    ddgLib: settled[2].status === 'fulfilled' ? settled[2].value.length : 0,
    merged: out.length,
  });
  return out;
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

// Fetch Instagram profile HTML and parse og:description / meta
async function enrichFromInstagram(handle: string): Promise<any> {
  if (!handle) return null;
  const clean = handle.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[a-zA-Z0-9._]+$/.test(clean)) return null;
  const url = `https://www.instagram.com/${clean}/`;
  const html = await safeFetch(url, 6000);
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
}

export async function huntMerchants(
  params: SearchParams,
  onProgress?: (count: number, stage?: string) => void
) {
  const { keywords, location, maxResults = 15 } = params;
  const runId = uuidv4();
  const HARD_DEADLINE_MS = 75_000;

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
  const { keywords, location, maxResults = 15 } = params;

  // Build compact, targeted query variations
  const isUAE = /dubai|uae|emirates|abu\s*dhabi|sharjah|ajman|fujairah|khaimah/i.test(
    location
  );

  const queries: string[] = [
    `${keywords} ${location} instagram OR tiktok OR whatsapp contact`,
    `${keywords} ${location} shop online "whatsapp"`,
    `${keywords} ${location} site:instagram.com`,
  ];

  // Run all searches in parallel
  const searchStart = Date.now();
  const searchResults = await Promise.allSettled(
    queries.map(q => webSearch(q))
  );

  const raw: SearchResult[] = [];
  for (const r of searchResults) {
    if (r.status === 'fulfilled') raw.push(...r.value);
  }

  // Run InvestInDubai + OSM Nominatim in parallel — both are UAE-only sources
  if (isUAE) {
    const govSources = await Promise.allSettled([
      withTimeout(scrapeInvestInDubai(keywords, 10), 10_000, 'investindubai'),
      withTimeout(
        searchNominatim({ query: `${keywords} ${location}`, countryCode: 'ae', limit: 15 }),
        9_000,
        'nominatim'
      ),
    ]);

    if (govSources[0].status === 'fulfilled') {
      for (const r of govSources[0].value) {
        raw.push({
          url: `https://investindubai.gov.ae/en/business-directory?search=${encodeURIComponent(
            r.businessName
          )}`,
          title: r.businessName,
          description: `DUL: ${r.dulNumber} | Category: ${r.category}`,
          businessName: r.businessName,
          category: r.category,
          dulNumber: r.dulNumber,
          isInvestInDubai: true,
        });
      }
    } else {
      logger.debug('investindubai_skipped', { error: (govSources[0] as any).reason?.message });
    }

    if (govSources[1].status === 'fulfilled') {
      for (const p of govSources[1].value) {
        const url = p.website ||
          `https://www.openstreetmap.org/${p.osmType}/${p.osmId}`;
        raw.push({
          url,
          title: p.name,
          description: `${p.category} — ${p.displayName}${p.phone ? ` — ${p.phone}` : ''}`,
          businessName: p.name,
          category: p.category,
        });
      }
    } else {
      logger.debug('nominatim_skipped', { error: (govSources[1] as any).reason?.message });
    }
  }

  logger.info('hunt_search_done', {
    runId,
    rawCount: raw.length,
    elapsedMs: Date.now() - searchStart,
  });

  // Dedupe by URL, keep top maxResults*2 candidates for enrichment
  const seen = new Set<string>();
  const candidates: SearchResult[] = [];
  for (const r of raw) {
    if (!r.url || seen.has(r.url)) continue;
    // Skip obvious directory aggregator noise we don't want to enrich
    if (/^(https?:\/\/)?(www\.)?(google|wikipedia|youtube)\./i.test(r.url)) continue;
    seen.add(r.url);
    candidates.push(r);
    if (candidates.length >= maxResults * 2) break;
  }

  onProgress?.(0, 'enriching');

  // Build base merchants
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
      category: result.category || keywords.split(' ')[0],
      evidence: [snippet].filter(Boolean),
      dulNumber: result.dulNumber || null,
      facebookUrl: null,
      tiktokHandle: null,
      physicalAddress: null,
    };
  }).filter(m => m.businessName && m.businessName.length >= 2);

  // Enrich in parallel with concurrency 4 — tight per-merchant timeout via safeFetch
  let enrichedCount = 0;
  const enriched = await mapLimit(baseMerchants, 4, async (m) => {
    const result = await enrichMerchantContacts(m);
    enrichedCount++;
    onProgress?.(enrichedCount, 'enriching');
    return result;
  });

  // Persist — filter out dupes, cap at maxResults
  const finalMerchants: any[] = [];
  let newLeadsCount = 0;

  for (const m of enriched) {
    if (!m) continue;
    if (finalMerchants.length >= maxResults) break;

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
      codEvidence: (m as any).codEvidence || [],
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
          myfatoorah_fit_score, evidence_json, contact_validation_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        m.category || keywords.split(' ')[0],
        m.dulNumber || null,
        confidenceScore,
        contactScore,
        adjustedFitScore,
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
    `${keywords} ${location}`,
    'scraper',
    finalMerchants.length,
    newLeadsCount,
    'COMPLETED'
  );

  logger.info('hunt_completed', { runId, newLeadsCount, finalCount: finalMerchants.length });
  return { runId, merchants: finalMerchants, newLeadsCount };
}
