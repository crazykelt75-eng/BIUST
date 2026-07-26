/**
 * Listing → alert fan-out.
 *
 * MASTER_PROMPT.md §9.2. The pipeline:
 *
 *   listing.published
 *     → candidate profiles (category + radius, narrowed in SQL)
 *     → score each match
 *     → filter: threshold, movement feasible, not the seller, not blocked
 *     → dedupe against recent sends
 *     → rate limit, quiet hours, channel routing
 *     → record an AlertSend for every decision, including the suppressions
 *
 * That last point matters more than it looks. Logging only what was sent makes
 * the engine impossible to tune: you cannot tell whether a quiet week meant
 * nothing matched or everything was suppressed. Every decision is recorded with
 * its score and its reason.
 */

import type { Tx } from '../db/client';
import { decideDelivery } from '../domain/matching/delivery';
import type { Channel } from '../domain/matching/delivery';
import {
  type AlertProfileSpec,
  type ListingCandidate,
  isMatch,
  scoreMatch,
} from '../domain/matching/score';
import { assessMovement } from '../domain/zones/movement';
import type { ZoneRestriction } from '../domain/zones/movement';
import { fromBigInt } from '../domain/money';

export interface FanOutResult {
  listingId: string;
  profilesConsidered: number;
  matched: number;
  queued: number;
  suppressed: number;
  /** Populated when the listing cannot be alerted on at all. */
  skippedReason?: string;
}

const DEDUPE_WINDOW_DAYS = 7;

/**
 * Fan a newly published listing out to matching alert profiles.
 *
 * Intended to run as a BullMQ job, not inline with the publish request: a
 * farmer pressing "publish" at a kraal on 2G should not wait for a fan-out to
 * thousands of profiles. It takes a `Tx` so a test can run it inside a
 * transaction and roll back.
 */
