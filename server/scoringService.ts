// Weighted Evaluation Matrix for Merchant Scoring
// Contact Quality (25%) | Payment Readiness (20%) | Business Legitimacy (20%)
// Social Presence (15%) | Revenue Potential (10%) | Risk Factors (10%)

export interface WeightedScore {
  composite: number;
  breakdown: {
    contactQuality: { score: number; weight: number; weighted: number };
    paymentReadiness: { score: number; weight: number; weighted: number };
    businessLegitimacy: { score: number; weight: number; weighted: number };
    socialPresence: { score: number; weight: number; weighted: number };
    revenuePotential: { score: number; weight: number; weighted: number };
    riskFactors: { score: number; weight: number; weighted: number };
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  recommendation: string;
}

export interface VerificationResult {
  status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'DISCREPANCY';
  sourcesConfirmed: number;
  totalSources: number;
  details: { field: string; sources: string[]; verified: boolean }[];
}

export interface RiskAssessment {
  score: number;
  category: 'LOW' | 'MEDIUM' | 'HIGH';
  emoji: string;
  color: string;
  factors: string[];
}

// --- Contact Quality (25% weight) ---
// Scores 1-5 based on available contact channels and verification
function scoreContactQuality(m: any): number {
  let score = 0;
  if (m.phone) score += 1.5;
  if (m.email) score += 1;
  if (m.whatsapp) score += 1;
  if (m.instagramHandle) score += 0.5;
  if (m.physicalAddress) score += 0.5;
  // Bonus for UAE phone format
  if (m.phone && /(\+?971|05[0-9])/.test(m.phone)) score += 0.5;
  return Math.min(Math.round(score * 10) / 10, 5);
}

// --- Payment Readiness / COD (20% weight) ---
function scorePaymentReadiness(m: any): number {
  let score = 1; // base
  if (m.isCOD) score += 2; // COD merchants are high priority
  if (m.paymentGateway && m.paymentGateway !== 'None detected') {
    // Already has gateway — still valuable but less urgent
    if (m.paymentGateway.toLowerCase().includes('myfatoorah')) score -= 1;
    else score += 1; // Has competitor gateway — conversion opportunity
  }
  if (m.platform === 'website') score += 1; // Website = ready for integration
  if (m.platform === 'instagram' || m.platform === 'tiktok') score += 0.5; // Social sellers need payment
  return Math.min(Math.max(score, 1), 5);
}

// --- Business Legitimacy (20% weight) ---
function scoreBusinessLegitimacy(m: any): number {
  let score = 1;
  if (m.dulNumber) score += 2;
  if (m.physicalAddress) score += 1;
  if (m.url && m.platform === 'website') score += 0.5;
  if (m.email && !m.email.includes('gmail') && !m.email.includes('yahoo')) score += 0.5; // Business email
  // Multi-source verification bonus
  const verifiedSources = (m.verificationSources || []).length;
  if (verifiedSources >= 3) score += 1;
  else if (verifiedSources >= 2) score += 0.5;
  return Math.min(score, 5);
}

// --- Social Presence (15% weight) ---
function scoreSocialPresence(m: any): number {
  let score = 1;
  const platforms = [m.instagramHandle, m.facebookUrl, m.tiktokHandle, m.telegramHandle].filter(Boolean).length;
  score += Math.min(platforms, 2); // Up to 2 points for multi-platform
  if (m.followers > 10000) score += 2;
  else if (m.followers > 5000) score += 1.5;
  else if (m.followers > 1000) score += 1;
  else if (m.followers > 100) score += 0.5;
  return Math.min(score, 5);
}

// --- Revenue Potential (10% weight) ---
function scoreRevenuePotential(m: any): number {
  let score = 2; // base mid-range
  const revenue = m.estimatedRevenue || m.revenue?.monthly || 0;
  if (revenue > 100000) score = 5;
  else if (revenue > 50000) score = 4;
  else if (revenue > 25000) score = 3.5;
  else if (revenue > 10000) score = 3;
  else if (revenue > 5000) score = 2.5;
  // Platform-based boost
  if (m.platform === 'website' && !revenue) score = Math.max(score, 3);
  return Math.min(score, 5);
}

// --- Risk Factors (10% weight) — inverted: 5 = lowest risk ---
function scoreRiskFactors(m: any): number {
  let deductions = 0;
  if (!m.phone && !m.email) deductions += 2;
  if (!m.physicalAddress) deductions += 1;
  if (!m.dulNumber && (m.platform === 'invest_in_dubai' || m.platform === 'website')) deductions += 0.5;
  if (m.platform === 'instagram' && (!m.followers || m.followers < 100)) deductions += 1;
  if (!m.url) deductions += 0.5;
  return Math.max(5 - deductions, 1);
}

// --- Composite Weighted Score ---
export function computeWeightedScore(m: any): WeightedScore {
  const contactRaw = scoreContactQuality(m);
  const paymentRaw = scorePaymentReadiness(m);
  const legitimacyRaw = scoreBusinessLegitimacy(m);
  const socialRaw = scoreSocialPresence(m);
  const revenueRaw = scoreRevenuePotential(m);
  const riskRaw = scoreRiskFactors(m);

  const breakdown = {
    contactQuality: { score: contactRaw, weight: 0.25, weighted: contactRaw * 0.25 },
    paymentReadiness: { score: paymentRaw, weight: 0.20, weighted: paymentRaw * 0.20 },
    businessLegitimacy: { score: legitimacyRaw, weight: 0.20, weighted: legitimacyRaw * 0.20 },
    socialPresence: { score: socialRaw, weight: 0.15, weighted: socialRaw * 0.15 },
    revenuePotential: { score: revenueRaw, weight: 0.10, weighted: revenueRaw * 0.10 },
    riskFactors: { score: riskRaw, weight: 0.10, weighted: riskRaw * 0.10 },
  };

  const composite = Math.round(
    (breakdown.contactQuality.weighted +
      breakdown.paymentReadiness.weighted +
      breakdown.businessLegitimacy.weighted +
      breakdown.socialPresence.weighted +
      breakdown.revenuePotential.weighted +
      breakdown.riskFactors.weighted) * 20 // Scale 0-5 to 0-100
  );

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  let recommendation: string;
  if (composite >= 80) { grade = 'A'; recommendation = 'High-priority — contact via WhatsApp immediately'; }
  else if (composite >= 65) { grade = 'B'; recommendation = 'Strong lead — schedule outreach this week'; }
  else if (composite >= 50) { grade = 'C'; recommendation = 'Moderate — needs more verification before outreach'; }
  else if (composite >= 35) { grade = 'D'; recommendation = 'Weak lead — archive or revisit later'; }
  else { grade = 'F'; recommendation = 'Skip — insufficient data for qualification'; }

  return { composite, breakdown, grade, recommendation };
}

// --- Multi-Source Verification ---
export function computeVerification(m: any): VerificationResult {
  const details: { field: string; sources: string[]; verified: boolean }[] = [];

  // Phone verification
  const phoneSources: string[] = [];
  if (m.phone) {
    if (m._phoneSources) phoneSources.push(...m._phoneSources);
    else phoneSources.push(m.platform || 'primary');
  }
  details.push({ field: 'phone', sources: phoneSources, verified: phoneSources.length > 0 });

  // Email verification
  const emailSources: string[] = [];
  if (m.email) {
    if (m._emailSources) emailSources.push(...m._emailSources);
    else emailSources.push(m.platform || 'primary');
  }
  details.push({ field: 'email', sources: emailSources, verified: emailSources.length > 0 });

  // Business name verification
  const nameSources: string[] = [m.platform || 'primary'];
  if (m.dulNumber) nameSources.push('InvestInDubai');
  if (m._enrichmentSources) nameSources.push(...m._enrichmentSources);
  details.push({ field: 'businessName', sources: nameSources, verified: nameSources.length > 0 });

  // Address verification
  const addrSources: string[] = [];
  if (m.physicalAddress) addrSources.push(m.platform || 'primary');
  details.push({ field: 'address', sources: addrSources, verified: addrSources.length > 0 });

  const verifiedFields = details.filter(d => d.verified).length;
  const totalFields = details.length;
  const totalSourcesUsed = new Set(details.flatMap(d => d.sources)).size;

  let status: VerificationResult['status'];
  if (verifiedFields >= 3 && totalSourcesUsed >= 2) status = 'VERIFIED';
  else if (verifiedFields >= 2) status = 'PARTIALLY_VERIFIED';
  else status = 'UNVERIFIED';

  return { status, sourcesConfirmed: totalSourcesUsed, totalSources: totalFields, details };
}

// --- Risk Assessment Engine ---
export function computeRiskAssessment(m: any): RiskAssessment {
  const factors: string[] = [];
  let riskPoints = 0;

  if (!m.phone && !m.email) {
    riskPoints += 35;
    factors.push('No contact details found');
  }
  if (!m.physicalAddress) {
    riskPoints += 15;
    factors.push('No physical address');
  }
  if (!m.dulNumber && (m.platform === 'invest_in_dubai' || m.platform === 'website')) {
    riskPoints += 10;
    factors.push('Missing trade license / DUL');
  }
  if (m.platform === 'instagram' && (!m.followers || m.followers < 100)) {
    riskPoints += 20;
    factors.push('Very low follower count');
  }
  if (!m.url || m.url === '') {
    riskPoints += 10;
    factors.push('No source URL');
  }
  // COD-only risk (no online payment)
  if (m.isCOD && (!m.paymentGateway || m.paymentGateway === 'None detected')) {
    riskPoints += 5;
    factors.push('COD-only, no gateway — high conversion potential');
  }
  // Mismatched data
  if (m.phone && m.whatsapp && m.phone !== m.whatsapp) {
    // Not necessarily bad, just flag
    factors.push('Phone and WhatsApp numbers differ');
  }

  let category: 'LOW' | 'MEDIUM' | 'HIGH';
  let emoji: string;
  let color: string;
  if (riskPoints >= 50) { category = 'HIGH'; emoji = '⚠️'; color = 'rose'; }
  else if (riskPoints >= 25) { category = 'MEDIUM'; emoji = '⚖️'; color = 'amber'; }
  else { category = 'LOW'; emoji = '🛡️'; color = 'emerald'; }

  return { score: riskPoints, category, emoji, color, factors };
}

// --- Legacy compatibility wrappers ---
export function computeFitScore(platform: string, followers: number): number {
  let score = 50;
  if (platform === 'instagram') score += 30;
  else if (platform === 'tiktok') score += 30;
  else if (platform === 'telegram') score += 25;
  else if (platform === 'facebook') score += 20;
  else if (platform === 'website') score += 15;
  if (followers > 10000) score += 10;
  else if (followers > 5000) score += 5;
  return Math.min(score, 100);
}

export function computeContactScore(m: any): number {
  return Math.round(scoreContactQuality(m) * 20); // Scale 1-5 to 0-100
}

export function computeConfidence(m: any): number {
  const verification = computeVerification(m);
  let score = verification.sourcesConfirmed * 25;
  if (m.url) score += 20;
  if (m.evidence && m.evidence.length > 0) score += 10;
  return Math.min(score, 100);
}

export function computeQualityScore(m: any): number {
  return computeWeightedScore(m).composite;
}

export function computeReliabilityScore(m: any): number {
  return Math.round(scoreBusinessLegitimacy(m) * 20);
}

export function computeComplianceScore(m: any): number {
  let score = 0;
  if (m.dulNumber) score += 70;
  if (m.physicalAddress) score += 30;
  return Math.min(score, 100);
}
