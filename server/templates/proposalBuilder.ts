// server/templates/proposalBuilder.ts
// Build a fully-personalised MyFatoorah proposal for one merchant.
// Structure mirrors the 10-section template in MyFatoorah_ChatGPT_SalesAgent.html.
// The same proposal also produces the wa.me / mailto: links that the
// MerchantCard surfaces as 3 buttons.

import { recommendTier, type TierResult } from '../pricing/tierEngine.ts';
import { getSectorTemplate, interpolate } from './sectorScripts.ts';
import { buildWhatsAppUrl, buildMailtoUrl } from './deepLinks.ts';

export interface MerchantForProposal {
  id: string;
  businessName: string;
  category?: string | null;       // sector
  city?: string | null;            // emirate
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  physicalAddress?: string | null;
  estimatedAnnualRevenueAed?: number | null;
  hasGateway?: boolean | null;
  paymentMethods?: string[] | null;
}

export interface ProposalSections {
  cover: string;
  executiveSummary: string;
  aboutMyFatoorah: string;
  theirProblem: string;
  ourSolution: string;
  pricingTable: {
    setupFeeAed: number;
    localRate: string;
    intlRate: string;
    settlementFeeAed: number;
    settlement: string;
  };
  roiProjection: {
    monthlyVolumeAed: number;
    settlementUpliftAed: number;
    bnplUpliftAed: number;
    totalAnnualUpliftAed: number;
    cashflowDaysSaved: number;
  };
  timeline: string[];
  kycDocs: string[];
  nextSteps: string;
  signature: string;
}

export interface Proposal {
  merchantId: string;
  generatedAt: string;
  sections: ProposalSections;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
  commercialAnalysis: TierResult;
}

// Lifted verbatim from the Sales Agent HTML — keeping these in code so the
// proposal stays on-message even if the HTML is lost.
const ABOUT_MYFATOORAH =
  'MyFatoorah is licensed by the Central Bank of UAE, PCI DSS certified, ' +
  'serving 75,000+ merchants across 6 GCC markets and processing $3B+ annually.';

const KYC_DOCS = [
  'Valid Trade License',
  'Memorandum / Articles of Association (MOA/AOA)',
  'VAT Registration Certificate',
  'Power of Attorney (if applicable)',
  'Tenancy Contract',
  'Emirates ID + Passport of Authorized Person',
  'Valid IBAN Bank Certificate',
  'Trade License of Holding Company (if applicable)',
];

const SIGNATURE =
  'Maaz Sharif\n' +
  'Commercial Manager — UAE\n' +
  'MyFatoorah PSP LLC (Licensed by Central Bank of UAE)\n' +
  '+971 50 950 9587  |  msharif@myfatoorah.com\n' +
  'Office 109, The Offices 4, One Central DWTC, Sheikh Zayed Road, Dubai';

const SETTLEMENT_FEE_AED = 5;

