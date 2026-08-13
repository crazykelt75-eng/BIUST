/**
 * Settlement arithmetic, including the weight tolerance rule.
 *
 * MASTER_PROMPT.md §3.4: almost every livestock dispute is about weight on
 * arrival. The tolerance clause resolves the common case automatically —
 * within tolerance, settle as agreed; outside it, recalculate pro rata — which
 * removes the argument before it starts.
 *
 * Two cases the naive version of this rule gets wrong, both handled here:
 *
 *   1. A per-head or per-lot sale does NOT auto-reprice on weight. The parties
 *      agreed a price per animal, not per kilogram. A large shortfall there is
 *      a description mismatch, which is a dispute, not a discount. Silently
 *      repricing a per-head deal would rewrite the contract.
 *
 *   2. An upward adjustment can exceed the escrowed amount. Heavier animals
 *      than declared means the buyer owes more than they deposited, and that
 *      money does not exist in the trust account. It cannot auto-settle; the
 *      buyer has to top up first.
 */

import {
  type Thebe,
  ZERO,
  multiplyByRatio,
  percentage,
  subtract,
  thebe,
} from './money';

export type PriceBasis = 'PER_HEAD' | 'PER_KG_LIVE' | 'PER_KG_CARCASS' | 'PER_LOT';

export type SettlementOutcome =
  /** Weight within tolerance (or no weight recorded). Settle at the agreed price. */
  | 'SETTLE_AS_AGREED'
  /** Outside tolerance on a weight basis, adjusted down. Seller accepts or disputes in 24h. */
  | 'ADJUSTED_DOWN_PENDING_SELLER'
  /** Outside tolerance and adjusted up beyond escrow. Buyer must top up. */
  | 'ADJUSTED_UP_REQUIRES_TOPUP'
  /** Outside tolerance on a non-weight basis. Not repriced — buyer may dispute. */
  | 'REVIEW_REQUIRED_NOT_REPRICED';

export interface SettlementInput {
  agreedAmount: Thebe;
  priceBasis: PriceBasis;
  /** Total weight the listing declared, in kg. */
  declaredWeightKg?: number;
  /** Total weight recorded at collection, in kg. */
  actualWeightKg?: number;
  /** Tolerance band, percent. Default 5. */
  tolerancePct?: number;
  /** Platform success fee, percent of settled value, seller-side. */
  feePct: number;
  /** Amount currently held in escrow for this transaction. */
  escrowHeld: Thebe;
}

export interface SettlementResult {
  outcome: SettlementOutcome;
  /** Final price payable by the buyer. */
  settledAmount: Thebe;
  /** Platform fee, deducted from the seller's proceeds. */
  platformFee: Thebe;
  /** What the seller receives after fee. */
  sellerProceeds: Thebe;
  /** Returned to the buyer where the settled amount is below what was held. */
  buyerRefund: Thebe;
  /** Additional deposit required from the buyer before settlement can proceed. */
  topUpRequired: Thebe;
  /** Signed variance, percent, of actual against declared weight. */
  weightVariancePct: number | null;
  withinTolerance: boolean;
  /** Human-readable reason, surfaced to both parties. */
  explanation: string;
}

