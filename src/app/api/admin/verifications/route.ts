import { NextResponse } from 'next/server';

import { prisma } from '../../../../db/client';
import { requireUser, toErrorResponse } from '../../../../lib/session';
import { reviewVerification } from '../../../../services/onboarding-service';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).userId;
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) return response;
    throw error;
  }

  // Role checked against the database, never against anything the client sent.
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: true },
  });
  if (!actor?.roles.includes('ADMIN')) {
    return NextResponse.json({ message: 'Not permitted' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { verificationId?: string; approve?: boolean; reason?: string }
    | null;

  if (!body?.verificationId || typeof body.approve !== 'boolean') {
    return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
  }

  const result = await reviewVerification(prisma, {
    verificationId: body.verificationId,
    reviewerId: userId,
    approve: body.approve,
    reason: body.reason,
  });

  return NextResponse.json(result);
}
