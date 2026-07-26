/**
 * Money — BWP in thebe (minor units), as integers. Never floats.
 *
 * Floating point money is how marketplaces end up with a trust account that is
 * 14 thebe short and nobody knows why. See MASTER_PROMPT.md §7.4.
 */

declare const brand: unique symbol;

/** An integer number of thebe (1/100 BWP). Signed — negatives are credits. */
export type Thebe = number & { readonly [brand]: 'Thebe' };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Construct a Thebe value, rejecting anything that isn't a safe integer. */
export function thebe(value: number): Thebe {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Money must be a whole number of thebe, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Money value ${value} exceeds safe integer range`);
  }
  // Normalise negative zero. `-0` compares equal to `0` with `==` but not with
  // Object.is, and it renders as "-BWP 0.00" in anything that checks the sign
  // bit. There is no such thing as a negative zero amount of money.
  return (value === 0 ? 0 : value) as Thebe;
}

/** Convert whole pula to thebe. `pula(1200)` → 120000 thebe. */
export function pula(amount: number): Thebe {
  if (!Number.isFinite(amount)) {
    throw new MoneyError(`Invalid pula amount: ${amount}`);
  }
  const asThebe = Math.round(amount * 100);
  if (Math.abs(amount * 100 - asThebe) > 1e-6) {
    throw new MoneyError(`Pula amount ${amount} has sub-thebe precision`);
  }
  return thebe(asThebe);
}

export function add(...values: Thebe[]): Thebe {
  return thebe(values.reduce((sum, v) => sum + v, 0));
}

export function subtract(a: Thebe, b: Thebe): Thebe {
  return thebe(a - b);
}

export function negate(a: Thebe): Thebe {
  return thebe(-a);
}

export function isZero(a: Thebe): boolean {
  return a === 0;
}

export const ZERO = thebe(0);

/**
 * Multiply by a ratio, rounding half-up to the nearest thebe.
 *
 * Used for pro-rata weight adjustment and percentage fees. The rounding
 * direction is fixed and explicit because "whichever way the language rounds"
 * is not an acceptable answer when the result is somebody's payout.
 */
export function multiplyByRatio(amount: Thebe, numerator: number, denominator: number): Thebe {
  if (denominator === 0) {
    throw new MoneyError('Division by zero in money calculation');
  }
  const exact = (amount * numerator) / denominator;
  return thebe(Math.round(exact));
}

/** Apply a percentage, e.g. `percentage(x, 2.5)` for a 2.5% fee. */
export function percentage(amount: Thebe, pct: number): Thebe {
  return multiplyByRatio(amount, pct, 100);
}

/**
 * Split an amount into `parts` shares that sum exactly to the original.
 *
 * The remainder is distributed one thebe at a time to the earliest shares, so
 * nothing is lost or invented. Needed for syndicate settlement (§6), where
 * "everyone gets a third" of 100 thebe must still total 100.
 */
export function splitEvenly(amount: Thebe, parts: number): Thebe[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError(`Cannot split into ${parts} parts`);
  }
  const sign = amount < 0 ? -1 : 1;
  const magnitude = Math.abs(amount);
  const base = Math.floor(magnitude / parts);
  const remainder = magnitude - base * parts;

  return Array.from({ length: parts }, (_, i) =>
    thebe(sign * (base + (i < remainder ? 1 : 0))),
  );
}

/**
 * Split proportionally to weights, preserving the total exactly.
 *
 * Largest-remainder method: allocate floors, then hand out the leftover thebe
 * to whoever was rounded down hardest.
 */
export function splitProportionally(amount: Thebe, weights: number[]): Thebe[] {
  if (weights.length === 0) {
    throw new MoneyError('Cannot split across zero weights');
  }
  if (weights.some((w) => w < 0)) {
    throw new MoneyError('Split weights must be non-negative');
  }
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) {
    throw new MoneyError('Split weights must not all be zero');
  }

  const sign = amount < 0 ? -1 : 1;
  const magnitude = Math.abs(amount);

  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const floors = exact.map(Math.floor);
  const allocated = floors.reduce((s, v) => s + v, 0);
  let remainder = magnitude - allocated;

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }

  return result.map((v) => thebe(sign * v));
}

/** Format for display, e.g. `formatBwp(thebe(120050))` → "BWP 1,200.50". */
export function formatBwp(amount: Thebe): string {
  const negative = amount < 0;
  const magnitude = Math.abs(amount);
  const major = Math.floor(magnitude / 100);
  const minor = magnitude % 100;
  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}BWP ${grouped}.${minor.toString().padStart(2, '0')}`;
}

/** Prisma stores money as BigInt. These bridge the boundary in one place. */
export function toBigInt(amount: Thebe): bigint {
  return BigInt(amount);
}

export function fromBigInt(value: bigint): Thebe {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`Ledger value ${value} exceeds safe integer range`);
  }
  return thebe(Number(value));
}
