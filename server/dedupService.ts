import db from '../db.ts';
import { canonicalKey, canonicalIdFromKey } from '../src/lib/normalize.ts';

export function normalizeName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Build the deterministic canonical UUIDv5 used as the cross-hunt dedup key. */
export function merchantCanonicalId(merchant: {
  businessName?: string;
  physicalAddress?: string | null;
  phone?: string | null;
}): string {
  return canonicalIdFromKey(
    canonicalKey(merchant.businessName || '', merchant.physicalAddress || '', merchant.phone || '')
  );
}

export function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (!cleaned || cleaned.length < 7) return null;
  // UAE local: 05xxxxxxxx → +97105xxxxxxxx
  if (/^05\d{8}$/.test(cleaned)) return `+971${cleaned.slice(1)}`;
  // UAE without country code: 971 + 9 digits
  if (/^971\d{9}$/.test(cleaned)) return `+${cleaned}`;
  // 00971 prefix
  if (/^00971\d{9}$/.test(cleaned)) return `+${cleaned.slice(2)}`;
  // Already E.164
  if (cleaned.startsWith('+')) return cleaned;
  return `+${cleaned}`;
}

export function normalizeEmail(email: string): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

export function normalizeHandle(handle: string): string | null {
  if (!handle) return null;
  return handle.toLowerCase().replace('@', '').trim();
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason: string | null;
  existingMerchantId?: string;
}

export function checkDuplicate(merchant: any): DuplicateCheckResult {
  const normalizedName = normalizeName(merchant.businessName);
  const phone = normalizePhone(merchant.phone);
  const email = normalizeEmail(merchant.email);
  const ig = normalizeHandle(merchant.instagramHandle);

  // Strongest signal first: deterministic canonical UUID derived from
  // (name, address, phone). Same inputs → same id, regardless of casing
  // or whitespace. Cheap O(1) index lookup.
  const canonicalId = merchantCanonicalId(merchant);
  const matchByCanonical = db.prepare('SELECT id FROM merchants WHERE canonical_id = ?').get(canonicalId) as any;
  if (matchByCanonical) return { isDuplicate: true, reason: 'matched_canonical_id', existingMerchantId: matchByCanonical.id };

  // Check by name
  const matchByName = db.prepare('SELECT id FROM merchants WHERE normalized_name = ?').get(normalizedName) as any;
  if (matchByName) return { isDuplicate: true, reason: 'matched_name', existingMerchantId: matchByName.id };

  // Check by phone
  if (phone) {
    const matchByPhone = db.prepare('SELECT id FROM merchants WHERE phone = ?').get(phone) as any;
    if (matchByPhone) return { isDuplicate: true, reason: 'matched_phone', existingMerchantId: matchByPhone.id };
  }

  // Check by email
  if (email) {
    const matchByEmail = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email) as any;
    if (matchByEmail) return { isDuplicate: true, reason: 'matched_email', existingMerchantId: matchByEmail.id };
  }

  // Check by IG
  if (ig) {
    const matchByIG = db.prepare('SELECT id FROM merchants WHERE instagram_handle = ?').get(ig) as any;
    if (matchByIG) return { isDuplicate: true, reason: 'matched_instagram', existingMerchantId: matchByIG.id };
  }

  return { isDuplicate: false, reason: null };
}
