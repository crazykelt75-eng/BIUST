import { NextResponse } from 'next/server';

import { prisma } from '../../../db/client';
import { requireUser, toErrorResponse } from '../../../lib/session';
import { OnboardingError, createFarm } from '../../../services/onboarding-service';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).userId;
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) return response;
    throw error;
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const farmId = await createFarm(prisma, {
      ownerId: userId,
      name: String(body.name ?? ''),
      district: body.district ? String(body.district) : undefined,
      zoneCode: body.zoneCode ? String(body.zoneCode) : undefined,
      latitude: typeof body.latitude === 'number' ? body.latitude : undefined,
      longitude: typeof body.longitude === 'number' ? body.longitude : undefined,
    });
    return NextResponse.json({ farmId }, { status: 201 });
  } catch (error) {
    if (error instanceof OnboardingError) {
      return NextResponse.json({ message: error.message, code: error.code }, { status: 400 });
    }
    console.error('Farm creation failed', error);
    return NextResponse.json({ message: 'error.generic' }, { status: 500 });
  }
}
