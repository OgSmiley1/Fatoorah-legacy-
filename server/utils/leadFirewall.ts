// server/utils/leadFirewall.ts
//
// Final firewall before anything becomes a Merchant.
// No result can reach MerchantCard, Pipeline, SQLite, Telegram, WhatsApp, or
// Excel unless evaluateLeadFirewall returns { allowed: true }.
//
// Search results, ads, posts, articles, directories, and captions are NOT
// merchants — they are only discovery evidence. A merchant is created only
// after a real business entity is extracted AND verified with merchant proof.

export type ContentType =
  | 'merchant_profile'
  | 'merchant_website'
  | 'maps_place'
  | 'government_registry'
  | 'advertisement_seed'
  | 'social_post_seed'
  | 'directory_seed'
  | 'article_seed'
  | 'payment_industry_content'
  | 'scam_warning'
  | 'freezone_taxonomy'
  | 'unknown';

export interface LeadFirewallInput {
  businessName?: string;
  title?: string;
  url?: string;
  snippet?: string;
  sourceEngine?: string;

  contentType?: ContentType;

  website?: string;
  instagramHandle?: string;
  facebookUrl?: string;
  tiktokHandle?: string;
  linkedinUrl?: string;

  phone?: string;
  whatsapp?: string;
  email?: string;
  physicalAddress?: string;

  herePlaceId?: string;
  mapsPlaceId?: string;
  dulNumber?: string;

  sourceCount?: number;
  evidence?: Array<{ title?: string; uri?: string; snippet?: string; type?: string }>;

  hasGateway?: boolean;
  isCOD?: boolean;

  extractionMode?: 'direct_merchant' | 'seed_promoted' | 'unknown';
}

export interface LeadFirewallDecision {
  allowed: boolean;
  proofScore: number;
  decision: 'ACCEPT' | 'REVIEW' | 'REJECT';
  reasons: string[];
  cleanBusinessName?: string;
}

const HARD_REJECT_CONTENT_TYPES = new Set<ContentType>([
  'payment_industry_content',
  'scam_warning',
  'freezone_taxonomy',
]);

const SEED_ONLY_CONTENT_TYPES = new Set<ContentType>([
  'advertisement_seed',
  'social_post_seed',
  'directory_seed',
  'article_seed',
]);

const BAD_NAME_PATTERNS = [
  /customs clearance/i,
  /required documents/i,
  /aani instant payments/i,
  /safe digital payment/i,
  /\bvisa\b/i,
  /\bmastercard\b/i,
  /used car scams/i,
  /\bscam\b/i,
  /\bfraud\b/i,
  /fake manager cheque/i,
  /never return money/i,
  /protect your personal/i,
  /these scams deceive/i,
  /^how should/i,
  /^if you want to order/i,
  /^location[:\s]/i,
  /send details here/i,
  /business activities list/i,
  /free zone/i,
  /company formation/i,
  /^top\s+\d+/i,
  /^best\s+/i,
  /\bdirectory\b/i,
  /\bguide\b/i,
  /\bblog\b/i,
  /\bnews\b/i,
  /press release/i,
  /partners with/i,
  /supporting small local businesses/i,
  /^embed\.js$/i,
];

const GENERIC_NAMES = new Set([
  'home', 'about', 'contact', 'shop', 'store', 'official', 'business',
  'services', 'products', 'post', 'reels', 'page', 'embed js',
  'khaleejtimes', 'visa', 'google', 'facebook', 'instagram', 'tiktok',
]);

