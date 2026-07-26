import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { prisma } from '../../../db/client';
import { maskLitsId } from '../../../domain/listing/validation';
import { formatBwp, fromBigInt } from '../../../domain/money';
import { can } from '../../../domain/verification';
import { assessMovement } from '../../../domain/zones/movement';
import { resolveLocale, t } from '../../../i18n/messages';
import { currentUser } from '../../../lib/session';
import { OfferPanel } from './offer-panel';

export const dynamic = 'force-dynamic';

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveLocale((await headers()).get('accept-language'));
  const user = await currentUser();

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      askingPrice: true,
      priceBasis: true,
      quantity: true,
      status: true,
      sellerId: true,
      farm: { select: { name: true, district: true, zoneId: true } },
      seller: { select: { tier: true } },
      media: { orderBy: { position: 'asc' }, select: { url: true } },
      animals: {
        select: {
          animal: {
            select: {
              litsId: true, breed: true, sex: true, weightKg: true,
              weightMethod: true, estimatedAgeMonths: true, bodyCondition: true,
            },
          },
        },
      },
    },
  });

  if (!listing) notFound();

  const restrictions = await prisma.zoneRestriction.findMany({
    where: { zoneId: listing.farm.zoneId ?? undefined, liftedAt: null },
  });

  const movement = assessMovement({
    originZoneId: listing.farm.zoneId,
    destinationZoneId: listing.farm.zoneId,
    restrictions: restrictions.map((r) => ({
      zoneId: r.zoneId, kind: r.kind, direction: r.direction,
      reason: r.reason, effectiveAt: r.effectiveAt, liftedAt: r.liftedAt,
    })),
  });

  const isOwnListing = user?.userId === listing.sellerId;
  const canOffer = user !== null && can(user.tier, 'MAKE_OFFER');

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32">
      {listing.media[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={listing.media[0].url} alt="" className="-mx-4 h-64 w-screen max-w-2xl bg-kraal-100 object-cover sm:mx-0 sm:w-full sm:rounded-b-xl" />
      )}

      <h1 className="mt-4 text-2xl font-bold">{listing.title}</h1>
      <p className="mt-1 text-3xl font-bold text-veld-700">
        {formatBwp(fromBigInt(listing.askingPrice))}
        <span className="ml-2 text-base font-normal opacity-70">
          {listing.priceBasis === 'PER_HEAD' ? '/ head' : '/ kg'}
        </span>
      </p>

      <p
        className={`mt-3 rounded-lg px-3 py-2 text-sm font-medium ${
          movement.blocked
            ? 'bg-danger-500/15 text-danger-500'
            : movement.permitRequired
              ? 'bg-warn-500/15 text-warn-500'
              : 'bg-veld-500/15 text-veld-700'
        }`}
      >
        {t(locale, movement.bannerKey as never)}
      </p>

      {listing.description && <p className="mt-4 whitespace-pre-line">{listing.description}</p>}

      <h2 className="mt-6 font-semibold">{listing.quantity} head</h2>
      <ul className="mt-2 space-y-2">
        {listing.animals.map(({ animal }) => (
          <li key={animal.litsId} className="rounded-xl border border-kraal-200 p-3 text-sm">
            {/* Masked until escrow is funded (§3.1) */}
            <p className="font-mono text-xs opacity-60">{maskLitsId(animal.litsId)}</p>
            <p className="font-medium">
              {[animal.breed, animal.sex?.replace('_', ' ')].filter(Boolean).join(' · ')}
            </p>
            <p className="opacity-70">
              {animal.weightKg ? `${animal.weightKg} kg` : 'Weight not given'}
              {animal.weightMethod ? ` (${animal.weightMethod.toLowerCase().replace('_', ' ')})` : ''}
              {animal.estimatedAgeMonths ? ` · ${animal.estimatedAgeMonths} months` : ''}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm opacity-70">
        {listing.farm.name}
        {listing.farm.district ? ` · ${listing.farm.district}` : ''}
      </p>

      <div className="fixed inset-x-0 bottom-0 border-t border-kraal-200 bg-[var(--background)] p-3">
        <div className="mx-auto max-w-2xl">
          {isOwnListing ? (
            <a href="/my" className="touch-target flex items-center justify-center rounded-xl border border-kraal-300 font-semibold">
              Dikabo / Offers
            </a>
          ) : !user ? (
            <a href="/signin" className="touch-target flex items-center justify-center rounded-xl bg-veld-600 font-bold text-white">
              {t(locale, 'action.continue')}
            </a>
          ) : listing.status !== 'ACTIVE' ? (
            <p className="rounded-xl bg-kraal-100 p-3 text-center text-sm">
              {t(locale, 'listing.status.sold')}
            </p>
          ) : (
            <OfferPanel
              listingId={listing.id}
              askingPrice={Number(listing.askingPrice)}
              priceBasis={listing.priceBasis}
              canOffer={canOffer}
            />
          )}
        </div>
      </div>
    </div>
  );
}
