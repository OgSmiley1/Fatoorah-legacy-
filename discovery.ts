import db from "./db";
import { v4 as uuidv4 } from "uuid";
import { checkDuplicate, normalizeName } from "./server/dedupService";
import { computeFitScore, computeContactScore, computeConfidence, computeContactConfidence, estimateRevenue } from "./server/scoringService";
import { generateScripts, detectPaymentGateways } from "./server/aiSearchService";

interface RawMerchant {
  businessName: string;
  platform: string;
  url: string;
  instagramHandle?: string;
  category?: string;
  subcategory?: string;
  location?: string;
  website?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  evidence?: string[];
  discoverySource?: string;
  revenue?: { monthly: number; annual: number };
  pricing?: { setupFee: number; transactionRate: string; settlementCycle: string };
  roi?: { feeSavings: number; bnplUplift: number; cashFlowGain: number; totalMonthlyGain: number; annualImpact: number };
  contactValidation?: { status: string; sources: string[] };
  paymentMethods?: string[];
  otherProfiles?: { platform: string; url: string }[];
  foundDate?: string;
}

interface ProcessedMerchant extends RawMerchant {
  id: string;
  status: string;
  duplicateReason?: string | null;
  contactScore: number;
  fitScore: number;
  fitSignals: string[];
  confidenceScore: number;
  contactConfidence: ReturnType<typeof computeContactConfidence>;
  risk: { score: number; category: string; emoji: string; color: string; factors: string[] };
  scripts: { arabic: string; english: string; whatsapp: string; instagram: string };
  revenueEstimate?: ReturnType<typeof estimateRevenue>;
  detectedGateways?: string[];
  hasPaymentGateway?: boolean;
  analyzedAt: string;
}

export interface IngestResult {
  merchants: ProcessedMerchant[];
  runId: string;
}

interface IngestParams {
  merchants: RawMerchant[];
  query: string;
  location: string;
}

