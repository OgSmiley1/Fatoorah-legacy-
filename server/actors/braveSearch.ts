// server/actors/braveSearch.ts
// Brave Search HTML endpoint — keyless, low-block-rate, independent index.
// Pure parser exported for unit tests; fetcher uses axios with UA rotation.

import axios from 'axios';
import { decodeHtml, stripTags } from '../searchParsers';
import type { SearchResult } from '../searchParsers';

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

// Brave renders results in <div class="snippet ..." data-type="web">
// containing <a class="heading-serpresult" href=URL> and <div class="snippet-description">
export function parseBraveHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const re =
    /<a[^>]+class="[^"]*(?:heading-serpresult|result-header)[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]+class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href || !href.startsWith('http')) continue;
    results.push({
      url: href,
      title: decodeHtml(stripTags(m[2])).trim(),
      description: decodeHtml(stripTags(m[3])).trim(),
    });
    if (results.length >= 20) break;
  }
  return results;
}

export async function braveSearch(query: string, timeoutMs = 8000): Promise<SearchResult[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': UAS[Math.floor(Math.random() * UAS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      maxRedirects: 3,
      validateStatus: (s) => s >= 200 && s < 400,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return typeof res.data === 'string' ? parseBraveHtml(res.data) : [];
  } catch {
    return [];
  }
}
