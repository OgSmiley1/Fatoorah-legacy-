export type ContactConfidenceLevel = 'VERIFIED' | 'LIKELY' | 'WEAK' | 'MISSING';
export type ContactabilityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface ContactConfidence {
  phone: ContactConfidenceLevel;
  whatsapp: ContactConfidenceLevel;
  email: ContactConfidenceLevel;
  instagram: ContactConfidenceLevel;
  overall: ContactabilityLevel;
}

export interface FitSignals {
  platform: string;
  codSignal: boolean;
  whatsappOrdering: boolean;
  noPaymentGateway: boolean;
  socialSelling: boolean;
  gccLocation: boolean;
  arabicBusiness: boolean;
  activePresence: boolean;
  score: number;
  rationale: string[];
}

interface MerchantInput {
  businessName?: string;
  platform?: string;
  evidence?: string[];
  phone?: string;
  whatsapp?: string;
  email?: string;
  instagramHandle?: string;
  website?: string;
  url?: string;
  location?: string;
}

export function computeFitScore(merchant: MerchantInput): FitSignals {
  let score = 0;
  const rationale: string[] = [];
  const snippet = ((merchant.evidence || []).join(' ') + ' ' + (merchant.businessName || '')).toLowerCase();
  const platform = merchant.platform || 'website';

  const codSignal = /cod|cash on delivery|الدفع عند الاستلام|دفع عند التوصيل/.test(snippet);
  if (codSignal) {
    score += 15;
    rationale.push('COD/cash-on-delivery signals detected');
  }

  const whatsappOrdering = /dm to order|واتساب|whatsapp.*order|order.*whatsapp|تواصل.*واتس|واتس.*طلب/.test(snippet);
  if (whatsappOrdering) {
    score += 15;
    rationale.push('WhatsApp/DM ordering signals');
  }

  const hasPaymentGateway = /stripe|paypal|tap|checkout\.com|myfatoorah|payment gateway|بوابة دفع/.test(snippet);
  const noPaymentGateway = !hasPaymentGateway;
  if (noPaymentGateway) {
    score += 10;
    rationale.push('No existing payment gateway detected');
  }

  const socialSelling = /shop|متجر|بيع|للبيع|for sale|prices|أسعار|تسوق|collection|new arrival/.test(snippet);
  if (socialSelling) {
    score += 10;
    rationale.push('Active social selling indicators');
  }

  const gccCountries = /kuwait|كويت|bahrain|بحرين|saudi|سعودي|uae|إمارات|dubai|دبي|qatar|قطر|oman|عمان|gcc|خليج/i;
  const gccLocation = gccCountries.test(snippet) || gccCountries.test(merchant.location || '');
  if (gccLocation) {
    score += 10;
    rationale.push('GCC location confirmed');
  }

  const arabicPattern = /[\u0600-\u06FF]/;
  const arabicBusiness = arabicPattern.test(merchant.businessName || '') || arabicPattern.test(snippet);
  if (arabicBusiness) {
    score += 5;
    rationale.push('Arabic-language business');
  }

  if (platform === 'instagram') { score += 15; rationale.push('Instagram presence (high social commerce)'); }
  else if (platform === 'tiktok') { score += 15; rationale.push('TikTok presence (viral commerce potential)'); }
  else if (platform === 'telegram') { score += 10; rationale.push('Telegram channel (direct selling)'); }
  else if (platform === 'facebook') { score += 8; rationale.push('Facebook presence'); }
  else if (platform === 'website') { score += 5; rationale.push('Has website'); }

  const activePresence = merchant.instagramHandle || merchant.url;
  if (activePresence) {
    score += 5;
    rationale.push('Active online presence');
  }

  score = Math.min(score, 100);

  return {
    platform,
    codSignal,
    whatsappOrdering,
    noPaymentGateway,
    socialSelling,
    gccLocation,
    arabicBusiness,
    activePresence: !!activePresence,
    score,
    rationale
  };
}

function normalizePhoneForComparison(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  return cleaned || null;
}

export function computeContactScore(m: MerchantInput): number {
  let score = 0;
  const phone = m.phone || null;
  const whatsapp = m.whatsapp || null;
  const email = m.email || null;
  const ig = m.instagramHandle || null;
  const website = m.website || null;

  if (phone) score += 30;

  const normPhone = normalizePhoneForComparison(phone);
  const normWhatsapp = normalizePhoneForComparison(whatsapp);

  if (whatsapp && normWhatsapp !== normPhone) {
    score += 20;
  } else if (whatsapp && normWhatsapp === normPhone) {
    score += 5;
  }

  if (email) score += 25;
  if (ig) score += 15;
  if (website) score += 10;

  return Math.min(score, 100);
}

export function computeContactConfidence(m: MerchantInput): ContactConfidence {
  const evidence = ((m.evidence || []).join(' ')).toLowerCase();

  function fieldConfidence(value: string | null | undefined, fieldName: string): ContactConfidenceLevel {
    if (!value) return 'MISSING';
    if (evidence.includes(value.toLowerCase())) return 'VERIFIED';
    if (value.length > 3) return 'LIKELY';
    return 'WEAK';
  }

  const phone = fieldConfidence(m.phone, 'phone');
  const whatsapp = fieldConfidence(m.whatsapp, 'whatsapp');
  const emailConf = fieldConfidence(m.email, 'email');
  const ig = fieldConfidence(m.instagramHandle, 'instagram');

  const levels = [phone, whatsapp, emailConf, ig];
  const verifiedCount = levels.filter(l => l === 'VERIFIED').length;
  const likelyCount = levels.filter(l => l === 'LIKELY').length;
  const missingCount = levels.filter(l => l === 'MISSING').length;

  let overall: ContactabilityLevel = 'NONE';
  if (verifiedCount >= 2 || (verifiedCount >= 1 && likelyCount >= 1)) overall = 'HIGH';
  else if (verifiedCount >= 1 || likelyCount >= 2) overall = 'MEDIUM';
  else if (likelyCount >= 1 || levels.some(l => l === 'WEAK')) overall = 'LOW';

  return { phone, whatsapp, email: emailConf, instagram: ig, overall };
}

export function computeConfidence(m: MerchantInput): number {
  let score = 0;
  if (m.url) score += 40;
  if (m.evidence && m.evidence.length > 0) score += 30;
  if (m.phone || m.email) score += 30;
  return score;
}
