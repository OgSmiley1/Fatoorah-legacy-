// Retry-with-jittered-exponential-backoff helper.
// Used to wrap fragile HTTP / Playwright calls in the hunter so a single
// transient failure (rate limit, DNS blip, slow CDN) doesn't kill a whole engine.

export interface RetryOptions {
  tries?: number;        // total attempts including the first; default 3
  baseDelayMs?: number;  // initial backoff; default 250
  maxDelayMs?: number;   // cap; default 4000
  jitter?: boolean;      // add 0-50% jitter; default true
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const tries = Math.max(1, opts.tries ?? 3);
  const base = Math.max(0, opts.baseDelayMs ?? 250);
  const cap = Math.max(base, opts.maxDelayMs ?? 4000);
  const jitter = opts.jitter ?? true;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= tries || !shouldRetry(err, attempt)) break;
      const exp = Math.min(cap, base * 2 ** (attempt - 1));
      const delay = jitter ? exp + Math.floor(Math.random() * exp * 0.5) : exp;
      opts.onRetry?.(err, attempt, delay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Convenience: returns null instead of throwing — matches the existing
// safeFetch shape used across the search/actor layer.
export async function retrySafe<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T | null> {
  try {
    return await retry(fn, opts);
  } catch {
    return null;
  }
}

// Read N from env with a numeric fallback. Used for HUNT_FETCH_RETRIES etc.
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
