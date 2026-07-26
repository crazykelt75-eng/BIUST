/**
 * Farm registration and verification requests.
 *
 * Without this a signed-in farmer can never reach the sell flow, because
 * listing requires both a farm and tier T2 (§8.1).
 *
 * Verification is progressive: you submit documents at the moment you want to
 * do the thing that needs them, which is also the moment you are most willing
 * to bother.
 */

import type { PrismaClient } from '@prisma/client';

export class OnboardingError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'OnboardingError';
  }
}

export interface CreateFarmArgs {
  ownerId: string;
  name: string;
  district?: string;
  zoneCode?: string;
  /** Exact location. Never exposed to non-committed buyers (§4.3). */
  latitude?: number;
  longitude?: number;
}

export async function createFarm(db: PrismaClient, args: CreateFarmArgs): Promise<string> {
  const name = args.name.trim();
  if (name.length < 2) throw new OnboardingError('Please give the farm a name', 'INVALID_NAME');

  const zone = args.zoneCode
    ? await db.zone.findUnique({ where: { code: args.zoneCode }, select: { id: true } })
    : null;

  if (args.zoneCode && !zone) {
    throw new OnboardingError('That disease-control zone is not recognised', 'UNKNOWN_ZONE');
  }

  const farm = await db.farm.create({
    data: {
      ownerId: args.ownerId,
      name,
      district: args.district?.trim() || null,
      zoneId: zone?.id ?? null,
    },
    select: { id: true },
  });

  // PostGIS columns are Unsupported() in Prisma, so the point is set in SQL.
  // The public point is snapped to roughly a 5 km grid: a buyer needs to know
  // the animals are near Serowe, not which cattle post they are standing in.
  if (args.latitude !== undefined && args.longitude !== undefined) {
    const snappedLat = Math.round(args.latitude * 20) / 20;
    const snappedLng = Math.round(args.longitude * 20) / 20;
    await db.$executeRaw`
      UPDATE farms
         SET location = ST_SetSRID(ST_MakePoint(${args.longitude}, ${args.latitude}), 4326)::geography,
             "publicLocation" = ST_SetSRID(ST_MakePoint(${snappedLng}, ${snappedLat}), 4326)::geography
       WHERE id = ${farm.id}
    `;
  }

  return farm.id;
}

export type VerificationDocKind =
  | 'NATIONAL_ID'
  | 'SELFIE_MATCH'
  | 'FARM_REGISTRATION'
  | 'BRAND_MARK'
  | 'POLICE_CLEARANCE'
  | 'BUSINESS_REGISTRATION'
  | 'ABATTOIR_LICENCE';

export async function submitVerification(
  db: PrismaClient,
  args: { userId: string; kind: VerificationDocKind; documentUrl?: string },
): Promise<string> {
  const pending = await db.verification.findFirst({
    where: { userId: args.userId, kind: args.kind, status: 'PENDING' },
    select: { id: true },
  });
  if (pending) return pending.id;

  const record = await db.verification.create({
    data: { userId: args.userId, kind: args.kind, documentUrl: args.documentUrl ?? null },
    select: { id: true },
  });

  return record.id;
}

/**
 * Admin approves a document and re-derives the user's tier.
 *
 * Tier is computed from approved documents rather than set directly, so it can
 * never drift from the evidence behind it.
 */
export async function reviewVerification(
  db: PrismaClient,
  args: { verificationId: string; reviewerId: string; approve: boolean; reason?: string },
): Promise<{ userId: string; tier: string }> {
  return db.$transaction(async (tx) => {
    const record = await tx.verification.update({
      where: { id: args.verificationId },
      data: {
        status: args.approve ? 'APPROVED' : 'REJECTED',
        reviewedBy: args.reviewerId,
        reviewedAt: new Date(),
        rejectionReason: args.approve ? null : (args.reason ?? 'Not accepted'),
      },
      select: { userId: true },
    });

    const approved = await tx.verification.findMany({
      where: { userId: record.userId, status: 'APPROVED' },
      select: { kind: true },
    });
    const kinds = new Set(approved.map((a) => a.kind));

    let tier: 'T0_UNVERIFIED' | 'T1_IDENTIFIED' | 'T2_VERIFIED_FARMER' | 'TB_VERIFIED_BUTCHER' =
      'T0_UNVERIFIED';

    if (kinds.has('NATIONAL_ID')) tier = 'T1_IDENTIFIED';
    if (kinds.has('NATIONAL_ID') && kinds.has('FARM_REGISTRATION')) tier = 'T2_VERIFIED_FARMER';
    if (kinds.has('BUSINESS_REGISTRATION') && kinds.has('ABATTOIR_LICENCE')) {
      tier = 'TB_VERIFIED_BUTCHER';
    }

    await tx.user.update({ where: { id: record.userId }, data: { tier } });

    await tx.auditLog.create({
      data: {
        actorId: args.reviewerId,
        actorRole: 'ADMIN',
        action: args.approve ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        entityType: 'Verification',
        entityId: args.verificationId,
        after: { tier } as never,
      },
    });

    return { userId: record.userId, tier };
  });
}

export async function pendingVerifications(db: PrismaClient) {
  return db.verification.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: {
      id: true,
      kind: true,
      documentUrl: true,
      createdAt: true,
      user: { select: { id: true, phone: true, fullName: true, tier: true } },
    },
  });
}
