import { redirect } from 'next/navigation';

import { prisma } from '../../db/client';
import { checkCapability } from '../../domain/verification';
import { currentUser } from '../../lib/session';
import { ListingForm } from './listing-form';

export const dynamic = 'force-dynamic';

/**
 * Sell flow shell.
 *
 * Gates on the session server-side. The API route gates independently — this
 * is a courtesy redirect so an unverified farmer is not led through a form
 * that will be rejected at the end, not the access control itself.
 */
export default async function SellPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const capability = checkCapability(user.tier, 'CREATE_LISTING');
  if (!capability.allowed) redirect('/verify');

  const farm = await prisma.farm.findFirst({
    where: { ownerId: user.userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!farm) redirect('/onboarding');

  return <ListingForm farmId={farm.id} />;
}
