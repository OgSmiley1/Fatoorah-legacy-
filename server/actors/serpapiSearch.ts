// server/actors/serpapiSearch.ts
// SerpApi — Google Search via JSON. Free tier: 100 searches/month.
// Cost-minimization measures:
//   1. Uses `google_light` engine (lower credit cost per call than `google`).
//   2. In-memory LRU cache (1-hour TTL, 200 entries) — repeated queries
//      within a session cost zero credits.
//   3. Soft monthly quota guard (default 100, override with
//      SERPAPI_MONTHLY_LIMIT). Stops calling once exhausted.
//
// Reads SERPAPI_API_KEY from env; falls back to embedded default.

import axios from 'axios';
import type { SearchResult } from '../searchParsers';
import { logger } from '../logger';

const DEFAULT_API_KEY =
  'ca511aa695f15ecd163387a13ca827526fdaac15ba850311fc6bed2db237d65f';

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

let monthlyCalls = 0;
const MONTHLY_LIMIT = Number(process.env.SERPAPI_MONTHLY_LIMIT || 100);

export function _resetSerpApiQuotaForTests(): void {
  monthlyCalls = 0;
  cache.clear();
}

export function getSerpApiUsage(): { used: number; limit: number } {
  return { used: monthlyCalls, limit: MONTHLY_LIMIT };
}

interface SerpApiOrganic {
  title?: string;
  link?: string;
  snippet?: string;
}

export function parseSerpApiResponse(raw: any): SearchResult[] {
  if (!raw || typeof raw !== 'object') return [];
  const organic: SerpApiOrganic[] = Array.isArray(raw.organic_results)
    ? raw.organic_results
    : [];
  const out: SearchResult[] = [];
  for (const r of organic) {
    const url = r.link;
    if (!url || !url.startsWith('http')) continue;
    out.push({
      url,
      title: r.title?.trim() || '',
      description: r.snippet?.trim() || '',
    });
    if (out.length >= 20) break;
  }
  return out;
}

export async function serpapiSearch(
  query: string,
  timeoutMs = 8000
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_API_KEY || DEFAULT_API_KEY;
  if (!apiKey) return [];

  const cached = cacheGet(query);
  if (cached) {
    logger.debug('serpapi_cache_hit', { query });
    return cached;
  }

  if (monthlyCalls >= MONTHLY_LIMIT) {
    logger.debug('serpapi_quota_exhausted', {
      used: monthlyCalls,
      limit: MONTHLY_LIMIT,
    });
    return [];
  }

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      timeout: timeoutMs,
      params: {
        engine: 'google_light',
        q: query,
        gl: 'ae',
        hl: 'en',
        location: 'United Arab Emirates',
        num: 20,
        api_key: apiKey,
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    monthlyCalls += 1;
    const parsed = parseSerpApiResponse(res.data);
    cacheSet(query, parsed);
    return parsed;
  } catch (e: any) {
    logger.debug('serpapi_search_failed', { query, error: e.message });
    return [];
  }
}
