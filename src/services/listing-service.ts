/**
 * Listing creation, publication, and the checks that run at publish.
 *
 * MASTER_PROMPT.md §3.3 and §8.3. Publishing is where the platform's
 * anti-stock-theft controls actually bite, because it is the moment an animal
 * is offered to strangers. Three checks run, in increasing order of severity:
 *
 *   1. Stolen register — the LITS ID has been reported stolen. Refuse outright.
 *   2. Ownership conflict — the animal's provenance says it belongs to someone
 *      else. Refuse, flag both parties, freeze.
 *   3. Zone restriction — the animals cannot lawfully move. Publish, but
 *      suppressed from alerts and banner-flagged.
 *
 * The first two refuse publication. A marketplace that lists stolen cattle
 * loses its licence to exist, and every farmer's trust with it.
 */

import type { PrismaClient } from '@prisma/client';

import type { Tx } from '../db/client';
import {
  type CattleListingInput,
  type ListingDraftInput,
  cattleListingSchema,
  listingDraftSchema,
  normaliseLitsId,
  toFailures,
} from '../domain/listing/validation';
import type { ValidationFailure } from '../domain/listing/validation';
import { assessMovement } from '../domain/zones/movement';
import { checkCapability } from '../domain/verification';

export class ListingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly failures: ValidationFailure[] = [],
  ) {
    super(message);
    this.name = 'ListingError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Drafts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a partial listing.
 *
 * Drafts are saved constantly from a phone at a kraal, often offline and
 * half-finished (§3.5), so validation is deliberately lenient here and strict
 * at publish. Refusing to save an incomplete draft loses a farmer's work, which
 * is the fastest way to lose the farmer.
 */
export async function saveDraft(
  tx: Tx,
  args: { sellerId: string; listingId?: string; input: unknown },
): Promise<string> {
  const parsed = listingDraftSchema.safeParse(args.input);
  if (!parsed.success) {
    throw new ListingError('Draft is not valid', 'INVALID_DRAFT', toFailures(parsed.error));
  }
  const draft = parsed.data;

  const farm = await tx.farm.findUnique({
    where: { id: draft.farmId },
    select: { ownerId: true, zoneId: true },
  });
  if (!farm) throw new ListingError('Farm not found', 'FARM_NOT_FOUND');
  if (farm.ownerId !== args.sellerId) {
    throw new ListingError('That farm belongs to someone else', 'NOT_FARM_OWNER');
  }

  const data = {
    sellerId: args.sellerId,
    farmId: draft.farmId,
    zoneId: farm.zoneId,
    category: 'CATTLE' as const,
    title: draft.title ?? 'Untitled listing',
    description: draft.description ?? null,
    priceBasis: draft.priceBasis ?? ('PER_HEAD' as const),
    askingPrice: BigInt(draft.askingPrice ?? 0),
    quantity: draft.quantity ?? 1,
    lotSplittable: draft.lotSplittable ?? false,
    minPurchaseQty: draft.minPurchaseQty ?? 1,
    status: 'DRAFT' as const,
  };

  if (args.listingId) {
    const existing = await tx.listing.findUnique({
      where: { id: args.listingId },
      select: { sellerId: true, status: true },
    });
    if (!existing) throw new ListingError('Listing not found', 'NOT_FOUND');
    if (existing.sellerId !== args.sellerId) {
      throw new ListingError('That listing belongs to someone else', 'NOT_OWNER');
    }
    if (existing.status !== 'DRAFT') {
      throw new ListingError(
        'Only drafts can be edited this way; published listings are amended, not overwritten',
        'NOT_A_DRAFT',
      );
    }
    await tx.listing.update({ where: { id: args.listingId }, data });
    return args.listingId;
  }

  const created = await tx.listing.create({ data, select: { id: true } });
  return created.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publication
// ─────────────────────────────────────────────────────────────────────────────

export interface PublishResult {
  listingId: string;
  status: 'ACTIVE' | 'PENDING_REVIEW';
  /** True when the animals cannot currently move; the listing is not alerted on. */
  movementBlocked: boolean;
  movementBannerKey: string;
  animalIds: string[];
}

interface Violation {
  kind: 'STOLEN_LITS_ID' | 'DUPLICATE_LITS_ID';
  litsId: string;
  animalId?: string;
  detail: string;
  messageKey: string;
}

/**
 * Publish a listing.
 *
 * Takes the root client rather than a transaction, unlike most services here,
 * and the reason is worth stating plainly: **a rejected publish still has to
 * leave evidence behind.**
 *
 * The first version of this ran the anti-theft checks inside the write
 * transaction, wrote a fraud flag, and then threw. The throw rolled the
 * transaction back and erased the flag along with it — so an attempt to list
 * stolen cattle was refused and then forgotten, which is the half of the
 * control that actually matters. Integration tests caught it.
 *
 * So publication runs in three phases:
 *   1. Check — read-only, no writes.
 *   2. On violation — record flags and freezes in their OWN committed
 *      transaction, then refuse.
 *   3. On success — write the listing and its animals atomically.
 */
export async function publishListing(
  db: PrismaClient,
  args: { sellerId: string; input: unknown },
): Promise<PublishResult> {
  const parsed = cattleListingSchema.safeParse(args.input);
  if (!parsed.success) {
    throw new ListingError('Listing is not valid', 'INVALID_LISTING', toFailures(parsed.error));
  }
  const input: CattleListingInput = parsed.data;

  const seller = await db.user.findUnique({
    where: { id: args.sellerId },
    select: { tier: true, suspendedAt: true },
  });
  if (!seller) throw new ListingError('Seller not found', 'SELLER_NOT_FOUND');
  if (seller.suspendedAt) {
    throw new ListingError('This account is suspended', 'ACCOUNT_SUSPENDED');
  }

  const capability = checkCapability(seller.tier, 'CREATE_LISTING');
  if (!capability.allowed) {
    throw new ListingError(
      capability.reason ?? 'Farm verification is required to sell livestock',
      'VERIFICATION_REQUIRED',
    );
  }

  const farm = await db.farm.findUnique({
    where: { id: input.farmId },
    select: { ownerId: true, zoneId: true },
  });
  if (!farm) throw new ListingError('Farm not found', 'FARM_NOT_FOUND');
  if (farm.ownerId !== args.sellerId) {
    throw new ListingError('That farm belongs to someone else', 'NOT_FARM_OWNER');
  }

  const litsIds = input.animals.map((a) => normaliseLitsId(a.litsId));

  // Phase 1 — check.
  const violations = await findViolations(db, litsIds, args.sellerId);

  // Phase 2 — on violation, commit the evidence before refusing.
  if (violations.length > 0) {
    await recordViolations(db, violations, args.sellerId);
    const stolen = violations.find((v) => v.kind === 'STOLEN_LITS_ID');
    throw new ListingError(
      stolen ? 'error.lits.stolen' : 'error.lits.duplicate',
      stolen ? 'STOLEN_STOCK' : 'OWNERSHIP_CONFLICT',
      violations.map((v) => ({ path: 'animals.litsId', message: v.detail })),
    );
  }

  // A restricted zone does not block listing — a farmer may legitimately
  // advertise stock that cannot move yet — but it suppresses alerts and shows
  // the banner. Movement itself is blocked by the transaction state machine.
  const restrictions = farm.zoneId
    ? await db.zoneRestriction.findMany({ where: { zoneId: farm.zoneId, liftedAt: null } })
    : [];
  const movement = assessMovement({
    originZoneId: farm.zoneId,
    destinationZoneId: farm.zoneId,
    restrictions: restrictions.map((r) => ({
      zoneId: r.zoneId,
      kind: r.kind,
      direction: r.direction,
      reason: r.reason,
      effectiveAt: r.effectiveAt,
      liftedAt: r.liftedAt,
    })),
  });

  // Phase 3 — write.
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.create({
      data: {
        sellerId: args.sellerId,
        farmId: input.farmId,
        zoneId: farm.zoneId,
        category: 'CATTLE',
        title: input.title,
        description: input.description ?? null,
        voiceNoteUrl: input.voiceNoteUrl ?? null,
        saleMechanism: input.saleMechanism,
        priceBasis: input.priceBasis,
        askingPrice: BigInt(input.askingPrice),
        priceNegotiable: input.priceNegotiable,
        quantity: input.quantity,
        lotSplittable: input.lotSplittable,
        minPurchaseQty: input.minPurchaseQty,
        availableFrom: input.availableFrom ?? null,
        availableUntil: input.availableUntil ?? null,
        collectionTerms: input.collectionTerms,
        inspectionWelcome: input.inspectionWelcome,
        status: 'ACTIVE',
        publishedAt: new Date(),
        sellerTierAtPublish: seller.tier,
        media: {
          create: input.photoUrls.map((url, position) => ({
            kind: 'PHOTO' as const,
            url,
            position,
          })),
        },
      },
      select: { id: true },
    });

    const animalIds = await upsertAnimals(tx, {
      listingId: listing.id,
      ownerId: args.sellerId,
      animals: input.animals,
    });

    await tx.auditLog.create({
      data: {
        actorId: args.sellerId,
        actorRole: 'FARMER',
        action: 'LISTING_PUBLISHED',
        entityType: 'Listing',
        entityId: listing.id,
        after: { litsIds, quantity: input.quantity } as never,
      },
    });

    return {
      listingId: listing.id,
      status: 'ACTIVE' as const,
      movementBlocked: movement.blocked,
      movementBannerKey: movement.bannerKey,
      animalIds,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-theft checks (§3.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read-only. Returns every reason this listing must not be published.
 *
 * Two checks, both keyed on the LITS ID:
 *
 *   - The stolen register. Blocking is not optional; a marketplace that lists
 *     stolen cattle loses its licence to exist and every farmer's trust with it.
 *   - Provenance. If the platform recorded this animal being sold to someone
 *     else and never sold on, whoever is listing it now is not its owner.
 *
 * A LITS ID the platform has never seen is fine. Most animals will be new to
 * the system for years, and refusing them would make the platform useless.
 */
async function findViolations(
  db: PrismaClient,
  litsIds: string[],
  sellerId: string,
): Promise<Violation[]> {
  const violations: Violation[] = [];

  const reports = await db.stolenStockReport.findMany({
    where: { litsId: { in: litsIds }, status: 'ACTIVE' },
    select: { litsId: true, id: true },
  });

  for (const report of reports) {
    violations.push({
      kind: 'STOLEN_LITS_ID',
      litsId: report.litsId,
      detail: `${report.litsId} is on the stolen register (report ${report.id})`,
      messageKey: 'error.lits.stolen',
    });
  }

  const known = await db.animal.findMany({
    where: { litsId: { in: litsIds }, currentOwnerId: { not: null } },
    select: { id: true, litsId: true, currentOwnerId: true },
  });

  for (const animal of known) {
    if (animal.currentOwnerId === sellerId) continue;
    violations.push({
      kind: 'DUPLICATE_LITS_ID',
      litsId: animal.litsId,
      animalId: animal.id,
      detail: `${animal.litsId} is already recorded under a different owner`,
      messageKey: 'error.lits.duplicate',
    });
  }

  return violations;
}

/**
 * Commit the evidence in its own transaction, so it survives the refusal.
 *
 * Freezes the other party's live listings for the same animals too. At this
 * point the platform does not know which of the two claimants is the rightful
 * owner, and guessing in either direction is worse than pausing both (§3.3).
 */
async function recordViolations(
  db: PrismaClient,
  violations: Violation[],
  sellerId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const violation of violations) {
      await tx.fraudFlag.create({
        data: {
          kind: violation.kind,
          severity: 'HARD',
          userId: sellerId,
          litsId: violation.litsId,
          detail: `${violation.detail}. Attempted listing by ${sellerId}.`,
          autoFrozen: true,
        },
      });
    }

    const contestedAnimalIds = violations
      .map((v) => v.animalId)
      .filter((id): id is string => id !== undefined);

    if (contestedAnimalIds.length > 0) {
      await tx.listing.updateMany({
        where: {
          status: { in: ['ACTIVE', 'PARTIALLY_COMMITTED'] },
          animals: { some: { animalId: { in: contestedAnimalIds } } },
        },
        data: { status: 'SUSPENDED' },
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Animals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or update the canonical animal records and attach them to the listing.
 *
 * Listing an animal asserts ownership but does not transfer it — ownership
 * moves on settlement (see `recordTransfer`). A first-time listing seeds
 * `currentOwnerId`, which is how provenance starts for animals the platform has
 * never seen.
 */
async function upsertAnimals(
  tx: Tx,
  args: { listingId: string; ownerId: string; animals: CattleListingInput['animals'] },
): Promise<string[]> {
  const ids: string[] = [];

  for (const [position, animal] of args.animals.entries()) {
    const litsId = normaliseLitsId(animal.litsId);

    const record = await tx.animal.upsert({
      where: { litsId },
      create: {
        litsId,
        currentOwnerId: args.ownerId,
        breed: animal.breed ?? null,
        sex: animal.sex,
        dateOfBirth: animal.dateOfBirth ?? null,
        estimatedAgeMonths: animal.estimatedAgeMonths ?? null,
        dentition: animal.dentition ?? null,
        weightKg: animal.weightKg ?? null,
        weightMethod: animal.weightMethod ?? null,
        weighedAt: animal.weighedAt ?? null,
        bodyCondition: animal.bodyCondition ?? null,
        hornStatus: animal.hornStatus ?? null,
        pregnancyStatus: animal.pregnancyStatus ?? null,
        pregnancyMonths: animal.pregnancyMonths ?? null,
        temperament: animal.temperament ?? null,
        sireLitsId: animal.sireLitsId ?? null,
        damLitsId: animal.damLitsId ?? null,
      },
      // On re-listing, refresh the mutable condition fields — weight and body
      // condition change between sales, and a two-year-old weight is worse
      // than no weight. Identity fields are never overwritten.
      update: {
        weightKg: animal.weightKg ?? null,
        weightMethod: animal.weightMethod ?? null,
        weighedAt: animal.weighedAt ?? null,
        bodyCondition: animal.bodyCondition ?? null,
        pregnancyStatus: animal.pregnancyStatus ?? null,
        pregnancyMonths: animal.pregnancyMonths ?? null,
        temperament: animal.temperament ?? null,
      },
      select: { id: true },
    });

    await tx.listingAnimal.create({
      data: { listingId: args.listingId, animalId: record.id, position },
    });

    ids.push(record.id);
  }

  return ids;
}

/**
 * Record a settled change of ownership.
 *
 * Called on transaction settlement. This is the write that builds the
 * provenance chain, and therefore the write that makes `assertOwnershipConsistent`
 * meaningful on the next sale.
 */
export async function recordTransfer(
  tx: Tx,
  args: { animalIds: string[]; fromUserId: string; toUserId: string; transactionId: string },
): Promise<void> {
  for (const animalId of args.animalIds) {
    await tx.animal.update({
      where: { id: animalId },
      data: { currentOwnerId: args.toUserId },
    });
    await tx.animalTransfer.create({
      data: {
        animalId,
        fromUserId: args.fromUserId,
        toUserId: args.toUserId,
        transactionId: args.transactionId,
      },
    });
  }
}

/** An animal's full ownership history, oldest first. */
export async function provenanceOf(tx: Tx, litsId: string) {
  const animal = await tx.animal.findUnique({
    where: { litsId: normaliseLitsId(litsId) },
    select: {
      id: true,
      litsId: true,
      currentOwnerId: true,
      firstSeenAt: true,
      transfers: { orderBy: { occurredAt: 'asc' } },
    },
  });
  return animal;
}

/** Report an animal stolen; blocks it from being listed platform-wide. */
export async function reportStolen(
  tx: Tx,
  args: {
    litsId: string;
    reportedById: string;
    policeCaseNumber?: string;
    reportedStolenAt: Date;
    description?: string;
  },
): Promise<string> {
  const litsId = normaliseLitsId(args.litsId);

  const report = await tx.stolenStockReport.create({
    data: {
      litsId,
      reportedById: args.reportedById,
      policeCaseNumber: args.policeCaseNumber ?? null,
      reportedStolenAt: args.reportedStolenAt,
      description: args.description ?? null,
      // A report with a police case number carries more weight than one
      // without, but both block listing until reviewed. The cost of a false
      // block is an inconvenienced seller; the cost of a false pass is a
      // laundered animal.
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  // Suspend any live listing already offering this animal.
  await tx.listing.updateMany({
    where: {
      status: { in: ['ACTIVE', 'PARTIALLY_COMMITTED'] },
      animals: { some: { animal: { litsId } } },
    },
    data: { status: 'SUSPENDED' },
  });

  return report.id;
}
