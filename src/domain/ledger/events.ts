/**
 * Business events → journal entries.
 *
 * This module is the executable form of the ledger movement table in
 * MASTER_PROMPT.md §7.5. If the spec table and this file ever disagree, one of
 * them is a bug; they are meant to be read side by side.
 *
 * Every builder is pure: it takes facts, returns a validated entry, touches
 * nothing. Persistence happens in the repository layer, inside the same DB
 * transaction as the state change that caused it (§10.1).
 */

import { type Thebe, ZERO, add, thebe } from '../money';
import { type JournalEntry, buildEntry, credit, debit } from './journal';

/**
 * Buyer's money lands in the trust account.
 *
 * Only ever called for a bank-CONFIRMED payment. A payment that has merely been
 * initiated does not post to the ledger and does not advance a transaction —
 * that optimism is precisely the hole a fraudster walks through (§7.4).
 */
export function depositConfirmed(args: {
  paymentId: string;
  buyerId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `deposit:${args.paymentId}`,
    event: 'DEPOSIT_CONFIRMED',
    narrative: `Confirmed deposit from buyer ${args.buyerId}`,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'BANK_TRUST' }, args.amount),
      credit({ kind: 'USER_ESCROW_HELD', userId: args.buyerId }, args.amount),
    ],
  });
}

/** Buyer's held funds are committed to a specific transaction. */
export function escrowFunded(args: {
  transactionId: string;
  buyerId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `escrow-funded:${args.transactionId}`,
    event: 'ESCROW_FUNDED',
    narrative: `Escrow funded for transaction ${args.transactionId}`,
    transactionId: args.transactionId,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'USER_ESCROW_HELD', userId: args.buyerId }, args.amount),
      credit({ kind: 'TXN_HELD', transactionId: args.transactionId }, args.amount),
    ],
  });
}

/**
 * Collection confirmed — split the held funds.
 *
 * `buyerRefund` is non-zero when the weight came in under tolerance and the
 * price recalculated downward (§3.4). The three outputs must exhaust the held
 * amount exactly; anything else means the settlement arithmetic is wrong, and
 * it is better to fail loudly here than to leave orphaned thebe in a
 * transaction account nobody ever looks at again.
 */
export function settlement(args: {
  transactionId: string;
  sellerId: string;
  buyerId: string;
  heldAmount: Thebe;
  sellerAmount: Thebe;
  platformFee: Thebe;
  buyerRefund?: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  const refund = args.buyerRefund ?? ZERO;
  const distributed = add(args.sellerAmount, args.platformFee, refund);

  if (distributed !== args.heldAmount) {
    throw new Error(
      `Settlement for ${args.transactionId} does not exhaust escrow: held ${args.heldAmount}, ` +
        `distributing ${distributed} (seller ${args.sellerAmount} + fee ${args.platformFee} + ` +
        `refund ${refund})`,
    );
  }

  const lines = [
    debit({ kind: 'TXN_HELD' as const, transactionId: args.transactionId }, args.heldAmount),
    credit({ kind: 'USER_PAYABLE' as const, userId: args.sellerId }, args.sellerAmount),
  ];

  if (args.platformFee > 0) {
    lines.push(credit({ kind: 'PLATFORM_FEE_RECEIVABLE' as const }, args.platformFee));
  }
  if (refund > 0) {
    lines.push(credit({ kind: 'USER_REFUNDABLE' as const, userId: args.buyerId }, refund));
  }

  return buildEntry({
    eventKey: `settlement:${args.transactionId}`,
    event: 'SETTLEMENT',
    narrative: `Settlement of transaction ${args.transactionId}`,
    transactionId: args.transactionId,
    occurredAt: args.occurredAt,
    lines,
  });
}

/**
 * Move earned fees from the trust account to the operating account.
 *
 * Four lines, two balanced pairs, one on each side of the fund wall. This is
 * the *only* legitimate way platform money leaves the trust account, and it is
 * an explicit, logged transfer — never a silent deduction from a balance
 * (§7.4 rule 3).
 */
export function feeSweep(args: {
  sweepId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `fee-sweep:${args.sweepId}`,
    event: 'FEE_SWEEP',
    narrative: `Fee sweep ${args.sweepId} from trust to operating`,
    occurredAt: args.occurredAt,
    lines: [
      // Trust side: the obligation and the cash both leave.
      debit({ kind: 'PLATFORM_FEE_RECEIVABLE' }, args.amount),
      credit({ kind: 'BANK_TRUST' }, args.amount),
      // Operating side: the cash arrives and revenue is recognised.
      debit({ kind: 'BANK_OPERATING' }, args.amount),
      credit({ kind: 'PLATFORM_FEE_INCOME' }, args.amount),
    ],
  });
}

/** Seller is actually paid; money leaves the trust bank account. */
export function payoutExecuted(args: {
  payoutId: string;
  payeeId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `payout:${args.payoutId}`,
    event: 'PAYOUT_EXECUTED',
    narrative: `Payout ${args.payoutId} to ${args.payeeId}`,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'USER_PAYABLE', userId: args.payeeId }, args.amount),
      credit({ kind: 'BANK_TRUST' }, args.amount),
    ],
  });
}

