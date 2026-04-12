// tests/normalize.test.ts
import { normalizeName, normalizePhone, canonicalKey, canonicalIdFromKey } from '../src/lib/normalize';

test('normalizeName trims, lowercases, collapses spaces', () => {
  expect(normalizeName('  ACME Ltd. ')).toBe('acme ltd');
  expect(normalizeName('Al-Rashid & Sons')).toBe('al-rashid & sons');
  expect(normalizeName('')).toBe('');
});

test('normalizePhone strips formatting, keeps +', () => {
  expect(normalizePhone('+971 50-123-4567')).toBe('+971501234567');
  expect(normalizePhone('050 123 4567')).toBe('0501234567');
  expect(normalizePhone('')).toBe('');
});

test('canonicalKey is case-insensitive for name', () => {
  const k1 = canonicalKey('ACME', 'Main St', '+971501234567');
  const k2 = canonicalKey('acme', 'Main St', '+971501234567');
  expect(k1).toBe(k2);
});

test('canonicalIdFromKey is stable and deterministic', () => {
  const key = canonicalKey('Test Shop', 'Dubai', '+971501234567');
  const id1 = canonicalIdFromKey(key);
  const id2 = canonicalIdFromKey(key);
  expect(id1).toBe(id2);
  expect(id1).toMatch(/^[0-9a-f-]{36}$/);
});

test('different merchants get different canonical IDs', () => {
  const id1 = canonicalIdFromKey(canonicalKey('Shop A', 'Dubai', '+971501111111'));
  const id2 = canonicalIdFromKey(canonicalKey('Shop B', 'Dubai', '+971502222222'));
  expect(id1).not.toBe(id2);
});
