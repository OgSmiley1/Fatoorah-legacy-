// src/lib/httpClient.ts
// Exponential backoff HTTP client using native fetch (Node 20+)

type RateTracker = { lastRequestAt: number };
const rateTrackers: Record<string, RateTracker> = {};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithBackoff(
  url: string,
  opts: RequestInit = {},
  sourceName = 'unknown',
  maxAttempts = 5
): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Simple rate spacing: at least 200ms between requests per source
    const tracker = rateTrackers[sourceName] || { lastRequestAt: 0 };
    const gap = Date.now() - tracker.lastRequestAt;
    if (gap < 200) await sleep(200 - gap);
    tracker.lastRequestAt = Date.now();
    rateTrackers[sourceName] = tracker;

    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
        // Only retry on rate-limit or server errors
        if (res.status === 429 || res.status >= 500) throw err;
        throw Object.assign(err, { fatal: true });
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    } catch (err: any) {
      if (err.fatal || attempt >= maxAttempts - 1) throw err;
      const delay = Math.min(30_000, 2 ** (attempt + 1) * 500);
      console.warn(`[httpClient] ${sourceName} attempt ${attempt + 1} failed — retrying in ${delay}ms:`, err.message);
      await sleep(delay);
    }
  }
}
