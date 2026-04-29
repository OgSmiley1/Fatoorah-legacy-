// tests/dedupCanonical.test.ts
// Canonical-id derivation must be deterministic and case/whitespace-insensitive
// so two hunts that surface the same merchant collapse onto one row.
import { merchantCanonicalId } from '../server/dedupService';

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
