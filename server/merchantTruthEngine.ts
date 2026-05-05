// server/merchantTruthEngine.ts
// Merchant Truth Engine
// Pure deterministic sales-quality gate for MyFatoorah merchant hunting.
// No network, no DB, no API keys. It turns noisy raw leads into real sales actions.

import {
  normalizeDomain,
  normalizeEmail,
  normalizeHandle,
  normalizePhone,
  isInstitutionalLead,
} from './verificationService';

export type TruthDecision = 'APPROVE' | 'REVIEW' | 'REJECT';
export type LeadTemperature = 'HOT' | 'WARM' | 'COLD' | 'DEAD';
export type EvidenceStrength = 'STRONG' | 'MEDIUM' | 'WEAK' | 'NEGATIVE';
export type BestChannel = 'whatsapp' | 'email' | 'instagram' | 'call' | 'review';

export interface EvidenceItem {
  field: string;
  value: string;
  source: string;
  strength: EvidenceStrength;
  confidence: number;
}

export interface BuyingSignal {
  key: string;
  label: string;
  weight: number;
  evidence: string;
}

export interface MerchantTruthScores {
  identityScore: number;
  contactScore: number;
  proofScore: number;
  buyingSignalScore: number;
  revenuePotentialScore: number;
  riskPenalty: number;
  finalSalesScore: number;
}

export interface SalesPlan {
  priority: LeadTemperature;
  bestChannel: BestChannel;
  myFatoorahFit: string[];
  painPoint: string;
  nextAction: string;
  openerEnglish: string;
  openerArabic: string;
  objectionToExpect: string;
}

export interface MerchantTruthResult {
  decision: TruthDecision;
  temperature: LeadTemperature;
  isSalesReady: boolean;
  rejectionReasons: string[];
  reviewReasons: string[];
  acceptedReasons: string[];
  evidence: EvidenceItem[];
  buyingSignals: BuyingSignal[];
  scores: MerchantTruthScores;
  salesPlan: SalesPlan;
}

const ARTICLE_RE = /\b(article|blog|guide|how to|tips|news|press|media|story|report|scam|warning|fraud|what is|learn about|top\s*\d+|best companies|directory of|embed\.js|javascript)\b/i;
const PAYMENT_INDUSTRY_RE = /\b(payment gateway|digital payment|instant payment|visa support|banking news|fintech news|safe digital payment|aani|central bank announcement)\b/i;
const GENERIC_NAME_RE = /\b(best|top|guide|how|why|what|when|companies|businesses|directory|khaleej\s*times|gulf\s*news|youtube|wikipedia|reddit)\b/i;
const FREE_EMAIL_RE = /@(gmail|yahoo|hotmail|outlook|icloud|protonmail)\./i;

const BUYING_SIGNAL_RULES: { key: string; label: string; weight: number; re: RegExp }[] = [
  { key: 'whatsapp_order', label: 'Accepts or requests WhatsApp orders', weight: 22, re: /\b(whatsapp\s*(to|for)?\s*(order|book|buy|inquire)|order\s*(on|via|through)\s*whatsapp|wa\.me|api\.whatsapp\.com)\b/i },
  { key: 'dm_to_order', label: 'Uses DM/manual order flow', weight: 20, re: /\b(dm\s*(to|for)?\s*(order|book|buy|price)|message\s*(us)?\s*(to|for)?\s*order|inbox\s*(to|for)?\s*order)\b/i },
  { key: 'bank_transfer', label: 'Mentions bank transfer/manual payment', weight: 18, re: /\b(bank transfer|wire transfer|transfer only|deposit required|advance payment|manual payment)\b/i },
  { key: 'cod', label: 'Cash on delivery/pay on delivery signal', weight: 18, re: /\b(cash on delivery|cod|pay on delivery|payment on delivery)\b/i },
  { key: 'booking_deposit', label: 'Booking/deposit collection use case', weight: 16, re: /\b(book now|booking|appointment|reservation|deposit|consultation fee|advance booking)\b/i },
  { key: 'shipping_delivery', label: 'Delivery/shipping business model', weight: 14, re: /\b(delivery|shipping|courier|same day delivery|worldwide shipping|international shipping)\b/i },
  { key: 'online_store', label: 'Online store / checkout-ready merchant', weight: 12, re: /\b(shop now|add to cart|checkout|woocommerce|shopify|online store|ecommerce|e-commerce)\b/i },
  { key: 'high_ticket', label: 'High-ticket category signal', weight: 15, re: /\b(luxury|jewellery|jewelry|gold|clinic|aesthetic|dental|real estate|interior|furniture|electronics|watches|perfume|oud)\b/i },
];

