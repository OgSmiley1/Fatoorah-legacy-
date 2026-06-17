import { logger } from './logger';

export interface ExcelScoringResult {
  score: number;
  priority: 'HOT' | 'WARM' | 'COLD' | 'LOW';
  breakdown: {
    no_gateway_or_cod: number;
    whatsapp_ig_selling: number;
    phone_exists: number;
    email_exists: number;
    high_followers: number;
  };
}

/**
 * Implements the Excel lead scoring formula:
 * - No gateway OR manual COD: +30 (biggest weight)
 * - WhatsApp/Instagram/DM/Telegram selling: +20
 * - Phone exists: +10
 * - Email exists: +10
 * - Followers/Reviews >= 5000: +10
 * Max: 100
 */
export function scoreLeadExcelFormula(merchant: any): ExcelScoringResult {
  let score = 0;
  const breakdown = {
    no_gateway_or_cod: 0,
    whatsapp_ig_selling: 0,
    phone_exists: 0,
    email_exists: 0,
    high_followers: 0,
  };

  // +30 for no gateway or COD/manual collection
  const hasGateway = merchant.payment_gateway || merchant.has_gateway;
  const isCODOnly = merchant.isCOD ||
    (merchant.sell_channel && merchant.sell_channel.toLowerCase().includes('cod')) ||
    (merchant.evidence && merchant.evidence.some((e: any) =>
      e.toLowerCase().includes('cash on delivery') ||
      e.toLowerCase().includes('pay on delivery')
    ));

  if (!hasGateway || isCODOnly) {
    score += 30;
    breakdown.no_gateway_or_cod = 30;
  }

  // +20 for WhatsApp/Instagram/DM/Telegram selling
  const sellChannelLower = merchant.sell_channel?.toLowerCase() || '';
  const hasWhatsApp = merchant.whatsapp || sellChannelLower.includes('whatsapp');
  const hasInstagram = merchant.instagram_handle ||
    merchant.source_platform === 'instagram' ||
    sellChannelLower.includes('instagram');
  const hasTelegram = merchant.telegram_handle || sellChannelLower.includes('telegram');
  const hasDM = sellChannelLower.includes('dm') || sellChannelLower.includes('direct message');

  if (hasWhatsApp || hasInstagram || hasDM || hasTelegram) {
    score += 20;
    breakdown.whatsapp_ig_selling = 20;
  }

  // +10 for phone exists
  if (merchant.phone || merchant.whatsapp) {
    score += 10;
    breakdown.phone_exists = 10;
  }

  // +10 for email exists
  if (merchant.email) {
    score += 10;
    breakdown.email_exists = 10;
  }

  // +10 for high followers/reviews (>= 5000)
  const followers = merchant.followers || 0;
  if (followers >= 5000) {
    score += 10;
    breakdown.high_followers = 10;
  }

  // Cap at 100
  score = Math.min(score, 100);

  // Assign priority based on score
  let priority: 'HOT' | 'WARM' | 'COLD' | 'LOW' = 'LOW';
  if (score >= 70) {
    priority = 'HOT';
  } else if (score >= 50) {
    priority = 'WARM';
  } else if (score >= 30) {
    priority = 'COLD';
  }

  logger.debug('score_calculated', {
    business_name: merchant.business_name,
    score,
    priority,
    breakdown,
  });

  return { score, priority, breakdown };
}

/**
 * Get sector-aware messaging hook for proposal generator
 */
export function getSectorHook(sector: string): string {
  const sectorLower = sector?.toLowerCase() || '';

  if (sectorLower.includes('real estate') || sectorLower.includes('property')) {
    return 'high-net-worth GCC buyers expect secure checkout — MyFatoorah protects your margins on high-ticket transactions';
  } else if (sectorLower.includes('car wash') || sectorLower.includes('automotive')) {
    return 'repeat customers — payment links turn washes into recurring revenue. WhatsApp settlements in 24hrs';
  } else if (sectorLower.includes('clinic') || sectorLower.includes('doctor') || sectorLower.includes('health')) {
    return 'patients pay via SMS payment link without leaving the clinic. Compliance-ready, DIFC-approved';
  } else if (sectorLower.includes('salon') || sectorLower.includes('spa') || sectorLower.includes('beauty')) {
    return 'WhatsApp bookings deserve a checkout that matches your brand. No payment gateway upcharge';
  } else if (sectorLower.includes('catering') || sectorLower.includes('restaurant') || sectorLower.includes('food')) {
    return 'Instagram orders close faster with a one-click payment link. Real-time settlement dashboard';
  } else if (sectorLower.includes('wedding') || sectorLower.includes('event')) {
    return 'high-ticket events need flexible payment plans — MyFatoorah BNPL partnerships convert browsers to bookers';
  } else if (sectorLower.includes('education') || sectorLower.includes('tutor')) {
    return 'recurring tuition fees + exam deposits — automate collections to focus on teaching';
  } else if (sectorLower.includes('photography') || sectorLower.includes('video')) {
    return 'shoot bookings + digital delivery = instant checkout. Protect pre-orders with upfront payment';
  }

  return 'your customers expect the same checkout experience as global platforms — MyFatoorah delivers in 48 hours';
}

/**
 * Estimate MyFatoorah revenue based on volume and rates
 */
export function estimateMFRevenue(
  expectedVolumeAED: number,
  monthlyTransactionFeePercent: number = 2.5,
  perTransactionFeeFree: boolean = false
): number {
  if (!expectedVolumeAED || expectedVolumeAED <= 0) return 0;

  // Annual calculation
  const monthlyFee = expectedVolumeAED * (monthlyTransactionFeePercent / 100);
  const annualFee = monthlyFee * 12;

  return Math.round(annualFee);
}