export async function ingestMerchants(params: IngestParams): Promise<IngestResult> {
  const runId = uuidv4();
  
  db.prepare('INSERT INTO search_runs (id, query, status) VALUES (?, ?, ?)').run(runId, params.query, 'pending');
  db.prepare('INSERT INTO logs (event, details, run_id) VALUES (?, ?, ?)').run('INGESTION_STARTED', `Query: ${params.query}, Location: ${params.location}`, runId);

  try {
    const processedMerchants: ProcessedMerchant[] = [];
    let newLeadsCount = 0;
    
    const seenInRun = new Set<string>();

    for (const raw of params.merchants) {
      const normalizedName = normalizeName(raw.businessName);
      const igHandle = (raw.instagramHandle || "").toLowerCase().trim();
      
      const dupCheck = checkDuplicate(raw);
      let isDuplicate = dupCheck.isDuplicate;
      let duplicateReason = dupCheck.reason;
      const existingId = dupCheck.existingMerchantId;

      if (!isDuplicate && (seenInRun.has(normalizedName) || (igHandle && seenInRun.has(igHandle)))) {
        isDuplicate = true;
        duplicateReason = "Duplicate in current search run";
      }

      seenInRun.add(normalizedName);
      if (igHandle) seenInRun.add(igHandle);

      let detectedGateways: string[] = [];
      try {
        if (raw.url && !raw.url.includes('instagram.com') && !raw.url.includes('facebook.com')) {
          detectedGateways = await detectPaymentGateways(raw.url);
        }
      } catch {}

      const merchantWithGateways = { ...raw, detectedGateways };
      const contactScore = computeContactScore(raw);
      const fitResult = computeFitScore(merchantWithGateways);
      const confidenceScore = computeConfidence(raw);
      const contactConfidence = computeContactConfidence(raw);
      const revenueEst = estimateRevenue(raw, fitResult);
      const risk = calculateRiskAssessment(raw);

      const scriptInput = {
        businessName: raw.businessName,
        platform: raw.platform,
        category: raw.category,
        codSignal: fitResult.codSignal,
        whatsappOrdering: fitResult.whatsappOrdering,
        tier: revenueEst.tier,
        hasPaymentGateway: detectedGateways.length > 0
      };

      let scripts;
      try {
        scripts = await generateScripts(scriptInput);
      } catch {
        scripts = {
          arabic: `مرحباً ${raw.businessName}، لاحظنا متجركم المميز ونود عرض حلول MyFatoorah لتسهيل الدفع لعملائكم.`,
          english: `Hi ${raw.businessName}, we love your products! MyFatoorah can help you accept online payments easily.`,
          whatsapp: `Hello! I'm from MyFatoorah. We help businesses like ${raw.businessName} accept payments online.`,
          instagram: `Love your feed! Have you considered adding a direct payment link to your bio?`
        };
      }

      const merchantId = isDuplicate ? (existingId || uuidv4()) : uuidv4();
      
      if (!isDuplicate) {
        db.prepare(`
          INSERT INTO merchants (
            id, business_name, normalized_name, source_platform, source_url, 
            category, subcategory, country, city, website, phone, whatsapp, 
            email, instagram_handle, confidence_score, contactability_score, 
            myfatoorah_fit_score, evidence_json, metadata_json,
            discovery_source, has_payment_gateway, detected_gateways
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          merchantId, raw.businessName, normalizedName, raw.platform, raw.url,
          raw.category, raw.subcategory, params.location, raw.location, raw.website,
          raw.phone, raw.whatsapp, raw.email, raw.instagramHandle,
          confidenceScore, contactScore, fitResult.score,
          JSON.stringify(raw.evidence || []),
          JSON.stringify({
            contactConfidence,
            fitSignals: fitResult.rationale,
            revenueEstimate: revenueEst,
            scripts
          }),
          raw.discoverySource || 'manual',
          detectedGateways.length > 0 ? 1 : 0,
          detectedGateways.length > 0 ? JSON.stringify(detectedGateways) : null
        );

        db.prepare(`
          INSERT INTO leads (id, merchant_id, status, run_id)
          VALUES (?, ?, ?, ?)
        `).run(uuidv4(), merchantId, 'NEW', runId);
        
        newLeadsCount++;
        processedMerchants.push({ 
          ...raw, 
          id: merchantId, 
          status: 'NEW', 
          contactScore, 
          fitScore: fitResult.score,
          fitSignals: fitResult.rationale,
          confidenceScore,
          contactConfidence,
          risk,
          scripts,
          revenueEstimate: revenueEst,
          detectedGateways,
          hasPaymentGateway: detectedGateways.length > 0,
          revenue: raw.revenue || { monthly: revenueEst.monthlyRevenue, annual: revenueEst.annualRevenue },
          pricing: raw.pricing || { setupFee: revenueEst.setupFeeMin, transactionRate: revenueEst.transactionRate, settlementCycle: "T+1" },
          roi: raw.roi || { feeSavings: 0, bnplUplift: 0, cashFlowGain: 0, totalMonthlyGain: 0, annualImpact: 0 },
          contactValidation: raw.contactValidation || { status: 'UNVERIFIED', sources: [] },
          paymentMethods: raw.paymentMethods || [],
          otherProfiles: raw.otherProfiles || [],
          foundDate: raw.foundDate || new Date().toISOString(),
          analyzedAt: new Date().toISOString()
        });
      } else {
        db.prepare('INSERT INTO logs (level, event, details, run_id) VALUES (?, ?, ?, ?)')
          .run('DEBUG', 'DUPLICATE_EXCLUDED', `Merchant: ${raw.businessName}, Reason: ${duplicateReason}`, runId);

        const existingLead = db.prepare(
          `SELECT id FROM leads WHERE merchant_id = ? AND run_id = ?`
        ).get(merchantId, runId) as { id: string } | undefined;

        if (!existingLead) {
          db.prepare(`
            INSERT INTO leads (id, merchant_id, run_id, status, notes)
            VALUES (?, ?, ?, 'DUPLICATE', ?)
          `).run(uuidv4(), merchantId, runId, `Duplicate: ${duplicateReason}`);
        }
        
        processedMerchants.push({ 
          ...raw, 
          id: merchantId,
          status: 'DUPLICATE', 
          duplicateReason,
          contactScore,
          fitScore: fitResult.score,
          fitSignals: fitResult.rationale,
          confidenceScore,
          contactConfidence,
          risk,
          scripts,
          revenueEstimate: revenueEst,
          detectedGateways,
          hasPaymentGateway: detectedGateways.length > 0,
          revenue: raw.revenue || { monthly: revenueEst.monthlyRevenue, annual: revenueEst.annualRevenue },
          pricing: raw.pricing || { setupFee: revenueEst.setupFeeMin, transactionRate: revenueEst.transactionRate, settlementCycle: "T+1" },
          roi: raw.roi || { feeSavings: 0, bnplUplift: 0, cashFlowGain: 0, totalMonthlyGain: 0, annualImpact: 0 },
          contactValidation: raw.contactValidation || { status: 'UNVERIFIED', sources: [] },
          paymentMethods: raw.paymentMethods || [],
          otherProfiles: raw.otherProfiles || [],
          foundDate: raw.foundDate || new Date().toISOString(),
          analyzedAt: new Date().toISOString()
        });
      }
    }

    db.prepare('UPDATE search_runs SET status = ?, results_count = ?, new_leads_count = ? WHERE id = ?')
      .run('completed', params.merchants.length, newLeadsCount, runId);
    
    db.prepare('INSERT INTO logs (event, details, run_id) VALUES (?, ?, ?)')
      .run('INGESTION_COMPLETED', `Processed ${params.merchants.length} total, ${newLeadsCount} new leads.`, runId);

    return { merchants: processedMerchants, runId };

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Ingestion Error:", error);
    db.prepare('UPDATE search_runs SET status = ?, error_message = ? WHERE id = ?')
      .run('failed', errMsg, runId);
    db.prepare('INSERT INTO logs (level, event, details, run_id) VALUES (?, ?, ?, ?)')
      .run('ERROR', 'INGESTION_FAILED', errMsg, runId);
    throw error;
  }
}

function calculateRiskAssessment(m: RawMerchant) {
  let score = 20;
  const factors = ["New discovery"];
  
  if (!m.phone && !m.email) {
    score += 40;
    factors.push("Limited contact info");
  }
  
  if (!m.website) {
    score += 20;
    factors.push("No official website");
  }

  let category: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  let emoji = '🛡️';
  let color = 'emerald';

  if (score > 60) {
    category = 'HIGH';
    emoji = '⚠️';
    color = 'rose';
  } else if (score > 30) {
    category = 'MEDIUM';
    emoji = '⚖️';
    color = 'amber';
  }

  return { score, category, emoji, color, factors };
}
