/**
 * Livestock movement feasibility between disease-control zones.
 *
 * MASTER_PROMPT.md §3.2. This is the module that keeps the platform on the
 * right side of the Department of Veterinary Services. Its output drives three
 * things: the banner on a listing, whether the matching engine may alert a
 * buyer at all, and whether the transaction state machine will advance to
 * collection.
 *
 * Showing a buyer a listing they cannot legally move is worse than showing them
 * nothing — it generates illegal trades and costs the platform its standing
 * with the regulator that can shut it down.
 */

export type RestrictionKind = 'FMD_OUTBREAK' | 'QUARANTINE' | 'ADMINISTRATIVE';

/** Null direction means all movement is blocked, including within the zone. */
export type MovementDirection = 'INBOUND' | 'OUTBOUND' | null;

export interface ZoneRestriction {
  zoneId: string;
  kind: RestrictionKind;
  direction: MovementDirection;
  reason: string;
  effectiveAt: Date;
  liftedAt: Date | null;
}

export type Feasibility = 'SAME_ZONE' | 'CROSS_ZONE_PERMIT_REQUIRED' | 'BLOCKED' | 'UNKNOWN_ZONE';

export interface MovementVerdict {
  feasibility: Feasibility;
  permitRequired: boolean;
  /** True when the animals may not legally move at all right now. */
  blocked: boolean;
  /** Banner text for the listing page, in the user's language layer. */
  bannerKey: string;
  /** Detail for the banner and for the transaction event log. */
  detail: string;
  /** Rough permit lead time, for setting expectations on the listing. */
  estimatedPermitDays?: number;
  blockingRestrictions: ZoneRestriction[];
}

const PERMIT_LEAD_DAYS = { min: 5, max: 10 };

export function isActive(restriction: ZoneRestriction, asOf: Date): boolean {
  if (restriction.effectiveAt > asOf) return false;
  if (restriction.liftedAt !== null && restriction.liftedAt <= asOf) return false;
  return true;
}

/**
 * Can animals move from `originZoneId` to `destinationZoneId` right now?
 *
 * `restrictions` should be every restriction touching either zone; filtering by
 * active-ness happens here so callers cannot forget to.
 */
export function assessMovement(args: {
  originZoneId: string | null;
  destinationZoneId: string | null;
  restrictions: ZoneRestriction[];
  asOf?: Date;
}): MovementVerdict {
  const asOf = args.asOf ?? new Date();
  const { originZoneId, destinationZoneId } = args;

  if (!originZoneId || !destinationZoneId) {
    return {
      feasibility: 'UNKNOWN_ZONE',
      permitRequired: true,
      blocked: false,
      bannerKey: 'movement.unknown_zone',
      detail:
        'Zone information is incomplete for this movement. Confirm the disease-control zone ' +
        'of both the farm and the destination before arranging collection.',
      blockingRestrictions: [],
    };
  }

  const active = args.restrictions.filter((r) => isActive(r, asOf));
  const sameZone = originZoneId === destinationZoneId;

  const blocking = active.filter((r) => {
    if (r.zoneId === originZoneId) {
      // Leaving the origin — blocked by an outbound or blanket restriction.
      // A blanket restriction also stops movement within the zone.
      if (r.direction === null) return true;
      if (r.direction === 'OUTBOUND' && !sameZone) return true;
    }
    if (r.zoneId === destinationZoneId) {
      if (r.direction === null) return true;
      if (r.direction === 'INBOUND' && !sameZone) return true;
    }
    return false;
  });

  if (blocking.length > 0) {
    const primary = blocking[0]!;
    const since = primary.effectiveAt.toISOString().slice(0, 10);
    return {
      feasibility: 'BLOCKED',
      permitRequired: false,
      blocked: true,
      bannerKey: 'movement.blocked',
      detail:
        `Movement restricted — zone under ${humanKind(primary.kind)} control since ${since}. ` +
        `${primary.reason}`,
      blockingRestrictions: blocking,
    };
  }

  if (sameZone) {
    return {
      feasibility: 'SAME_ZONE',
      permitRequired: false,
      blocked: false,
      bannerKey: 'movement.same_zone',
      detail: 'Same disease-control zone — no movement permit needed.',
      blockingRestrictions: [],
    };
  }

  return {
    feasibility: 'CROSS_ZONE_PERMIT_REQUIRED',
    permitRequired: true,
    blocked: false,
    bannerKey: 'movement.permit_required',
    detail:
      `Cross-zone movement — a DVS permit is required before collection ` +
      `(typically ${PERMIT_LEAD_DAYS.min}–${PERMIT_LEAD_DAYS.max} days).`,
    estimatedPermitDays: PERMIT_LEAD_DAYS.max,
    blockingRestrictions: [],
  };
}

function humanKind(kind: RestrictionKind): string {
  switch (kind) {
    case 'FMD_OUTBREAK':
      return 'foot-and-mouth disease';
    case 'QUARANTINE':
      return 'quarantine';
    case 'ADMINISTRATIVE':
      return 'administrative';
  }
}

/**
 * May this listing be surfaced to this buyer at all?
 *
 * Used by the matching engine before an alert is queued (§9.2). Deliberately
 * stricter than the listing page: a buyer browsing may see a blocked listing
 * with its banner, but we do not actively push an alert for animals nobody can
 * lawfully move.
 */
export function isAlertable(verdict: MovementVerdict): boolean {
  return !verdict.blocked && verdict.feasibility !== 'UNKNOWN_ZONE';
}