const WEIGHT_BASED: ReadonlySet<PriceBasis> = new Set(['PER_KG_LIVE', 'PER_KG_CARCASS']);

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const tolerancePct = input.tolerancePct ?? 5;
  const { agreedAmount, priceBasis, declaredWeightKg, actualWeightKg, escrowHeld } = input;

  const haveWeights =
    typeof declaredWeightKg === 'number' &&
    typeof actualWeightKg === 'number' &&
    declaredWeightKg > 0;

  if (!haveWeights) {
    return finalise({
      outcome: 'SETTLE_AS_AGREED',
      settledAmount: agreedAmount,
      feePct: input.feePct,
      escrowHeld,
      weightVariancePct: null,
      withinTolerance: true,
      explanation: 'No weight comparison available; settling at the agreed price.',
    });
  }

  const declared = declaredWeightKg;
  const actual = actualWeightKg;
  const variancePct = ((actual - declared) / declared) * 100;
  const withinTolerance = Math.abs(variancePct) <= tolerancePct;

  if (withinTolerance) {
    return finalise({
      outcome: 'SETTLE_AS_AGREED',
      settledAmount: agreedAmount,
      feePct: input.feePct,
      escrowHeld,
      weightVariancePct: variancePct,
      withinTolerance: true,
      explanation:
        `Actual weight ${actual} kg is within the ${tolerancePct}% tolerance of the ` +
        `declared ${declared} kg (${variancePct.toFixed(1)}%). Settling at the agreed price.`,
    });
  }

  if (!WEIGHT_BASED.has(priceBasis)) {
    // The deal was struck per head or per lot. Repricing it on weight would be
    // rewriting the contract, so flag it for the buyer to accept or dispute.
    return finalise({
      outcome: 'REVIEW_REQUIRED_NOT_REPRICED',
      settledAmount: agreedAmount,
      feePct: input.feePct,
      escrowHeld,
      weightVariancePct: variancePct,
      withinTolerance: false,
      explanation:
        `Actual weight ${actual} kg differs from the declared ${declared} kg by ` +
        `${variancePct.toFixed(1)}%, outside the ${tolerancePct}% tolerance. This sale was ` +
        `priced ${priceBasis.replace(/_/g, ' ').toLowerCase()}, so the price has not been ` +
        'adjusted automatically. The buyer may accept the animals as delivered or raise a dispute.',
    });
  }

  const adjusted = multiplyByRatio(agreedAmount, actual, declared);

  if (adjusted > escrowHeld) {
    const shortfall = subtract(adjusted, escrowHeld);
    return finalise({
      outcome: 'ADJUSTED_UP_REQUIRES_TOPUP',
      settledAmount: adjusted,
      feePct: input.feePct,
      escrowHeld,
      topUpRequired: shortfall,
      weightVariancePct: variancePct,
      withinTolerance: false,
      explanation:
        `Actual weight ${actual} kg exceeds the declared ${declared} kg by ` +
        `${variancePct.toFixed(1)}%. The pro-rata price is above the amount held in escrow; ` +
        'the buyer must deposit the difference before settlement can complete.',
    });
  }

  return finalise({
    outcome: 'ADJUSTED_DOWN_PENDING_SELLER',
    settledAmount: adjusted,
    feePct: input.feePct,
    escrowHeld,
    weightVariancePct: variancePct,
    withinTolerance: false,
    explanation:
      `Actual weight ${actual} kg is ${Math.abs(variancePct).toFixed(1)}% below the declared ` +
      `${declared} kg, outside the ${tolerancePct}% tolerance. The price has been recalculated ` +
      'pro rata per kilogram. The seller has 24 hours to accept or dispute.',
  });
}

function finalise(args: {
  outcome: SettlementOutcome;
  settledAmount: Thebe;
  feePct: number;
  escrowHeld: Thebe;
  topUpRequired?: Thebe;
  weightVariancePct: number | null;
  withinTolerance: boolean;
  explanation: string;
}): SettlementResult {
  const platformFee = percentage(args.settledAmount, args.feePct);
  const sellerProceeds = subtract(args.settledAmount, platformFee);
  const topUpRequired = args.topUpRequired ?? ZERO;
  const buyerRefund =
    args.settledAmount < args.escrowHeld ? subtract(args.escrowHeld, args.settledAmount) : ZERO;

  return {
    outcome: args.outcome,
    settledAmount: args.settledAmount,
    platformFee,
    sellerProceeds,
    buyerRefund,
    topUpRequired,
    weightVariancePct: args.weightVariancePct,
    withinTolerance: args.withinTolerance,
    explanation: args.explanation,
  };
}

/**
 * Whether a settlement result may be posted to the ledger without further
 * human or counterparty action.
 */
export function canAutoPost(result: SettlementResult): boolean {
  return result.outcome === 'SETTLE_AS_AGREED';
}

/**
 * Seller weight-accuracy score, 0–100 (§8.2).
 *
 * Objective, computed from settled transactions, and not gameable by a seller
 * writing nice things about themselves — which is what makes it worth showing.
 */
export function weightAccuracyScore(
  history: { declaredWeightKg: number; actualWeightKg: number }[],
): number | null {
  const usable = history.filter((h) => h.declaredWeightKg > 0);
  if (usable.length === 0) return null;

  const totalError = usable.reduce((sum, h) => {
    const errorPct = Math.abs((h.actualWeightKg - h.declaredWeightKg) / h.declaredWeightKg) * 100;
    return sum + Math.min(errorPct, 100);
  }, 0);

  return Math.round(100 - totalError / usable.length);
}

/** Convenience for display alongside the score. */
export function describeAccuracy(score: number | null, sampleSize: number): string {
  if (score === null || sampleSize === 0) return 'No weight history yet';
  return `Weight accuracy: ${score}% (${sampleSize} ${sampleSize === 1 ? 'sale' : 'sales'})`;
}

export { thebe };
