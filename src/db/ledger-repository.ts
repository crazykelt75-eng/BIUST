/**
 * Ledger persistence.
 *
 * The domain layer (src/domain/ledger) builds and validates entries; this
 * module writes them. It deliberately does NOT open its own database
 * transaction — it takes one. Posting money is always part of a larger unit of
 * work, and a repository that commits on its own behalf makes atomicity
 * impossible for its callers (MASTER_PROMPT §10.1).
 */

// See prisma-client.ts — importing '@prisma/client' directly breaks on Workers.
import { Prisma } from './prisma-client';

import type { Tx } from './client';
import { accountKey, fundClassOf } from '../domain/ledger/accounts';
import type { JournalEntry } from '../domain/ledger/journal';
import { type Thebe, fromBigInt, thebe } from '../domain/money';

export interface PostResult {
  entryId: string;
  /** True when this event had already been posted and was skipped. */
  idempotentReplay: boolean;
}

/**
 * Raised when two concurrent callers race to post the same business event.
 *
 * Recoverable by retrying the whole unit of work: the retry takes the fast path
 * below and returns the entry the winner posted.
 */
export class LedgerConcurrencyError extends Error {
  constructor(readonly eventKey: string) {
    super(
      `Journal entry "${eventKey}" was posted concurrently by another writer. ` +
        'Retry the operation — the retry will observe the existing entry.',
    );
    this.name = 'LedgerConcurrencyError';
  }
}

/**
 * Post a validated journal entry.
 *
 * Idempotent on `eventKey`: a replayed payment webhook, a retried job, or a
 * double-clicked admin button posts once.
 *
 * Note the ordering — existence is checked *before* inserting, not by catching
 * the unique violation afterwards. In PostgreSQL a failed statement aborts the
 * entire surrounding transaction ("current transaction is aborted, commands
 * ignored until end of transaction block"), so the catch-then-query pattern
 * cannot recover: the recovery query is itself rejected. Since every caller
 * here posts inside a larger transaction, checking first is the only version
 * that works.
 *
 * The unique index remains the real guarantee. It just serves as the backstop
 * for a genuine concurrent race rather than the primary control flow, and that
 * race surfaces as a retryable error.
 */
export async function postEntry(tx: Tx, entry: JournalEntry): Promise<PostResult> {
  const existing = await tx.journalEntry.findUnique({
    where: { eventKey: entry.eventKey },
    select: { id: true },
  });

  if (existing) {
    return { entryId: existing.id, idempotentReplay: true };
  }

  try {
    const created = await tx.journalEntry.create({
      data: {
        eventKey: entry.eventKey,
        event: entry.event,
        narrative: entry.narrative,
        transactionId: entry.transactionId ?? null,
        occurredAt: entry.occurredAt,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        lines: {
          create: entry.lines.map((line) => ({
            account: accountKey(line.account),
            fundClass: fundClassOf(line.account),
            amount: BigInt(line.amount),
          })),
        },
      },
      select: { id: true },
    });

    return { entryId: created.id, idempotentReplay: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Another writer won the race between our check and our insert. The
      // transaction is now aborted, so we cannot look up their entry from
      // here — surface it as retryable and let the caller start again.
      throw new LedgerConcurrencyError(entry.eventKey);
    }
    throw error;
  }
}

/** Post several entries as part of the caller's transaction. */
export async function postEntries(tx: Tx, entries: JournalEntry[]): Promise<PostResult[]> {
  const results: PostResult[] = [];
  for (const entry of entries) {
    results.push(await postEntry(tx, entry));
  }
  return results;
}

/** Current balance of a single account. */
export async function accountBalance(tx: Tx, account: string): Promise<Thebe> {
  const result = await tx.journalLine.aggregate({
    where: { account },
    _sum: { amount: true },
  });
  return result._sum.amount === null ? thebe(0) : fromBigInt(result._sum.amount);
}

export interface TrustPosition {
  /** Cash in the trust bank account. */
  trustCash: Thebe;
  /** Total owed to clients, as a positive magnitude. */
  clientLiabilities: Thebe;
  /** Should always be zero. Non-zero is a code defect, not a timing difference. */
  residual: Thebe;
}

/**
 * The trust account's internal position, computed in the database rather than
 * by loading every journal line into memory. At any real volume, the naive
 * version stops being viable well before anyone notices it is the problem.
 */
export async function trustPosition(tx: Tx): Promise<TrustPosition> {
  const rows = await tx.$queryRaw<{ trust_cash: bigint; client_liabilities: bigint }[]>`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE account = 'bank:trust'), 0) AS trust_cash,
      COALESCE(SUM(amount) FILTER (
        WHERE "fundClass" = 'CLIENT_TRUST' AND account <> 'bank:trust'
      ), 0) AS client_liabilities
    FROM journal_lines
  `;

  const row = rows[0] ?? { trust_cash: 0n, client_liabilities: 0n };
  const trustCash = fromBigInt(row.trust_cash);
  const liabilities = fromBigInt(row.client_liabilities);

  return {
    trustCash,
    clientLiabilities: thebe(-liabilities),
    residual: thebe(trustCash + liabilities),
  };
}

/**
 * What can safely be paid out right now: amounts owed to users, excluding
 * anything frozen in dispute and fees not yet swept.
 */
export async function availableForPayout(tx: Tx): Promise<Thebe> {
  const rows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM journal_lines
    WHERE account LIKE 'user:%:payable' OR account LIKE 'user:%:refundable'
  `;
  return thebe(-fromBigInt(rows[0]?.total ?? 0n));
}

/** Full account listing for the reconciliation report. */
export async function trialBalance(tx: Tx): Promise<{ account: string; balance: Thebe }[]> {
  const rows = await tx.$queryRaw<{ account: string; balance: bigint }[]>`
    SELECT account, SUM(amount) AS balance
    FROM journal_lines
    GROUP BY account
    HAVING SUM(amount) <> 0
    ORDER BY account
  `;
  return rows.map((r) => ({ account: r.account, balance: fromBigInt(r.balance) }));
}

/** Every entry touching one transaction, oldest first — the audit trail. */
export async function entriesForTransaction(tx: Tx, transactionId: string) {
  return tx.journalEntry.findMany({
    where: { transactionId },
    include: { lines: true },
    orderBy: { occurredAt: 'asc' },
  });
}