/** Transaction cancelled before settlement — the buyer's committed funds unwind. */
export function refundIssued(args: {
  transactionId: string;
  buyerId: string;
  amount: Thebe;
  reason: string;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `refund:${args.transactionId}`,
    event: 'REFUND_ISSUED',
    narrative: `Refund for transaction ${args.transactionId}: ${args.reason}`,
    transactionId: args.transactionId,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'TXN_HELD', transactionId: args.transactionId }, args.amount),
      credit({ kind: 'USER_REFUNDABLE', userId: args.buyerId }, args.amount),
    ],
  });
}

/** A dispute freezes the funds. Neither party is paid until it resolves. */
export function disputeHold(args: {
  transactionId: string;
  disputeId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `dispute-hold:${args.disputeId}`,
    event: 'DISPUTE_HOLD',
    narrative: `Funds frozen for dispute ${args.disputeId}`,
    transactionId: args.transactionId,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'TXN_HELD', transactionId: args.transactionId }, args.amount),
      credit({ kind: 'TXN_DISPUTED', transactionId: args.transactionId }, args.amount),
    ],
  });
}

/**
 * Dispute resolved — return the frozen funds to the transaction account so the
 * normal settlement or refund path can run. Splitting the outcome between the
 * parties is then an ordinary settlement with adjusted figures, which keeps
 * one settlement code path rather than two.
 */
export function disputeRelease(args: {
  transactionId: string;
  disputeId: string;
  amount: Thebe;
  outcome: string;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `dispute-release:${args.disputeId}`,
    event: 'DISPUTE_RELEASE',
    narrative: `Dispute ${args.disputeId} resolved: ${args.outcome}`,
    transactionId: args.transactionId,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'TXN_DISPUTED', transactionId: args.transactionId }, args.amount),
      credit({ kind: 'TXN_HELD', transactionId: args.transactionId }, args.amount),
    ],
  });
}

/** A syndicate member's binding pledge is funded into trust (§6.3). */
export function syndicatePledgeFunded(args: {
  syndicateId: string;
  userId: string;
  paymentId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `syndicate-pledge:${args.syndicateId}:${args.userId}`,
    event: 'SYNDICATE_PLEDGE_FUNDED',
    narrative: `Syndicate ${args.syndicateId} pledge funded by ${args.userId}`,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'USER_ESCROW_HELD', userId: args.userId }, args.amount),
      credit({ kind: 'SYNDICATE_MEMBER', syndicateId: args.syndicateId, userId: args.userId }, args.amount),
    ],
  });
}

/**
 * Syndicate lapsed or dissolved — every member is refunded individually.
 *
 * Deliberately one entry per member rather than one aggregate entry: when a
 * refund fails, it must be traceable to a person, and a lapsed syndicate is
 * exactly the moment members are anxious about their money.
 */
export function syndicateMemberRefund(args: {
  syndicateId: string;
  userId: string;
  amount: Thebe;
  reason: string;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `syndicate-refund:${args.syndicateId}:${args.userId}`,
    event: 'SYNDICATE_LAPSED',
    narrative: `Syndicate ${args.syndicateId} refund to ${args.userId}: ${args.reason}`,
    occurredAt: args.occurredAt,
    lines: [
      debit({ kind: 'SYNDICATE_MEMBER', syndicateId: args.syndicateId, userId: args.userId }, args.amount),
      credit({ kind: 'USER_REFUNDABLE', userId: args.userId }, args.amount),
    ],
  });
}

/**
 * A member defaulted after pledges became binding; their deposit compensates
 * the seller for holding stock (§6.4).
 */
export function defaultDepositForfeited(args: {
  syndicateId: string;
  defaulterId: string;
  sellerId: string;
  amount: Thebe;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `default-forfeit:${args.syndicateId}:${args.defaulterId}`,
    event: 'DEFAULT_DEPOSIT_FORFEITED',
    narrative: `Default deposit from ${args.defaulterId} forfeited to seller ${args.sellerId}`,
    occurredAt: args.occurredAt,
    lines: [
      debit(
        { kind: 'SYNDICATE_MEMBER', syndicateId: args.syndicateId, userId: args.defaulterId },
        args.amount,
      ),
      credit({ kind: 'USER_PAYABLE', userId: args.sellerId }, args.amount),
    ],
  });
}

/**
 * Reverse a prior entry. Corrections are new entries, never edits — the journal
 * is append-only because it is evidence (§10.3).
 */
export function correction(args: {
  correctionId: string;
  original: JournalEntry;
  reason: string;
  occurredAt?: Date;
}): JournalEntry {
  return buildEntry({
    eventKey: `correction:${args.correctionId}`,
    event: 'CORRECTION',
    narrative: `Reversal of ${args.original.eventKey}: ${args.reason}`,
    transactionId: args.original.transactionId,
    occurredAt: args.occurredAt,
    metadata: { reverses: args.original.eventKey },
    lines: args.original.lines.map((line) => ({
      account: line.account,
      amount: thebe(-line.amount),
    })),
  });
}
