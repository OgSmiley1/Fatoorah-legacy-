// server/verificationService.ts
// Cross-source consensus + verification. Pure logic, no network, no DB.
//
// The rule: a lead is only emitted as VERIFIED when at least N independent
// sources (search engines / directories / social profiles) agree on the same
// identity. Identity is keyed on normalized phone, normalized Instagram handle,
// normalized email, or normalized domain — in that priority order.
//
// This is the same mental model Apify users get when they stack multiple actors
// against each other and keep only the rows that survive all of them.

export type SourceLabel =
  | 'ddg'
  | 'bing'
  | 'ddg-lib'
  | 'brave'
  | 'startpage'
  | 'mojeek'
  | 'searx'
  | 'nominatim'
  | 'invest-in-dubai'
  | 'website'
  | 'json-ld'
  | 'instagram'
  | 'dns-mx'
  | 'whatsapp-live';

export interface RawLead {
  businessName?: string | null;
  url?: string | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  instagramHandle?: string | null;
  source: SourceLabel;
  raw?: any;
}

export type VerifiedStatus = 'VERIFIED' | 'LIKELY' | 'UNVERIFIED';

export interface ConsensusLead {
  identityKey: string;
  businessName: string;
  url?: string;
  website?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  instagramHandle?: string;
  sources: SourceLabel[];           // every distinct source that produced this identity
  agreementScore: number;           // count of distinct sources
  verifiedStatus: VerifiedStatus;
  rawContributions: RawLead[];
}

// --- normalizers ---

export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let digits = String(p).replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (!digits.startsWith('+')) {
    if (/^0\d{9}$/.test(digits)) digits = '+971' + digits.slice(1);       // 0XXXXXXXXX local UAE
    else if (/^971\d{8,9}$/.test(digits)) digits = '+' + digits;          // 971-prefixed without +
    else if (/^5[02458]\d{7}$/.test(digits)) digits = '+971' + digits;    // bare UAE mobile (9 digits)
    else if (/^\d{9,12}$/.test(digits)) digits = '+' + digits;
  }
  if (digits.replace(/\D/g, '').length < 8) return null;
  return digits;
}

export function normalizeHandle(h: string | null | undefined): string | null {
  if (!h) return null;
  const clean = String(h).replace(/^@/, '').replace(/\/+$/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]+$/.test(clean)) return null;
  if (['p', 'reel', 'explore', 'stories', 'tr', 'sharer', 'plugins'].includes(clean)) return null;
  return clean;
}

export function normalizeEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const clean = String(e).trim().toLowerCase().replace(/^mailto:/, '');
  return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(clean) ? clean : null;
}

export function normalizeDomain(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`);
    return url.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

// Choose the strongest available identity in priority order
export function identityKey(lead: RawLead): string | null {
  const phone = normalizePhone(lead.phone) || normalizePhone(lead.whatsapp);
  if (phone) return `phone:${phone}`;
  const ig = normalizeHandle(lead.instagramHandle);
  if (ig) return `ig:${ig}`;
  const email = normalizeEmail(lead.email);
  if (email) return `email:${email}`;
  const domain = normalizeDomain(lead.website || lead.url);
  if (domain) return `domain:${domain}`;
  return null;
}

function statusFor(score: number): VerifiedStatus {
  if (score >= 3) return 'VERIFIED';
  if (score === 2) return 'LIKELY';
  return 'UNVERIFIED';
}

// Merge a list of raw leads from N sources into consensus-grouped leads.
// Leads without any resolvable identity are dropped (they can't be verified).
export function buildConsensus(raw: RawLead[]): ConsensusLead[] {
  const groups = new Map<string, ConsensusLead>();
  for (const lead of raw) {
    const key = identityKey(lead);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = {
        identityKey: key,
        businessName: lead.businessName || '',
        url: lead.url || undefined,
        website: lead.website || undefined,
        phone: normalizePhone(lead.phone) || undefined,
        whatsapp: normalizePhone(lead.whatsapp) || undefined,
        email: normalizeEmail(lead.email) || undefined,
        instagramHandle: normalizeHandle(lead.instagramHandle) || undefined,
        sources: [],
        agreementScore: 0,
        verifiedStatus: 'UNVERIFIED',
        rawContributions: [],
      };
      groups.set(key, g);
    }
    // Merge best-of fields
    if (!g.businessName && lead.businessName) g.businessName = lead.businessName;
    if (lead.businessName && lead.businessName.length > g.businessName.length) {
      g.businessName = lead.businessName;
    }
    if (!g.url && lead.url) g.url = lead.url;
    if (!g.website && lead.website) g.website = lead.website;
    if (!g.phone) g.phone = normalizePhone(lead.phone) || undefined;
    if (!g.whatsapp) g.whatsapp = normalizePhone(lead.whatsapp) || undefined;
    if (!g.email) g.email = normalizeEmail(lead.email) || undefined;
    if (!g.instagramHandle) g.instagramHandle = normalizeHandle(lead.instagramHandle) || undefined;
    if (!g.sources.includes(lead.source)) g.sources.push(lead.source);
    g.rawContributions.push(lead);
  }

  for (const g of groups.values()) {
    g.agreementScore = g.sources.length;
    g.verifiedStatus = statusFor(g.agreementScore);
  }

  // Sort: VERIFIED first, then LIKELY, then UNVERIFIED, by agreement score
  return Array.from(groups.values()).sort((a, b) => {
    if (a.verifiedStatus !== b.verifiedStatus) {
      const order = { VERIFIED: 0, LIKELY: 1, UNVERIFIED: 2 };
      return order[a.verifiedStatus] - order[b.verifiedStatus];
    }
    return b.agreementScore - a.agreementScore;
  });
}