export function buildProposal(merchant: MerchantForProposal): Proposal {
  const businessName = merchant.businessName || 'Merchant';
  const emirate = merchant.city || 'UAE';
  const sector = merchant.category || '';
  const annual = merchant.estimatedAnnualRevenueAed ?? 0;
  const hasGateway = Boolean(merchant.hasGateway);
  const hasWebsite = Boolean(merchant.website);

  const tier = recommendTier({
    estimatedAnnualRevenueAed: annual,
    sector,
    hasGateway,
    hasWebsite,
  });

  const tmpl = getSectorTemplate(sector);
  const vars = { businessName, emirate, sector };

  const painAngle = interpolate(tmpl.painAngle, vars);
  const opportunity = interpolate(tmpl.opportunity, vars);

  // ROI math:
  //   monthly volume = annual / 12 (defaults to 0 if unknown)
  //   settlement uplift = monthly_volume × (rate_saving / 100)
  //     — conservative: assume merchant currently pays ~3.0%, MyFatoorah ~2.6% → 0.4% saving.
  //   BNPL uplift = monthly_volume × bnpl_percent / 100
  const monthlyVolumeAed = Math.round(annual / 12);
  const RATE_SAVING_PCT = 0.4;
  const settlementUpliftAed = Math.round((monthlyVolumeAed * RATE_SAVING_PCT) / 100);
  const bnplUpliftAed = Math.round((monthlyVolumeAed * tier.upliftEstimate.bnplPercent) / 100);
  const totalAnnualUpliftAed = (settlementUpliftAed + bnplUpliftAed) * 12;

  const sections: ProposalSections = {
    cover: `Payment Infrastructure Proposal for ${businessName}\nPrepared by Maaz Sharif, Commercial Manager, MyFatoorah`,
    executiveSummary:
      `${businessName} is well-positioned to capture more revenue with a modern payment stack. ` +
      `We recommend the ${tier.tier} package — a one-time setup fee of AED ${tier.setupFeeAed.recommended.toLocaleString()}, ` +
      `${tier.localRate} local card rate, and ${tier.settlement} settlement. ` +
      `Projected annual uplift: AED ${totalAnnualUpliftAed.toLocaleString()} from faster settlement plus BNPL conversion.`,
    aboutMyFatoorah: ABOUT_MYFATOORAH,
    theirProblem:
      `Based on what we found for ${businessName}${sector ? ` (${sector})` : ''}${emirate ? ` in ${emirate}` : ''}: ` +
      `${painAngle}` +
      `${hasGateway ? ' You\'re live on a competing gateway, but the settlement cycle and BNPL story leave money on the table.' : ''}` +
      `${!hasWebsite ? ' No website detected — currently relying on WhatsApp/Instagram, which means no checkout flow at all.' : ''}`,
    ourSolution: opportunity +
      ' Specifically: native Tabby/Tamara BNPL with no third-party redirect; payment links you can drop into any WhatsApp message; ' +
      'recurring billing for subscriptions; QR + Soft POS for in-person; T+1 settlement so the cash arrives before you need it.',
    pricingTable: {
      setupFeeAed: tier.setupFeeAed.recommended,
      localRate: tier.localRate,
      intlRate: tier.intlRate,
      settlementFeeAed: SETTLEMENT_FEE_AED,
      settlement: tier.settlement,
    },
    roiProjection: {
      monthlyVolumeAed,
      settlementUpliftAed,
      bnplUpliftAed,
      totalAnnualUpliftAed,
      cashflowDaysSaved: tier.upliftEstimate.cashflowDaysSaved,
    },
    timeline: [
      'Day 1 — Sign agreement, pay onboarding fee, dedicated account manager assigned.',
      'Day 2 — KYC docs submitted, Risk team review, technical integration kick-off.',
      'Day 3 — Live on the MyFatoorah dashboard, first payment link tested end-to-end.',
    ],
    kycDocs: KYC_DOCS,
    nextSteps:
      `Sign the agreement and pay the AED ${tier.setupFeeAed.recommended.toLocaleString()} ` +
      `onboarding fee to reserve your priority slot. We'll be live in 3 working days.`,
    signature: SIGNATURE,
  };

  // Pre-baked outreach bodies for the WhatsApp / mailto links.
  // These reuse the per-sector script with merchant-specific interpolation.
  const waBody = interpolate(tmpl.whatsappEn, vars);
  const emailSubject = interpolate(tmpl.emailSubject, vars);
  const emailBody = interpolate(tmpl.emailBody, vars);

  // Prefer the dedicated `whatsapp` field if it's present; otherwise fall back to phone.
  const whatsappTarget = merchant.whatsapp || merchant.phone || null;
  const whatsappUrl = buildWhatsAppUrl(whatsappTarget, waBody);
  const mailtoUrl = buildMailtoUrl(merchant.email, emailSubject, emailBody);

  return {
    merchantId: merchant.id,
    generatedAt: new Date().toISOString(),
    sections,
    whatsappUrl,
    mailtoUrl,
    commercialAnalysis: tier,
  };
}
