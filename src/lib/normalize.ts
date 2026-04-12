// src/lib/normalize.ts
// Canonical normalization + deterministic ID generation
import { v5 as uuidv5 } from 'uuid';

// Stable RFC 4122 namespace UUID (DNS namespace — public constant)
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export function normalizeName(name: string): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s\-&]/g, '');
}

export function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '');
}

/** Build a stable string key that uniquely identifies a merchant entity */
export function canonicalKey(name: string, address = '', phone = ''): string {
  const n = normalizeName(name);
  const a = address.trim().toLowerCase().replace(/\s+/g, ' ');
  const p = normalizePhone(phone);
  return `${n}|${a}|${p}`;
}

/** Derive a deterministic UUID from the canonical key — same inputs → same ID always */
export function canonicalIdFromKey(key: string): string {
  return uuidv5(key, NAMESPACE);
}
