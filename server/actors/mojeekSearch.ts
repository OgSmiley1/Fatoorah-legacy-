// server/actors/mojeekSearch.ts
// Mojeek — UK-based independent crawler (not Bing/Google). Smaller index but
// surfaces long-tail merchants the majors miss, and rarely blocks.

import axios from 'axios';
import { decodeHtml, stripTags } from '../searchParsers';
import type { SearchResult } from '../searchParsers';

// Mojeek HTML: <ul class="results"><li class="r"><a class="ob" href=URL><h2>Title</h2></a>
//   <p class="s">Snippet</p></li>
export function parseMojeekHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const re =
    /<a[^>]+class="[^"]*\bob\b[^"]*"[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<\/a>[\s\S]*?<p[^>]+class="[^"]*\bs\b[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
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

export async function mojeekSearch(query: string, timeoutMs = 8000): Promise<SearchResult[]> {
  const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 3,
      validateStatus: (s) => s >= 200 && s < 400,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return typeof res.data === 'string' ? parseMojeekHtml(res.data) : [];
  } catch {
    return [];
  }
}
