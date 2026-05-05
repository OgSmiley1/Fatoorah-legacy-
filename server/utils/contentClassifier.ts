// server/utils/contentClassifier.ts
//
// Classify a raw search result so the hunt pipeline knows whether the URL
// is a real merchant signal, a seed (article/post that may *contain* a
// merchant entity), or pure noise (scam pages, payment industry news,
// freezone taxonomy, etc.) that must be hard-rejected.

import type { ContentType } from './leadFirewall';

export interface RawSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  sourceEngine?: string;
  placeId?: string;
  phone?: string;
  address?: string;
  website?: string;
}

function combined(raw: RawSearchResult): string {
  return [raw.title, raw.url, raw.snippet].filter(Boolean).join(' ').toLowerCase();
}

export function classifyContent(raw: RawSearchResult): ContentType {
  const text = combined(raw);
  const url = String(raw.url || '').toLowerCase();
  const title = String(raw.title || '');

  // 1. Free-zone taxonomy / activity lists — never a merchant
  if (
    /meydanfz\.ae\/business-activities-list/i.test(url) ||
    /\/activities[-_/]list/i.test(url) ||
    text.includes('business activities list') ||
    text.includes('list of business activities')
  ) {
    return 'freezone_taxonomy';
  }

  // 2. Scam warnings — never a merchant
  if (
    /\bscam(s|mer|ming)?\b|\bfraud\b|\bfake\s+(manager|cheque|invoice)\b|deceive|protect your personal|loses?\s+dh|return money to scammers|never return money/i.test(
      text
    )
  ) {
    return 'scam_warning';
  }

  // 3. Payment industry / fintech news — never a merchant
  if (
    /\b(visa|mastercard|aani)\b\s+(announces|launches|partners|unveils|tops|reveals)/i.test(text) ||
    /instant payments?\s+(uae|launch|reach)/i.test(text) ||
    /move\s+towards\s+safe\s+digital\s+payment/i.test(text) ||
    /\bcentral bank of (uae|the uae)\b/i.test(text) ||
    /\b(payment processor|payment gateway provider|fintech (company|startup)|embedded finance)\b/i.test(text)
  ) {
    return 'payment_industry_content';
  }

  // 4. Government registry — strong direct merchant signal
  if (
    /investindubai\.gov\.ae/i.test(url) ||
    /meydanfz\.ae\/(directory|company|business)/i.test(url) ||
    /\b(dul|trade license)\b/i.test(text) && /investindubai|meydanfz|dubai economy/i.test(url)
  ) {
    return 'government_registry';
  }

  // 5. Social *post* (specific URL pattern) — seed only
  if (
    /\/p\/|\/reel\/|\/posts\/|\/photo\/|\/video\/|\/status\/|\/share\//i.test(url) &&
    /(instagram|facebook|tiktok|twitter|x)\.com/i.test(url)
  ) {
    return 'social_post_seed';
  }

  // 6. Social *profile* — direct merchant signal (handle is the entity)
  if (
    /(instagram|facebook|tiktok|linkedin)\.com\/[a-zA-Z0-9._-]+\/?$/i.test(url) ||
    /(instagram|facebook|tiktok)\.com\/@[a-zA-Z0-9._-]+/i.test(url)
  ) {
    return 'merchant_profile';
  }

  // 7. Directory / "top N" listicles — seed
  if (
    /^top\s+\d+/i.test(title) ||
    /\bbest\b.*\b(companies|services|businesses|shops|stores|suppliers|restaurants|cafes|salons)\b/i.test(text) ||
    /\b(directory|list of|near me|reviews)\b/i.test(text)
  ) {
    return 'directory_seed';
  }

  // 8. Blog / news / how-to — seed (a real merchant might be mentioned inside)
  if (
    /\b(how to|what is|why you|guide|process|required documents|blog|news article|press release|announces|partners with|supporting small local businesses)\b/i.test(
      text
    ) ||
    /khaleejtimes|gulfnews|thenationalnews|arabianbusiness/i.test(url)
  ) {
    return 'article_seed';
  }

  // 9. Maps place — direct merchant signal
  if (raw.placeId || (raw.address && raw.address.length > 5)) {
    return 'maps_place';
  }

  // 10. Looks like a merchant website (has a business-y term in title/content)
  if (
    /\b(llc|fze|fzc|trading|restaurant|cafe|cafeteria|salon|spa|shop|store|boutique|services|atelier|studio|company)\b/i.test(
      text
    )
  ) {
    return 'merchant_website';
  }

  // 11. Default for unknown — treat as advertisement seed (need to extract entity)
  return 'advertisement_seed';
}
