/**
 * Double-entry journal.
 *
 * MASTER_PROMPT.md §7.5: every money movement is a paired entry. No exceptions,
 * no shortcuts, never a mutable balance column.
 *
 * Two invariants are enforced on every entry:
 *
 *   1. Lines sum to zero.       — ordinary double-entry
 *   2. Lines sum to zero WITHIN each fund class.  — the client/platform wall
 *
 * The second is the interesting one. It means no single entry can quietly move
 * value from client trust into platform operating: a legitimate fee sweep moves
 * money out of trust and into operating using two balanced pairs, one on each
 * side of the wall. An accidental commingle produces an imbalanced fund class
 * and is rejected at construction time, before it can ever reach the database.
 */

import { type AccountRef, type FundClass, accountKey, fundClassOf } from './accounts';
import { type Thebe, thebe } from '../money';

export type LedgerEventType =
  | 'DEPOSIT_RECEIVED'
  | 'DEPOSIT_CONFIRMED'
  | 'ESCROW_FUNDED'
  | 'SETTLEMENT'
  | 'FEE_SWEEP'
  | 'PAYOUT_EXECUTED'
  | 'REFUND_ISSUED'
  | 'PARTIAL_REFUND'
  | 'DISPUTE_HOLD'
  | 'DISPUTE_RELEASE'
  | 'SYNDICATE_PLEDGE_FUNDED'
  | 'SYNDICATE_LAPSED'
  | 'DEFAULT_DEPOSIT_FORFEITED'
  | 'CORRECTION';

export interface JournalLine {
  account: AccountRef;
  /** Signed: positive = debit, negative = credit. */
  amount: Thebe;
}

export interface JournalEntry {
  /** Idempotency key. Replaying the same business event must not double-post. */
  eventKey: string;
  event: LedgerEventType;
  narrative: string;
  lines: JournalLine[];
  transactionId?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function debit(account: AccountRef, amount: Thebe): JournalLine {
  if (amount <= 0) {
    throw new LedgerError(`Debit must be positive, got ${amount}`);
  }
  return { account, amount };
}

export function credit(account: AccountRef, amount: Thebe): JournalLine {
  if (amount <= 0) {
    throw new LedgerError(`Credit must be given as a positive magnitude, got ${amount}`);
  }
  return { account, amount: thebe(-amount) };
}

export interface EntryDraft {
  eventKey: string;
  event: LedgerEventType;
  narrative: string;
  lines: JournalLine[];
  transactionId?: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Build and validate a journal entry. Throws rather than returning an invalid
 * entry — an unbalanced journal is never something to handle gracefully and
 * carry on from.
 */
export function buildEntry(draft: EntryDraft): JournalEntry {
  const { lines } = draft;

  if (lines.length < 2) {
    throw new LedgerError(
      `Entry "${draft.eventKey}" has ${lines.length} line(s); double-entry requires at least 2`,
    );
  }

  for (const line of lines) {
    if (!Number.isInteger(line.amount)) {
      throw new LedgerError(
        `Entry "${draft.eventKey}" has a non-integer amount on ${accountKey(line.account)}`,
      );
    }
    if (line.amount === 0) {
      throw new LedgerError(
        `Entry "${draft.eventKey}" has a zero-amount line on ${accountKey(line.account)}; ` +
          'zero-value postings hide bugs rather than recording facts',
      );
    }
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total !== 0) {
    throw new LedgerError(
      `Entry "${draft.eventKey}" does not balance: lines sum to ${total}, expected 0`,
    );
  }

  const byFundClass = new Map<FundClass, number>();
  for (const line of lines) {
    const fc = fundClassOf(line.account);
    byFundClass.set(fc, (byFundClass.get(fc) ?? 0) + line.amount);
  }
  for (const [fc, subtotal] of byFundClass) {
    if (subtotal !== 0) {
      throw new LedgerError(
        `Entry "${draft.eventKey}" breaches the client/platform fund wall: ` +
          `${fc} lines sum to ${subtotal}, expected 0. Money cannot cross the wall ` +
          'within a single unpaired posting — use a balanced sweep on both sides.',
      );
    }
  }

  return {
    eventKey: draft.eventKey,
    event: draft.event,
    narrative: draft.narrative,
    lines,
    transactionId: draft.transactionId,
    occurredAt: draft.occurredAt ?? new Date(),
    metadata: draft.metadata,
  };
}

/** Current balance of one account across a set of entries. */
export function balanceOf(entries: JournalEntry[], account: AccountRef): Thebe {
  const key = accountKey(account);
  let total = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (accountKey(line.account) === key) {
        total += line.amount;
      }
    }
  }
  return thebe(total);
}

/** Every account with a non-zero balance, keyed by account string. */
export function trialBalance(entries: JournalEntry[]): Map<string, Thebe> {
  const balances = new Map<string, number>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const key = accountKey(line.account);
      balances.set(key, (balances.get(key) ?? 0) + line.amount);
    }
  }
  const result = new Map<string, Thebe>();
  for (const [key, value] of balances) {
    if (value !== 0) result.set(key, thebe(value));
  }
  return result;
}

/**
 * The books balance if every entry balances. Cheap enough to assert in tests
 * and in the nightly reconciliation job.
 */
export function assertBooksBalance(entries: JournalEntry[]): void {
  const total = entries.reduce(
    (sum, entry) => sum + entry.lines.reduce((s, l) => s + l.amount, 0),
    0,
  );
  if (total !== 0) {
    throw new LedgerError(`Books do not balance: total across all entries is ${total}`);
  }
}