const HIGH_VALUE_CATEGORY_RE = /\b(luxury|jewellery|jewelry|gold|clinic|aesthetic|dental|real estate|interior|furniture|electronics|watches|perfume|oud|fashion|abaya|salon|spa|corporate gifts|events|catering)\b/i;
const FOOD_DELIVERY_RE = /\b(restaurant|cafe|bakery|dessert|kitchen|food|catering|delivery)\b/i;
const BOOKING_RE = /\b(clinic|salon|spa|dental|aesthetic|gym|studio|course|academy|hotel|tour|travel|event)\b/i;
const MARKETPLACE_RE = /\b(marketplace|multi vendor|vendor|classified|platform)\b/i;
const SUBSCRIPTION_RE = /\b(subscription|membership|monthly|recurring)\b/i;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

function merchantName(m: any): string {
  return String(m.businessName || m.name || m.title || '').trim();
}

function sourceList(m: any): string[] {
  const raw = m.verifiedSources || m.sources || m.sourceProof || m.contactValidation?.sources || [];
  if (Array.isArray(raw)) return uniq(raw.map(String));
  if (typeof raw === 'string') return [raw];
  return [];
}

function textOf(m: any): string {
  return [
    m.businessName,
    m.name,
    m.title,
    m.category,
    m.subcategory,
    m.snippet,
    m.description,
    m.bio,
    Array.isArray(m.evidence) ? m.evidence.join(' ') : '',
    Array.isArray(m.codEvidence) ? m.codEvidence.join(' ') : '',
    m.metaSignals?.title,
    m.metaSignals?.description,
    m.structuredData?.description,
  ].filter(Boolean).join(' ');
}

function hasNegativeContent(m: any): string[] {
  const reasons: string[] = [];
  const text = textOf(m);
  const name = merchantName(m);
  const url = String(m.url || m.website || '').toLowerCase();
  const contentType = String(m.contentType || '').toLowerCase();

  if (ARTICLE_RE.test(text) || ARTICLE_RE.test(url) || ['article', 'news', 'blog_article', 'javascript_file'].includes(contentType)) {
    reasons.push('Looks like article/news/guide/script content, not a merchant.');
  }
  if (PAYMENT_INDUSTRY_RE.test(text) && !m.phone && !m.address && !m.physicalAddress) {
    reasons.push('Looks like payment-industry content without merchant proof.');
  }
  if (!name || name.length < 2) reasons.push('Missing merchant name.');
  if (name && GENERIC_NAME_RE.test(name) && !m.phone && !m.address && !m.website) {
    reasons.push('Generic/non-merchant name without proof.');
  }
  if (isInstitutionalLead({ businessName: name, email: m.email, instagramHandle: m.instagramHandle })) {
    reasons.push('Institutional/government lead, not a target merchant.');
  }
  return reasons;
}

function buildEvidence(m: any): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const sources = sourceList(m);
  const defaultSource = sources[0] || m.platform || m.source || 'unknown';
  const add = (field: string, value: any, source = defaultSource, strength: EvidenceStrength = 'MEDIUM', confidence = 0.7) => {
    if (value == null || String(value).trim() === '') return;
    evidence.push({ field, value: String(value), source, strength, confidence });
  };

  const name = merchantName(m);
  add('merchantName', name, defaultSource, 'STRONG', 0.9);

  const website = m.website || (String(m.platform || '').toLowerCase() === 'website' ? m.url : undefined);
  const domain = normalizeDomain(website || m.url);
  if (domain) add('domain', domain, 'domain', 'STRONG', 0.86);

  const phone = normalizePhone(m.phone || m.whatsapp);
  if (phone) add('phone', phone, m.whatsappVerification?.status === 'live' ? 'whatsapp-live' : defaultSource, 'STRONG', m.whatsappVerification?.status === 'live' ? 0.95 : 0.82);

  const email = normalizeEmail(m.email);
  if (email) add('email', email, m.emailVerification?.status === 'deliverable' ? 'dns-mx' : defaultSource, FREE_EMAIL_RE.test(email) ? 'MEDIUM' : 'STRONG', FREE_EMAIL_RE.test(email) ? 0.65 : 0.82);

  const ig = normalizeHandle(m.instagramHandle);
  if (ig) add('instagram', ig, m.instagramProfile ? 'instagram' : defaultSource, 'MEDIUM', m.instagramProfile ? 0.8 : 0.65);

  const address = m.physicalAddress || m.address || m.displayName || m.location;
  if (address) add('address', address, sources.includes('here-geocoding') ? 'here-geocoding' : defaultSource, 'STRONG', 0.78);

  if (m.dulNumber) add('dulNumber', m.dulNumber, 'invest-in-dubai', 'STRONG', 0.95);
  if (m.placeId || m.place_id) add('placeId', m.placeId || m.place_id, sources.includes('serpapi') ? 'serpapi' : defaultSource, 'STRONG', 0.86);
  if (m.structuredData) add('structuredData', 'present', 'json-ld', 'STRONG', 0.86);
  if (Array.isArray(m.paymentMethods) && m.paymentMethods.length) add('paymentMethods', m.paymentMethods.join(', '), 'website', 'MEDIUM', 0.75);

  return evidence;
}

