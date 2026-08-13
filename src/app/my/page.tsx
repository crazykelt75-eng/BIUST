import Link from 'next/link';
import { redirect } from 'next/navigation';

import { prisma } from '../../db/client';
import { formatBwp, fromBigInt } from '../../domain/money';
import { currentUser } from '../../lib/session';
import { offersForBuyer, offersForSeller } from '../../services/offer-service';
import { OfferActions } from './offer-actions';

export const dynamic = 'force-dynamic';

/**
 * One screen for both sides of the market.
 *
 * Most users here are both buyer and seller — a farmer selling tollies this
 * month is buying weaners next — so splitting this into two sections of one
 * page beats two separate destinations to remember.
 */
export default async function MyPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const [incoming, outgoing, listings, transactions] = await Promise.all([
    offersForSeller(prisma, user.userId),
    offersForBuyer(prisma, user.userId),
    prisma.listing.findMany({
      where: { sellerId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, status: true, askingPrice: true, quantity: true },
    }),
    prisma.transaction.findMany({
      where: { OR: [{ buyerId: user.userId }, { sellerId: user.userId }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, state: true, agreedAmount: true, permitRequired: true,
        listing: { select: { title: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-center justify-between py-6">
        <h1 className="text-2xl font-bold">Tsa me / Mine</h1>
        <span className="rounded-full bg-kraal-100 px-3 py-1 text-xs font-semibold">
          {user.tier.replace(/^T\w+_/, '').replace('_', ' ')}
        </span>
      </header>

      {transactions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 font-semibold">Dithekiso / Deals</h2>
          <ul className="space-y-2">
            {transactions.map((txn) => (
              <li key={txn.id} className="rounded-xl border border-veld-600/40 bg-veld-500/5 p-3">
                <p className="font-medium">{txn.listing.title}</p>
                <p className="text-sm opacity-70">
                  {formatBwp(fromBigInt(txn.agreedAmount))} · {txn.state.replace(/_/g, ' ').toLowerCase()}
                </p>
                {txn.permitRequired && (
                  <p className="mt-1 text-xs font-medium text-warn-500">Movement permit required</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">Dikabo tse di tlileng / Offers received</h2>
        {incoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-kraal-300 p-6 text-center text-sm opacity-70">
            —
          </p>
        ) : (
          <ul className="space-y-3">
            {incoming.map((offer) => (
              <li key={offer.id} className="rounded-xl border border-kraal-200 p-3">
                <p className="font-medium">{offer.listing.title}</p>
                <p className="text-xl font-bold text-veld-700">
                  {formatBwp(fromBigInt(offer.amount))}
                </p>
                <p className="text-sm opacity-70">
                  {offer.quantity} head · asking {formatBwp(fromBigInt(offer.listing.askingPrice))}
                </p>
                {offer.message && <p className="mt-1 text-sm italic">&ldquo;{offer.message}&rdquo;</p>}
                {offer.status === 'PENDING' ? (
                  <OfferActions offerId={offer.id} />
                ) : (
                  <p className="mt-2 text-sm font-semibold text-veld-700">{offer.status}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">Dikabo tsa me / My offers</h2>
        {outgoing.length === 0 ? (
          <p className="rounded-xl border border-dashed border-kraal-300 p-6 text-center text-sm opacity-70">—</p>
        ) : (
          <ul className="space-y-2">
            {outgoing.map((offer) => (
              <li key={offer.id} className="rounded-xl border border-kraal-200 p-3 text-sm">
                <Link href={`/listings/${offer.listing.id}`} className="font-medium underline">
                  {offer.listing.title}
                </Link>
                <p className="opacity-70">
                  {formatBwp(fromBigInt(offer.amount))} · {offer.status.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Tse ke di rekisang / My listings</h2>
        {listings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-kraal-300 p-6 text-center text-sm opacity-70">—</p>
        ) : (
          <ul className="space-y-2">
            {listings.map((listing) => (
              <li key={listing.id} className="rounded-xl border border-kraal-200 p-3 text-sm">
                <Link href={`/listings/${listing.id}`} className="font-medium underline">
                  {listing.title}
                </Link>
                <p className="opacity-70">
                  {formatBwp(fromBigInt(listing.askingPrice))} · {listing.status.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
