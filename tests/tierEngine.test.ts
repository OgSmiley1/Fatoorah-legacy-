// tests/tierEngine.test.ts
import { recommendTier } from '../server/pricing/tierEngine';

describe('recommendTier — tier selection', () => {
  test('< AED 500K annual → Micro', () => {
    const r = recommendTier({ estimatedAnnualRevenueAed: 250_000 });
    expect(r.tier).toBe('Micro');
    expect(r.setupFeeAed.min).toBe(3_500);
    expect(r.setupFeeAed.max).toBe(9_000);
  });

  test('AED 500K – 3M annual → Small-Medium', () => {
    const r = recommendTier({ estimatedAnnualRevenueAed: 1_500_000 });
    expect(r.tier).toBe('Small-Medium');
    expect(r.setupFeeAed.recommended).toBeGreaterThanOrEqual(9_000);
    expect(r.setupFeeAed.recommended).toBeLessThanOrEqual(16_500);
  });

  test('AED 3M – 10M annual → Medium-High', () => {
    const r = recommendTier({ estimatedAnnualRevenueAed: 5_000_000 });
    expect(r.tier).toBe('Medium-High');
  });

  test('> AED 10M annual → High-Volume', () => {
    const r = recommendTier({ estimatedAnnualRevenueAed: 25_000_000 });
    expect(r.tier).toBe('High-Volume');
    expect(r.setupFeeAed.min).toBe(22_000);
    expect(r.localRate).toMatch(/negotiated/i);
  });

  test('zero / missing revenue defaults to Micro', () => {
    expect(recommendTier({ estimatedAnnualRevenueAed: 0 }).tier).toBe('Micro');
  });
});

describe('recommendTier — sector & gateway nudges', () => {
  test('hot-sector (Driving School) nudges setup-fee toward top of band', () => {
    const base = recommendTier({ estimatedAnnualRevenueAed: 1_500_000 });
    const hot = recommendTier({ estimatedAnnualRevenueAed: 1_500_000, sector: 'Driving School' });
    expect(hot.setupFeeAed.recommended).toBeGreaterThan(base.setupFeeAed.recommended);
    expect(hot.rationale.toLowerCase()).toContain('priority slot');
    expect(hot.upliftEstimate.bnplPercent).toBeGreaterThan(base.upliftEstimate.bnplPercent);
  });

  test('hasGateway discounts the recommended setup fee', () => {
    const base = recommendTier({ estimatedAnnualRevenueAed: 1_500_000, sector: 'Driving School' });
    const switching = recommendTier({ estimatedAnnualRevenueAed: 1_500_000, sector: 'Driving School', hasGateway: true });
    expect(switching.setupFeeAed.recommended).toBeLessThan(base.setupFeeAed.recommended);
    expect(switching.rationale.toLowerCase()).toContain('existing gateway');
  });

  test('hasWebsite=false adds an infrastructure-framing line to rationale', () => {
    const r = recommendTier({ estimatedAnnualRevenueAed: 250_000, hasWebsite: false });
    expect(r.rationale.toLowerCase()).toContain('infrastructure');
  });

  test('Micro tier still gets T+2 settlement, higher tiers get T+1', () => {
    expect(recommendTier({ estimatedAnnualRevenueAed: 100_000 }).settlement).toMatch(/T\+2/);
    expect(recommendTier({ estimatedAnnualRevenueAed: 5_000_000 }).settlement).toMatch(/T\+1/);
  });
});
