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

  // Website presence
  if (m.url && m.platform === 'website') score += 35;
  else if (m.url) score += 15;

  // Instagram (highest commerce signal)
  if (m.instagramHandle) {
    if (m.followers == null) score += 15;
    else if (m.followers > 10000) score += 35;
    else if (m.followers > 1000) score += 25;
    else if (m.followers > 100) score += 15;
    else score += 10;
  }

  // Other social channels
  if (m.tiktokHandle) score += 15;
  if (m.facebookUrl) score += 10;
  if (m.telegramHandle) score += 8;

  // Contact signals that indicate legitimacy
  if (m.email) score += 10;
  if (m.isCOD) score += 20;

  return Math.min(score, 100);
}

export function computeReliabilityScore(m: any): number {
  let score = 0;
  if (m.phone) score += 35;
  if (m.physicalAddress) score += 30;
  if (m.dulNumber) score += 25;
  // Email and social as secondary reliability signals
  if (m.email) score += 10;
  if (!m.phone && (m.whatsapp || m.telegramHandle)) score += 10;
  return Math.min(score, 100);
}

export function computeComplianceScore(m: any): number {
  let score = 0;
  if (m.dulNumber) score += 60;
  if (m.physicalAddress) score += 25;
  if (m.phone) score += 10;
  if (m.email) score += 5;
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

// Estimate monthly GMV from observable signals (followers, platform, category).
// Returns { monthly, annual, basis } — basis is shown in the UI as the heuristic label.
export function estimateRevenue(m: {
  followers?: number | null;
  platform?: string;
  category?: string;
  isCOD?: boolean;
}): { monthly: number; annual: number; basis: string } {
  const followers = typeof m.followers === 'number' ? m.followers : 0;
  const platform = m.platform || 'website';
  const cat = (m.category || '').toLowerCase();

  // Average order value by category
  let aov = 150; // AED
  if (cat.includes('electronics') || cat.includes('gadget')) aov = 600;
  else if (cat.includes('jewelry') || cat.includes('gold')) aov = 800;
  else if (cat.includes('perfume') || cat.includes('oud')) aov = 300;
  else if (cat.includes('fashion') || cat.includes('abaya') || cat.includes('clothing')) aov = 220;
  else if (cat.includes('food') || cat.includes('restaurant') || cat.includes('cafe')) aov = 80;
  else if (cat.includes('beauty') || cat.includes('salon') || cat.includes('spa')) aov = 200;
  else if (cat.includes('home') || cat.includes('decor') || cat.includes('furniture')) aov = 400;

  // Conversion rate % of followers who buy per month
  let convRate = 0.005; // 0.5% default
  if (followers > 50000) convRate = 0.003;
  else if (followers > 10000) convRate = 0.005;
  else if (followers < 1000 && followers > 0) convRate = 0.012;

  // Platform multiplier (Instagram/TikTok drive more commerce than others)
  const platformMult = platform === 'instagram' || platform === 'tiktok' ? 1.2
    : platform === 'facebook' ? 0.9
    : platform === 'website' ? 1.1
    : 0.8;

  const monthly = followers > 0
    ? Math.round(followers * convRate * aov * platformMult / 100) * 100
    : 0;

  const basis = monthly > 0
    ? `${followers.toLocaleString()} followers × ${(convRate * 100).toFixed(1)}% CVR × AED ${aov} AOV`
    : 'Insufficient data';

  return { monthly, annual: monthly * 12, basis };
}
