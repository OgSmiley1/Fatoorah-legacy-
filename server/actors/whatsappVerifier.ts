// server/actors/whatsappVerifier.ts
// Checks whether a phone number is live on WhatsApp by fetching the public
// wa.me click-to-chat page and looking for the "invalid number" sentinel.
// No API, no credentials — just a public redirect page.
//
// Exported pure classifier (classifyWhatsappPage) is unit-testable; the fetcher
// (verifyWhatsApp) is what you call in production.

import axios from 'axios';

export type WhatsappStatus = 'live' | 'not_registered' | 'unknown';

export interface WhatsappVerification {
  number: string;
  status: WhatsappStatus;
  reason?: string;
}

// WhatsApp's public invalid-number page contains this phrase (English + Arabic variants).
const INVALID_SENTINELS: RegExp[] = [
  /phone number shared via url is invalid/i,
  /\brm number shared via url is invalid/i,
  /الرقم الذي تمت مشاركته غير صالح/i,
];

// Valid click-to-chat pages carry a Continue to Chat button + JSON bootstrap.
const VALID_SENTINELS: RegExp[] = [
  /continue to chat/i,
  /use whatsapp on your phone/i,
  /"isCountrySupported":\s*true/i,
];

export function classifyWhatsappPage(html: string): WhatsappStatus {
  if (!html || typeof html !== 'string') return 'unknown';
  for (const re of INVALID_SENTINELS) if (re.test(html)) return 'not_registered';
  for (const re of VALID_SENTINELS) if (re.test(html)) return 'live';
  return 'unknown';
}

function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

export async function verifyWhatsApp(
  rawNumber: string,
  timeoutMs = 5000
): Promise<WhatsappVerification> {
  const number = digitsOnly(rawNumber);
  if (number.length < 8) {
    return { number, status: 'unknown', reason: 'too_short' };
  }

  const url = `https://wa.me/${number}`;
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (res.status >= 400) {
      return { number, status: 'unknown', reason: `http_${res.status}` };
    }
    const html = typeof res.data === 'string' ? res.data : '';
    return { number, status: classifyWhatsappPage(html) };
  } catch (e: any) {
    return { number, status: 'unknown', reason: e?.message || 'network_error' };
  }
}