function detectBuyingSignals(m: any): BuyingSignal[] {
  const text = textOf(m);
  const signals: BuyingSignal[] = [];
  for (const rule of BUYING_SIGNAL_RULES) {
    const match = text.match(rule.re);
    if (match) {
      signals.push({ key: rule.key, label: rule.label, weight: rule.weight, evidence: match[0] });
    }
  }
  if (m.isCOD && !signals.some(s => s.key === 'cod')) {
    signals.push({ key: 'cod', label: 'Cash on delivery/pay on delivery signal', weight: 18, evidence: 'isCOD=true' });
  }
  if (Array.isArray(m.codEvidence) && m.codEvidence.length && !signals.some(s => s.key === 'cod')) {
    signals.push({ key: 'cod', label: 'Cash on delivery/pay on delivery signal', weight: 18, evidence: String(m.codEvidence[0]) });
  }
  if (m.hasGateway === false) {
    signals.push({ key: 'no_gateway_detected', label: 'No payment gateway detected', weight: 16, evidence: 'hasGateway=false' });
  }
  return signals;
}

function scoreMerchant(m: any, evidence: EvidenceItem[], buyingSignals: BuyingSignal[], rejectionReasons: string[]): MerchantTruthScores {
  const sources = sourceList(m);
  const sourceCount = uniq(sources).length;
  const text = textOf(m);
  const hasName = Boolean(merchantName(m));
  const hasDomain = evidence.some(e => e.field === 'domain');
  const hasPhone = evidence.some(e => e.field === 'phone');
  const hasEmail = evidence.some(e => e.field === 'email');
  const hasSocial = evidence.some(e => e.field === 'instagram');
  const hasAddress = evidence.some(e => e.field === 'address');
  const hasRegistry = evidence.some(e => e.field === 'dulNumber');
  const hasPlace = evidence.some(e => e.field === 'placeId') || sources.includes('here-geocoding') || sources.includes('serpapi');
  const hasStructured = evidence.some(e => e.field === 'structuredData');

  const identityScore = clamp(
    (hasName ? 28 : 0) +
    (hasDomain ? 22 : 0) +
    (hasPhone ? 20 : 0) +
    (hasEmail ? 14 : 0) +
    (hasSocial ? 10 : 0) +
    (hasAddress ? 12 : 0)
  );

  const contactScore = clamp(
    (hasPhone ? 38 : 0) +
    (m.whatsapp || m.whatsappVerification?.status === 'live' ? 24 : 0) +
    (hasEmail ? 22 : 0) +
    (hasSocial ? 12 : 0) +
    (m.website || m.url ? 8 : 0)
  );

  const proofScore = clamp(
    sourceCount * 14 +
    (hasRegistry ? 32 : 0) +
    (hasPlace ? 22 : 0) +
    (hasStructured ? 18 : 0) +
    (m.emailVerification?.status === 'deliverable' ? 10 : 0) +
    (m.whatsappVerification?.status === 'live' ? 12 : 0)
  );

  const buyingSignalScore = clamp(buyingSignals.reduce((sum, s) => sum + s.weight, 0));

  let revenuePotentialScore = 25;
  if (HIGH_VALUE_CATEGORY_RE.test(text)) revenuePotentialScore += 30;
  if (FOOD_DELIVERY_RE.test(text)) revenuePotentialScore += 18;
  if (BOOKING_RE.test(text)) revenuePotentialScore += 18;
  if (MARKETPLACE_RE.test(text)) revenuePotentialScore += 22;
  if (SUBSCRIPTION_RE.test(text)) revenuePotentialScore += 18;
  if (typeof m.followers === 'number') {
    if (m.followers >= 50000) revenuePotentialScore += 25;
    else if (m.followers >= 10000) revenuePotentialScore += 18;
    else if (m.followers >= 1000) revenuePotentialScore += 10;
  }
  revenuePotentialScore = clamp(revenuePotentialScore);

  let riskPenalty = 0;
  if (rejectionReasons.length) riskPenalty += Math.min(55, rejectionReasons.length * 25);
  if (!hasPhone && !hasEmail && !hasSocial) riskPenalty += 25;
  if (!hasDomain && !hasPlace && !hasRegistry && !hasStructured) riskPenalty += 20;
  if (m.hasGateway === true && !m.isCOD) riskPenalty += 10;
  if (m.email && FREE_EMAIL_RE.test(String(m.email))) riskPenalty += 5;
  riskPenalty = clamp(riskPenalty);

  const finalSalesScore = clamp(
    identityScore * 0.24 +
    contactScore * 0.22 +
    proofScore * 0.24 +
    buyingSignalScore * 0.18 +
    revenuePotentialScore * 0.12 -
    riskPenalty * 0.7
  );

  return {
    identityScore,
    contactScore,
    proofScore,
    buyingSignalScore,
    revenuePotentialScore,
    riskPenalty,
    finalSalesScore,
  };
}

