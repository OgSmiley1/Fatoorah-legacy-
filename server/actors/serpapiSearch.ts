// server/actors/serpapiSearch.ts
// SerpApi — Google Search via JSON.
// Production rules:
//   1. Never hardcode API keys.
//   2. Read SERPAPI_KEY first, then legacy SERPAPI_API_KEY.
//   3. Return [] when no key/quota/error so the full hunt never crashes.
//   4. Parse both organic results and local place results.
//   5. Cache repeated queries for 1 hour to protect free-tier credits.

import axios from 'axios';
import type { SearchResult } from '../searchParsers';
import { logger } from '../logger';

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

interface SerpApiLocalPlace {
  title?: string;
  type?: string;
  address?: string;
  phone?: string;
  place_id?: string;
  place_id_search?: string;
  rating?: number;
  reviews?: number;
  gps_coordinates?: { latitude?: number; longitude?: number };
}

export function parseSerpApiResponse(raw: any): SearchResult[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: SearchResult[] = [];

  const places: SerpApiLocalPlace[] = Array.isArray(raw.local_results?.places)
    ? raw.local_results.places
    : [];

  for (const p of places) {
    const title = p.title?.trim();
    if (!title) continue;
    const url = p.place_id_search || `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(title)}`;
    const parts = [
      p.type,
      p.address,
      p.phone,
      p.rating ? `rating ${p.rating}` : '',
      p.reviews ? `${p.reviews} reviews` : '',
      p.gps_coordinates?.latitude && p.gps_coordinates?.longitude
        ? `gps ${p.gps_coordinates.latitude},${p.gps_coordinates.longitude}`
        : '',
      p.place_id ? `place_id ${p.place_id}` : '',
    ].filter(Boolean);

    out.push({
      url,
      title,
      description: parts.join(' — '),
      businessName: title,
      category: p.type,
      placeId: p.place_id,
      phone: p.phone,
      physicalAddress: p.address,
    } as any);
  }

  const organic: SerpApiOrganic[] = Array.isArray(raw.organic_results)
    ? raw.organic_results
    : [];
  for (const r of organic) {
    const url = r.link;
    if (!url || !url.startsWith('http')) continue;
    out.push({
      url,
      title: r.title?.trim() || '',
      description: r.snippet?.trim() || '',
    });
    if (out.length >= 30) break;
  }

  return out;
}

export async function serpapiSearch(
  query: string,
  timeoutMs = 8000
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    logger.debug('serpapi_skipped_missing_key', { query });
    return [];
  }

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
        engine: 'google',
        q: query,
        location: 'Dubai, United Arab Emirates',
        google_domain: 'google.com',
        gl: 'ae',
        hl: 'en',
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
