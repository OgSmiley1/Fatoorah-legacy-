// server/actors/serperSearch.ts
// Serper.dev — Google Search JSON API.
// Free tier: 2,500 queries on signup at https://serper.dev
// Embedded fallback key; env var takes precedence if set.

import axios from 'axios';
import type { SearchResult } from '../searchParsers';

const DEFAULT_API_KEY = 'ca511aa695f15ecd163387a13ca827526fdaac15ba850311fc6bed2db237d65f';

interface CacheEntry {
  ts: number;
  results: SearchResult[];
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;

function cacheGet(key: string): SearchResult[] | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.results;
}

function cacheSet(key: string, results: SearchResult[]): void {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), results });
}

interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
}

export function parseSerperResponse(raw: any): SearchResult[] {
  if (!raw || typeof raw !== 'object') return [];
  const organic: SerperOrganic[] = Array.isArray(raw.organic) ? raw.organic : [];
  const results: SearchResult[] = [];
  for (const item of organic) {
    const url = item.link;
    if (!url || !url.startsWith('http')) continue;
    results.push({
      url,
      title: item.title?.trim() || '',
      description: item.snippet?.trim() || '',
    });
    if (results.length >= 20) break;
  }
  return results;
}

export async function serperSearch(
  query: string,
  timeoutMs = 8000
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY || DEFAULT_API_KEY;

  const cached = cacheGet(query);
  if (cached) return cached;

  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: 20, gl: 'ae', hl: 'en', location: 'United Arab Emirates' },
      {
        timeout: timeoutMs,
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      }
    );
    const parsed = parseSerperResponse(res.data);
    cacheSet(query, parsed);
    return parsed;
  } catch {
    return [];
  }
}
