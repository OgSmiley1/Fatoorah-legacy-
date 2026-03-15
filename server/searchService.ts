import { search } from 'duck-duck-scrape';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { checkDuplicate, normalizeName, normalizePhone } from './dedupService';
import { computeFitScore, computeContactScore, computeConfidence, computeContactConfidence, estimateRevenue } from './scoringService';
import { searchWithPerplexity, searchWithGrok, searchWithGemini, detectPaymentGateways, generateScripts, type MerchantCandidate } from './aiSearchService';
import { logger } from './logger';

interface SearchParams {
  keywords: string;
  location: string;
  maxResults?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface DuckDuckGoResult {
  title: string;
  description: string;
  url: string;
}

async function safeSearch(query: string, retries = 3): Promise<DuckDuckGoResult[]> {
  for (let i = 0; i <= retries; i++) {
    try {
      const initialDelay = i === 0 ? 2000 : 10000 * i;
      await sleep(initialDelay + Math.random() * 3000);
      
      const results = await search(query, { safeSearch: 0 });
      return (results.results || []) as DuckDuckGoResult[];
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (i === retries) {
        logger.error('search_strategy_failed', { query, error: errMsg });
        return [];
      }
      const delay = 15000 * (i + 1) + Math.random() * 10000; 
      logger.warn('search_retry', { query, attempt: i + 1, delay });
      await sleep(delay);
    }
  }
  return [];
}

function extractBusinessName(title: string): string {
  if (!title) return '';
  
  const arabicPattern = /[\u0600-\u06FF]/;
  
  if (arabicPattern.test(title)) {
    let name = title
      .replace(/على انستقرام|على فيسبوك|على تيك توك|on Instagram|on Facebook|on TikTok/gi, '')
      .replace(/@[\w.]+/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/["•·…]/g, '')
      .trim();
    
    const parts = name.split(/[\|\-–—]/);
    name = parts[0].trim();
    
    if (name.length < 2) name = title.split(/[\|\-–—\(]/)[0].trim();
    return name;
  }
  
  let name = title
    .replace(/on Instagram|on Facebook|on TikTok|- YouTube|- Home/gi, '')
    .replace(/@[\w.]+/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
  
  const parts = name.split(/[\|\-–—]/);
  name = parts[0].trim();
  
  return name.length >= 2 ? name : '';
}

async function scraperSearch(params: SearchParams): Promise<MerchantCandidate[]> {
  const { keywords, location, maxResults = 10 } = params;
  
  const queries: string[] = [];
  const jitter = () => Math.random() > 0.5 ? ' ' : '';
  
  queries.push(`${keywords}${jitter()} ${location} (site:instagram.com OR site:t.me) عباية متجر واتساب`);
  queries.push(`${keywords}${jitter()} ${location} (site:instagram.com OR site:facebook.com OR site:tiktok.com) shop store`);
  queries.push(`${keywords}${jitter()} ${location} متجر واتساب "الدفع عند الاستلام" OR "كاش" OR "تواصل"`);
  queries.push(`${keywords}${jitter()} ${location} "whatsapp" OR "contact us" OR "order" ecommerce shop`);

  const allResults: DuckDuckGoResult[] = [];
  
  for (let i = 0; i < queries.length; i++) {
    const results = await safeSearch(queries[i]);
    allResults.push(...results);
    
    if (i < queries.length - 1) {
      await sleep(5000 + Math.random() * 3000);
    }
  }

  const uniqueResults = Array.from(new Map(allResults.map(r => [r.url, r])).values());
  const candidates: MerchantCandidate[] = [];

  for (const result of uniqueResults.slice(0, maxResults * 3)) {
    const title = result.title || '';
    const snippet = result.description || '';
    const businessName = extractBusinessName(title);
    
    if (!businessName || businessName.length < 2) continue;

    let platform = 'website';
    if (result.url.includes('instagram.com')) platform = 'instagram';
    else if (result.url.includes('facebook.com')) platform = 'facebook';
    else if (result.url.includes('tiktok.com')) platform = 'tiktok';
    else if (result.url.includes('t.me')) platform = 'telegram';

    let instagramHandle: string | null = null;
    if (platform === 'instagram') {
      const match = result.url.match(/instagram\.com\/([^\/\?]+)/);
      if (match && !['p', 'explore', 'reels', 'stories', 'accounts'].includes(match[1])) {
        instagramHandle = match[1];
      }
    }

    const phonePatterns = [
      /(\+?(?:965|971|973|974|968|966)\s?\d{7,8})/,
      /(\+?\d{10,15})/
    ];
    let phone: string | null = null;
    for (const p of phonePatterns) {
      const match = snippet.match(p);
      if (match) { phone = match[1].replace(/\s/g, ''); break; }
    }

    const emailMatch = snippet.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0] : null;

    const whatsappMatch = snippet.match(/(?:واتساب|whatsapp|wa\.me)[:\s]*(\+?\d{7,15})/i);
    const whatsapp = whatsappMatch ? whatsappMatch[1] : phone;

    const normalizedPhone = normalizePhone(phone || '') || phone;
    const normalizedWhatsapp = normalizePhone(whatsapp || '') || whatsapp;

    candidates.push({
      businessName,
      platform,
      url: result.url,
      instagramHandle,
      phone: normalizedPhone,
      whatsapp: normalizedWhatsapp,
      email,
      category: keywords.split(/[,\s]+/)[0],
      evidence: [snippet],
      discoverySource: 'scraper'
    });
  }

  return candidates;
}

function deduplicateCandidates(candidates: MerchantCandidate[]): MerchantCandidate[] {
  const seen = new Map<string, MerchantCandidate>();
  for (const c of candidates) {
    const key = c.url.toLowerCase().replace(/\/$/, '');
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }
  return Array.from(seen.values());
}

export async function huntMerchants(params: SearchParams) {
  const { keywords, location, maxResults = 10 } = params;
  const runId = uuidv4();
  
  logger.info('hunt_started', { runId, keywords, location });

  try {
    const sourcePromises = [
      scraperSearch(params).catch(err => {
        logger.error('scraper_source_failed', { error: String(err) });
        return [] as MerchantCandidate[];
      }),
      searchWithPerplexity(params).catch(err => {
        logger.error('perplexity_source_failed', { error: String(err) });
        return [] as MerchantCandidate[];
      }),
      searchWithGrok(params).catch(err => {
        logger.error('grok_source_failed', { error: String(err) });
        return [] as MerchantCandidate[];
      }),
      searchWithGemini(params).catch(err => {
        logger.error('gemini_source_failed', { error: String(err) });
        return [] as MerchantCandidate[];
      })
    ];

    const results = await Promise.allSettled(sourcePromises);
    
    let allCandidates: MerchantCandidate[] = [];
    const sourceCounts: Record<string, number> = {};
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allCandidates.push(...result.value);
        for (const c of result.value) {
          sourceCounts[c.discoverySource] = (sourceCounts[c.discoverySource] || 0) + 1;
        }
      }
    }

    logger.info('sources_completed', { runId, sourceCounts, totalRaw: allCandidates.length });

    allCandidates = deduplicateCandidates(allCandidates);

    const finalMerchants = [];
    let newLeadsCount = 0;

    const seenUrls = new Set<string>();
    for (const m of allCandidates.slice(0, maxResults * 3)) {
      if (seenUrls.has(m.url)) continue;
      seenUrls.add(m.url);

      const dupCheck = checkDuplicate(m);
      
      let detectedGateways: string[] = [];
      if (m.platform === 'website' || (m.url && !m.url.includes('instagram.com') && !m.url.includes('facebook.com'))) {
        detectedGateways = await detectPaymentGateways(m.url);
      }

      const merchantWithGateways = { ...m, detectedGateways };
      const fitResult = computeFitScore(merchantWithGateways);
      const contactScore = computeContactScore(m);
      const confidenceScore = computeConfidence(m);
      const contactConfidence = computeContactConfidence(m);
      const revenueEstimate = estimateRevenue(m, fitResult);

      const scriptInput = {
        businessName: m.businessName,
        platform: m.platform,
        category: m.category,
        codSignal: fitResult.codSignal,
        whatsappOrdering: fitResult.whatsappOrdering,
        tier: revenueEstimate.tier,
        hasPaymentGateway: detectedGateways.length > 0
      };

      let scripts;
      try {
        scripts = await generateScripts(scriptInput);
      } catch {
        scripts = {
          arabic: `مرحباً ${m.businessName}، لاحظنا متجركم المميز ونود عرض حلول MyFatoorah لتسهيل الدفع لعملائكم.`,
          english: `Hi ${m.businessName}, we love your products! MyFatoorah can help you accept online payments easily.`,
          whatsapp: `Hello! I'm from MyFatoorah. We help businesses like ${m.businessName} accept payments online.`,
          instagram: `Love your feed! Have you considered adding a direct payment link to your bio?`
        };
      }

      if (!dupCheck.isDuplicate) {
        const merchantId = uuidv4();

        db.prepare(`
          INSERT INTO merchants (
            id, business_name, normalized_name, source_platform, source_url,
            phone, whatsapp, email, instagram_handle, category,
            confidence_score, contactability_score, myfatoorah_fit_score, evidence_json, metadata_json,
            discovery_source, has_payment_gateway, detected_gateways
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          merchantId, m.businessName, normalizeName(m.businessName), m.platform, m.url,
          m.phone, m.whatsapp, m.email, m.instagramHandle, m.category || keywords.split(/[,\s]+/)[0],
          confidenceScore, contactScore, fitResult.score,
          JSON.stringify(m.evidence),
          JSON.stringify({
            contactConfidence,
            fitSignals: fitResult.rationale,
            revenueEstimate,
            scripts
          }),
          m.discoverySource,
          detectedGateways.length > 0 ? 1 : 0,
          detectedGateways.length > 0 ? JSON.stringify(detectedGateways) : null
        );

        const leadId = uuidv4();
        db.prepare(`
          INSERT INTO leads (id, merchant_id, run_id, status)
          VALUES (?, ?, ?, 'NEW')
        `).run(leadId, merchantId, runId);

        newLeadsCount++;
        finalMerchants.push({
          ...m,
          id: merchantId,
          status: 'NEW',
          fitScore: fitResult.score,
          fitSignals: fitResult.rationale,
          contactScore,
          confidenceScore,
          contactConfidence,
          revenueEstimate,
          detectedGateways,
          hasPaymentGateway: detectedGateways.length > 0,
          scripts
        });
      } else {
        logger.info('duplicate_skipped', { name: m.businessName, reason: dupCheck.reason });
        const existingId = dupCheck.existingMerchantId || uuidv4();
        
        const existingLead = db.prepare(
          `SELECT id FROM leads WHERE merchant_id = ? AND run_id = ?`
        ).get(existingId, runId) as { id: string } | undefined;

        if (!existingLead) {
          const dupLeadId = uuidv4();
          db.prepare(`
            INSERT INTO leads (id, merchant_id, run_id, status, notes)
            VALUES (?, ?, ?, 'DUPLICATE', ?)
          `).run(dupLeadId, existingId, runId, `Duplicate: ${dupCheck.reason}`);
        }

        finalMerchants.push({
          ...m,
          id: existingId,
          status: 'DUPLICATE',
          duplicateReason: dupCheck.reason,
          fitScore: fitResult.score,
          fitSignals: fitResult.rationale,
          contactScore,
          confidenceScore,
          contactConfidence,
          revenueEstimate,
          detectedGateways,
          hasPaymentGateway: detectedGateways.length > 0,
          scripts
        });
      }
    }

    const sourceStr = Object.keys(sourceCounts).join('+') || 'scraper';
    db.prepare(`
      INSERT INTO search_runs (id, query, source, results_count, new_leads_count, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, `${keywords} ${location}`, sourceStr, finalMerchants.length, newLeadsCount, 'COMPLETED');

    logger.info('hunt_completed', { runId, newLeadsCount, totalProcessed: allCandidates.length, sources: sourceCounts });
    return { runId, merchants: finalMerchants, newLeadsCount, sourceCounts };

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('hunt_failed', { runId, error: errMsg });
    db.prepare(`
      INSERT INTO search_runs (id, query, source, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).run(runId, `${keywords} ${location}`, 'multi', 'FAILED', errMsg);
    throw error;
  }
}
