import { describe, expect, it } from 'vitest';

import {
  MoneyError,
  add,
  formatBwp,
  fromBigInt,
  multiplyByRatio,
  percentage,
  pula,
  splitEvenly,
  splitProportionally,
  thebe,
  toBigInt,
} from './money';

describe('constructing money', () => {
  it('rejects fractional thebe', () => {
    expect(() => thebe(10.5)).toThrow(MoneyError);
  });

  it('rejects pula amounts with sub-thebe precision', () => {
    expect(() => pula(10.005)).toThrow(/sub-thebe/);
  });

  it('converts pula to thebe', () => {
    expect(pula(8_000)).toBe(800_000);
    expect(pula(1_200.5)).toBe(120_050);
  });
});

describe('splitting money', () => {
  it('splits evenly with no thebe lost or invented', () => {
    const parts = splitEvenly(thebe(100), 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(add(...parts)).toBe(100);
  });

  it('preserves the total for awkward syndicate splits', () => {
    for (const total of [1, 7, 99, 100_001, 48_337]) {
      for (const members of [2, 3, 5, 7, 11]) {
        const parts = splitEvenly(thebe(total), members);
        expect(add(...parts)).toBe(total);
      }
    }
  });

  it('splits proportionally, preserving the total exactly', () => {
    // Three members contributing unequally to a BWP 50,000 syndicate.
    const parts = splitProportionally(pula(50_000), [3, 1, 1]);
    expect(add(...parts)).toBe(pula(50_000));
    expect(parts[0]).toBeGreaterThan(parts[1]!);
  });

  it('hands the remainder to whoever was rounded down hardest', () => {
    const parts = splitProportionally(thebe(10), [1, 1, 1]);
    expect(add(...parts)).toBe(10);
    expect(parts.filter((p) => p === 4)).toHaveLength(1);
  });

  it('rejects splits that would divide by zero weight', () => {
    expect(() => splitProportionally(thebe(100), [0, 0])).toThrow(MoneyError);
  });
});

describe('ratios and percentages', () => {
  it('applies a percentage fee', () => {
    expect(percentage(pula(48_000), 2.5)).toBe(pula(1_200));
  });

  it('rounds half-up, deterministically', () => {
    expect(multiplyByRatio(thebe(101), 1, 2)).toBe(51);
  });

  it('refuses division by zero', () => {
    expect(() => multiplyByRatio(thebe(100), 1, 0)).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatBwp(thebe(120_050))).toBe('BWP 1,200.50');
    expect(formatBwp(thebe(500))).toBe('BWP 5.00');
    expect(formatBwp(thebe(-120_050))).toBe('-BWP 1,200.50');
  });
});

describe('database boundary', () => {
  it('round-trips through BigInt', () => {
    const amount = pula(48_000);
    expect(fromBigInt(toBigInt(amount))).toBe(amount);
  });

  it('refuses ledger values beyond safe integer range', () => {
    expect(() => fromBigInt(BigInt(Number.MAX_SAFE_INTEGER) + 10n)).toThrow(MoneyError);
  });
});