function productFit(m: any, buyingSignals: BuyingSignal[]): string[] {
  const text = textOf(m);
  const fits: string[] = [];
  const signalKeys = new Set(buyingSignals.map(s => s.key));

  if (signalKeys.has('whatsapp_order') || signalKeys.has('dm_to_order') || signalKeys.has('bank_transfer') || signalKeys.has('cod')) {
    fits.push('Payment Links');
  }
  if (signalKeys.has('online_store') || /shopify|woocommerce|checkout|ecommerce|e-commerce/i.test(text)) {
    fits.push('Online Checkout / E-commerce Integration');
  }
  if (/apple pay|google pay|checkout|shop now|mobile/i.test(text) || signalKeys.has('online_store')) {
    fits.push('Apple Pay / Google Pay');
  }
  if (BOOKING_RE.test(text) || signalKeys.has('booking_deposit')) {
    fits.push('Booking Deposits');
  }
  if (MARKETPLACE_RE.test(text)) {
    fits.push('Multi-vendor / Split Settlement Review');
  }
  if (SUBSCRIPTION_RE.test(text)) {
    fits.push('Recurring Payments');
  }
  if (!fits.length) fits.push('Payment Links');
  return uniq(fits);
}

function leadTemperature(score: number, decision: TruthDecision): LeadTemperature {
  if (decision === 'REJECT') return 'DEAD';
  if (score >= 82) return 'HOT';
  if (score >= 62) return 'WARM';
  return 'COLD';
}

function bestChannel(m: any): BestChannel {
  if (normalizePhone(m.whatsapp || m.phone)) return 'whatsapp';
  if (normalizeEmail(m.email)) return 'email';
  if (normalizeHandle(m.instagramHandle)) return 'instagram';
  return 'review';
}

function buildSalesPlan(m: any, decision: TruthDecision, temperature: LeadTemperature, buyingSignals: BuyingSignal[]): SalesPlan {
  const name = merchantName(m) || 'your business';
  const fits = productFit(m, buyingSignals);
  const channel = decision === 'REJECT' ? 'review' : bestChannel(m);
  const strongestSignal = buyingSignals[0]?.label || 'manual customer payment collection can be improved';

  let painPoint = 'Manual payment collection may be slowing customer conversion.';
  if (buyingSignals.some(s => s.key === 'whatsapp_order' || s.key === 'dm_to_order')) {
    painPoint = 'Customers appear to be pushed into WhatsApp/DM ordering, which can lose buyers before payment.';
  } else if (buyingSignals.some(s => s.key === 'bank_transfer')) {
    painPoint = 'Bank-transfer/manual confirmation creates friction and delays collections.';
  } else if (buyingSignals.some(s => s.key === 'booking_deposit')) {
    painPoint = 'Booking or deposit collection can be made faster with instant payment links.';
  } else if (buyingSignals.some(s => s.key === 'online_store')) {
    painPoint = 'Checkout can be improved with local cards, Apple Pay, and faster customer payment options.';
  }

  const nextAction = decision === 'APPROVE'
    ? `Contact via ${channel} using a payment-pain opener, then qualify monthly volume and current payment method.`
    : decision === 'REVIEW'
      ? 'Do not export yet. Verify one more proof point: phone, website, registry, HERE/SerpApi place, or active Instagram.'
      : 'Reject from sales list. Do not waste outreach time.';

  return {
    priority: temperature,
    bestChannel: channel,
    myFatoorahFit: fits,
    painPoint,
    nextAction,
    openerEnglish: `Hi ${name}, I noticed ${strongestSignal.toLowerCase()}. MyFatoorah can help you collect payments instantly through ${fits[0].toLowerCase()}, so customers can pay without delays or manual confirmation. Who handles payments or online orders on your side?`,
    openerArabic: `مرحباً ${name}، لاحظت أن لديكم فرصة لتسهيل تحصيل المدفوعات للعملاء. مع MyFatoorah نقدر نوفر لكم ${fits[0]} بحيث العميل يدفع فوراً بدون تأخير أو تحويلات يدوية. من الشخص المسؤول عن المدفوعات أو الطلبات عندكم؟`,
    objectionToExpect: m.hasGateway ? 'They may say they already have a payment gateway. Ask about failed payments, Apple Pay, settlement, and payment links.' : 'They may ask about fees. Anchor on faster collection, less manual follow-up, and easier customer payment.',
  };
}

