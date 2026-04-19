// server/actors/startpageSearch.ts
// Startpage HTML endpoint — keyless, Google-backed results through a privacy proxy.
// Different block profile than DDG/Bing, useful for cross-source agreement.

import axios from 'axios';
import { decodeHtml, stripTags } from '../searchParsers';
import type { SearchResult } from '../searchParsers';

// Startpage's HTML result card:
// <section class="w-gl__result ...">
//   <a class="w-gl__result-title result-link" href="URL">Title</a>
//   <p class="w-gl__description">Snippet</p>
// </section>
export function parseStartpageHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const re =
    /<a[^>]+class="[^"]*(?:w-gl__result-title|result-link)[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]+class="[^"]*w-gl__description[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
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

export async function startpageSearch(query: string, timeoutMs = 8000): Promise<SearchResult[]> {
  // Startpage prefers POST but accepts GET with query param; using GET for simplicity.
  const url = `https://www.startpage.com/do/dsearch?query=${encodeURIComponent(query)}&cat=web&pl=opensearch`;
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      maxRedirects: 3,
      validateStatus: (s) => s >= 200 && s < 400,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return typeof res.data === 'string' ? parseStartpageHtml(res.data) : [];
  } catch {
    return [];
  }
}
