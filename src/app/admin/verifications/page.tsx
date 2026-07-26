import { redirect } from 'next/navigation';

import { prisma } from '../../../db/client';
import { currentUser } from '../../../lib/session';
import { pendingVerifications } from '../../../services/onboarding-service';
import { ReviewActions } from './review-actions';

export const dynamic = 'force-dynamic';

/**
 * Verification queue.
 *
 * Gated on the ADMIN role held on the user record, checked server-side. There
 * is no route-level secret and no "unlisted URL" — an admin page protected by
 * obscurity is not protected.
 */
export default async function AdminVerificationsPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const record = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { roles: true },
  });
  if (!record?.roles.includes('ADMIN')) redirect('/');

  const pending = await pendingVerifications(prisma);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Verification queue</h1>
      <p className="mt-1 text-sm opacity-70">{pending.length} pending</p>

      <ul className="mt-6 space-y-3">
        {pending.map((item) => (
          <li key={item.id} className="rounded-xl border border-kraal-200 p-3">
            <p className="font-medium">{item.kind.replace(/_/g, ' ')}</p>
            <p className="text-sm opacity-70">
              {item.user.phone} · currently {item.user.tier.replace(/^T\w+_/, '')}
            </p>
            <ReviewActions verificationId={item.id} />
          </li>
        ))}
      </ul>

      {pending.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-kraal-300 p-8 text-center opacity-70">
          Nothing waiting
        </p>
      )}
    </div>
  );
}
