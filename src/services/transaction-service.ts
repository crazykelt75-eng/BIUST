/**
 * Transaction orchestration.
 *
 * This is where the architectural commitment in MASTER_PROMPT §10.1 is actually
 * kept: **a state change and the money it moves commit in the same database
 * transaction, or neither happens.**
 *
 * The failure this prevents is specific and expensive. Escrow is marked funded,
 * the ledger write fails, and now a transaction says the buyer has paid while
 * the books say the trust account never received anything. Nobody notices until
 * reconciliation, by which point the animals have moved. Every function here
 * takes a `Tx` and does its work inside the caller's unit of work.
 */

import type { Tx } from '../db/client';
import { postEntry } from '../db/ledger-repository';
import {
  depositConfirmed,
  disputeHold,
  escrowFunded,
  refundIssued,
  settlement,
} from '../domain/ledger/events';
import { type Thebe, fromBigInt, thebe } from '../domain/money';
import { calculateSettlement } from '../domain/settlement';
import type { PriceBasis, SettlementResult } from '../domain/settlement';
import {
  type ActorRole,
  type TransactionState,
  type TransitionContext,
  canTransition,
  deadlineFor,
  stateAfterEscrowFunded,
} from '../domain/transaction/state-machine';
import { assessMovement } from '../domain/zones/movement';
import type { ZoneRestriction } from '../domain/zones/movement';

export class TransactionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

/** Platform success fee, seller-side. Tapers by tier in a later phase. */
const DEFAULT_FEE_PCT = 2.5;

// ─────────────────────────────────────────────────────────────────────────────
// Context assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the guard context for a transition from live data.
 *
 * Zone restrictions are read at decision time, never cached on the transaction.
 * An outbreak declared this morning must block a collection arranged last week,
 * and a stale copy of the restriction table is how animals move illegally.
 */
export async function buildTransitionContext(
  tx: Tx,
  transactionId: string,
  actorRole: ActorRole,
): Promise<TransitionContext> {
  const txn = await tx.transaction.findUnique({
    where: { id: transactionId },
    select: {
      permitRequired: true,
      permitApprovedAt: true,
      listing: { select: { zoneId: true } },
      buyer: { select: { farms: { select: { zoneId: true }, take: 1 } } },
    },
  });

  if (!txn) {
    throw new TransactionError(`Transaction ${transactionId} not found`, 'NOT_FOUND');
  }

  const originZoneId = txn.listing.zoneId;
  const destinationZoneId = txn.buyer.farms[0]?.zoneId ?? null;

  const restrictions = await activeRestrictions(tx, [originZoneId, destinationZoneId]);
  const verdict = assessMovement({ originZoneId, destinationZoneId, restrictions });

  const escrowConfirmed = await hasConfirmedEscrow(tx, transactionId);

  return {
    zoneRestricted: verdict.blocked,
    permitRequired: txn.permitRequired,
    permitApproved: txn.permitApprovedAt !== null,
    escrowConfirmed,
    actorRole,
  };
}

async function activeRestrictions(
  tx: Tx,
  zoneIds: (string | null)[],
): Promise<ZoneRestriction[]> {
  const ids = zoneIds.filter((z): z is string => z !== null);
  if (ids.length === 0) return [];

  const rows = await tx.zoneRestriction.findMany({
    where: { zoneId: { in: ids }, liftedAt: null },
  });

  return rows.map((r) => ({
    zoneId: r.zoneId,
    kind: r.kind,
    direction: r.direction,
    reason: r.reason,
    effectiveAt: r.effectiveAt,
    liftedAt: r.liftedAt,
  }));
}

