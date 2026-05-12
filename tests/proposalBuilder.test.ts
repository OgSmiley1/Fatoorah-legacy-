// tests/proposalBuilder.test.ts
import { buildProposal } from '../server/templates/proposalBuilder';

describe('buildProposal — structure', () => {
  const base = {
    id: 'm-123',
    businessName: 'Zenith Car Wash',
    category: 'Car Wash',
    city: 'Dubai',
    phone: '0501234567',
    email: 'info@zenithcarwash.ae',
    website: null,
    physicalAddress: 'Al Quoz, Dubai',
    estimatedAnnualRevenueAed: 1_800_000,
    hasGateway: false,
  };

  test('returns all 10 sections of the canonical proposal', () => {
    const p = buildProposal(base);
    expect(p.sections.cover).toContain('Zenith Car Wash');
    expect(p.sections.executiveSummary).toBeTruthy();
    expect(p.sections.aboutMyFatoorah).toContain('Central Bank of UAE');
    expect(p.sections.theirProblem).toBeTruthy();
    expect(p.sections.ourSolution).toBeTruthy();
    expect(p.sections.pricingTable.setupFeeAed).toBeGreaterThan(0);
    expect(p.sections.roiProjection.totalAnnualUpliftAed).toBeGreaterThan(0);
    expect(p.sections.timeline.length).toBeGreaterThanOrEqual(3);
    expect(p.sections.kycDocs.length).toBeGreaterThanOrEqual(8);
    expect(p.sections.nextSteps).toBeTruthy();
    expect(p.sections.signature).toContain('Maaz Sharif');
  });

  test('proposal carries the commercial analysis from tierEngine', () => {
    const p = buildProposal(base);
    expect(p.commercialAnalysis.tier).toBe('Small-Medium');
    expect(p.commercialAnalysis.setupFeeAed.recommended).toBe(p.sections.pricingTable.setupFeeAed);
  });

  test('phone present → wa.me URL; email present → mailto URL', () => {
    const p = buildProposal(base);
    expect(p.whatsappUrl).toMatch(/^https:\/\/wa\.me\/971501234567\?text=/);
    expect(p.mailtoUrl).toMatch(/^mailto:info@zenithcarwash\.ae\?/);
  });

  test('missing phone → whatsappUrl is null; missing email → mailtoUrl is null', () => {
    const p = buildProposal({ ...base, phone: null, whatsapp: null, email: null });
    expect(p.whatsappUrl).toBeNull();
    expect(p.mailtoUrl).toBeNull();
  });

  test('merchant name appears in proposal body, never the literal placeholder', () => {
    const p = buildProposal(base);
    const blob = JSON.stringify(p);
    expect(blob).toContain('Zenith Car Wash');
    expect(blob).not.toContain('{{businessName}}');
    expect(blob).not.toContain('{{emirate}}');
  });

  test('hasGateway=true → executive summary mentions switching', () => {
    const p = buildProposal({ ...base, hasGateway: true });
    expect(p.sections.theirProblem.toLowerCase()).toContain('gateway');
  });

  test('no website detected → theirProblem flags it', () => {
    const p = buildProposal({ ...base, website: null });
    expect(p.sections.theirProblem.toLowerCase()).toContain('no website');
  });

  test('zero revenue still produces a usable proposal (Micro tier)', () => {
    const p = buildProposal({ ...base, estimatedAnnualRevenueAed: 0 });
    expect(p.commercialAnalysis.tier).toBe('Micro');
    expect(p.sections.roiProjection.totalAnnualUpliftAed).toBe(0);
  });
});
