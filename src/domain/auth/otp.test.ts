import { describe, expect, it } from 'vitest';

import {
  CODE_LENGTH,
  MAX_REQUESTS_PER_WINDOW,
  MAX_VERIFY_ATTEMPTS,
  canRequestCode,
  challengeState,
  generateCode,
  isWellFormedCode,
  maskPhone,
  normalisePhone,
} from './otp';

describe('phone normalisation', () => {
  it('accepts the forms people actually type', () => {
    for (const input of [
      '71234567',
      '071234567',
      '+26771234567',
      '26771234567',
      '+267 71 234 567',
      '(267) 71-234-567',
    ]) {
      const result = normalisePhone(input);
      expect(result.valid, `rejected "${input}"`).toBe(true);
      if (result.valid) expect(result.e164).toBe('+26771234567');
    }
  });

  it('rejects landlines, which cannot receive an SMS', () => {
    // Better to say so now than to leave someone staring at a code that will
    // never arrive.
    const result = normalisePhone('3971234');
    expect(result.valid).toBe(false);
  });

  it('rejects wrong-length and non-numeric input', () => {
    expect(normalisePhone('7123456').valid).toBe(false);
    expect(normalisePhone('712345678').valid).toBe(false);
    expect(normalisePhone('not a phone').valid).toBe(false);
    expect(normalisePhone('').valid).toBe(false);
  });

  it('masks for logging', () => {
    expect(maskPhone('+26771234567')).toBe('+267712***67');
  });
});

describe('code generation', () => {
  it('always produces a fixed-length numeric code', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isWellFormedCode(code)).toBe(true);
    }
  });

  it('produces leading-zero codes rather than shortening them', () => {
    // A naive implementation drops the zeros and emits a 5-digit code, which
    // both breaks verification and shrinks the keyspace.
    const codes = Array.from({ length: 3_000 }, generateCode);
    expect(codes.every((c) => c.length === CODE_LENGTH)).toBe(true);
  });

  it('is spread across the keyspace', () => {
    const codes = new Set(Array.from({ length: 1_000 }, generateCode));
    // Collisions in 1,000 draws from a million-wide space should be rare.
    expect(codes.size).toBeGreaterThan(990);
  });

  it('rejects malformed codes', () => {
    expect(isWellFormedCode('12345')).toBe(false);
    expect(isWellFormedCode('1234567')).toBe(false);
    expect(isWellFormedCode('12345a')).toBe(false);
    expect(isWellFormedCode('')).toBe(false);
  });
});

describe('request rate limiting', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

  it('allows the first request', () => {
    expect(canRequestCode([], now).allowed).toBe(true);
  });

  it('allows up to the cap', () => {
    const recent = [minutesAgo(1), minutesAgo(5)];
    expect(canRequestCode(recent, now).allowed).toBe(true);
  });

  it('blocks past the cap and says when to retry', () => {
    const recent = [minutesAgo(1), minutesAgo(5), minutesAgo(10)];
    const verdict = canRequestCode(recent, now);

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('RATE_LIMITED');
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
      expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('ignores requests older than the window', () => {
    const recent = [minutesAgo(20), minutesAgo(30), minutesAgo(40)];
    expect(canRequestCode(recent, now).allowed).toBe(true);
  });

  it('caps sends low, because each one costs money', () => {
    expect(MAX_REQUESTS_PER_WINDOW).toBeLessThanOrEqual(3);
  });
});

describe('challenge usability', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const base = { expiresAt: new Date('2026-07-26T12:05:00Z'), consumedAt: null, attempts: 0 };

  it('is usable while fresh and unspent', () => {
    expect(challengeState(base, now).usable).toBe(true);
  });

  it('is dead once consumed, so a correct code cannot be replayed', () => {
    const state = challengeState({ ...base, consumedAt: now }, now);
    expect(state.usable).toBe(false);
    if (!state.usable) expect(state.reason).toBe('CONSUMED');
  });

  it('is dead once expired', () => {
    const state = challengeState(base, new Date('2026-07-26T12:06:00Z'));
    expect(state.usable).toBe(false);
    if (!state.usable) expect(state.reason).toBe('EXPIRED');
  });

  it('dies at the attempt cap — the whole challenge, not just the guess', () => {
    // A 6-digit code is only adequate if guessing is strictly bounded.
    const state = challengeState({ ...base, attempts: MAX_VERIFY_ATTEMPTS }, now);
    expect(state.usable).toBe(false);
    if (!state.usable) expect(state.reason).toBe('TOO_MANY_ATTEMPTS');
  });

  it('keeps the attempt cap tight', () => {
    expect(MAX_VERIFY_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});
