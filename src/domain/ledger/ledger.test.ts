import { describe, expect, it } from 'vitest';

import { pula, thebe } from '../money';
import { accountKey, fundClassOf, isClientLiability } from './accounts';
import {
  LedgerError,
  assertBooksBalance,
  balanceOf,
  buildEntry,
  credit,
  debit,
  trialBalance,
} from './journal';
import {
  correction,
  defaultDepositForfeited,
  depositConfirmed,
  disputeHold,
  disputeRelease,
  escrowFunded,
  feeSweep,
  payoutExecuted,
  refundIssued,
  settlement,
  syndicateMemberRefund,
  syndicatePledgeFunded,
} from './events';
import { availableForPayout, checkInternalIntegrity, reconcile } from './reconcile';

describe('journal invariants', () => {
  it('rejects an entry whose lines do not sum to zero', () => {
    expect(() =>
      buildEntry({
        eventKey: 'bad:1',
        event: 'CORRECTION',
        narrative: 'unbalanced',
        lines: [
          debit({ kind: 'BANK_TRUST' }, pula(100)),
          credit({ kind: 'USER_PAYABLE', userId: 'u1' }, pula(90)),
        ],
      }),
    ).toThrow(LedgerError);
  });

  it('rejects a single-line entry', () => {
    expect(() =>
      buildEntry({
        eventKey: 'bad:2',
        event: 'CORRECTION',
        narrative: 'one-sided',
        lines: [debit({ kind: 'BANK_TRUST' }, pula(100))],
      }),
    ).toThrow(/at least 2/);
  });

  it('rejects zero-amount lines', () => {
    expect(() =>
      buildEntry({
        eventKey: 'bad:3',
        event: 'CORRECTION',
        narrative: 'zero line',
        lines: [
          { account: { kind: 'BANK_TRUST' }, amount: thebe(0) },
          { account: { kind: 'BANK_OPERATING' }, amount: thebe(0) },
        ],
      }),
    ).toThrow(/zero-amount/);
  });

  it('rejects an entry that moves money across the client/platform wall unpaired', () => {
    // Overall this sums to zero, so plain double-entry would wave it through.
    // It still takes client money straight into the operating account.
    expect(() =>
      buildEntry({
        eventKey: 'commingle:1',
        event: 'CORRECTION',
        narrative: 'sneaky',
        lines: [
          debit({ kind: 'BANK_OPERATING' }, pula(500)),
          credit({ kind: 'TXN_HELD', transactionId: 't1' }, pula(500)),
        ],
      }),
    ).toThrow(/fund wall/);
  });

  it('allows a fee sweep, which crosses the wall using two balanced pairs', () => {
    const entry = feeSweep({ sweepId: 's1', amount: pula(250) });
    expect(entry.lines).toHaveLength(4);
    expect(entry.lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  });
});

describe('account classification', () => {
  it('keeps unswept fees on the trust side of the wall', () => {
    // Until the sweep runs the money is physically in the trust account.
    // Calling it platform money early is what makes reconciliation fail.
    expect(fundClassOf({ kind: 'PLATFORM_FEE_RECEIVABLE' })).toBe('CLIENT_TRUST');
    expect(fundClassOf({ kind: 'PLATFORM_FEE_INCOME' })).toBe('PLATFORM_OPERATING');
  });

  it('builds stable account keys', () => {
    expect(accountKey({ kind: 'TXN_HELD', transactionId: 'abc' })).toBe('txn:abc:held');
    expect(accountKey({ kind: 'USER_PAYABLE', userId: 'u9' })).toBe('user:u9:payable');
  });

  it('counts client liabilities but not trust cash', () => {
    expect(isClientLiability({ kind: 'TXN_HELD', transactionId: 't' })).toBe(true);
    expect(isClientLiability({ kind: 'BANK_TRUST' })).toBe(false);
  });
});

describe('a complete sale, end to end', () => {
  const BUYER = 'buyer-1';
  const SELLER = 'seller-1';
  const TXN = 'txn-1';
  const PRICE = pula(48_000); // 6 tollies at BWP 8,000
  const FEE = pula(1_200); // 2.5%
  const SELLER_PROCEEDS = pula(46_800);

  function fullSale() {
    return [
      depositConfirmed({ paymentId: 'p1', buyerId: BUYER, amount: PRICE }),
      escrowFunded({ transactionId: TXN, buyerId: BUYER, amount: PRICE }),
      settlement({
        transactionId: TXN,
        sellerId: SELLER,
        buyerId: BUYER,
        heldAmount: PRICE,
        sellerAmount: SELLER_PROCEEDS,
        platformFee: FEE,
      }),
    ];
  }

  it('leaves the seller payable and the fee receivable', () => {
    const entries = fullSale();
    expect(balanceOf(entries, { kind: 'USER_PAYABLE', userId: SELLER })).toBe(-SELLER_PROCEEDS);
    expect(balanceOf(entries, { kind: 'PLATFORM_FEE_RECEIVABLE' })).toBe(-FEE);
    expect(balanceOf(entries, { kind: 'TXN_HELD', transactionId: TXN })).toBe(0);
  });

  it('keeps trust cash equal to client liabilities throughout', () => {
    const entries = fullSale();
    expect(checkInternalIntegrity(entries)).toBeNull();
    expect(balanceOf(entries, { kind: 'BANK_TRUST' })).toBe(PRICE);
  });

  it('empties the trust account once the seller is paid and fees are swept', () => {
    const entries = [
      ...fullSale(),
      payoutExecuted({ payoutId: 'po1', payeeId: SELLER, amount: SELLER_PROCEEDS }),
      feeSweep({ sweepId: 'sw1', amount: FEE }),
    ];

    expect(balanceOf(entries, { kind: 'BANK_TRUST' })).toBe(0);
    expect(balanceOf(entries, { kind: 'BANK_OPERATING' })).toBe(FEE);
    expect(balanceOf(entries, { kind: 'PLATFORM_FEE_INCOME' })).toBe(-FEE);
    expect(checkInternalIntegrity(entries)).toBeNull();
    assertBooksBalance(entries);
  });

  it('refuses a settlement that does not exhaust the escrow', () => {
    expect(() =>
      settlement({
        transactionId: TXN,
        sellerId: SELLER,
        buyerId: BUYER,
        heldAmount: PRICE,
        sellerAmount: pula(40_000),
        platformFee: FEE,
        // Leaves BWP 6,800 stranded in the transaction account.
      }),
    ).toThrow(/does not exhaust escrow/);
  });
});

describe('weight-adjusted settlement', () => {
  it('splits the escrow three ways without losing a thebe', () => {
    const held = pula(50_000);
    const entries = [
      depositConfirmed({ paymentId: 'p2', buyerId: 'b2', amount: held }),
      escrowFunded({ transactionId: 't2', buyerId: 'b2', amount: held }),
      settlement({
        transactionId: 't2',
        sellerId: 's2',
        buyerId: 'b2',
        heldAmount: held,
        sellerAmount: pula(43_875),
        platformFee: pula(1_125),
        buyerRefund: pula(5_000),
      }),
    ];

    expect(balanceOf(entries, { kind: 'TXN_HELD', transactionId: 't2' })).toBe(0);
    expect(balanceOf(entries, { kind: 'USER_REFUNDABLE', userId: 'b2' })).toBe(-pula(5_000));
    expect(checkInternalIntegrity(entries)).toBeNull();
  });
});

describe('disputes', () => {
  it('freezes funds so neither party can be paid, then releases them', () => {
    const amount = pula(30_000);
    const held = [
      depositConfirmed({ paymentId: 'p3', buyerId: 'b3', amount }),
      escrowFunded({ transactionId: 't3', buyerId: 'b3', amount }),
      disputeHold({ transactionId: 't3', disputeId: 'd1', amount }),
    ];

    expect(balanceOf(held, { kind: 'TXN_HELD', transactionId: 't3' })).toBe(0);
    expect(balanceOf(held, { kind: 'TXN_DISPUTED', transactionId: 't3' })).toBe(-amount);
    expect(availableForPayout(held)).toBe(0);

    const resolved = [
      ...held,
      disputeRelease({
        transactionId: 't3',
        disputeId: 'd1',
        amount,
        outcome: 'resolved in favour of seller',
      }),
    ];
    expect(balanceOf(resolved, { kind: 'TXN_HELD', transactionId: 't3' })).toBe(-amount);
    expect(checkInternalIntegrity(resolved)).toBeNull();
  });
});

describe('syndicates', () => {
  it('refunds each member individually when a syndicate lapses', () => {
    const share = pula(15_000);
    const entries = [
      depositConfirmed({ paymentId: 'pa', buyerId: 'm1', amount: share }),
      depositConfirmed({ paymentId: 'pb', buyerId: 'm2', amount: share }),
      syndicatePledgeFunded({ syndicateId: 'sy1', userId: 'm1', paymentId: 'pa', amount: share }),
      syndicatePledgeFunded({ syndicateId: 'sy1', userId: 'm2', paymentId: 'pb', amount: share }),
      syndicateMemberRefund({ syndicateId: 'sy1', userId: 'm1', amount: share, reason: 'lapsed' }),
      syndicateMemberRefund({ syndicateId: 'sy1', userId: 'm2', amount: share, reason: 'lapsed' }),
    ];

    expect(balanceOf(entries, { kind: 'USER_REFUNDABLE', userId: 'm1' })).toBe(-share);
    expect(balanceOf(entries, { kind: 'USER_REFUNDABLE', userId: 'm2' })).toBe(-share);
    expect(checkInternalIntegrity(entries)).toBeNull();
  });

  it('moves a defaulter deposit to the seller', () => {
    const deposit = pula(2_000);
    const entries = [
      depositConfirmed({ paymentId: 'pc', buyerId: 'm3', amount: deposit }),
      syndicatePledgeFunded({ syndicateId: 'sy2', userId: 'm3', paymentId: 'pc', amount: deposit }),
      defaultDepositForfeited({
        syndicateId: 'sy2',
        defaulterId: 'm3',
        sellerId: 'seller-9',
        amount: deposit,
      }),
    ];

    expect(balanceOf(entries, { kind: 'USER_PAYABLE', userId: 'seller-9' })).toBe(-deposit);
    expect(checkInternalIntegrity(entries)).toBeNull();
  });
});

describe('corrections', () => {
  it('reverses an entry rather than editing it', () => {
    const original = depositConfirmed({ paymentId: 'p9', buyerId: 'b9', amount: pula(1_000) });
    const reversal = correction({ correctionId: 'c1', original, reason: 'duplicate webhook' });

    const net = [original, reversal];
    expect(balanceOf(net, { kind: 'BANK_TRUST' })).toBe(0);
    expect(balanceOf(net, { kind: 'USER_ESCROW_HELD', userId: 'b9' })).toBe(0);
    expect(reversal.metadata?.reverses).toBe(original.eventKey);
  });
});

describe('idempotency', () => {
  it('derives a stable event key per business event', () => {
    const a = escrowFunded({ transactionId: 't7', buyerId: 'b7', amount: pula(100) });
    const b = escrowFunded({ transactionId: 't7', buyerId: 'b7', amount: pula(100) });
    // The DB unique constraint on eventKey turns a replayed webhook into a
    // no-op instead of a double-posting.
    expect(a.eventKey).toBe(b.eventKey);
  });
});

describe('reconciliation', () => {
  const entries = [
    depositConfirmed({ paymentId: 'r1', buyerId: 'rb', amount: pula(20_000) }),
    escrowFunded({ transactionId: 'rt', buyerId: 'rb', amount: pula(20_000) }),
  ];

  it('balances when the bank agrees with the ledger', () => {
    const result = reconcile({
      entries,
      bankBalance: pula(20_000),
      asOfDate: new Date('2026-07-26'),
    });

    expect(result.status).toBe('BALANCED');
    expect(result.variance).toBe(0);
    expect(result.freezePayouts).toBe(false);
    expect(result.clientLiabilities).toBe(pula(20_000));
  });

  it('freezes payouts on any variance', () => {
    const result = reconcile({
      entries,
      bankBalance: pula(19_950), // BWP 50 unexplained
      asOfDate: new Date('2026-07-26'),
    });

    expect(result.status).toBe('VARIANCE_DETECTED');
    expect(result.variance).toBe(-pula(50));
    expect(result.freezePayouts).toBe(true);
  });

  it('reports what is safely payable, excluding disputed funds', () => {
    const withDispute = [
      ...entries,
      settlement({
        transactionId: 'rt',
        sellerId: 'rs',
        buyerId: 'rb',
        heldAmount: pula(20_000),
        sellerAmount: pula(19_500),
        platformFee: pula(500),
      }),
    ];
    expect(availableForPayout(withDispute)).toBe(pula(19_500));
  });

  it('lists trust account balances in the breakdown', () => {
    const result = reconcile({
      entries,
      bankBalance: pula(20_000),
      asOfDate: new Date('2026-07-26'),
    });
    const accounts = result.breakdown.map((b) => b.account);
    expect(accounts).toContain('bank:trust');
    expect(accounts).toContain('txn:rt:held');
  });
});

describe('trial balance', () => {
  it('omits accounts that have netted to zero', () => {
    const entries = [
      depositConfirmed({ paymentId: 'tb1', buyerId: 'tb', amount: pula(500) }),
      escrowFunded({ transactionId: 'tbt', buyerId: 'tb', amount: pula(500) }),
    ];
    const tb = trialBalance(entries);
    expect(tb.has('user:tb:escrow_held')).toBe(false);
    expect(tb.get('bank:trust')).toBe(pula(500));
  });
});
