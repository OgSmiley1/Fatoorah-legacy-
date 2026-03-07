import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Merchant, SearchParams, RiskAssessment, RevenueLeakage, KYCPreFlight, RiskCategory } from "../types";
import { storageService } from "./storageService";
import { generateMerchantHash } from "../utils/normalization";
import { calculateRevenueLeakage } from "../utils/revenueCalculator";
import { validateKYC } from "../utils/validation";
import { generateOutreachScripts } from "../utils/scripts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const geminiService = {
  async searchMerchants(params: SearchParams): Promise<Merchant[]> {
    try {
      // 1. Fetch all previously found merchants from storage
      const exclusionList = storageService.getExclusionList();
      
      // 2. Build exclusion prompt (limit to last 50 to avoid token limits, but backend check is full)
      const recentExclusions = exclusionList.names.slice(-50).join(', ');
      
      const excludeInstruction = recentExclusions
        ? `\n🚫 CRITICAL DUPLICATE PREVENTION RULES:
        1. EXCLUSION LIST: Never include any merchant from this list: ${recentExclusions}
        2. VERIFICATION REQUIRED: For each merchant, confirm business name does NOT match any in exclusion list (fuzzy match 85%+)`
        : '';

      const advancedFilters = `
        ${params.subCategories?.length ? `- SUB-CATEGORIES: Focus specifically on these niches: "${params.subCategories.join(', ')}"` : ''}
        ${params.categories?.length ? `- CATEGORIES: Target these industries: "${params.categories.join(', ')}"` : ''}
        ${params.businessAge ? `- BUSINESS AGE: Prefer businesses that are "${params.businessAge}"` : ''}
        ${params.minFollowers ? `- MINIMUM FOLLOWERS: Only include businesses with at least ${params.minFollowers} followers` : ''}
        ${params.riskLevel ? `- RISK PROFILE: Target businesses that would be considered "${params.riskLevel}" risk (Low risk = established, high followers, verified web; High risk = new, low followers, social-only)` : ''}
      `.trim();

      // 3. Define Parallel Search Strategies (Reduced to 3 for stability)
      const strategies = [
        { name: "Social & Web", focus: "Instagram Business, TikTok Shop, Official Brand Websites, Google Maps" },
        { name: "Directories", focus: "UAE Yellow Pages, ATN Info, Connect.ae, ArabianTalks" },
        { name: "Niche & Industry", focus: "Industry-specific blogs, forums, marketplaces, and social commerce hashtags" }
      ];

      // 4. Execute Parallel Searches
      const batchSize = Math.ceil(params.maxResults / strategies.length);
      
      const searchPromises = strategies.map(strategy => {
        const batchPrompt = `
          # ROLE
          You are SMILEY WIZARD — an elite merchant intelligence engine.
          Find ${batchSize} REAL, VERIFIED e-commerce merchants in ${params.location} matching keywords: "${params.keywords}".
          
          # STRATEGY: ${strategy.name}
          Focus specifically on: ${strategy.focus}

          # ADVANCED FILTERS
          ${advancedFilters}

          # CRITICAL RULES
          1. NO FABRICATION: Only return real businesses.
          2. JSON ONLY: Return a JSON array of objects.
          ${excludeInstruction}
          
          For each merchant, provide:
          - businessName
          - platform
          - url
          - instagramHandle
          - category
          - followers (number)
          - bio
          - email
          - phone
          - whatsapp
          - website
          - location
          - lastActive
          - isCOD (boolean)
          - paymentMethods (array of strings)
          - contactValidation (object with status, sources, notes)
        `;

        return ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: batchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json"
          },
        }).catch(err => {
          console.error(`Gemini API error in batch ${strategy.name}:`, err);
          throw err;
        });
      });

      // 5. Await all results (Promise.allSettled to handle partial failures)
      const results = await Promise.allSettled(searchPromises);

      // 6. Aggregate Results
      let rawMerchants: any[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          try {
            const text = result.value.text;
            if (!text) return;
            
            const batchData = JSON.parse(text);
            if (Array.isArray(batchData)) {
              rawMerchants = [...rawMerchants, ...batchData];
            } else if (batchData && typeof batchData === 'object') {
              rawMerchants.push(batchData);
            }
          } catch (e) {
            console.error(`Failed to parse batch ${index} (${strategies[index].name})`, e);
          }
        } else {
          console.error(`Batch ${index} (${strategies[index].name}) failed`, result.reason);
        }
      });
      
      // Enrich with Smiley Wizard logic
      const enrichedMerchants = rawMerchants
        .filter(m => m && typeof m === 'object' && m.businessName)
        .map((m: any) => geminiService.enrichMerchant(m));
      
      // Deduplicate within the current batch first to prevent duplicate keys in UI
      const batchUniqueMap = new Map<string, Merchant>();
      enrichedMerchants.forEach(m => {
        if (!batchUniqueMap.has(m.id)) {
          batchUniqueMap.set(m.id, m);
        }
      });
      const batchUniqueMerchants = Array.from(batchUniqueMap.values());

      // Filter out duplicates using storageService (global exclusion)
      const existingMerchants = storageService.getAllMerchants();
      const existingHashes = new Set(existingMerchants.map(m => m.merchantHash));
      
      const uniqueMerchants = batchUniqueMerchants.filter((m: Merchant) => !existingHashes.has(m.merchantHash));
      
      // Save new unique merchants to history
      storageService.saveMerchants(uniqueMerchants);
      
      // Save search history
      storageService.saveSearch({
        sessionId: new Date().toISOString().split('T')[0],
        query: params.keywords,
        location: params.location,
        category: params.categories?.length ? params.categories.join(', ') : 'All',
        resultsCount: uniqueMerchants.length
      });
      
      return uniqueMerchants;
    } catch (error) {
      console.error("Search error in geminiService:", error);
      throw error;
    }
  },

  enrichMerchant(m: any): Merchant {
    const followers = m.followers || 0;
    
    // 1. Risk Assessment
    let riskCategory: RiskCategory = 'HIGH';
    let score = 30;
    const factors: string[] = [];

    if (followers > 10000) {
      riskCategory = 'LOW';
      score = 90;
      factors.push("High follower count indicates established presence");
    } else if (followers > 1000) {
      riskCategory = 'MEDIUM';
      score = 65;
      factors.push("Moderate follower count");
    } else {
      factors.push("Low follower count increases risk profile");
    }

    if (m.website) {
      score += 10;
      factors.push("Verified website present");
    } else {
      factors.push("No dedicated website found");
    }

    if (m.contactValidation?.status === 'VERIFIED') {
      score += 15;
      factors.push("3+ verified contact methods");
    }

    const risk: RiskAssessment = {
      score: Math.min(score, 100),
      category: riskCategory,
      emoji: riskCategory === 'LOW' ? '✅' : riskCategory === 'MEDIUM' ? '⚠️' : '🚨',
      color: riskCategory === 'LOW' ? '#34d399' : riskCategory === 'MEDIUM' ? '#fbbf24' : '#f87171',
      factors
    };

    // 2. Pricing & Settlement (Dynamic based on risk)
    const pricing = {
      setupFee: riskCategory === 'LOW' ? 1500 : riskCategory === 'MEDIUM' ? 3500 : 5500,
      transactionRate: riskCategory === 'LOW' ? "2.49%" : riskCategory === 'MEDIUM' ? "2.75%" : "3.00%",
      settlementCycle: riskCategory === 'LOW' ? "T+1 (Next Day)" : riskCategory === 'MEDIUM' ? "T+3" : "T+7"
    };

    // 3. Revenue & ROI
    const monthlyRevenue = followers * 0.5;
    const currentFees = monthlyRevenue * 0.035;
    const mfFees = monthlyRevenue * (riskCategory === 'LOW' ? 0.0249 : riskCategory === 'MEDIUM' ? 0.0275 : 0.03);
    const feeSavings = Math.round(currentFees - mfFees);
    const bnplUplift = Math.round(monthlyRevenue * 0.25);
    const cashFlowGain = Math.round(monthlyRevenue * 0.1);

    const roi = {
      feeSavings,
      bnplUplift,
      cashFlowGain,
      totalMonthlyGain: Math.round(feeSavings + (bnplUplift * 0.1)),
      annualImpact: Math.round((feeSavings + (bnplUplift * 0.1)) * 12)
    };

    // 4. Leakage Calculator
    const leakage = calculateRevenueLeakage(m);

    // 5. KYC Pre-flight
    const kyc = validateKYC(m);

    // 6. Outreach Scripts
    const scripts = generateOutreachScripts(m);

    const merchantHash = generateMerchantHash(m);

    return {
      ...m,
      id: merchantHash,
      merchantHash,
      searchSessionId: new Date().toISOString().split('T')[0],
      firstFoundDate: new Date().toISOString(),
      foundDate: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
      risk,
      pricing,
      revenue: {
        monthly: monthlyRevenue,
        annual: monthlyRevenue * 12
      },
      roi,
      leakage,
      kyc,
      scripts,
      otherProfiles: m.otherProfiles || [],
      paymentMethods: m.paymentMethods || (m.isCOD ? ["Cash on Delivery"] : ["Unknown"]),
      contactValidation: m.contactValidation || { status: 'UNVERIFIED', sources: [] }
    };
  }
};
