/**
 * Offers — the negotiation that precedes a transaction.
 *
 * MASTER_PROMPT.md §5: best-offer is the default mechanic for cattle, and it is
 * deliberately *not* an auction. Competing offer amounts are never shown
 * publicly and no lot is ever auto-awarded to the highest bidder. Those two
 * properties are what keep this outside auctioneer licensing (§3.7), so they
 * are enforced here rather than left to the UI.
 */

import type { PrismaClient } from '@prisma/client';

import type { Tx } from '../db/client';
import { checkOfferAmount } from '../domain/verification';
import { fromBigInt } from '../domain/money';
import { assessMovement } from '../domain/zones/movement';

export class OfferError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OfferError';
  }
}

/** Offers expire in 48 hours (§7.2), so nothing sits on a seller's list forever. */
const OFFER_TTL_HOURS = 48;

export interface MakeOfferArgs {
  listingId: string;
  buyerId: string;
  /** Thebe, on the listing's price basis. */
  amount: number;
  quantity?: number;
  message?: string;
  /** Set when countering a seller's counter. */
  parentOfferId?: string;
}

export async function makeOffer(db: PrismaClient, args: MakeOfferArgs): Promise<string> {
  const listing = await db.listing.findUnique({
    where: { id: args.listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      quantity: true,
      minPurchaseQty: true,
      lotSplittable: true,
      zoneId: true,
    },
  });

  if (!listing) throw new OfferError('Listing not found', 'NOT_FOUND');
  if (listing.status !== 'ACTIVE' && listing.status !== 'PARTIALLY_COMMITTED') {
    throw new OfferError('This listing is not accepting offers', 'NOT_ACCEPTING');
  }
  if (listing.sellerId === args.buyerId) {
    throw new OfferError('You cannot make an offer on your own listing', 'OWN_LISTING');
  }
  if (args.amount <= 0) {
    throw new OfferError('An offer must be more than zero', 'INVALID_AMOUNT');
  }

  const buyer = await db.user.findUnique({
    where: { id: args.buyerId },
    select: { tier: true, suspendedAt: true },
  });
  if (!buyer) throw new OfferError('Buyer not found', 'NOT_FOUND');
  if (buyer.suspendedAt) throw new OfferError('This account is suspended', 'SUSPENDED');

  // Tier ceiling, checked server-side against the live tier (§8.1).
  const verdict = checkOfferAmount(buyer.tier, args.amount);
  if (!verdict.allowed) {
    throw new OfferError(verdict.reason ?? 'Verification required', 'VERIFICATION_REQUIRED');
  }

  const quantity = args.quantity ?? listing.quantity;
  if (quantity < 1 || quantity > listing.quantity) {
    throw new OfferError(`This listing has ${listing.quantity} available`, 'INVALID_QUANTITY');
  }
  if (!listing.lotSplittable && quantity !== listing.quantity) {
    throw new OfferError('This lot must be bought whole', 'LOT_NOT_SPLITTABLE');
  }
  if (quantity < listing.minPurchaseQty) {
    throw new OfferError(
      `The seller's minimum is ${listing.minPurchaseQty}`,
      'BELOW_MINIMUM',
    );
  }

  // A buyer with an outstanding offer should amend it rather than stack
  // another — otherwise a seller sees three live offers from one person and
  // cannot tell which is real.
  const existing = await db.offer.findFirst({
    where: { listingId: args.listingId, buyerId: args.buyerId, status: 'PENDING' },
    select: { id: true },
  });
  if (existing && !args.parentOfferId) {
    throw new OfferError(
      'You already have an offer on this listing. Withdraw it first to make another.',
      'DUPLICATE_OFFER',
    );
  }

  const offer = await db.offer.create({
    data: {
      listingId: args.listingId,
      buyerId: args.buyerId,
      amount: BigInt(args.amount),
      quantity,
      message: args.message ?? null,
      parentOfferId: args.parentOfferId ?? null,
      expiresAt: new Date(Date.now() + OFFER_TTL_HOURS * 3_600_000),
    },
    select: { id: true },
  });

  return offer.id;
}

