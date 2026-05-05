// tests/dedupCanonical.test.ts
// Canonical-id derivation must be deterministic and case/whitespace-insensitive
// so two hunts that surface the same merchant collapse onto one row.
import { merchantCanonicalId, normalizePhone } from '../server/dedupService';

describe('merchantCanonicalId', () => {
  test('same merchant → same id, regardless of casing/whitespace', () => {
    const a = merchantCanonicalId({
      businessName: 'Al Rashid Boutique',
      physicalAddress: 'Sheikh Zayed Rd, Dubai',
      phone: '+971 50 123 4567',
    });
    const b = merchantCanonicalId({
      businessName: '  AL RASHID  Boutique ',
      physicalAddress: 'sheikh zayed rd, dubai',
      phone: '+971-50-123-4567',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('different phones → different ids', () => {
    const a = merchantCanonicalId({
      businessName: 'Same Name',
      physicalAddress: 'Same Address',
      phone: '+971501111111',
    });
    const b = merchantCanonicalId({
      businessName: 'Same Name',
      physicalAddress: 'Same Address',
      phone: '+971502222222',
    });
    expect(a).not.toBe(b);
  });

  test('missing phone/address still produces a stable id from name alone', () => {
    const a = merchantCanonicalId({ businessName: 'Solo Brand' });
    const b = merchantCanonicalId({ businessName: 'Solo Brand' });
    expect(a).toBe(b);
  });
});

describe('dedupService.normalizePhone (UAE local → E.164)', () => {
  test('UAE local 05xxxxxxxx becomes +97105xxxxxxxx (removes leading 0, adds country code)', () => {
    expect(normalizePhone('0501234567')).toBe('+971501234567');
    expect(normalizePhone('050 123 4567')).toBe('+971501234567');
    expect(normalizePhone('050-123-4567')).toBe('+971501234567');
  });

  test('971 prefix (no +) becomes +971', () => {
    expect(normalizePhone('971501234567')).toBe('+971501234567');
  });

  test('00971 prefix becomes +971', () => {
    expect(normalizePhone('00971501234567')).toBe('+971501234567');
  });

  test('already E.164 passes through unchanged', () => {
    expect(normalizePhone('+971501234567')).toBe('+971501234567');
  });

  test('returns null for empty or too-short input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });

  test('same real number in different formats normalises to the same value', () => {
    const formats = ['0501234567', '+971501234567', '971501234567', '00971501234567', '050 123 4567'];
    const normalised = formats.map(normalizePhone);
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe('+971501234567');
  });
});
