/**
 * Ledger account keys and the client/platform fund wall.
 *
 * MASTER_PROMPT.md §7.4 rule 1: client funds and platform funds live in separate
 * bank accounts. This module makes commingling a type error rather than a habit
 * question — every account carries its fund class, and the journal refuses to
 * post an entry that moves value across the wall without an explicit sweep.
 */

export type FundClass = 'CLIENT_TRUST' | 'PLATFORM_OPERATING';

export type AccountRef =
  /** The trust bank account. Asset. Holds client money only. */
  | { kind: 'BANK_TRUST' }
  /** The operating bank account. Asset. Platform money only. */
  | { kind: 'BANK_OPERATING' }
  /** Buyer funds received but not yet allocated to a transaction. Liability. */
  | { kind: 'USER_ESCROW_HELD'; userId: string }
  /** Owed to a seller, awaiting the next payout run. Liability. */
  | { kind: 'USER_PAYABLE'; userId: string }
  /** Owed back to a buyer after cancellation. Liability. */
  | { kind: 'USER_REFUNDABLE'; userId: string }
  /** Funds committed to a specific transaction. Liability. */
  | { kind: 'TXN_HELD'; transactionId: string }
  /** Funds frozen pending dispute resolution. Liability. Neither party is paid. */
  | { kind: 'TXN_DISPUTED'; transactionId: string }
  /** Platform fee earned but still sitting in the trust account. Liability. */
  | { kind: 'PLATFORM_FEE_RECEIVABLE' }
  /** Fee income, recognised once swept to operating. Revenue. */
  | { kind: 'PLATFORM_FEE_INCOME' }
  /** A syndicate member's funded pledge. Liability. */
  | { kind: 'SYNDICATE_MEMBER'; syndicateId: string; userId: string };

export function accountKey(ref: AccountRef): string {
  switch (ref.kind) {
    case 'BANK_TRUST':
      return 'bank:trust';
    case 'BANK_OPERATING':
      return 'bank:operating';
    case 'USER_ESCROW_HELD':
      return `user:${ref.userId}:escrow_held`;
    case 'USER_PAYABLE':
      return `user:${ref.userId}:payable`;
    case 'USER_REFUNDABLE':
      return `user:${ref.userId}:refundable`;
    case 'TXN_HELD':
      return `txn:${ref.transactionId}:held`;
    case 'TXN_DISPUTED':
      return `txn:${ref.transactionId}:disputed`;
    case 'PLATFORM_FEE_RECEIVABLE':
      return 'platform:fee_receivable';
    case 'PLATFORM_FEE_INCOME':
      return 'platform:fee_income';
    case 'SYNDICATE_MEMBER':
      return `syndicate:${ref.syndicateId}:member:${ref.userId}`;
  }
}

/**
 * Which side of the wall an account sits on.
 *
 * PLATFORM_FEE_RECEIVABLE is deliberately CLIENT_TRUST: until the sweep runs,
 * that money is physically in the trust account, and the reconciliation check
 * must account for it. Calling it platform money early is exactly the error
 * that makes a trust account fail to balance.
 */
export function fundClassOf(ref: AccountRef): FundClass {
  switch (ref.kind) {
    case 'BANK_TRUST':
    case 'USER_ESCROW_HELD':
    case 'USER_PAYABLE':
    case 'USER_REFUNDABLE':
    case 'TXN_HELD':
    case 'TXN_DISPUTED':
    case 'PLATFORM_FEE_RECEIVABLE':
    case 'SYNDICATE_MEMBER':
      return 'CLIENT_TRUST';
    case 'BANK_OPERATING':
    case 'PLATFORM_FEE_INCOME':
      return 'PLATFORM_OPERATING';
  }
}

/** Assets are debit-positive; liabilities and revenue are credit-positive. */
export type AccountNature = 'ASSET' | 'LIABILITY' | 'REVENUE';

export function natureOf(ref: AccountRef): AccountNature {
  switch (ref.kind) {
    case 'BANK_TRUST':
    case 'BANK_OPERATING':
      return 'ASSET';
    case 'PLATFORM_FEE_INCOME':
      return 'REVENUE';
    default:
      return 'LIABILITY';
  }
}

/**
 * Client-money liability accounts. Their combined balance is what the trust
 * bank account must equal at reconciliation (§7.4 rule 4).
 */
export function isClientLiability(ref: AccountRef): boolean {
  return fundClassOf(ref) === 'CLIENT_TRUST' && natureOf(ref) === 'LIABILITY';
}
