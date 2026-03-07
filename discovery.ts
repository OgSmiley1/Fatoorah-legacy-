import { GoogleGenAI } from "@google/genai";
import db from "./db";
import { v4 as uuidv4 } from "uuid";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface DiscoveryResult {
  merchants: any[];
  runId: string;
}

export async function runDiscovery(params: {
  keywords: string;
  location: string;
  maxResults: number;
  includeOld?: boolean;
}): Promise<DiscoveryResult> {
  const runId = uuidv4();
  
  // Log start
  db.prepare('INSERT INTO search_runs (id, query, status) VALUES (?, ?, ?)').run(runId, params.keywords, 'pending');
  db.prepare('INSERT INTO logs (event, details, run_id) VALUES (?, ?, ?)').run('SEARCH_STARTED', `Query: ${params.keywords}, Location: ${params.location}`, runId);

  try {
    // 1. Get existing merchants for deduplication (hashes)
    const existing = db.prepare('SELECT id, normalized_name, phone, email, instagram_handle FROM merchants').all() as any[];
    const existingNames = new Set(existing.map(m => m.normalized_name.toLowerCase()));
    const existingPhones = new Set(existing.map(m => m.phone).filter(Boolean));
    const existingEmails = new Set(existing.map(m => m.email).filter(Boolean));
    const existingIGs = new Set(existing.map(m => m.instagram_handle).filter(Boolean));

    const prompt = `
      # ROLE
      You are SMILEY WIZARD — an elite merchant intelligence engine for MyFatoorah.
      Find ${params.maxResults} REAL, VERIFIED e-commerce merchants in ${params.location} matching keywords: "${params.keywords}".
      
      # TARGET
      Focus on merchants who sell via Instagram, TikTok, WhatsApp, or simple web stores.
      Prioritize those likely needing payment links or online checkout.
      
      # CRITICAL RULES
      1. NO FABRICATION: Only return real businesses with verifiable presence.
      2. EVIDENCE: For each merchant, list the source URL or platform where they were found.
      3. JSON ONLY: Return a JSON array of objects.
      
      For each merchant, provide:
      - businessName
      - platform (Instagram, TikTok, Web, etc.)
      - url (source URL)
      - instagramHandle
      - category
      - subcategory
      - followers (number)
      - bio
      - email
      - phone
      - whatsapp
      - website
      - location (City, Country)
      - evidence (list of sources)
      - paymentFrictionSignals (e.g., "Uses COD only", "DM to order", "No checkout")
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json"
      },
    });

    const rawMerchants = JSON.parse(response.text || "[]");
    const processedMerchants: any[] = [];
    let newLeadsCount = 0;

    for (const raw of rawMerchants) {
      const normalizedName = raw.businessName.toLowerCase().trim();
      
      // Deduplication Logic
      let isDuplicate = false;
      let duplicateReason = "";

      if (existingNames.has(normalizedName)) {
        isDuplicate = true;
        duplicateReason = "Matched on business name";
      } else if (raw.phone && existingPhones.has(raw.phone)) {
        isDuplicate = true;
        duplicateReason = "Matched on phone number";
      } else if (raw.email && existingEmails.has(raw.email)) {
        isDuplicate = true;
        duplicateReason = "Matched on email";
      } else if (raw.instagramHandle && existingIGs.has(raw.instagramHandle)) {
        isDuplicate = true;
        duplicateReason = "Matched on Instagram handle";
      }

      // Scoring Logic
      const contactScore = calculateContactScore(raw);
      const fitScore = calculateFitScore(raw);
      const confidenceScore = calculateConfidenceScore(raw);

      const merchantId = uuidv4();
      
      // Save Merchant if not duplicate or if we want to track it anyway (but mark as duplicate)
      if (!isDuplicate) {
        db.prepare(`
          INSERT INTO merchants (
            id, business_name, normalized_name, source_platform, source_url, 
            category, subcategory, country, city, website, phone, whatsapp, 
            email, instagram_handle, confidence_score, contactability_score, 
            myfatoorah_fit_score, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          merchantId, raw.businessName, normalizedName, raw.platform, raw.url,
          raw.category, raw.subcategory, params.location, raw.location, raw.website,
          raw.phone, raw.whatsapp, raw.email, raw.instagramHandle,
          confidenceScore, contactScore, fitScore, JSON.stringify(raw.evidence || [])
        );

        db.prepare(`
          INSERT INTO leads (id, merchant_id, status, run_id)
          VALUES (?, ?, ?, ?)
        `).run(uuidv4(), merchantId, 'NEW', runId);
        
        newLeadsCount++;
        processedMerchants.push({ ...raw, id: merchantId, status: 'NEW', contactScore, fitScore, confidenceScore });
      } else {
        db.prepare('INSERT INTO logs (level, event, details, run_id) VALUES (?, ?, ?, ?)')
          .run('DEBUG', 'DUPLICATE_EXCLUDED', `Merchant: ${raw.businessName}, Reason: ${duplicateReason}`, runId);
        
        if (params.includeOld) {
          processedMerchants.push({ ...raw, status: 'DUPLICATE', duplicateReason });
        }
      }
    }

    // Update run status
    db.prepare('UPDATE search_runs SET status = ?, results_count = ?, new_leads_count = ? WHERE id = ?')
      .run('completed', rawMerchants.length, newLeadsCount, runId);
    
    db.prepare('INSERT INTO logs (event, details, run_id) VALUES (?, ?, ?)')
      .run('SEARCH_COMPLETED', `Found ${rawMerchants.length} total, ${newLeadsCount} new leads.`, runId);

    return { merchants: processedMerchants, runId };

  } catch (error: any) {
    console.error("Discovery Error:", error);
    db.prepare('UPDATE search_runs SET status = ?, error_message = ? WHERE id = ?')
      .run('failed', error.message, runId);
    db.prepare('INSERT INTO logs (level, event, details, run_id) VALUES (?, ?, ?, ?)')
      .run('ERROR', 'SEARCH_FAILED', error.message, runId);
    throw error;
  }
}

function calculateContactScore(m: any): number {
  let score = 0;
  if (m.phone) score += 30;
  if (m.whatsapp) score += 20;
  if (m.email) score += 25;
  if (m.instagramHandle) score += 15;
  if (m.website) score += 10;
  return score;
}

function calculateFitScore(m: any): number {
  let score = 50; // Base score
  const signals = (m.paymentFrictionSignals || "").toLowerCase();
  if (signals.includes("cod") || signals.includes("cash")) score += 20;
  if (signals.includes("dm") || signals.includes("direct message")) score += 15;
  if (signals.includes("no checkout") || signals.includes("no payment")) score += 15;
  
  const category = (m.category || "").toLowerCase();
  if (['fashion', 'retail', 'electronics', 'food', 'beauty'].includes(category)) score += 10;
  
  return Math.min(score, 100);
}

function calculateConfidenceScore(m: any): number {
  let score = 0;
  if (m.url) score += 40;
  if (m.evidence && m.evidence.length > 0) score += 30;
  if (m.phone || m.email) score += 30;
  return score;
}
