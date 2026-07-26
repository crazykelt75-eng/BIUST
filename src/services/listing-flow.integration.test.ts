/**
 * Listing publication, anti-theft checks, and alert fan-out, end to end.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../db/client';
import { pula } from '../domain/money';
import { ListingError, provenanceOf, publishListing, recordTransfer, reportStolen } from './listing-service';
import { fanOutListing } from './match-worker';

const IDS = {
  zoneGreen: 'z-green',
  zoneRed: 'z-red',
  mpho: 'u-mpho', // seller
  kabelo: 'u-kabelo', // buyer with a matching alert profile
  thief: 'u-thief',
  farmMpho: 'f-mpho',
  farmKabelo: 'f-kabelo',
  farmThief: 'f-thief',
  profile: 'ap-kabelo',
};

const LITS = 'BW123456789';

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      journal_lines, journal_entries, transaction_events, audit_log,
      disputes, ratings, payments, payouts, transactions, offers,
      alert_sends, alert_profiles, listing_media, listing_animals,
      animal_transfers, animal_health_events, animals, listings,
      stolen_stock_reports, fraud_flags, farms, verifications,
      zone_restrictions, zones, users
    RESTART IDENTITY CASCADE
  `);
}

async function seed() {
  await prisma.zone.createMany({
    data: [
      { id: IDS.zoneGreen, code: 'Z6', name: 'Zone 6 — Central' },
      { id: IDS.zoneRed, code: 'Z3', name: 'Zone 3 — North East' },
    ],
  });

  await prisma.user.createMany({
    data: [
      { id: IDS.mpho, phone: '+26771000011', tier: 'T2_VERIFIED_FARMER' },
      { id: IDS.kabelo, phone: '+26771000012', tier: 'T2_VERIFIED_FARMER' },
      { id: IDS.thief, phone: '+26771000013', tier: 'T2_VERIFIED_FARMER' },
    ],
  });

  await prisma.farm.createMany({
    data: [
      { id: IDS.farmMpho, ownerId: IDS.mpho, name: 'Serowe Cattle Post', zoneId: IDS.zoneGreen },
      { id: IDS.farmKabelo, ownerId: IDS.kabelo, name: 'Palapye Farm', zoneId: IDS.zoneGreen },
      { id: IDS.farmThief, ownerId: IDS.thief, name: 'Other Farm', zoneId: IDS.zoneGreen },
    ],
  });

  await prisma.alertProfile.create({
    data: {
      id: IDS.profile,
      userId: IDS.kabelo,
      name: 'Tollies near Palapye',
      categories: ['CATTLE'],
      breeds: ['BRAHMAN'],
      sexes: ['OX'],
      maxPrice: BigInt(pula(12_000)),
      radiusKm: 150,
      channels: ['PUSH'],
      urgency: 'INSTANT',
    },
  });
}

function listingInput(overrides: Record<string, unknown> = {}) {
  return {
    category: 'CATTLE',
    farmId: IDS.farmMpho,
    title: '6 Brahman tollies, good condition',
    priceBasis: 'PER_HEAD',
    askingPrice: pula(8_000),
    quantity: 1,
    photoUrls: [
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
      'https://cdn.example.com/c.jpg',
    ],
    animals: [
      {
        litsId: LITS,
        breed: 'BRAHMAN',
        sex: 'OX',
        estimatedAgeMonths: 30,
        weightKg: 400,
        weightMethod: 'WEIGHBRIDGE',
      },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  await seed();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('publishing', () => {
  it('creates the listing, the animal record, and seeds provenance', async () => {
    const result = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    expect(result.status).toBe('ACTIVE');
    expect(result.movementBlocked).toBe(false);
    expect(result.animalIds).toHaveLength(1);

    const animal = await prisma.animal.findUniqueOrThrow({ where: { litsId: LITS } });
    expect(animal.currentOwnerId).toBe(IDS.mpho);
    expect(animal.breed).toBe('BRAHMAN');

    const media = await prisma.listingMedia.count({ where: { listingId: result.listingId } });
    expect(media).toBe(3);
  });

  it('refuses to publish for an unverified seller', async () => {
    await prisma.user.update({ where: { id: IDS.mpho }, data: { tier: 'T1_IDENTIFIED' } });

    await expect(
      publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() }),
    ).rejects.toThrow(/verification tier/i);
  });

  it('refuses to publish on someone else\'s farm', async () => {
    await expect(
      publishListing(prisma, { sellerId: IDS.kabelo, input: listingInput() }),
    ).rejects.toThrow(/belongs to someone else/);
  });

  it('reports validation failures field by field', async () => {
    try {
      await publishListing(prisma, {
        sellerId: IDS.mpho,
        input: listingInput({ photoUrls: ['https://cdn.example.com/a.jpg'] }),
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ListingError);
      const failures = (error as ListingError).failures;
      expect(failures.some((f) => f.message === 'error.photos.minimum')).toBe(true);
    }
  });
});

describe('anti-stock-theft (§3.3)', () => {
  it('refuses a listing for an animal on the stolen register, and flags it', async () => {
    await prisma.$transaction((tx) =>
      reportStolen(tx, {
        litsId: LITS,
        reportedById: IDS.kabelo,
        policeCaseNumber: 'CR-123/2026',
        reportedStolenAt: new Date('2026-07-01'),
      }),
    );

    await expect(
      publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() }),
    ).rejects.toThrow('error.lits.stolen');

    const flags = await prisma.fraudFlag.findMany({ where: { kind: 'STOLEN_LITS_ID' } });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe('HARD');
    expect(flags[0]!.autoFrozen).toBe(true);
  });

  it('suspends a live listing when its animal is reported stolen afterwards', async () => {
    const { listingId } = await publishListing(prisma, {
      sellerId: IDS.mpho,
      input: listingInput(),
    });

    await prisma.$transaction((tx) =>
      reportStolen(tx, {
        litsId: LITS,
        reportedById: IDS.kabelo,
        reportedStolenAt: new Date('2026-07-20'),
      }),
    );

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.status).toBe('SUSPENDED');
  });

  it('refuses a second seller listing an animal the ledger says is not theirs', async () => {
    await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    // Same ear tag, different farm, different seller.
    await expect(
      publishListing(prisma, {
        sellerId: IDS.thief,
        input: listingInput({ farmId: IDS.farmThief }),
      }),
    ).rejects.toThrow('error.lits.duplicate');

    const flags = await prisma.fraudFlag.findMany({ where: { kind: 'DUPLICATE_LITS_ID' } });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.userId).toBe(IDS.thief);
  });

  it('freezes the original listing too — the platform does not know who is right', async () => {
    const { listingId } = await publishListing(prisma, {
      sellerId: IDS.mpho,
      input: listingInput(),
    });

    await publishListing(prisma, {
      sellerId: IDS.thief,
      input: listingInput({ farmId: IDS.farmThief }),
    }).catch(() => undefined);

    const original = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(original.status).toBe('SUSPENDED');
  });

  it('lets the new owner relist after a settled transfer', async () => {
    const first = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    await prisma.$transaction((tx) =>
      recordTransfer(tx, {
        animalIds: first.animalIds,
        fromUserId: IDS.mpho,
        toUserId: IDS.kabelo,
        transactionId: 'txn-sold',
      }),
    );

    // Kabelo now owns it, so relisting from his farm is legitimate.
    const second = await publishListing(prisma, {
      sellerId: IDS.kabelo,
      input: listingInput({ farmId: IDS.farmKabelo, title: 'Brahman ox, resale' }),
    });

    expect(second.status).toBe('ACTIVE');

    // One animal record, two listings, a traceable chain of custody.
    expect(await prisma.animal.count()).toBe(1);
    const provenance = await provenanceOf(prisma, LITS);
    expect(provenance?.currentOwnerId).toBe(IDS.kabelo);
    expect(provenance?.transfers).toHaveLength(1);
    expect(provenance?.transfers[0]!.fromUserId).toBe(IDS.mpho);
  });
});

describe('alert fan-out (§9)', () => {
  it('queues an alert for a matching profile', async () => {
    const { listingId } = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    const result = await fanOutListing(prisma, listingId);

    expect(result.matched).toBe(1);
    expect(result.queued).toBe(1);

    const send = await prisma.alertSend.findFirstOrThrow({ where: { listingId } });
    expect(send.userId).toBe(IDS.kabelo);
    expect(send.status).toBe('QUEUED');
    expect(send.matchScore).toBeGreaterThan(0.55);
  });

  it('never alerts the seller about their own listing', async () => {
    await prisma.alertProfile.create({
      data: {
        userId: IDS.mpho,
        name: 'Anything cattle',
        categories: ['CATTLE'],
        radiusKm: 500,
        channels: ['PUSH'],
      },
    });

    const { listingId } = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    const result = await fanOutListing(prisma, listingId);
    const sends = await prisma.alertSend.findMany({ where: { userId: IDS.mpho } });

    expect(sends).toHaveLength(0);
    expect(result.queued).toBe(1); // Kabelo only
  });

  it('does not alert about animals the buyer could not lawfully move', async () => {
    // Buyer is in another zone, and the seller's zone closes for FMD.
    await prisma.farm.update({
      where: { id: IDS.farmKabelo },
      data: { zoneId: IDS.zoneRed },
    });
    await prisma.zoneRestriction.create({
      data: {
        zoneId: IDS.zoneGreen,
        kind: 'FMD_OUTBREAK',
        direction: 'OUTBOUND',
        reason: 'Confirmed FMD case',
        effectiveAt: new Date(Date.now() - 1000),
        declaredBy: 'DVS',
      },
    });

    const { listingId } = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    const result = await fanOutListing(prisma, listingId);

    expect(result.matched).toBe(1);
    expect(result.queued).toBe(0);
    expect(result.suppressed).toBe(1);
  });

  it('does not fan out a suspended listing', async () => {
    const { listingId } = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'SUSPENDED' } });

    const result = await fanOutListing(prisma, listingId);
    expect(result.skippedReason).toMatch(/SUSPENDED/);
    expect(result.queued).toBe(0);
  });

  it('is idempotent — a retried job does not double-alert', async () => {
    const { listingId } = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    await fanOutListing(prisma, listingId);
    const second = await fanOutListing(prisma, listingId);

    // The second run sees the earlier send and suppresses as a duplicate.
    expect(second.queued).toBe(0);
    expect(await prisma.alertSend.count({ where: { listingId } })).toBe(1);
  });

  it('records suppressions rather than dropping them silently', async () => {
    // A profile whose budget the listing exceeds is a hard reject and is not
    // logged; one that is merely a weak match is logged as suppressed.
    await prisma.alertProfile.update({
      where: { id: IDS.profile },
      data: { breeds: ['SIMMENTAL'], sexes: ['BULL'], keywords: ['stud', 'pedigree'] },
    });

    const { listingId } = await publishListing(prisma, { sellerId: IDS.mpho, input: listingInput() });

    const result = await fanOutListing(prisma, listingId);
    const sends = await prisma.alertSend.findMany({ where: { listingId } });

    // Either it was queued or it was recorded as suppressed — never vanished.
    expect(result.matched).toBe(1);
    expect(sends.length + result.suppressed).toBeGreaterThan(0);
  });
});
