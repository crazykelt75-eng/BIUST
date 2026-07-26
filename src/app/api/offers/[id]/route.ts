import { NextResponse } from 'next/server';

import { prisma } from '../../../../db/client';
import { requireUser, toErrorResponse } from '../../../../lib/session';
import {
  OfferError,
  acceptOffer,
  counterOffer,
  declineOffer,
  withdrawOffer,
} from '../../../../services/offer-service';

/** Seller: accept | decline | counter. Buyer: withdraw. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = (await requireUser()).userId;
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? '');

  try {
    switch (action) {
      case 'accept': {
        const result = await acceptOffer(prisma, { offerId: id, sellerId: userId });
        return NextResponse.json(result);
      }
      case 'decline':
        await declineOffer(prisma, { offerId: id, sellerId: userId });
        return NextResponse.json({ ok: true });
      case 'counter': {
        if (typeof body?.amount !== 'number') {
          return NextResponse.json({ message: 'Counter needs an amount' }, { status: 400 });
        }
        const offerId = await counterOffer(prisma, {
          offerId: id,
          sellerId: userId,
          amount: Math.round(body.amount),
          message: body.message ? String(body.message) : undefined,
        });
        return NextResponse.json({ offerId });
      }
      case 'withdraw':
        await withdrawOffer(prisma, { offerId: id, buyerId: userId });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ message: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof OfferError) {
      return NextResponse.json({ message: error.message, code: error.code }, { status: 400 });
    }
    console.error('Offer action failed', error);
    return NextResponse.json({ message: 'error.generic' }, { status: 500 });
  }
}
