// tests/retry.test.ts
import { jest, describe, test, expect, afterEach } from '@jest/globals';
import { retry, retrySafe, envInt } from '../server/retry';

describe('retry', () => {
  test('returns the value on first success', async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue('ok');
    const out = await retry(fn, { tries: 3, baseDelayMs: 0 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds before exhausting tries', async () => {
    const fn = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom-1'))
      .mockRejectedValueOnce(new Error('boom-2'))
      .mockResolvedValueOnce('finally');
    const out = await retry(fn, { tries: 4, baseDelayMs: 0 });
    expect(out).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws the last error after exhausting tries', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('always'));
    await expect(retry(fn, { tries: 3, baseDelayMs: 0 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('shouldRetry false stops further attempts immediately', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('fatal'));
    await expect(
      retry(fn, { tries: 5, baseDelayMs: 0, shouldRetry: () => false })
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('onRetry receives the error, attempt index, and computed delay', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('once'))
      .mockResolvedValueOnce('ok');
    await retry(fn, { tries: 3, baseDelayMs: 1, jitter: false, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    const [err, attempt, delay] = onRetry.mock.calls[0];
    expect((err as Error).message).toBe('once');
    expect(attempt).toBe(1);
    expect(delay).toBeGreaterThanOrEqual(1);
  });
});

describe('retrySafe', () => {
  test('returns null instead of throwing when retries are exhausted', async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('nope'));
    const out = await retrySafe(fn, { tries: 2, baseDelayMs: 0 });
    expect(out).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('returns the value when fn ultimately succeeds', async () => {
    const fn = jest.fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('once'))
      .mockResolvedValueOnce(42);
    const out = await retrySafe(fn, { tries: 3, baseDelayMs: 0 });
    expect(out).toBe(42);
  });
});

describe('envInt', () => {
  const key = 'RETRY_TEST_ENVINT_VAR';
  afterEach(() => { delete process.env[key]; });

  test('returns fallback when env var is unset', () => {
    expect(envInt(key, 7)).toBe(7);
  });

  test('parses a valid integer', () => {
    process.env[key] = '12';
    expect(envInt(key, 7)).toBe(12);
  });

  test('rejects negative values and falls back', () => {
    process.env[key] = '-3';
    expect(envInt(key, 7)).toBe(7);
  });

  test('rejects non-numeric values and falls back', () => {
    process.env[key] = 'abc';
    expect(envInt(key, 7)).toBe(7);
  });
});