export function evaluateMerchantTruth(m: any): MerchantTruthResult {
  const rejectionReasons = hasNegativeContent(m);
  const evidence = buildEvidence(m);
  const buyingSignals = detectBuyingSignals(m);
  const scores = scoreMerchant(m, evidence, buyingSignals, rejectionReasons);
  const acceptedReasons: string[] = [];
  const reviewReasons: string[] = [];

  const sources = sourceList(m);
  const sourceCount = uniq(sources).length;
  const hasContact = evidence.some(e => ['phone', 'email', 'instagram'].includes(e.field));
  const hasStrongProof = evidence.some(e => ['dulNumber', 'placeId', 'structuredData', 'address', 'domain'].includes(e.field) && e.strength === 'STRONG');
  const hasTwoIndependentProofs = sourceCount >= 2 || evidence.filter(e => e.strength === 'STRONG').length >= 2;

  if (hasContact) acceptedReasons.push('Reachable merchant contact found.');
  if (hasStrongProof) acceptedReasons.push('Strong merchant proof found.');
  if (buyingSignals.length) acceptedReasons.push('Payment buying signal detected.');
  if (hasTwoIndependentProofs) acceptedReasons.push('Two or more proof signals support the merchant identity.');

  if (!hasContact) reviewReasons.push('Needs at least one contact route before outreach.');
  if (!hasTwoIndependentProofs) reviewReasons.push('Needs another independent proof source before export.');
  if (!buyingSignals.length && scores.revenuePotentialScore < 60) reviewReasons.push('No clear payment pain or high-value buying signal yet.');

  let decision: TruthDecision;
  if (rejectionReasons.length && scores.finalSalesScore < 55) {
    decision = 'REJECT';
  } else if (scores.finalSalesScore >= 72 && hasContact && hasTwoIndependentProofs && rejectionReasons.length === 0) {
    decision = 'APPROVE';
  } else if (scores.finalSalesScore >= 50 && (hasContact || hasStrongProof) && rejectionReasons.length <= 1) {
    decision = 'REVIEW';
  } else {
    decision = 'REJECT';
  }

  const temperature = leadTemperature(scores.finalSalesScore, decision);
  const salesPlan = buildSalesPlan(m, decision, temperature, buyingSignals);

  return {
    decision,
    temperature,
    isSalesReady: decision === 'APPROVE',
    rejectionReasons,
    reviewReasons,
    acceptedReasons,
    evidence,
    buyingSignals,
    scores,
    salesPlan,
  };
}

export function applyMerchantTruth<T extends Record<string, any>>(merchant: T): T & { truth: MerchantTruthResult; salesReady: boolean; salesScore: number; salesTemperature: LeadTemperature; nextAction: string } {
  const truth = evaluateMerchantTruth(merchant);
  return {
    ...merchant,
    truth,
    salesReady: truth.isSalesReady,
    salesScore: truth.scores.finalSalesScore,
    salesTemperature: truth.temperature,
    nextAction: truth.salesPlan.nextAction,
  };
}

export function filterSalesReady<T extends Record<string, any>>(merchants: T[], options?: { includeReview?: boolean; minScore?: number }): Array<T & { truth: MerchantTruthResult; salesReady: boolean; salesScore: number; salesTemperature: LeadTemperature; nextAction: string }> {
  const includeReview = options?.includeReview ?? false;
  const minScore = options?.minScore ?? 0;
  return merchants
    .map(applyMerchantTruth)
    .filter(m => m.salesScore >= minScore)
    .filter(m => m.truth.decision === 'APPROVE' || (includeReview && m.truth.decision === 'REVIEW'))
    .sort((a, b) => b.salesScore - a.salesScore);
}
