export function computeFitScore(platform: string, followers: number | null): number {
  let score = 50;

  // Platform weighting
  if (platform === 'instagram') score += 30;
  else if (platform === 'tiktok') score += 30;
  else if (platform === 'telegram') score += 25;
  else if (platform === 'facebook') score += 20;
  else if (platform === 'website') score += 15;

  // Follower weighting - handle null gracefully
  if (followers !== null) {
    if (followers > 10000) score += 10;
    else if (followers > 5000) score += 5;
  } else {
    // Neutral bonus for unverified but discovered social presence
    if (platform === 'instagram' || platform === 'tiktok') score += 5;
  }

  return Math.min(score, 100);
}

export function computeQualityScore(m: any): number {
  let score = 0;
  if (m.url && m.platform === 'website') score += 40;
  // Don't collapse if followers are null, just give a smaller bonus
  if (m.instagramHandle) {
    if (m.followers === null) score += 15;
    else if (m.followers > 1000) score += 30;
    else if (m.followers > 100) score += 10;
  }
  if (m.isCOD) score += 30;
  return Math.min(score, 100);
}

export function computeReliabilityScore(m: any): number {
  let score = 0;
  if (m.phone) score += 30;
  if (m.physicalAddress) score += 40;
  if (m.dulNumber) score += 30;
  return Math.min(score, 100);
}

export function computeComplianceScore(m: any): number {
  let score = 0;
  if (m.dulNumber) score += 70;
  if (m.physicalAddress) score += 30;
  return Math.min(score, 100);
}

export function computeRiskAssessment(m: any): { score: number | null, category: 'LOW' | 'MEDIUM' | 'HIGH', emoji: string, color: string, factors: string[] } {
  const factors: string[] = [];
  let riskPoints = 0;

  if (!m.phone && !m.email) {
    riskPoints += 40;
    factors.push('No contact details found');
  }
  if (!m.physicalAddress) {
    riskPoints += 20;
    factors.push('No physical address');
  }
  if (!m.dulNumber && m.platform === 'invest_in_dubai') {
    riskPoints += 10;
    factors.push('Missing DUL number');
  }
  
  // Only flag low followers if we actually sourced them and they are low
  if (m.platform === 'instagram' && m.followers !== null && m.followers < 100) {
    riskPoints += 30;
    factors.push('Very low follower count');
  }

  if (riskPoints >= 60) return { score: riskPoints, category: 'HIGH', emoji: '⚠️', color: 'red', factors };
  if (riskPoints >= 30) return { score: riskPoints, category: 'MEDIUM', emoji: '🟡', color: 'yellow', factors };
  return { score: riskPoints, category: 'LOW', emoji: '✅', color: 'green', factors };
}

export function computeContactScore(m: any): number {
  let score = 0;
  if (m.phone) score += 25;
  if (m.whatsapp) score += 15;
  if (m.email) score += 20;
  if (m.instagramHandle) score += 10;
  if (m.facebookUrl) score += 10;
  if (m.tiktokHandle) score += 10;
  if (m.physicalAddress) score += 10;
  if (m.website) score += 5;
  return Math.min(score, 100);
}

export function computeConfidence(m: any, sourceCount = 1): number {
  let score = 0;
  if (m.url) score += 30;
  if (m.evidence && m.evidence.length > 0) score += 20;

  // Bonus for multiple contact points
  const contactPoints = [m.phone, m.email, m.whatsapp, m.instagramHandle, m.facebookUrl, m.tiktokHandle].filter(Boolean).length;
  score += Math.min(contactPoints * 10, 50);

  // Cross-source verification bonus: same merchant found by 2+ independent sources
  if (sourceCount >= 3) score += 30;
  else if (sourceCount >= 2) score += 20;

  return Math.min(score, 100);
}

export interface MyFatoorahOffer {
  setupFee: number;
  transactionRate: string;
  settlementCycle: string;
  offerReason: string;
  isEligible: boolean;
}

export function calculateMyFatoorahOffer(m: any, risk: any, revenue: any): MyFatoorahOffer {
  // 1. Risk Eligibility - Only LOW and MEDIUM risk get special offers
  // High risk gets standard pricing or no offer
  if (risk.category === 'HIGH') {
    return {
      setupFee: 1499,
      transactionRate: '3.0% + 1.50 AED',
      settlementCycle: 'T+5',
      offerReason: 'Standard pricing for high-risk profile',
      isEligible: false
    };
  }

  let setupFee = 999;
  let transactionRate = '2.5% + 1.00 AED';
  let settlementCycle = 'T+2';
  let offerReason = 'Standard digital integration';

  // 2. Activity / Revenue Scaling
  const monthlyRev = revenue?.monthly || 0;
  if (monthlyRev > 100000) {
    setupFee = 0;
    transactionRate = '1.9% + 0.50 AED';
    settlementCycle = 'T+1';
    offerReason = 'Enterprise volume discount';
  } else if (monthlyRev > 50000) {
    setupFee = 299;
    transactionRate = '2.2% + 0.75 AED';
    settlementCycle = 'T+1';
    offerReason = 'High-growth merchant offer';
  } else if (monthlyRev > 20000) {
    setupFee = 499;
    transactionRate = '2.4% + 1.00 AED';
    offerReason = 'Verified active merchant discount';
  }

  // 3. Category / Product Specifics
  const category = (m.category || '').toLowerCase();
  if (category.includes('fashion') || category.includes('clothing') || category.includes('beauty')) {
    // High-volume retail categories get slightly better rates
    if (setupFee > 0) setupFee -= 100;
    offerReason += ' • Retail sector incentive';
  } else if (category.includes('electronics') || category.includes('gadgets')) {
    // Electronics often have lower margins, maybe faster settlement
    settlementCycle = 'T+1';
    offerReason += ' • Electronics sector fast-settlement';
  }

  // 4. Risk Bonus - Only LOW risk gets the absolute best perks
  if (risk.category === 'LOW') {
    if (setupFee > 0) setupFee = Math.round(setupFee * 0.7); // 30% discount on setup
    offerReason += ' • Low-risk trust bonus';
  }

  // 5. COD Bonus
  if (m.isCOD) {
    offerReason += ' • COD conversion specialist';
  }

  return {
    setupFee,
    transactionRate,
    settlementCycle,
    offerReason,
    isEligible: true
  };
}
