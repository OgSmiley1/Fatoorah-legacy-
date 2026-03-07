import { getAllNormalizedFields, logDedupMatch } from './database.js';
import { logger } from './logger.js';

// ─── Normalization functions ───

export function normalizeBusinessName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
}

export function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

export function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 9) {
    return '+971' + digits.slice(-9);
  }
  return digits.length > 0 ? '+' + digits : '';
}

export function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.toLowerCase().trim();
}

export function normalizeDomain(url: string): string {
  if (!url) return '';
  let domain = url.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];

  // Extract root domain (e.g., shop.mybrand.com → mybrand.com)
  const parts = domain.split('.');
  if (parts.length > 2) {
    domain = parts.slice(-2).join('.');
  }
  return domain;
}

export function normalizeHandle(handle: string): string {
  if (!handle) return '';
  return handle.toLowerCase().trim().replace(/^@/, '');
}

export function generateMerchantHash(merchant: {
  businessName?: string;
  business_name?: string;
  url?: string;
  phone?: string;
  instagramHandle?: string;
  instagram_handle?: string;
  tradeLicense?: string;
  trade_license?: string;
}): string {
  const name = normalizeBusinessName(merchant.businessName || merchant.business_name || '');
  const url = normalizeUrl(merchant.url || '');
  const phone = normalizePhone(merchant.phone || '');
  const insta = normalizeHandle(merchant.instagramHandle || merchant.instagram_handle || '');
  const license = (merchant.tradeLicense || merchant.trade_license || '').toUpperCase().trim();
  return `${name}|${url}|${phone}|${insta}|${license}`;
}

// ─── Fuzzy matching ───

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function isFuzzyMatch(a: string, b: string, maxDistance: number = 2): boolean {
  if (!a || !b || a.length < 5 || b.length < 5) return false;
  return levenshteinDistance(a, b) <= maxDistance;
}

// ─── Dedup engine ───

export interface DedupResult {
  isDuplicate: boolean;
  reason?: string;
  matchedId?: string;
  detail?: string;
}

export function checkDuplicate(
  merchant: {
    id: string;
    normalized_name: string;
    normalized_phone?: string;
    normalized_email?: string;
    normalized_domain?: string;
    normalized_instagram?: string;
    normalized_tiktok?: string;
    normalized_url?: string;
    maps_place_id?: string;
  },
  existingFields: ReturnType<typeof getAllNormalizedFields>
): DedupResult {
  // Layer 1: Exact hash match
  if (existingFields.hashes.has(merchant.id)) {
    return { isDuplicate: true, reason: 'hash', matchedId: merchant.id, detail: 'Exact hash match' };
  }

  // Layer 2: Maps Place ID (strongest signal)
  if (merchant.maps_place_id && existingFields.mapsIds.has(merchant.maps_place_id)) {
    return { isDuplicate: true, reason: 'maps_place_id', detail: merchant.maps_place_id };
  }

  // Layer 3: Exact normalized field matches
  if (merchant.normalized_phone && existingFields.phones.has(merchant.normalized_phone)) {
    return { isDuplicate: true, reason: 'phone', detail: merchant.normalized_phone };
  }
  if (merchant.normalized_email && existingFields.emails.has(merchant.normalized_email)) {
    return { isDuplicate: true, reason: 'email', detail: merchant.normalized_email };
  }
  if (merchant.normalized_instagram && existingFields.instagrams.has(merchant.normalized_instagram)) {
    return { isDuplicate: true, reason: 'instagram', detail: merchant.normalized_instagram };
  }
  if (merchant.normalized_tiktok && existingFields.tiktoks.has(merchant.normalized_tiktok)) {
    return { isDuplicate: true, reason: 'tiktok', detail: merchant.normalized_tiktok };
  }
  if (merchant.normalized_domain && existingFields.domains.has(merchant.normalized_domain)) {
    return { isDuplicate: true, reason: 'domain', detail: merchant.normalized_domain };
  }

  // Layer 4: Exact name match
  if (merchant.normalized_name && existingFields.names.has(merchant.normalized_name)) {
    return { isDuplicate: true, reason: 'name', detail: merchant.normalized_name };
  }

  // Layer 5: Fuzzy name match
  for (const existingName of existingFields.names) {
    if (isFuzzyMatch(merchant.normalized_name, existingName)) {
      return { isDuplicate: true, reason: 'fuzzy_name', detail: `${merchant.normalized_name} ≈ ${existingName}` };
    }
  }

  // Layer 6: Composite fingerprint (2+ fields match)
  let matchCount = 0;
  if (merchant.normalized_url && existingFields.urls.has(merchant.normalized_url)) matchCount++;
  if (merchant.normalized_name && existingFields.names.has(merchant.normalized_name)) matchCount++;
  if (matchCount >= 2) {
    return { isDuplicate: true, reason: 'composite', detail: `${matchCount} fields matched` };
  }

  return { isDuplicate: false };
}