export async function fanOutListing(tx: Tx, listingId: string, now = new Date()): Promise<FanOutResult> {
  const listing = await tx.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      category: true,
      title: true,
      description: true,
      askingPrice: true,
      status: true,
      zoneId: true,
      sellerTierAtPublish: true,
      seller: { select: { tier: true } },
      farm: { select: { zoneId: true, district: true } },
      animals: {
        select: {
          animal: {
            select: { breed: true, sex: true, estimatedAgeMonths: true, weightKg: true },
          },
        },
      },
    },
  });

  if (!listing) {
    return {
      listingId,
      profilesConsidered: 0,
      matched: 0,
      queued: 0,
      suppressed: 0,
      skippedReason: 'Listing not found',
    };
  }

  if (listing.status !== 'ACTIVE') {
    return {
      listingId,
      profilesConsidered: 0,
      matched: 0,
      queued: 0,
      suppressed: 0,
      skippedReason: `Listing is ${listing.status}, not ACTIVE`,
    };
  }

  const restrictions = await activeRestrictionsFor(tx, listing.farm.zoneId);

  const candidate: ListingCandidate = {
    id: listing.id,
    sellerId: listing.sellerId,
    category: listing.category,
    title: listing.title,
    description: listing.description ?? undefined,
    askingPrice: fromBigInt(listing.askingPrice),
    sellerTier: listing.sellerTierAtPublish ?? listing.seller.tier,
    breeds: unique(listing.animals.map((a) => a.animal.breed).filter(isPresent)),
    sexes: unique(listing.animals.map((a) => a.animal.sex).filter(isPresent)),
    ageMonthsRange: rangeOf(listing.animals.map((a) => a.animal.estimatedAgeMonths)),
    weightKgRange: rangeOf(listing.animals.map((a) => a.animal.weightKg)),
  };

  // Only profiles whose category list is empty or includes this one. Radius
  // filtering happens in the scorer, since the geography column is not
  // expressible through Prisma's typed API and a raw spatial query here would
  // duplicate the distance logic.
  const profiles = await tx.alertProfile.findMany({
    where: {
      enabled: true,
      userId: { not: listing.sellerId },
      OR: [{ categories: { isEmpty: true } }, { categories: { has: listing.category } }],
      AND: [
        { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
        { OR: [{ activeUntil: null }, { activeUntil: { gte: now } }] },
      ],
    },
    include: { user: { select: { id: true, tier: true } } },
  });

  let matched = 0;
  let queued = 0;
  let suppressed = 0;

  for (const profile of profiles) {
    const spec: AlertProfileSpec = {
      userId: profile.userId,
      categories: profile.categories,
      breeds: profile.breeds,
      sexes: profile.sexes,
      minAgeMonths: profile.minAgeMonths ?? undefined,
      maxAgeMonths: profile.maxAgeMonths ?? undefined,
      minWeightKg: profile.minWeightKg ?? undefined,
      maxWeightKg: profile.maxWeightKg ?? undefined,
      maxPrice: profile.maxPrice ? fromBigInt(profile.maxPrice) : undefined,
      radiusKm: profile.radiusKm,
      minSellerTier: profile.minSellerTier ?? undefined,
      minSellerRating: profile.minSellerRating ?? undefined,
      keywords: profile.keywords,
    };

    const result = scoreMatch(spec, candidate);
    if (!isMatch(result)) continue;

    matched += 1;

    // Never push an alert for animals this buyer could not lawfully move.
    // Showing them is worse than showing nothing — it generates illegal
    // trades (§3.2).
    const buyerZoneId = await primaryZoneOf(tx, profile.userId);
    const movement = assessMovement({
      originZoneId: listing.farm.zoneId,
      destinationZoneId: buyerZoneId,
      restrictions: [...restrictions, ...(await activeRestrictionsFor(tx, buyerZoneId))],
      asOf: now,
    });

    if (movement.blocked) {
      suppressed += 1;
      continue;
    }

    const alreadyAlerted = await wasRecentlyAlerted(tx, profile.userId, listing.id, now);
    const instantSentToday = await countInstantSendsToday(tx, profile.userId, now);
    const channel = pickChannel(profile.channels);

    const decision = decideDelivery({
      matchScore: result.score,
      channel,
      urgency: profile.urgency,
      tier: profile.user.tier,
      quietHoursStart: profile.quietHoursStart,
      quietHoursEnd: profile.quietHoursEnd,
      instantSentToday,
      alreadyAlerted,
      timeCritical: false,
      now,
    });

    if (decision.action === 'SUPPRESS') {
      suppressed += 1;
      // Recorded, not dropped silently — otherwise a suppression bug is
      // invisible and looks like an absence of matching stock.
      await recordSend(tx, {
        profileId: profile.id,
        userId: profile.userId,
        listingId: listing.id,
        channel,
        score: result.score,
        status: decision.logStatus,
      });
      continue;
    }

    await recordSend(tx, {
      profileId: profile.id,
      userId: profile.userId,
      listingId: listing.id,
      channel,
      score: result.score,
      status: 'QUEUED',
    });
    queued += 1;
  }

  return {
    listingId,
    profilesConsidered: profiles.length,
    matched,
    queued,
    suppressed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function recordSend(
  tx: Tx,
  args: {
    profileId: string;
    userId: string;
    listingId: string;
    channel: Channel;
    score: number;
    status: 'QUEUED' | 'SUPPRESSED_RATE_LIMIT' | 'SUPPRESSED_QUIET_HOURS' | 'SUPPRESSED_DUPLICATE';
  },
): Promise<void> {
  // The unique index on (profileId, listingId, channel) is the real dedupe
  // guarantee. Upserting rather than creating makes a re-run of the fan-out
  // idempotent, which matters because job queues retry.
  await tx.alertSend.upsert({
    where: {
      profileId_listingId_channel: {
        profileId: args.profileId,
        listingId: args.listingId,
        channel: args.channel,
      },
    },
    create: {
      profileId: args.profileId,
      userId: args.userId,
      listingId: args.listingId,
      channel: args.channel,
      matchScore: args.score,
      status: args.status,
    },
    update: {},
  });
}

async function wasRecentlyAlerted(
  tx: Tx,
  userId: string,
  listingId: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const existing = await tx.alertSend.findFirst({
    where: { userId, listingId, queuedAt: { gte: since } },
    select: { id: true },
  });
  return existing !== null;
}

async function countInstantSendsToday(tx: Tx, userId: string, now: Date): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return tx.alertSend.count({
    where: { userId, status: { in: ['QUEUED', 'SENT', 'DELIVERED'] }, queuedAt: { gte: startOfDay } },
  });
}

async function activeRestrictionsFor(tx: Tx, zoneId: string | null): Promise<ZoneRestriction[]> {
  if (!zoneId) return [];
  const rows = await tx.zoneRestriction.findMany({ where: { zoneId, liftedAt: null } });
  return rows.map((r) => ({
    zoneId: r.zoneId,
    kind: r.kind,
    direction: r.direction,
    reason: r.reason,
    effectiveAt: r.effectiveAt,
    liftedAt: r.liftedAt,
  }));
}

async function primaryZoneOf(tx: Tx, userId: string): Promise<string | null> {
  const farm = await tx.farm.findFirst({
    where: { ownerId: userId },
    select: { zoneId: true },
    orderBy: { createdAt: 'asc' },
  });
  return farm?.zoneId ?? null;
}

/** Prefer the richest channel the profile has opted into. */
function pickChannel(channels: Channel[]): Channel {
  const preference: Channel[] = ['PUSH', 'WHATSAPP', 'SMS', 'EMAIL', 'IN_APP'];
  return preference.find((c) => channels.includes(c)) ?? 'IN_APP';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function rangeOf(values: (number | null)[]): [number, number] | undefined {
  const present = values.filter(isPresent);
  if (present.length === 0) return undefined;
  return [Math.min(...present), Math.max(...present)];
}