/**
 * Seller accepts, creating the transaction.
 *
 * Accepting is the moment the deal becomes real, so it also decides whether a
 * movement permit is needed — computed from live zone data rather than anything
 * cached on the listing, because an outbreak declared this morning must apply
 * to a deal struck this afternoon (§3.2).
 */
export async function acceptOffer(
  db: PrismaClient,
  args: { offerId: string; sellerId: string },
): Promise<{ transactionId: string; permitRequired: boolean }> {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({
      where: { id: args.offerId },
      select: {
        id: true,
        amount: true,
        quantity: true,
        status: true,
        expiresAt: true,
        buyerId: true,
        listing: {
          select: {
            id: true,
            sellerId: true,
            status: true,
            priceBasis: true,
            zoneId: true,
            animals: { select: { animal: { select: { weightKg: true } } } },
          },
        },
      },
    });

    if (!offer) throw new OfferError('Offer not found', 'NOT_FOUND');
    if (offer.listing.sellerId !== args.sellerId) {
      throw new OfferError('That offer is on someone else\'s listing', 'NOT_SELLER');
    }
    if (offer.status !== 'PENDING') {
      throw new OfferError(`This offer is already ${offer.status.toLowerCase()}`, 'NOT_PENDING');
    }
    if (offer.expiresAt <= new Date()) {
      throw new OfferError('This offer has expired', 'EXPIRED');
    }

    const permitRequired = await needsPermit(tx, offer.listing.zoneId, offer.buyerId);

    const declaredWeightKg = offer.listing.animals.reduce(
      (sum, a) => sum + (a.animal.weightKg ?? 0),
      0,
    );

    const transaction = await tx.transaction.create({
      data: {
        listingId: offer.listing.id,
        offerId: offer.id,
        buyerId: offer.buyerId,
        sellerId: args.sellerId,
        state: 'OFFER_ACCEPTED',
        agreedAmount: offer.amount,
        quantity: offer.quantity,
        priceBasis: offer.listing.priceBasis,
        declaredWeightKg: declaredWeightKg > 0 ? declaredWeightKg : null,
        permitRequired,
      },
      select: { id: true },
    });

    await tx.transactionEvent.create({
      data: {
        transactionId: transaction.id,
        toState: 'OFFER_ACCEPTED',
        actorId: args.sellerId,
        actorRole: 'SELLER',
        reason: 'Offer accepted',
      },
    });

    await tx.offer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });

    // Every other live offer on this listing is now moot. Leaving them pending
    // strings buyers along on stock that is spoken for.
    await tx.offer.updateMany({
      where: { listingId: offer.listing.id, status: 'PENDING', id: { not: offer.id } },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });

    await tx.listing.update({
      where: { id: offer.listing.id },
      data: { status: 'FULLY_COMMITTED' },
    });

    return { transactionId: transaction.id, permitRequired };
  });
}

export async function declineOffer(
  db: PrismaClient,
  args: { offerId: string; sellerId: string; reason?: string },
): Promise<void> {
  const offer = await db.offer.findUnique({
    where: { id: args.offerId },
    select: { status: true, listing: { select: { sellerId: true } } },
  });

  if (!offer) throw new OfferError('Offer not found', 'NOT_FOUND');
  if (offer.listing.sellerId !== args.sellerId) {
    throw new OfferError('That offer is on someone else\'s listing', 'NOT_SELLER');
  }
  if (offer.status !== 'PENDING') {
    throw new OfferError('This offer is no longer pending', 'NOT_PENDING');
  }

  await db.offer.update({
    where: { id: args.offerId },
    data: { status: 'DECLINED', respondedAt: new Date() },
  });
}

/**
 * Seller counters. The original is marked COUNTERED and a new offer is created
 * pointing back at it, so the whole negotiation stays readable as a thread —
 * which matters when a dispute later turns on what was actually agreed.
 */
