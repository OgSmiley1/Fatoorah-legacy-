// server/actors/emailVerifier.ts
// Verifies an email address by checking whether its domain has valid MX DNS records.
// Pure Node `dns` module — no third-party API, no key. Acts as a mailbox liveness
// pre-filter: an address on a domain without MX cannot receive mail at all.

import { promises as dns } from 'dns';

export type EmailDeliverability = 'deliverable' | 'risky' | 'invalid' | 'unknown';

export interface EmailVerification {
  email: string;
  domain: string | null;
  status: EmailDeliverability;
  mxHosts?: string[];
  reason?: string;
}

const EMAIL_FORMAT_RE = /^[a-z0-9._%+\-]+@([a-z0-9.\-]+\.[a-z]{2,})$/i;

// Well-known "public/free mailbox" domains — still deliverable, but lower trust
// for a business-lead context. We tag them as 'risky' so the UI can highlight.
const FREE_MAILBOX_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'aol.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com',
]);

export async function verifyEmail(email: string, timeoutMs = 4000): Promise<EmailVerification> {
  const cleaned = (email || '').trim().toLowerCase().replace(/^mailto:/, '');
  const m = cleaned.match(EMAIL_FORMAT_RE);
  if (!m) {
    return { email: cleaned, domain: null, status: 'invalid', reason: 'format' };
  }
  const domain = m[1];

  try {
    const resolve = dns.resolveMx(domain);
    const timer = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('dns_timeout')), timeoutMs)
    );
    const records = (await Promise.race([resolve, timer])) as { exchange: string; priority: number }[];
    if (!records || records.length === 0) {
      return { email: cleaned, domain, status: 'invalid', reason: 'no_mx' };
    }
    const mxHosts = records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange)
      .slice(0, 3);

    if (FREE_MAILBOX_DOMAINS.has(domain)) {
      return { email: cleaned, domain, status: 'risky', mxHosts, reason: 'public_mailbox' };
    }
    return { email: cleaned, domain, status: 'deliverable', mxHosts };
  } catch (e: any) {
    return {
      email: cleaned,
      domain,
      status: 'unknown',
      reason: e?.message?.includes('timeout') ? 'dns_timeout' : 'dns_error',
    };
  }
}