function normalizeText(value?: string): string {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanBusinessName(value?: string): string {
  let name = normalizeText(value);

  // Strip social-post suffixes
  name = name.replace(/['’]s post$/i, '');
  name = name.replace(/\s+on\s+(Instagram|Facebook|TikTok|LinkedIn).*$/i, '');
  name = name.replace(/\s*-\s*(Instagram|Facebook|TikTok|LinkedIn).*$/i, '');

  // Cut at common separators
  name = name.split('|')[0];
  name = name.split('•')[0]; // bullet
  name = name.split(' - ')[0];

  // Strip leading @
  name = name.replace(/^@+/, '').trim();

  // Replace separators with spaces
  name = name
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Title case — avoid capitalising the letter after an apostrophe (Tom's → Tom's not Tom'S)
  return name.replace(/(?<!['''])\b\w/g, (c) => c.toUpperCase());
}

export function isBadBusinessName(name?: string): boolean {
  const clean = cleanBusinessName(name);
  const lower = clean.toLowerCase();

  if (!lower || lower.length < 3) return true;
  if (lower.length > 80) return true;
  if (/^\d+\/?$/.test(lower)) return true;
  if (/^\+?\d{7,15}$/.test(lower)) return true;
  if (GENERIC_NAMES.has(lower)) return true;

  return BAD_NAME_PATTERNS.some((pattern) => pattern.test(clean));
}

function hasValue(value: any): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function evaluateLeadFirewall(input: LeadFirewallInput): LeadFirewallDecision {
  const reasons: string[] = [];
  const cleanName = cleanBusinessName(input.businessName || input.title);

  // Hard rejects: content type that is never a merchant
  if (input.contentType && HARD_REJECT_CONTENT_TYPES.has(input.contentType)) {
    return {
      allowed: false,
      proofScore: 0,
      decision: 'REJECT',
      reasons: [`hard_reject_content_type:${input.contentType}`],
      cleanBusinessName: cleanName,
    };
  }

  // Reject if the name itself looks like an article/scam/generic
  if (isBadBusinessName(cleanName)) {
    return {
      allowed: false,
      proofScore: 0,
      decision: 'REJECT',
      reasons: ['bad_or_generic_business_name'],
      cleanBusinessName: cleanName,
    };
  }

  // Tally proof signals
  let proofScore = 0;

  if (input.contentType === 'maps_place') {
    proofScore += 45;
    reasons.push('maps_place_source');
  }

  if (input.contentType === 'government_registry') {
    proofScore += 50;
    reasons.push('government_registry_source');
  }

  if (input.contentType === 'merchant_website') {
    proofScore += 30;
    reasons.push('merchant_website_source');
  }

  if (input.contentType === 'merchant_profile') {
    proofScore += 25;
    reasons.push('merchant_profile_source');
  }

  if (hasValue(input.herePlaceId) || hasValue(input.mapsPlaceId)) {
    proofScore += 35;
    reasons.push('has_place_id');
  }

  if (hasValue(input.dulNumber)) {
    proofScore += 45;
    reasons.push('has_dul_trade_license');
  }

  if (hasValue(input.website)) {
    proofScore += 25;
    reasons.push('has_website');
  }

  if (
    hasValue(input.instagramHandle) ||
    hasValue(input.facebookUrl) ||
    hasValue(input.tiktokHandle) ||
    hasValue(input.linkedinUrl)
  ) {
    proofScore += 20;
    reasons.push('has_social_profile');
  }

  if (hasValue(input.phone) || hasValue(input.whatsapp)) {
    proofScore += 20;
    reasons.push('has_phone_or_whatsapp');
  }

  if (hasValue(input.email)) {
    proofScore += 10;
    reasons.push('has_email');
  }

  if (hasValue(input.physicalAddress)) {
    proofScore += 25;
    reasons.push('has_physical_address');
  }

  if ((input.sourceCount || 0) >= 3) {
    proofScore += 25;
    reasons.push('three_or_more_sources');
  } else if ((input.sourceCount || 0) >= 2) {
    proofScore += 15;
    reasons.push('two_sources');
  }

  if (Array.isArray(input.evidence) && input.evidence.length >= 2) {
    proofScore += 10;
    reasons.push('multiple_evidence_items');
  }

  // Seed origins need extra proof
  if (input.contentType && SEED_ONLY_CONTENT_TYPES.has(input.contentType)) {
    proofScore -= 20;
    reasons.push(`seed_origin_requires_extra_proof:${input.contentType}`);
  }

  if (input.extractionMode === 'seed_promoted') {
    proofScore -= 10;
    reasons.push('seed_promoted_requires_proof');
  }

  // Existing gateways are slightly less attractive (sales-side, not proof)
  if (input.hasGateway) {
    proofScore -= 5;
    reasons.push('has_existing_gateway');
  }

  proofScore = Math.max(0, Math.min(100, proofScore));

  if (proofScore >= 55) {
    return {
      allowed: true,
      proofScore,
      decision: proofScore >= 75 ? 'ACCEPT' : 'REVIEW',
      reasons,
      cleanBusinessName: cleanName,
    };
  }

  return {
    allowed: false,
    proofScore,
    decision: 'REJECT',
    reasons: [`insufficient_merchant_proof:${reasons.join('|')}`],
    cleanBusinessName: cleanName,
  };
}
