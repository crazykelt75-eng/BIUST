import { describe, expect, it } from 'vitest';

import { pula } from './money';
import {
  calculateSettlement,
  canAutoPost,
  describeAccuracy,
  weightAccuracyScore,
} from './settlement';

const BASE = {
  agreedAmount: pula(48_000),
  priceBasis: 'PER_KG_LIVE' as const,
  feePct: 2.5,
  escrowHeld: pula(48_000),
};

describe('weight within tolerance', () => {
  it('settles at the agreed price', () => {
    const result = calculateSettlement({
      ...BASE,
      declaredWeightKg: 2_000,
      actualWeightKg: 1_960, // 2% under
    });

    expect(result.outcome).toBe('SETTLE_AS_AGREED');
    expect(result.settledAmount).toBe(pula(48_000));
    expect(result.buyerRefund).toBe(0);
    expect(result.withinTolerance).toBe(true);
    expect(canAutoPost(result)).toBe(true);
  });

  it('treats the tolerance boundary as inside, not outside', () => {
    const result = calculateSettlement({
      ...BASE,
      declaredWeightKg: 2_000,
      actualWeightKg: 1_900, // exactly 5% under
    });
    expect(result.outcome).toBe('SETTLE_AS_AGREED');
  });

  it('settles as agreed when no weights were recorded', () => {
    const result = calculateSettlement(BASE);
    expect(result.outcome).toBe('SETTLE_AS_AGREED');
    expect(result.weightVariancePct).toBeNull();
  });
});

describe('weight outside tolerance, priced per kg', () => {
  it('recalculates pro rata and refunds the difference', () => {
    const result = calculateSettlement({
      ...BASE,
      declaredWeightKg: 2_000,
      actualWeightKg: 1_800, // 10% under
    });

    expect(result.outcome).toBe('ADJUSTED_DOWN_PENDING_SELLER');
    expect(result.settledAmount).toBe(pula(43_200)); // 48,000 × 1800/2000
    expect(result.buyerRefund).toBe(pula(4_800));
    expect(result.platformFee).toBe(pula(1_080)); // fee follows the settled figure
    expect(result.sellerProceeds).toBe(pula(42_120));
    expect(canAutoPost(result)).toBe(false);
  });

  it('leaves nothing stranded — the escrow splits exactly three ways', () => {
    const result = calculateSettlement({
      ...BASE,
      declaredWeightKg: 1_850,
      actualWeightKg: 1_612, // an awkward ratio, deliberately
    });

    const distributed = result.sellerProceeds + result.platformFee + result.buyerRefund;
    expect(distributed).toBe(BASE.escrowHeld);
  });

  it('requires a top-up when the animals weigh more than declared', () => {
    const result = calculateSettlement({
      ...BASE,
      declaredWeightKg: 2_000,
      actualWeightKg: 2_400, // 20% over — buyer owes more than they deposited
    });

    expect(result.outcome).toBe('ADJUSTED_UP_REQUIRES_TOPUP');
    expect(result.settledAmount).toBe(pula(57_600));
    expect(result.topUpRequired).toBe(pula(9_600));
    expect(result.buyerRefund).toBe(0);
    expect(canAutoPost(result)).toBe(false);
  });
});

describe('weight outside tolerance, priced per head', () => {
  it('does not silently reprice a per-head deal', () => {
    const result = calculateSettlement({
      ...BASE,
      priceBasis: 'PER_HEAD',
      declaredWeightKg: 2_000,
      actualWeightKg: 1_700,
    });

    // The parties agreed a price per animal, not per kilogram. Repricing here
    // would be rewriting the contract on the seller.
    expect(result.outcome).toBe('REVIEW_REQUIRED_NOT_REPRICED');
    expect(result.settledAmount).toBe(pula(48_000));
    expect(result.explanation).toMatch(/has not been adjusted automatically/);
  });

  it('does not reprice a per-lot deal either', () => {
    const result = calculateSettlement({
      ...BASE,
      priceBasis: 'PER_LOT',
      declaredWeightKg: 2_000,
      actualWeightKg: 1_500,
    });
    expect(result.outcome).toBe('REVIEW_REQUIRED_NOT_REPRICED');
  });
});

describe('custom tolerance', () => {
  it('honours a tighter band', () => {
    const result = calculateSettlement({
      ...BASE,
      tolerancePct: 2,
      declaredWeightKg: 2_000,
      actualWeightKg: 1_940, // 3% under — inside 5%, outside 2%
    });
    expect(result.outcome).toBe('ADJUSTED_DOWN_PENDING_SELLER');
  });
});

describe('seller weight-accuracy score', () => {
  it('returns null with no history', () => {
    expect(weightAccuracyScore([])).toBeNull();
    expect(describeAccuracy(null, 0)).toBe('No weight history yet');
  });

  it('scores a consistently accurate seller near 100', () => {
    const score = weightAccuracyScore([
      { declaredWeightKg: 500, actualWeightKg: 498 },
      { declaredWeightKg: 600, actualWeightKg: 604 },
      { declaredWeightKg: 450, actualWeightKg: 449 },
    ]);
    expect(score).toBeGreaterThanOrEqual(98);
  });

  it('penalises a seller who consistently overstates weight', () => {
    const score = weightAccuracyScore([
      { declaredWeightKg: 500, actualWeightKg: 420 },
      { declaredWeightKg: 600, actualWeightKg: 500 },
    ]);
    expect(score).toBeLessThan(90);
  });

  it('treats overstating and understating alike', () => {
    const over = weightAccuracyScore([{ declaredWeightKg: 500, actualWeightKg: 550 }]);
    const under = weightAccuracyScore([{ declaredWeightKg: 500, actualWeightKg: 450 }]);
    expect(over).toBe(under);
  });

  it('formats for display', () => {
    expect(describeAccuracy(98, 23)).toBe('Weight accuracy: 98% (23 sales)');
    expect(describeAccuracy(100, 1)).toBe('Weight accuracy: 100% (1 sale)');
  });
});
