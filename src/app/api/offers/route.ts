import { NextResponse } from 'next/server';

import { prisma } from '../../../db/client';
import { requireCapability, toErrorResponse } from '../../../lib/session';
import { OfferError, makeOffer } from '../../../services/offer-service';

export async function POST(request: Request) {
  let buyerId: string;
  try {
    buyerId = (await requireCapability('MAKE_OFFER')).userId;
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.listingId || typeof body.amount !== 'number') {
    return NextResponse.json({ message: 'Missing listing or amount' }, { status: 400 });
  }

  try {
    const offerId = await makeOffer(prisma, {
      listingId: String(body.listingId),
      buyerId,
      amount: Math.round(body.amount),
      quantity: typeof body.quantity === 'number' ? body.quantity : undefined,
      message: body.message ? String(body.message) : undefined,
    });
    return NextResponse.json({ offerId }, { status: 201 });
  } catch (error) {
    if (error instanceof OfferError) {
      const status = error.code === 'VERIFICATION_REQUIRED' ? 403 : 400;
      return NextResponse.json({ message: error.message, code: error.code }, { status });
    }
    console.error('Offer failed', error);
    return NextResponse.json({ message: 'error.generic' }, { status: 500 });
  }
}