async function hasConfirmedEscrow(tx: Tx, transactionId: string): Promise<boolean> {
  const entry = await tx.journalEntry.findUnique({
    where: { eventKey: `escrow-funded:${transactionId}` },
    select: { id: true },
  });
  return entry !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The transition primitive
// ─────────────────────────────────────────────────────────────────────────────

export interface TransitionArgs {
  transactionId: string;
  to: TransactionState;
  actorId?: string;
  actorRole: ActorRole;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Move a transaction to a new state, writing the append-only event and setting
 * the next deadline.
 *
 * Refuses illegal transitions rather than logging and continuing. A transition
 * the state machine rejects is a bug or an attack, and both deserve a stack
 * trace.
 */
export async function transitionTo(tx: Tx, args: TransitionArgs): Promise<TransactionState> {
  const current = await tx.transaction.findUnique({
    where: { id: args.transactionId },
    select: { state: true },
  });

  if (!current) {
    throw new TransactionError(`Transaction ${args.transactionId} not found`, 'NOT_FOUND');
  }

  const ctx = await buildTransitionContext(tx, args.transactionId, args.actorRole);
  const verdict = canTransition(current.state, args.to, ctx);

  if (!verdict.allowed) {
    throw new TransactionError(
      `Cannot move ${args.transactionId} from ${current.state} to ${args.to}: ${verdict.reason}`,
      'ILLEGAL_TRANSITION',
    );
  }

  const now = new Date();

  await tx.transaction.update({
    where: { id: args.transactionId },
    data: {
      state: args.to,
      stateDeadline: deadlineFor(args.to, now),
      ...(args.to === 'SETTLED' ? { collectedAt: now } : {}),
    },
  });

  await tx.transactionEvent.create({
    data: {
      transactionId: args.transactionId,
      fromState: current.state,
      toState: args.to,
      actorId: args.actorId ?? null,
      actorRole: args.actorRole,
      reason: args.reason ?? null,
      metadata: (args.metadata ?? undefined) as never,
      occurredAt: now,
    },
  });

  return args.to;
}

// ─────────────────────────────────────────────────────────────────────────────
// Money-moving operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A buyer's payment has been CONFIRMED BY THE BANK. Post it and commit the
 * funds to the transaction.
 *
 * Never call this on payment initiation. The whole point of the PENDING payment
 * state is that initiating a mobile-money push is not the same as the money
 * arriving, and treating them alike is the hole a fraudster walks through
 * (§7.4).
 */
export async function confirmEscrowFunding(
  tx: Tx,
  args: { transactionId: string; paymentId: string; actorId?: string },
): Promise<TransactionState> {
  const payment = await tx.payment.findUnique({
    where: { id: args.paymentId },
    select: { status: true, amount: true, payerId: true, transactionId: true },
  });

  if (!payment) {
    throw new TransactionError(`Payment ${args.paymentId} not found`, 'NOT_FOUND');
  }
  if (payment.status !== 'CONFIRMED') {
    throw new TransactionError(
      `Payment ${args.paymentId} is ${payment.status}, not CONFIRMED. Escrow cannot be ` +
        'funded until the bank confirms the deposit.',
      'PAYMENT_NOT_CONFIRMED',
    );
  }
  if (payment.transactionId !== args.transactionId) {
    throw new TransactionError(
      `Payment ${args.paymentId} belongs to a different transaction`,
      'PAYMENT_MISMATCH',
    );
  }

  const amount = fromBigInt(payment.amount);

  // Money in, then money committed. Both inside the caller's transaction.
  await postEntry(
    tx,
    depositConfirmed({
      paymentId: args.paymentId,
      buyerId: payment.payerId,
      amount,
    }),
  );

  await postEntry(
    tx,
    escrowFunded({
      transactionId: args.transactionId,
      buyerId: payment.payerId,
      amount,
    }),
  );

  await transitionTo(tx, {
    transactionId: args.transactionId,
    to: 'ESCROW_FUNDED',
    actorId: args.actorId,
    actorRole: 'SYSTEM',
    reason: `Deposit ${args.paymentId} confirmed`,
  });

  // Cross-zone trades wait for a DVS permit; same-zone trades are ready now.
  const txn = await tx.transaction.findUniqueOrThrow({
    where: { id: args.transactionId },
    select: { permitRequired: true },
  });

  return transitionTo(tx, {
    transactionId: args.transactionId,
    to: stateAfterEscrowFunded(txn),
    actorRole: 'SYSTEM',
    reason: txn.permitRequired ? 'Awaiting DVS movement permit' : 'Ready for collection',
  });
}

export interface CollectionArgs {
  transactionId: string;
  actualWeightKg?: number;
  collectionCode: string;
  actorId: string;
}

/**
 * The collection handshake at the loading ramp (§7.3).
 *
 * Records the actual weight, applies the tolerance rule, and moves into the
 * inspection window. Deliberately does not settle: the buyer gets their
 * inspection period, and the 24h timeout settles if nobody disputes.
 */
export async function recordCollection(
  tx: Tx,
  args: CollectionArgs,
): Promise<{ state: TransactionState; settlement: SettlementResult }> {
  const txn = await tx.transaction.findUnique({
    where: { id: args.transactionId },
    select: {
      state: true,
      agreedAmount: true,
      priceBasis: true,
      declaredWeightKg: true,
      weightTolerancePct: true,
      collectionCodeHash: true,
    },
  });

  if (!txn) {
    throw new TransactionError(`Transaction ${args.transactionId} not found`, 'NOT_FOUND');
  }

  if (txn.collectionCodeHash && !(await verifyCollectionCode(args.collectionCode, txn.collectionCodeHash))) {
    throw new TransactionError('Collection code does not match', 'BAD_COLLECTION_CODE');
  }

  const held = await escrowHeldFor(tx, args.transactionId);

  const result = calculateSettlement({
    agreedAmount: fromBigInt(txn.agreedAmount),
    priceBasis: txn.priceBasis as PriceBasis,
    declaredWeightKg: txn.declaredWeightKg ?? undefined,
    actualWeightKg: args.actualWeightKg,
    tolerancePct: txn.weightTolerancePct,
    feePct: DEFAULT_FEE_PCT,
    escrowHeld: held,
  });

  await tx.transaction.update({
    where: { id: args.transactionId },
    data: {
      actualWeightKg: args.actualWeightKg ?? null,
      settledAmount: BigInt(result.settledAmount),
      platformFee: BigInt(result.platformFee),
    },
  });

  const state = await transitionTo(tx, {
    transactionId: args.transactionId,
    to: 'DELIVERED',
    actorId: args.actorId,
    actorRole: 'BUYER',
    reason: result.explanation,
    metadata: {
      outcome: result.outcome,
      actualWeightKg: args.actualWeightKg,
      weightVariancePct: result.weightVariancePct,
    },
  });

  const next = await transitionTo(tx, {
    transactionId: args.transactionId,
    to: 'INSPECTION_WINDOW',
    actorRole: 'SYSTEM',
    reason: 'Inspection window open — settles automatically in 24 hours',
  });

  void state;
  return { state: next, settlement: result };
}

/**
 * Release escrow: seller proceeds, platform fee, and any weight refund.
 *
 * Called by the buyer confirming, an admin resolving, or the inspection-window
 * timeout. The state machine refuses a seller settling their own sale.
 */
export async function settleTransaction(
  tx: Tx,
  args: { transactionId: string; actorId?: string; actorRole: ActorRole },
): Promise<Thebe> {
  const txn = await tx.transaction.findUnique({
    where: { id: args.transactionId },
    select: {
      buyerId: true,
      sellerId: true,
      settledAmount: true,
      platformFee: true,
      agreedAmount: true,
    },
  });

  if (!txn) {
    throw new TransactionError(`Transaction ${args.transactionId} not found`, 'NOT_FOUND');
  }

  const held = await escrowHeldFor(tx, args.transactionId);
  if (held <= 0) {
    throw new TransactionError(
      `Transaction ${args.transactionId} holds no escrow to settle`,
      'NOTHING_TO_SETTLE',
    );
  }

  const settled = txn.settledAmount ? fromBigInt(txn.settledAmount) : fromBigInt(txn.agreedAmount);
  const fee = txn.platformFee ? fromBigInt(txn.platformFee) : thebe(0);
  const sellerAmount = thebe(settled - fee);
  const buyerRefund = thebe(held - settled);

  if (buyerRefund < 0) {
    throw new TransactionError(
      `Settlement of ${settled} exceeds escrow of ${held}; the buyer must top up first`,
      'INSUFFICIENT_ESCROW',
    );
  }

  await postEntry(
    tx,
    settlement({
      transactionId: args.transactionId,
      sellerId: txn.sellerId,
      buyerId: txn.buyerId,
      heldAmount: held,
      sellerAmount,
      platformFee: fee,
      buyerRefund,
    }),
  );

  await transitionTo(tx, {
    transactionId: args.transactionId,
    to: 'SETTLED',
    actorId: args.actorId,
    actorRole: args.actorRole,
    reason: 'Escrow released',
  });

  return sellerAmount;
}

/** Cancel and unwind, refunding whatever is held. */
export async function cancelTransaction(
  tx: Tx,
  args: { transactionId: string; reason: string; actorId?: string; actorRole: ActorRole },
): Promise<void> {
  const txn = await tx.transaction.findUniqueOrThrow({
    where: { id: args.transactionId },
    select: { buyerId: true },
  });

  const held = await escrowHeldFor(tx, args.transactionId);

  if (held > 0) {
    await postEntry(
      tx,
      refundIssued({
        transactionId: args.transactionId,
        buyerId: txn.buyerId,
        amount: held,
        reason: args.reason,
      }),
    );
  }

  await transitionTo(tx, {
    transactionId: args.transactionId,
    to: 'CANCELLED',
    actorId: args.actorId,
    actorRole: args.actorRole,
    reason: args.reason,
  });
}

/** Raise a dispute, freezing the funds so neither party can be paid. */
export async function raiseDispute(
  tx: Tx,
  args: {
    transactionId: string;
    raisedById: string;
    reason:
      | 'WEIGHT_MISMATCH'
      | 'CONDITION_MISMATCH'
      | 'ANIMAL_NOT_AS_DESCRIBED'
      | 'NON_DELIVERY'
      | 'NON_PAYMENT'
      | 'LITS_MISMATCH'
      | 'SUSPECTED_STOLEN'
      | 'OTHER';
    description: string;
    actorRole: ActorRole;
  },
): Promise<string> {
  const held = await escrowHeldFor(tx, args.transactionId);

  const dispute = await tx.dispute.create({
    data: {
      transactionId: args.transactionId,
      raisedById: args.raisedById,
      reason: args.reason,
      description: args.description,
      heldAmount: BigInt(held),
    },
    select: { id: true },
  });

  if (held > 0) {
    await postEntry(
      tx,
      disputeHold({
        transactionId: args.transactionId,
        disputeId: dispute.id,
        amount: held,
      }),
    );
  }

  await transitionTo(tx, {
    transactionId: args.transactionId,
    to: 'DISPUTED',
    actorId: args.raisedById,
    actorRole: args.actorRole,
    reason: `${args.reason}: ${args.description}`,
  });

  return dispute.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** What is currently held against this transaction, from the ledger itself. */
async function escrowHeldFor(tx: Tx, transactionId: string): Promise<Thebe> {
  const rows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM journal_lines
    WHERE account = ${`txn:${transactionId}:held`}
  `;
  return thebe(-fromBigInt(rows[0]?.total ?? 0n));
}

/**
 * Collection codes are hashed, never stored in the clear — anyone with database
 * read access could otherwise walk animals off a farm.
 */
export async function hashCollectionCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyCollectionCode(code: string, expectedHash: string): Promise<boolean> {
  const actual = await hashCollectionCode(code);
  // Length-constant comparison; both are fixed-length hex digests.
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function generateCollectionCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return (bytes[0]! % 1_000_000).toString().padStart(6, '0');
}
