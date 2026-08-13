import { redirect } from 'next/navigation';

import { prisma } from '../../db/client';
import { currentUser } from '../../lib/session';
import { OnboardingForm } from './onboarding-form';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const farm = await prisma.farm.findFirst({
    where: { ownerId: user.userId },
    select: { id: true },
  });

  return <OnboardingForm hasFarm={farm !== null} />;
}
