// server/actors/searxMetaSearch.ts
// Searx / SearxNG meta-search — aggregates Google/Bing/Yahoo/Qwant/etc. through
// public instances. Each instance returns JSON (format=json) with results from
// N engines; we iterate a rotating list of public instances until one responds.
// Fully keyless.

import axios from 'axios';
import type { SearchResult } from '../searchParsers';
import { logger } from '../logger';

// Rotating pool of public SearxNG instances — ordered by historical reliability.
// If one rate-limits or is down, the next is tried. No auth required.
const SEARX_INSTANCES = [
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://northboot.xyz',
  'https://searx.oloke.xyz',
  'https://priv.au',
];

// Pure parser — turns a Searx JSON response into SearchResult[]
export function parseSearxJson(raw: any): SearchResult[] {
  if (!raw || !Array.isArray(raw.results)) return [];
  const out: SearchResult[] = [];
  for (const r of raw.results) {
    if (!r || typeof r !== 'object') continue;
    const url = typeof r.url === 'string' ? r.url : '';
    if (!url.startsWith('http')) continue;
    const content = typeof r.content === 'string' ? r.content.trim() : '';
    const prettyUrl = typeof r.pretty_url === 'string' ? r.pretty_url : '';
    out.push({
      url,
      title: typeof r.title === 'string' ? r.title.trim() : '',
      description: content || prettyUrl,
    });
    if (out.length >= 25) break;
  }
  return out;
}

export async function searxSearch(query: string, timeoutMs = 8000): Promise<SearchResult[]> {
  // Shuffle so we spread load and don't always hammer the same instance first
  const shuffled = [...SEARX_INSTANCES].sort(() => Math.random() - 0.5);
  for (const base of shuffled.slice(0, 3)) {
    try {
      const res = await axios.get(`${base}/search`, {
        timeout: timeoutMs,
        params: {
          q: query,
          format: 'json',
          safesearch: 0,
          categories: 'general',
        },
        headers: {
          'User-Agent': 'FatoorahHunter/1.0 (+https://github.com/OgSmiley1/Fatoorah-legacy-)',
          Accept: 'application/json',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const parsed = parseSearxJson(res.data);
      if (parsed.length) {
        logger.debug('searx_hit', { instance: base, count: parsed.length });
        return parsed;
      }
    } catch (e: any) {
      logger.debug('searx_instance_failed', { instance: base, error: e.message });
      continue;
    }
  }
  return [];
}
