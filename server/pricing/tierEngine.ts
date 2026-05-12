// server/pricing/tierEngine.ts
// Pure function: given a merchant's revenue + sector + gateway state, return
// the recommended MyFatoorah commercial tier (setup-fee band, transaction rate,
// settlement speed, rationale). Numbers lifted from the Sales Agent HTML
// (MyFatoorah_ChatGPT_SalesAgent.html) so the proposal stays on-message.

export type Tier = 'Micro' | 'Small-Medium' | 'Medium-High' | 'High-Volume';

export interface TierInput {
  /** Merchant's *annual* AED revenue. Pass 0 if unknown — engine defaults to Micro. */
  estimatedAnnualRevenueAed: number;
  sector?: string;
  hasGateway?: boolean;
  hasWebsite?: boolean;
}

export interface TierResult {
  tier: Tier;
  setupFeeAed: { min: number; max: number; recommended: number };
  localRate: string;
  intlRate: string;
  settlement: string;
  rationale: string;
  upliftEstimate: { bnplPercent: number; cashflowDaysSaved: number };
}

// Sectors with the highest HOT % (per the uploaded "📊 Sector Breakdown" sheet)
// — these merchants are easier closes, so we nudge the recommended setup fee
// up toward the top of the band (priority slot).
const HOT_SECTORS = new Set([
  'driving school',
  'moving company',
  'car wash',
  'photography studio',
  'home cleaning',
  'restaurant',
  'cafe',
]);

function bandForRevenue(annual: number): Tier {
  if (annual >= 10_000_000) return 'High-Volume';
  if (annual >= 3_000_000) return 'Medium-High';
  if (annual >= 500_000) return 'Small-Medium';
  return 'Micro';
}

function bandPricing(tier: Tier): {
  min: number; max: number; localRate: string; intlRate: string;
} {
  switch (tier) {
    case 'High-Volume':  return { min: 22_000, max: 35_000, localRate: '2.40% (negotiated)', intlRate: '2.85% (negotiated)' };
    case 'Medium-High':  return { min: 16_500, max: 22_000, localRate: '2.49%', intlRate: '2.85%' };
    case 'Small-Medium': return { min:  9_000, max: 16_500, localRate: '2.62%', intlRate: '3.00%' };
    case 'Micro':        return { min:  3_500, max:  9_000, localRate: '2.75%', intlRate: '3.00%' };
  }
}

export function recommendTier(input: TierInput): TierResult {
  const annual = Math.max(0, Number(input.estimatedAnnualRevenueAed) || 0);
  const tier = bandForRevenue(annual);
  const { min, max, localRate, intlRate } = bandPricing(tier);

  // Start from the midpoint of the band.
  let recommended = Math.round((min + max) / 2);
  const reasons: string[] = [];

  const sectorLower = (input.sector || '').toLowerCase();
  const isHotSector = Array.from(HOT_SECTORS).some(s => sectorLower.includes(s));
  if (isHotSector) {
    // Nudge ~10% toward the top of the band — hot-sector merchants close
    // faster, so we sell the "priority onboarding slot" harder.
    recommended = Math.min(max, Math.round(recommended * 1.10));
    reasons.push(`${input.sector} is a high-HOT% sector — priority slot pricing applied.`);
  }

  // If the merchant already has a payment gateway, getting them to switch is
  // harder — discount the setup fee ~15% to ease the close.
  if (input.hasGateway) {
    recommended = Math.max(min, Math.round(recommended * 0.85));
    reasons.push('Existing gateway detected — competitive discount applied to win the switch.');
  }

  // No website at all means they're starting from zero on online payments —
  // emphasise that the setup fee is the *infrastructure* investment, not a tax.
  if (input.hasWebsite === false) {
    reasons.push('No website detected — frame setup fee as the cost of building payment infrastructure.');
  }

  // Settlement speed is the headline differentiator regardless of tier.
  const settlement = tier === 'Micro' ? 'T+2 (next-business-day for verified merchants)' : 'T+1 next-day';

  // BNPL uplift heuristic from the Sales Agent HTML ("avg +23% basket size lift").
  // Hot sectors lean higher because their AOV is naturally more BNPL-friendly.
  const bnplPercent = isHotSector ? 25 : 18;

  // Cashflow days saved: replacing T+5/T+7 with T+1 → roughly 4 days back.
  const cashflowDaysSaved = 4;

  if (!reasons.length) reasons.push('Standard pricing for the band — recommend midpoint of the setup-fee range.');

  return {
    tier,
    setupFeeAed: { min, max, recommended },
    localRate,
    intlRate,
    settlement,
    rationale: reasons.join(' '),
    upliftEstimate: { bnplPercent, cashflowDaysSaved },
  };
}
