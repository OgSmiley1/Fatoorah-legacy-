import db from '../db';

export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[\u0600-\u06FF]/g, (ch) => ch)
    .replace(/[^a-z0-9\u0600-\u06FF]/g, '')
    .trim();
}

export function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

export function normalizeEmail(email: string): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

export function normalizeHandle(handle: string): string | null {
  if (!handle) return null;
  return handle.toLowerCase().replace('@', '').trim();
}

export function normalizeDomain(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return (1 - dist / maxLen) * 100;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason: string | null;
  existingMerchantId?: string;
}

interface MerchantCandidate {
  businessName?: string;
  phone?: string;
  email?: string;
  instagramHandle?: string;
  url?: string;
  website?: string;
}

interface DbIdRow { id: string }
interface DbMerchantUrlRow { id: string; source_url: string | null; website: string | null }
interface DbMerchantNameRow { id: string; normalized_name: string; business_name: string }

export function checkDuplicate(merchant: MerchantCandidate): DuplicateCheckResult {
  const normalizedName = normalizeName(merchant.businessName || '');
  const phone = normalizePhone(merchant.phone || '');
  const email = normalizeEmail(merchant.email || '');
  const ig = normalizeHandle(merchant.instagramHandle || '');
  const domain = normalizeDomain(merchant.url || merchant.website || '');
  const sourceUrl = merchant.url || null;

  if (normalizedName) {
    const matchByName = db.prepare('SELECT id FROM merchants WHERE normalized_name = ?').get(normalizedName) as DbIdRow | undefined;
    if (matchByName) return { isDuplicate: true, reason: `exact_name_match: "${merchant.businessName}"`, existingMerchantId: matchByName.id };
  }

  if (phone) {
    const matchByPhone = db.prepare('SELECT id FROM merchants WHERE phone = ?').get(phone) as DbIdRow | undefined;
    if (matchByPhone) return { isDuplicate: true, reason: `matched_phone: ${phone}`, existingMerchantId: matchByPhone.id };
  }

  if (email) {
    const matchByEmail = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email) as DbIdRow | undefined;
    if (matchByEmail) return { isDuplicate: true, reason: `matched_email: ${email}`, existingMerchantId: matchByEmail.id };
  }

  if (ig) {
    const matchByIG = db.prepare('SELECT id FROM merchants WHERE instagram_handle = ?').get(ig) as DbIdRow | undefined;
    if (matchByIG) return { isDuplicate: true, reason: `matched_instagram: @${ig}`, existingMerchantId: matchByIG.id };
  }

  if (sourceUrl) {
    const matchByUrl = db.prepare('SELECT id FROM merchants WHERE source_url = ?').get(sourceUrl) as DbIdRow | undefined;
    if (matchByUrl) return { isDuplicate: true, reason: `matched_source_url: ${sourceUrl}`, existingMerchantId: matchByUrl.id };
  }

  const socialPlatformDomains = new Set([
    'instagram.com', 'facebook.com', 'tiktok.com', 't.me', 'twitter.com',
    'x.com', 'youtube.com', 'linkedin.com', 'snapchat.com', 'threads.net'
  ]);
  
  if (domain && !socialPlatformDomains.has(domain)) {
    const allMerchants = db.prepare('SELECT id, source_url, website FROM merchants').all() as DbMerchantUrlRow[];
    for (const existing of allMerchants) {
      const existingDomain = normalizeDomain(existing.source_url || existing.website || '');
      if (existingDomain && existingDomain === domain && !socialPlatformDomains.has(existingDomain)) {
        return { isDuplicate: true, reason: `matched_domain: ${domain}`, existingMerchantId: existing.id };
      }
    }
  }

  if (normalizedName && normalizedName.length >= 4) {
    const candidates = db.prepare('SELECT id, normalized_name, business_name FROM merchants').all() as DbMerchantNameRow[];
    for (const candidate of candidates) {
      const similarity = nameSimilarity(normalizedName, candidate.normalized_name);
      if (similarity >= 85) {
        return { isDuplicate: true, reason: `fuzzy_name_match (${similarity.toFixed(0)}%): "${candidate.business_name}"`, existingMerchantId: candidate.id };
      }
    }
  }

  return { isDuplicate: false, reason: null };
}
