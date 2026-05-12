// tests/deepLinks.test.ts
import { buildWhatsAppUrl, buildMailtoUrl, normalizeUaePhone } from '../server/templates/deepLinks';

describe('normalizeUaePhone', () => {
  test('handles 0501234567 (local 10-digit)', () => {
    expect(normalizeUaePhone('0501234567')).toBe('971501234567');
  });

  test('handles +971 50 123 4567 (international with spaces)', () => {
    expect(normalizeUaePhone('+971 50 123 4567')).toBe('971501234567');
  });

  test('handles 00971501234567 (intl with double-0 prefix)', () => {
    expect(normalizeUaePhone('00971501234567')).toBe('971501234567');
  });

  test('handles 971501234567 (already canonical)', () => {
    expect(normalizeUaePhone('971501234567')).toBe('971501234567');
  });

  test('handles 9-digit local-without-leading-0 (501234567)', () => {
    expect(normalizeUaePhone('501234567')).toBe('971501234567');
  });

  test('rejects empty / null', () => {
    expect(normalizeUaePhone('')).toBeNull();
    expect(normalizeUaePhone(null)).toBeNull();
    expect(normalizeUaePhone(undefined)).toBeNull();
  });

  test('rejects too-short numbers', () => {
    expect(normalizeUaePhone('123')).toBeNull();
  });

  test('rejects clearly-invalid garbage', () => {
    expect(normalizeUaePhone('abcdefg')).toBeNull();
  });
});

describe('buildWhatsAppUrl', () => {
  test('returns wa.me URL with URL-encoded body', () => {
    const url = buildWhatsAppUrl('0501234567', 'Hello + welcome!');
    expect(url).toBe('https://wa.me/971501234567?text=Hello%20%2B%20welcome!');
  });

  test('returns null when phone is missing', () => {
    expect(buildWhatsAppUrl(null, 'hi')).toBeNull();
    expect(buildWhatsAppUrl('', 'hi')).toBeNull();
  });

  test('returns null on unparseable phone', () => {
    expect(buildWhatsAppUrl('xxx', 'hi')).toBeNull();
  });

  test('truncates extremely long bodies to keep URL under wa.me cap', () => {
    const huge = 'x'.repeat(20_000);
    const url = buildWhatsAppUrl('0501234567', huge);
    expect(url).toBeTruthy();
    // wa.me URL = base 26 chars + encoded payload (x stays 1:1 so we know exact length)
    const encoded = url!.split('?text=')[1];
    expect(encoded.length).toBeLessThanOrEqual(5000);
  });
});

describe('buildMailtoUrl', () => {
  test('returns mailto with encoded subject and body', () => {
    const url = buildMailtoUrl('foo@bar.com', 'Hello — proposal', 'Line 1\nLine 2');
    expect(url).toBe('mailto:foo@bar.com?subject=Hello%20%E2%80%94%20proposal&body=Line%201%0ALine%202');
  });

  test('returns null when email is missing or invalid', () => {
    expect(buildMailtoUrl(null, 's', 'b')).toBeNull();
    expect(buildMailtoUrl('', 's', 'b')).toBeNull();
    expect(buildMailtoUrl('not-an-email', 's', 'b')).toBeNull();
    expect(buildMailtoUrl('foo@bar', 's', 'b')).toBeNull();
  });
});
