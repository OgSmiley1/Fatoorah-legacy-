import { search } from 'duck-duck-scrape';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { checkDuplicate, normalizeName } from './dedupService';
import { computeFitScore, computeContactScore, computeConfidence } from './scoringService';
import { logger } from './logger';
import { GoogleGenAI, Type } from "@google/genai";

interface SearchParams {
  keywords: string;
  location: string;
  maxResults?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function aiSearch(keywords: string, location: string, maxResults: number): Promise<any[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('ai_search_skipped', { reason: 'No GEMINI_API_KEY found' });
    return [];
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Find ${maxResults} real, active merchants in ${location} related to "${keywords}". 
  Focus on finding their business name, platform (instagram, facebook, tiktok, or website), URL, and contact details (phone, email, instagram handle).
  Only return real businesses you can find evidence for.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              businessName: { type: Type.STRING },
              platform: { type: Type.STRING, enum: ['instagram', 'facebook', 'tiktok', 'website', 'github'] },
              url: { type: Type.STRING },
              instagramHandle: { type: Type.STRING },
              githubUrl: { type: Type.STRING },
              phone: { type: Type.STRING },
              email: { type: Type.STRING },
              category: { type: Type.STRING },
              evidence: { type: Type.STRING, description: "A short snippet or reason why this merchant was found" }
            },
            required: ['businessName', 'platform', 'url']
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const merchants = JSON.parse(text);
    return merchants.map((m: any) => ({
      ...m,
      whatsapp: m.phone,
      evidence: [m.evidence || "Found via AI search"]
    }));
  } catch (error: any) {
    logger.error('ai_search_failed', { error: error.message });
    return [];
  }
}

async function safeSearch(query: string, retries = 3): Promise<any[]> {
  for (let i = 0; i <= retries; i++) {
    try {
      // Add a significant delay before each attempt to cool down
      // First attempt: 2-4s, subsequent attempts: 10s, 20s, 30s...
      const initialDelay = i === 0 ? 2000 : 10000 * i;
      await sleep(initialDelay + Math.random() * 3000);
      
      const results = await search(query, { safeSearch: 0 });
      return results.results || [];
    } catch (error: any) {
      if (i === retries) {
        logger.error('search_strategy_failed', { query, error: error.message });
        return [];
      }
      // Aggressive backoff: 15s, 30s, 45s...
      const delay = 15000 * (i + 1) + Math.random() * 10000; 
      logger.warn('search_retry', { query, attempt: i + 1, delay });
      await sleep(delay);
    }
  }
  return [];
}

export async function huntMerchants(params: SearchParams) {
  const { keywords, location, maxResults = 10 } = params;
  const runId = uuidv4();
  
  logger.info('hunt_started', { runId, keywords, location });

  try {
    // Primary Strategy: AI Search with Grounding (The "Free AI Tool" approach)
    let discoveredMerchants = await aiSearch(keywords, location, maxResults);
    
    // Fallback Strategy: Scraper (if AI fails or returns too few)
    if (discoveredMerchants.length < maxResults / 2) {
      logger.info('fallback_to_scraper', { runId, aiCount: discoveredMerchants.length });
      
      const jitter = Math.random() > 0.5 ? ' ' : '';
      const combinedQuery = `${keywords}${jitter} ${location} (site:instagram.com OR site:facebook.com OR site:tiktok.com OR "whatsapp" OR "contact us")`;
      const combinedResults = await safeSearch(combinedQuery);
      
      await sleep(8000 + Math.random() * 5000); 
      const githubQuery = `${keywords} ${location} site:github.com${jitter}`;
      const githubResults = await safeSearch(githubQuery);

      const allResults = [...combinedResults, ...githubResults];
      const uniqueResults = Array.from(new Map(allResults.map(r => [r.url, r])).values());

      for (const result of uniqueResults.slice(0, maxResults * 2)) {
        const title = result.title || '';
        const snippet = result.description || '';
        const businessName = title.split(/[\|\-\(]/)[0].trim();
        
        if (!businessName || businessName.length < 2) continue;

        let platform = 'website';
        if (result.url.includes('instagram.com')) platform = 'instagram';
        else if (result.url.includes('facebook.com')) platform = 'facebook';
        else if (result.url.includes('tiktok.com')) platform = 'tiktok';
        else if (result.url.includes('t.me')) platform = 'telegram';
        else if (result.url.includes('github.com')) platform = 'github';

        let instagramHandle = null;
        if (platform === 'instagram') {
          const match = result.url.match(/instagram\.com\/([^\/\?]+)/);
          if (match) instagramHandle = match[1];
        }

        let githubUrl = null;
        if (platform === 'github') {
          githubUrl = result.url;
        } else {
          const ghMatch = snippet.match(/github\.com\/([^\/\s\)]+)/);
          if (ghMatch) githubUrl = `https://github.com/${ghMatch[1]}`;
        }

        const phoneMatch = snippet.match(/(\+?\d{7,15})/);
        const phone = phoneMatch ? phoneMatch[1] : null;

        const emailMatch = snippet.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const email = emailMatch ? emailMatch[1] : null;

        discoveredMerchants.push({
          businessName,
          platform,
          url: result.url,
          instagramHandle,
          githubUrl,
          phone,
          whatsapp: phone,
          email,
          category: keywords.split(' ')[0],
          evidence: [snippet]
        });
      }
    }

    const finalMerchants = [];
    let newLeadsCount = 0;

    // Deduplicate and save
    const seenUrls = new Set();
    for (const m of discoveredMerchants) {
      if (seenUrls.has(m.url)) continue;
      seenUrls.add(m.url);

      const dupCheck = checkDuplicate(m);
      if (!dupCheck.isDuplicate) {
        const merchantId = uuidv4();
        const fitScore = computeFitScore(m.platform, 0);
        const contactScore = computeContactScore(m);
        const confidenceScore = computeConfidence(m);

        db.prepare(`
          INSERT INTO merchants (
            id, business_name, normalized_name, source_platform, source_url,
            phone, whatsapp, email, instagram_handle, github_url, category,
            confidence_score, contactability_score, myfatoorah_fit_score, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          merchantId, m.businessName, normalizeName(m.businessName), m.platform, m.url,
          m.phone, m.phone, m.email, m.instagramHandle, m.githubUrl, m.category || keywords.split(' ')[0],
          confidenceScore, contactScore, fitScore, JSON.stringify(m.evidence)
        );

        const leadId = uuidv4();
        db.prepare(`
          INSERT INTO leads (id, merchant_id, run_id, status)
          VALUES (?, ?, ?, 'NEW')
        `).run(leadId, merchantId, runId, 'NEW');

        newLeadsCount++;
        finalMerchants.push({ ...m, id: merchantId, status: 'NEW' });
      }
    }

    db.prepare(`
      INSERT INTO search_runs (id, query, source, results_count, new_leads_count, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, `${keywords} ${location}`, 'ai_hybrid', finalMerchants.length, newLeadsCount, 'COMPLETED');

    logger.info('hunt_completed', { runId, newLeadsCount });
    return { runId, merchants: finalMerchants, newLeadsCount };

  } catch (error: any) {
    logger.error('hunt_failed', { runId, error: error.message });
    db.prepare(`
      INSERT INTO search_runs (id, query, source, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).run(runId, `${keywords} ${location}`, 'ai_hybrid', 'FAILED', error.message);
    throw error;
  }
}
