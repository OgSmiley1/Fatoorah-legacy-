// server/utils/seedEntityExtractor.ts
//
// When a search result is a seed (article, ad, social post, directory),
// it may *contain* a real business entity. This module extracts the
// possible business name and any contact info from the seed text.
//
// The output is then run through the lead firewall — a seed only becomes
// a merchant when the extracted entity has enough proof to clear it.

import type { RawSearchResult } from './contentClassifier';
import { cleanBusinessName, isBadBusinessName } from './leadFirewall';

export interface ExtractedSeedEntity {
  possibleBusinessName?: string;
  possibleWebsite?: string;
  possibleInstagramHandle?: string;
  possibleFacebookUrl?: string;
  possibleTiktokHandle?: string;
  possiblePhone?: string;
  possibleEmail?: string;
  confidence: number;
  reasons: string[];
}

function extractPhone(text: string): string {
  const match = text.match(/(?:\+971|00971|971|0)?[\s-]?\d[\d\s-]{7,14}\d/);
  return match?.[0]?.replace(/\s+/g, '') || '';
}

function extractEmail(text: string): string {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] || '';
}

function extractWebsite(text: string): string {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0] || '';
}

function extractInstagram(text: string): string {
  const urlMatch = text.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (urlMatch?.[1]) return urlMatch[1];

  const handleMatch = text.match(/@([a-zA-Z0-9._]{3,30})/);
  return handleMatch?.[1] || '';
}

function inferNameFromUrl(url?: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (host.includes('instagram.com') && parts[0] && parts[0] !== 'p' && parts[0] !== 'reel') {
      return cleanBusinessName(parts[0]);
    }
    if (host.includes('facebook.com') && parts[0] && parts[0] !== 'pages') {
      return cleanBusinessName(parts[0]);
    }
    if (host.includes('tiktok.com') && parts[0]) {
      return cleanBusinessName(parts[0].replace(/^@/, ''));
    }

    return cleanBusinessName(host.split('.')[0]);
  } catch {
    return '';
  }
}

export function extractSeedEntity(raw: RawSearchResult): ExtractedSeedEntity {
  const text = [raw.title, raw.url, raw.snippet].filter(Boolean).join(' ');
  const reasons: string[] = [];

  let confidence = 0;

  const patterns = [
    /at\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/i,
    /trust\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/i,
    /by\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/i,
    /from\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/i,
    /^([A-Z][A-Za-z0-9&'.\- ]{2,80})\s+on\s+(Instagram|Facebook|TikTok)/i,
    /^([A-Z][A-Za-z0-9&'.\- ]{2,80})\s+\|\s+/i,
  ];

  let possibleBusinessName = '';

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = cleanBusinessName(match[1]);
      if (!isBadBusinessName(name)) {
        possibleBusinessName = name;
        confidence += 30;
        reasons.push('business_name_extracted_from_pattern');
        break;
      }
    }
  }

  if (!possibleBusinessName) {
    const fromTitle = cleanBusinessName(raw.title || '');
    if (!isBadBusinessName(fromTitle)) {
      possibleBusinessName = fromTitle;
      confidence += 15;
      reasons.push('business_name_from_clean_title');
    }
  }

  if (!possibleBusinessName) {
    const fromUrl = inferNameFromUrl(raw.url);
    if (!isBadBusinessName(fromUrl)) {
      possibleBusinessName = fromUrl;
      confidence += 20;
      reasons.push('business_name_from_url');
    }
  }

  const possiblePhone = raw.phone || extractPhone(text);
  const possibleEmail = extractEmail(text);
  const possibleWebsite = raw.website || extractWebsite(text);
  const possibleInstagramHandle = extractInstagram(text);

  if (possiblePhone) { confidence += 20; reasons.push('phone_extracted'); }
  if (possibleEmail) { confidence += 10; reasons.push('email_extracted'); }
  if (possibleWebsite) { confidence += 15; reasons.push('website_extracted'); }
  if (possibleInstagramHandle) { confidence += 15; reasons.push('instagram_extracted'); }

  return {
    possibleBusinessName,
    possibleWebsite,
    possibleInstagramHandle,
    possiblePhone,
    possibleEmail,
    confidence: Math.max(0, Math.min(100, confidence)),
    reasons,
  };
}
