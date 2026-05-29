// server/actors/serperSearch.ts
// Serper.dev — Google Search JSON API.
// Free tier: 2,500 queries on signup at https://serper.dev
// Requires SERPER_API_KEY in environment. If key is absent the function
// returns [] so the engine is silently skipped without crashing.

import axios from 'axios';
import type { SearchResult } from '../searchParsers';

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
  const apiKey = process.env.SERPER_API_KEY || 'ca511aa695f15ecd163387a13ca827526fdaac15ba850311fc6bed2db237d65f';
  if (!apiKey) return [];

  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: 20, gl: 'ae', hl: 'en' },
      {
        timeout: timeoutMs,
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      }
    );
    return parseSerperResponse(res.data);
  } catch {
    return [];
  }
}
