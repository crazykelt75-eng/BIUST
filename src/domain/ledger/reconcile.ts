/**
 * Daily trust account reconciliation.
 *
 * MASTER_PROMPT.md §7.4 rule 4: the ledger must reconcile to the bank, daily and
 * automatically. Any variance raises a P1 and freezes payouts until cleared.
 *
 * There are two distinct checks here and conflating them is a mistake:
 *
 *   - INTERNAL integrity: the ledger agrees with itself. Trust cash equals the
 *     sum of what we owe clients. A failure here is a code bug.
 *   - EXTERNAL reconciliation: the ledger agrees with the bank statement. A
 *     failure here is a bank timing difference, a missed webhook, an
 *     unrecorded fee — or fraud.
 *
 * Internal integrity failing is always a defect. External variance may be
 * explainable. They get separate alerts because they need separate responses.
 */

import { type Thebe, thebe } from '../money';
import { type AccountRef, accountKey, fundClassOf, isClientLiability, natureOf } from './accounts';
import { type JournalEntry } from './journal';

export type ReconciliationStatus = 'BALANCED' | 'VARIANCE_DETECTED';

export interface ReconciliationResult {
  asOfDate: Date;
  /** Trust cash per the ledger. */
  ledgerTrustCash: Thebe;
  /** Total owed to clients per the ledger (positive magnitude). */
  clientLiabilities: Thebe;
  /** Trust cash per the bank statement. */
  bankBalance: Thebe;
  /** bankBalance − ledgerTrustCash. Non-zero means investigate. */
  variance: Thebe;
  status: ReconciliationStatus;
  /** True when a variance requires payouts to be frozen. */
  freezePayouts: boolean;
  /** Set when the ledger disagrees with itself — always a defect. */
  internalIntegrityError?: string;
  breakdown: AccountBalance[];
}

export interface AccountBalance {
  account: string;
  balance: Thebe;
}

function signedBalances(entries: JournalEntry[]): Map<string, { ref: AccountRef; amount: number }> {
  const balances = new Map<string, { ref: AccountRef; amount: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const key = accountKey(line.account);
      const existing = balances.get(key);
      if (existing) {
        existing.amount += line.amount;
      } else {
        balances.set(key, { ref: line.account, amount: line.amount });
      }
    }
  }
  return balances;
}

/**
 * Check the ledger against itself: trust cash must equal what we owe clients.
 *
 * Returns null when sound, or a description of the breach. This is the check
 * that catches a bug before a farmer's money goes missing, so it runs on every
 * reconciliation and is cheap enough to assert in tests.
 */
export function checkInternalIntegrity(entries: JournalEntry[]): string | null {
  const balances = signedBalances(entries);

  let trustCash = 0;
  let clientLiabilities = 0;

  for (const { ref, amount } of balances.values()) {
    if (ref.kind === 'BANK_TRUST') {
      trustCash += amount;
    } else if (isClientLiability(ref)) {
      clientLiabilities += amount;
    }
  }

  // Cash is debit-positive, liabilities credit-positive: they must cancel.
  const residual = trustCash + clientLiabilities;
  if (residual !== 0) {
    return (
      `Trust ledger is internally inconsistent: cash ${trustCash} against client ` +
      `liabilities ${-clientLiabilities}, residual ${residual}. This is a code defect, ` +
      'not a bank timing difference.'
    );
  }

  if (trustCash < 0) {
    return `Trust cash balance is negative (${trustCash}) — the trust account cannot be overdrawn.`;
  }

  return null;
}

/**
 * Compare the ledger to the bank statement.
 *
 * `bankBalance` is the closing balance of the trust bank account for the day,
 * taken from the statement — not from anything the platform computed itself.
 */
export function reconcile(args: {
  entries: JournalEntry[];
  bankBalance: Thebe;
  asOfDate: Date;
}): ReconciliationResult {
  const balances = signedBalances(args.entries);

  let trustCash = 0;
  let clientLiabilities = 0;
  const breakdown: AccountBalance[] = [];

  for (const [key, { ref, amount }] of balances) {
    if (amount === 0) continue;
    if (fundClassOf(ref) !== 'CLIENT_TRUST') continue;

    breakdown.push({ account: key, balance: thebe(amount) });

    if (ref.kind === 'BANK_TRUST') {
      trustCash += amount;
    } else if (natureOf(ref) === 'LIABILITY') {
      clientLiabilities += amount;
    }
  }

  breakdown.sort((a, b) => a.account.localeCompare(b.account));

  const variance = args.bankBalance - trustCash;
  const integrityError = checkInternalIntegrity(args.entries);
  const balanced = variance === 0 && integrityError === null;

  return {
    asOfDate: args.asOfDate,
    ledgerTrustCash: thebe(trustCash),
    clientLiabilities: thebe(-clientLiabilities),
    bankBalance: args.bankBalance,
    variance: thebe(variance),
    status: balanced ? 'BALANCED' : 'VARIANCE_DETECTED',
    // Any unexplained variance freezes payouts. Paying out of an account whose
    // balance you cannot explain is how a trust account becomes a shortfall.
    freezePayouts: !balanced,
    ...(integrityError ? { internalIntegrityError: integrityError } : {}),
    breakdown,
  };
}

/**
 * Funds available to pay out right now: what we owe sellers, excluding anything
 * frozen in dispute and excluding fees not yet swept.
 *
 * Deliberately conservative — it answers "what can we safely release", not
 * "what is in the account".
 */
export function availableForPayout(entries: JournalEntry[]): Thebe {
  const balances = signedBalances(entries);
  let payable = 0;
  for (const { ref, amount } of balances.values()) {
    if (ref.kind === 'USER_PAYABLE' || ref.kind === 'USER_REFUNDABLE') {
      payable += amount;
    }
  }
  return thebe(-payable);
}