export async function counterOffer(
  db: PrismaClient,
  args: { offerId: string; sellerId: string; amount: number; message?: string },
): Promise<string> {
  return db.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({
      where: { id: args.offerId },
      select: {
        status: true,
        buyerId: true,
        listingId: true,
        quantity: true,
        listing: { select: { sellerId: true } },
      },
    });

    if (!offer) throw new OfferError('Offer not found', 'NOT_FOUND');
    if (offer.listing.sellerId !== args.sellerId) {
      throw new OfferError('That offer is on someone else\'s listing', 'NOT_SELLER');
    }
    if (offer.status !== 'PENDING') {
      throw new OfferError('This offer is no longer pending', 'NOT_PENDING');
    }
    if (args.amount <= 0) throw new OfferError('Invalid amount', 'INVALID_AMOUNT');

    await tx.offer.update({
      where: { id: args.offerId },
      data: { status: 'COUNTERED', respondedAt: new Date() },
    });

    const counter = await tx.offer.create({
      data: {
        listingId: offer.listingId,
        // The counter is still attributed to the buyer: it is an offer the
        // buyer may accept, and keeping one party per thread keeps the
        // accept/decline permissions unambiguous.
        buyerId: offer.buyerId,
        amount: BigInt(args.amount),
        quantity: offer.quantity,
        message: args.message ?? null,
        parentOfferId: args.offerId,
        expiresAt: new Date(Date.now() + OFFER_TTL_HOURS * 3_600_000),
      },
      select: { id: true },
    });

    return counter.id;
  });
}

export async function withdrawOffer(
  db: PrismaClient,
  args: { offerId: string; buyerId: string },
): Promise<void> {
  const offer = await db.offer.findUnique({
    where: { id: args.offerId },
    select: { buyerId: true, status: true },
  });

  if (!offer) throw new OfferError('Offer not found', 'NOT_FOUND');
  if (offer.buyerId !== args.buyerId) throw new OfferError('Not your offer', 'NOT_BUYER');
  if (offer.status !== 'PENDING') {
    throw new OfferError('This offer is no longer pending', 'NOT_PENDING');
  }

  await db.offer.update({
    where: { id: args.offerId },
    data: { status: 'WITHDRAWN', respondedAt: new Date() },
  });
}

/** Sweep expired offers. Run from a Cron Trigger. */
export async function expireStaleOffers(db: PrismaClient): Promise<number> {
  const result = await db.offer.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

async function needsPermit(tx: Tx, listingZoneId: string | null, buyerId: string): Promise<boolean> {
  const buyerFarm = await tx.farm.findFirst({
    where: { ownerId: buyerId },
    orderBy: { createdAt: 'asc' },
    select: { zoneId: true },
  });

  const restrictions = await tx.zoneRestriction.findMany({
    where: {
      zoneId: { in: [listingZoneId, buyerFarm?.zoneId ?? null].filter((z): z is string => !!z) },
      liftedAt: null,
    },
  });

  const verdict = assessMovement({
    originZoneId: listingZoneId,
    destinationZoneId: buyerFarm?.zoneId ?? null,
    restrictions: restrictions.map((r) => ({
      zoneId: r.zoneId,
      kind: r.kind,
      direction: r.direction,
      reason: r.reason,
      effectiveAt: r.effectiveAt,
      liftedAt: r.liftedAt,
    })),
  });

  return verdict.permitRequired;
}

/** Offers on a seller's listing, newest first — the seller's inbox. */
export async function offersForSeller(db: PrismaClient, sellerId: string) {
  return db.offer.findMany({
    where: { listing: { sellerId }, status: { in: ['PENDING', 'ACCEPTED'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      quantity: true,
      message: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      buyer: { select: { id: true, fullName: true, phone: true, tier: true } },
      listing: { select: { id: true, title: true, askingPrice: true, priceBasis: true } },
    },
  });
}

/** A buyer's own offers. */
export async function offersForBuyer(db: PrismaClient, buyerId: string) {
  return db.offer.findMany({
    where: { buyerId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      amount: true,
      quantity: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      listing: { select: { id: true, title: true, askingPrice: true, priceBasis: true } },
    },
  });
}

export { fromBigInt };
