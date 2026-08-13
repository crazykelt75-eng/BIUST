import { NextResponse } from 'next/server';

import { prisma } from '../../../db/client';
import { requireUser, toErrorResponse } from '../../../lib/session';
import { submitVerification } from '../../../services/onboarding-service';
import type { VerificationDocKind } from '../../../services/onboarding-service';

const ALLOWED: VerificationDocKind[] = [
  'NATIONAL_ID',
  'SELFIE_MATCH',
  'FARM_REGISTRATION',
  'BRAND_MARK',
  'POLICE_CLEARANCE',
  'BUSINESS_REGISTRATION',
  'ABATTOIR_LICENCE',
];

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).userId;
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const body = (await request.json().catch(() => null)) as { kind?: string } | null;
  const kind = body?.kind as VerificationDocKind | undefined;

  if (!kind || !ALLOWED.includes(kind)) {
    return NextResponse.json({ message: 'Unknown document type' }, { status: 400 });
  }

  const id = await submitVerification(prisma, { userId, kind });
  return NextResponse.json({ verificationId: id }, { status: 201 });
}