export function deduplicateBatch(
  merchants: any[],
  searchRunId: string
): { unique: any[]; duplicates: number; reasons: Record<string, number> } {
  const existingFields = getAllNormalizedFields();
  const batchSeen = new Map<string, boolean>();
  const unique: any[] = [];
  let duplicates = 0;
  const reasons: Record<string, number> = {};

  for (const m of merchants) {
    const normName = normalizeBusinessName(m.businessName || m.business_name || '');
    const normPhone = normalizePhone(m.phone || '');
    const normEmail = normalizeEmail(m.email || '');
    const normDomain = normalizeDomain(m.website || m.url || '');
    const normInsta = normalizeHandle(m.instagramHandle || m.instagram_handle || '');
    const normTiktok = normalizeHandle(m.tiktokHandle || m.tiktok_handle || '');
    const normUrl = normalizeUrl(m.url || '');
    const hash = generateMerchantHash(m);

    // Within-batch dedup
    if (batchSeen.has(hash)) {
      duplicates++;
      reasons['batch_duplicate'] = (reasons['batch_duplicate'] || 0) + 1;
      continue;
    }
    batchSeen.set(hash, true);

    // Cross-session dedup
    const result = checkDuplicate(
      {
        id: hash,
        normalized_name: normName,
        normalized_phone: normPhone,
        normalized_email: normEmail,
        normalized_domain: normDomain,
        normalized_instagram: normInsta,
        normalized_tiktok: normTiktok,
        normalized_url: normUrl,
        maps_place_id: m.mapsPlaceId || m.maps_place_id,
      },
      existingFields
    );

    if (result.isDuplicate) {
      duplicates++;
      const reason = result.reason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
      logDedupMatch(searchRunId, m.businessName || m.business_name || '', result.matchedId || '', reason, result.detail);
      logger.info('dedup.rejected', { name: m.businessName || m.business_name, reason, detail: result.detail });
    } else {
      // Attach normalized fields for storage
      m._normalized = {
        hash,
        name: normName,
        phone: normPhone,
        email: normEmail,
        domain: normDomain,
        instagram: normInsta,
        tiktok: normTiktok,
        url: normUrl,
      };
      unique.push(m);

      // Add to existingFields so subsequent items in this batch also dedup against earlier items
      existingFields.hashes.add(hash);
      if (normName) existingFields.names.add(normName);
      if (normPhone) existingFields.phones.add(normPhone);
      if (normEmail) existingFields.emails.add(normEmail);
      if (normDomain) existingFields.domains.add(normDomain);
      if (normInsta) existingFields.instagrams.add(normInsta);
      if (normTiktok) existingFields.tiktoks.add(normTiktok);
      if (normUrl) existingFields.urls.add(normUrl);
    }
  }

  logger.info('dedup.completed', { total: merchants.length, unique: unique.length, duplicates, reasons });
  return { unique, duplicates, reasons };
}
