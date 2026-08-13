/**
 * Integration tests against a real PostgreSQL + PostGIS database.
 *
 * These exist because the invariants that matter most — atomicity of money and
 * state, append-only enforcement, the trust account never going negative — are
 * properties of the database, not of the domain layer. Unit tests cannot
 * observe them.
 *
 * Run with DATABASE_URL pointing at a disposable database:
 *   npm run test:integration
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../db/client';
import { availableForPayout, postEntry, trustPosition } from '../db/ledger-repository';
import { depositConfirmed } from '../domain/ledger/events';
import { pula } from '../domain/money';
import {
  TransactionError,
  cancelTransaction,
  confirmEscrowFunding,
  hashCollectionCode,
  raiseDispute,
  recordCollection,
  settleTransaction,
  transitionTo,
} from './transaction-service';

const SEED = {
  zoneGreen: 'zone-green',
  zoneRed: 'zone-red',
  seller: 'user-seller',
  buyer: 'user-buyer',
  farmSeller: 'farm-seller',
  farmBuyer: 'farm-buyer',
  listing: 'listing-1',
  txn: 'txn-1',
  payment: 'payment-1',
};

const PRICE = pula(48_000);
const COLLECTION_CODE = '123456';

async function resetDatabase() {
  // TRUNCATE rather than DELETE: the evidence tables refuse row deletion by
  // design. In production the app role must not hold this privilege.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      journal_lines, journal_entries, transaction_events, audit_log,
      disputes, ratings, payments, payouts, transactions, offers,
      alert_sends, alert_profiles, listing_media, animals, listings,
      farms, verifications, zone_restrictions, zones, users
    RESTART IDENTITY CASCADE
  `);
}

async function seed(opts: { permitRequired?: boolean; buyerZone?: string } = {}) {
  await prisma.zone.createMany({
    data: [
      { id: SEED.zoneGreen, code: 'Z6', name: 'Zone 6 — Central' },
      { id: SEED.zoneRed, code: 'Z3', name: 'Zone 3 — North East' },
    ],
  });

  await prisma.user.createMany({
    data: [
      { id: SEED.seller, phone: '+26771000001', tier: 'T2_VERIFIED_FARMER' },
      { id: SEED.buyer, phone: '+26771000002', tier: 'T2_VERIFIED_FARMER' },
    ],
  });

  await prisma.farm.createMany({
    data: [
      { id: SEED.farmSeller, ownerId: SEED.seller, name: 'Serowe Cattle Post', zoneId: SEED.zoneGreen },
      {
        id: SEED.farmBuyer,
        ownerId: SEED.buyer,
        name: 'Palapye Farm',
        zoneId: opts.buyerZone ?? SEED.zoneGreen,
      },
    ],
  });

  await prisma.listing.create({
    data: {
      id: SEED.listing,
      sellerId: SEED.seller,
      farmId: SEED.farmSeller,
      zoneId: SEED.zoneGreen,
      title: '6 Brahman tollies',
      priceBasis: 'PER_KG_LIVE',
      askingPrice: BigInt(PRICE),
      status: 'ACTIVE',
    },
  });

  await prisma.transaction.create({
    data: {
      id: SEED.txn,
      listingId: SEED.listing,
      buyerId: SEED.buyer,
      sellerId: SEED.seller,
      state: 'ESCROW_PENDING',
      agreedAmount: BigInt(PRICE),
      priceBasis: 'PER_KG_LIVE',
      declaredWeightKg: 2_000,
      permitRequired: opts.permitRequired ?? false,
      collectionCodeHash: await hashCollectionCode(COLLECTION_CODE),
    },
  });

  await prisma.payment.create({
    data: {
      id: SEED.payment,
      transactionId: SEED.txn,
      payerId: SEED.buyer,
      method: 'ORANGE_MONEY',
      amount: BigInt(PRICE),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('escrow funding', () => {
  it('posts the ledger and advances state in one commit', async () => {
    await seed();

    const state = await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    expect(state).toBe('READY_FOR_COLLECTION');

    const position = await trustPosition(prisma);
    expect(position.trustCash).toBe(PRICE);
    expect(position.clientLiabilities).toBe(PRICE);
    expect(position.residual).toBe(0);
  });

  it('refuses to fund escrow from an unconfirmed payment', async () => {
    await seed();
    await prisma.payment.update({
      where: { id: SEED.payment },
      data: { status: 'PENDING', confirmedAt: null },
    });

    await expect(
      prisma.$transaction((tx) =>
        confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
      ),
    ).rejects.toThrow(/not CONFIRMED/);

    // Nothing posted — the trust account never saw this money.
    const position = await trustPosition(prisma);
    expect(position.trustCash).toBe(0);
  });

  it('routes a cross-zone trade through the permit state', async () => {
    await seed({ permitRequired: true, buyerZone: SEED.zoneRed });

    const state = await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    expect(state).toBe('PERMIT_PENDING');
  });

  it('is idempotent — a replayed webhook does not double-post', async () => {
    await seed();

    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    // The ledger recognises both events as replays; the state machine then
    // rejects the redundant transition. Money is posted exactly once either way.
    await expect(
      prisma.$transaction((tx) =>
        confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
      ),
    ).rejects.toThrow(TransactionError);

    const position = await trustPosition(prisma);
    expect(position.trustCash).toBe(PRICE);

    const entries = await prisma.journalEntry.count({
      where: { eventKey: `escrow-funded:${SEED.txn}` },
    });
    expect(entries).toBe(1);
  });
});

describe('ledger idempotency', () => {
  it('returns the existing entry instead of posting twice', async () => {
    await seed();
    const entry = depositConfirmed({
      paymentId: SEED.payment,
      buyerId: SEED.buyer,
      amount: PRICE,
    });

    const first = await prisma.$transaction((tx) => postEntry(tx, entry));
    const second = await prisma.$transaction((tx) => postEntry(tx, entry));

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.entryId).toBe(first.entryId);

    // Critically: the trust account holds the amount once, not twice.
    const position = await trustPosition(prisma);
    expect(position.trustCash).toBe(PRICE);
    expect(await prisma.journalLine.count()).toBe(2);
  });

  it('survives a replay inside a transaction that continues afterwards', async () => {
    await seed();
    const entry = depositConfirmed({
      paymentId: SEED.payment,
      buyerId: SEED.buyer,
      amount: PRICE,
    });

    await prisma.$transaction((tx) => postEntry(tx, entry));

    // A caught unique violation would have aborted this transaction and made
    // every subsequent statement fail. Checking before inserting keeps the
    // transaction usable.
    const result = await prisma.$transaction(async (tx) => {
      const replay = await postEntry(tx, entry);
      const position = await trustPosition(tx);
      return { replay, position };
    });

    expect(result.replay.idempotentReplay).toBe(true);
    expect(result.position.trustCash).toBe(PRICE);
  });
});

describe('atomicity', () => {
  it('rolls back the state change when the ledger write fails', async () => {
    await seed();

    // Force a failure after the ledger post but inside the same transaction.
    await expect(
      prisma.$transaction(async (tx) => {
        await confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment });
        throw new Error('simulated downstream failure');
      }),
    ).rejects.toThrow('simulated downstream failure');

    // Neither the money nor the state survived. This is the whole point.
    const position = await trustPosition(prisma);
    expect(position.trustCash).toBe(0);

    const txn = await prisma.transaction.findUniqueOrThrow({ where: { id: SEED.txn } });
    expect(txn.state).toBe('ESCROW_PENDING');

    const events = await prisma.transactionEvent.count({ where: { transactionId: SEED.txn } });
    expect(events).toBe(0);
  });
});

describe('zone restrictions', () => {
  it('blocks collection once an outbreak is declared, even mid-transaction', async () => {
    await seed();

    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    // Buyer is in a different zone, and the seller's zone closes.
    await prisma.farm.update({
      where: { id: SEED.farmBuyer },
      data: { zoneId: SEED.zoneRed },
    });
    await prisma.zoneRestriction.create({
      data: {
        zoneId: SEED.zoneGreen,
        kind: 'FMD_OUTBREAK',
        direction: 'OUTBOUND',
        reason: 'Confirmed FMD case',
        effectiveAt: new Date(Date.now() - 1000),
        declaredBy: 'DVS',
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        transitionTo(tx, {
          transactionId: SEED.txn,
          to: 'IN_TRANSIT',
          actorRole: 'BUYER',
        }),
      ),
    ).rejects.toThrow(/disease-control restriction/);
  });

  it('still allows cancellation and refund while restricted', async () => {
    await seed();
    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    await prisma.farm.update({ where: { id: SEED.farmBuyer }, data: { zoneId: SEED.zoneRed } });
    await prisma.zoneRestriction.create({
      data: {
        zoneId: SEED.zoneGreen,
        kind: 'FMD_OUTBREAK',
        direction: 'OUTBOUND',
        reason: 'Confirmed FMD case',
        effectiveAt: new Date(Date.now() - 1000),
        declaredBy: 'DVS',
      },
    });

    // A restriction must never trap a buyer's money.
    await prisma.$transaction((tx) =>
      cancelTransaction(tx, {
        transactionId: SEED.txn,
        reason: 'Zone closed by FMD outbreak',
        actorRole: 'ADMIN',
      }),
    );

    const refundable = await availableForPayout(prisma);
    expect(refundable).toBe(PRICE);
  });
});

describe('collection and settlement', () => {
  async function fundAndCollect(actualWeightKg: number) {
    await seed();
    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );
    return prisma.$transaction((tx) =>
      recordCollection(tx, {
        transactionId: SEED.txn,
        actualWeightKg,
        collectionCode: COLLECTION_CODE,
        actorId: SEED.buyer,
      }),
    );
  }

  it('settles at the agreed price when weight is within tolerance', async () => {
    const { state, settlement } = await fundAndCollect(1_960);
    expect(state).toBe('INSPECTION_WINDOW');
    expect(settlement.outcome).toBe('SETTLE_AS_AGREED');

    const proceeds = await prisma.$transaction((tx) =>
      settleTransaction(tx, { transactionId: SEED.txn, actorRole: 'SYSTEM' }),
    );

    expect(proceeds).toBe(pula(46_800)); // 48,000 less the 2.5% fee
    const position = await trustPosition(prisma);
    expect(position.residual).toBe(0);
  });

  it('recalculates pro rata when weight is under tolerance, refunding the buyer', async () => {
    const { settlement } = await fundAndCollect(1_800); // 10% under
    expect(settlement.outcome).toBe('ADJUSTED_DOWN_PENDING_SELLER');
    expect(settlement.settledAmount).toBe(pula(43_200));

    await prisma.$transaction((tx) =>
      settleTransaction(tx, { transactionId: SEED.txn, actorRole: 'ADMIN' }),
    );

    // Escrow splits exactly: seller + fee + buyer refund, nothing stranded.
    const held = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0) AS total FROM journal_lines
      WHERE account = ${`txn:${SEED.txn}:held`}
    `;
    expect(Number(held[0]!.total)).toBe(0);

    const position = await trustPosition(prisma);
    expect(position.residual).toBe(0);
    expect(position.trustCash).toBe(PRICE);
  });

  it('rejects a wrong collection code', async () => {
    await seed();
    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    await expect(
      prisma.$transaction((tx) =>
        recordCollection(tx, {
          transactionId: SEED.txn,
          actualWeightKg: 2_000,
          collectionCode: '999999',
          actorId: SEED.buyer,
        }),
      ),
    ).rejects.toThrow(/Collection code does not match/);
  });

  it('refuses to let a seller settle their own sale', async () => {
    await fundAndCollect(2_000);

    await expect(
      prisma.$transaction((tx) =>
        settleTransaction(tx, { transactionId: SEED.txn, actorRole: 'SELLER' }),
      ),
    ).rejects.toThrow(/cannot settle their own sale/);
  });
});

describe('disputes', () => {
  it('freezes the funds so neither party can be paid', async () => {
    await seed();
    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );
    await prisma.$transaction((tx) =>
      recordCollection(tx, {
        transactionId: SEED.txn,
        actualWeightKg: 1_500,
        collectionCode: COLLECTION_CODE,
        actorId: SEED.buyer,
      }),
    );

    await prisma.$transaction((tx) =>
      raiseDispute(tx, {
        transactionId: SEED.txn,
        raisedById: SEED.buyer,
        reason: 'WEIGHT_MISMATCH',
        description: 'Animals 25% lighter than declared',
        actorRole: 'BUYER',
      }),
    );

    expect(await availableForPayout(prisma)).toBe(0);

    const txn = await prisma.transaction.findUniqueOrThrow({ where: { id: SEED.txn } });
    expect(txn.state).toBe('DISPUTED');

    const position = await trustPosition(prisma);
    expect(position.residual).toBe(0);
  });
});

describe('append-only enforcement', () => {
  it('refuses to update a posted ledger line', async () => {
    await seed();
    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    const line = await prisma.journalLine.findFirstOrThrow();
    await expect(
      prisma.journalLine.update({ where: { id: line.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to delete a transaction event', async () => {
    await seed();
    await prisma.$transaction((tx) =>
      confirmEscrowFunding(tx, { transactionId: SEED.txn, paymentId: SEED.payment }),
    );

    const event = await prisma.transactionEvent.findFirstOrThrow();
    await expect(
      prisma.transactionEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/append-only/);
  });
});
