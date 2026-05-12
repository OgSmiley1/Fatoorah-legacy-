// server/templates/deepLinks.ts
// Pure helpers that produce click-ready wa.me / mailto: URLs from a merchant's
// raw phone or email. Both return null when the input can't form a valid link,
// which lets the UI greyscale the corresponding button cleanly.

const URL_ENCODE_MAX = 5000;

/**
 * Normalize a UAE-style phone to wa.me's international, digits-only format.
 *
 * Accepts:
 *   "050 123 4567"     → "971501234567"
 *   "0501234567"       → "971501234567"
 *   "+971 50 123 4567" → "971501234567"
 *   "971 50 123 4567"  → "971501234567"
 *   "00971501234567"   → "971501234567"
 *
 * Returns null if the cleaned number doesn't look like a UAE mobile (5x prefix)
 * or landline. Conservative on purpose — wa.me silently 404s on bad numbers,
 * so we'd rather grey out the button than ship a broken link.
 */
export function normalizeUaePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('+')) s = s.slice(1);
  // 9-digit local (50xxxxxxx, 4xxxxxxx, ...) → prefix country code
  if (/^[0-9]{9}$/.test(s)) s = '971' + s;
  // 10-digit local with leading 0 (0501234567) → strip 0, prefix 971
  if (/^0[0-9]{9}$/.test(s)) s = '971' + s.slice(1);
  // 12-digit starting with 971 is what we want
  if (!/^971[0-9]{8,9}$/.test(s)) return null;
  return s;
}

export function buildWhatsAppUrl(phone: string | null | undefined, body: string): string | null {
  const num = normalizeUaePhone(phone);
  if (!num) return null;
  const text = body.length > URL_ENCODE_MAX ? body.slice(0, URL_ENCODE_MAX) : body;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function buildMailtoUrl(
  email: string | null | undefined,
  subject: string,
  body: string
): string | null {
  if (!email) return null;
  const cleaned = String(email).trim();
  if (!EMAIL_RE.test(cleaned)) return null;
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${cleaned}?${q}`;
}
