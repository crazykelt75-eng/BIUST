import Link from 'next/link';
import { headers } from 'next/headers';

import { prisma } from '../db/client';
import { maskLitsId } from '../domain/listing/validation';
import { formatBwp, fromBigInt } from '../domain/money';
import { assessMovement } from '../domain/zones/movement';
import { resolveLocale, t } from '../i18n/messages';

export const dynamic = 'force-dynamic';

/**
 * Browse.
 *
 * Server-rendered rather than client-fetched, for two reasons that both matter
 * here: listing pages are a real organic-search acquisition channel, and a
 * farmer on 2G should get HTML on the first round trip rather than a spinner
 * waiting on a JSON call.
 */
export default async function BrowsePage() {
  const locale = resolveLocale((await headers()).get('accept-language'));

  const listings = await prisma.listing.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { publishedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      title: true,
      askingPrice: true,
      priceBasis: true,
      quantity: true,
      zoneId: true,
      farm: { select: { district: true, zoneId: true } },
      seller: { select: { tier: true } },
      animals: {
        take: 1,
        select: { animal: { select: { litsId: true, breed: true } } },
      },
      media: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
    },
  });

  const restrictions = await prisma.zoneRestriction.findMany({ where: { liftedAt: null } });

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <header className="py-6">
        <h1 className="text-3xl font-bold">{t(locale, 'app.name')}</h1>
        <p className="opacity-80">{t(locale, 'app.tagline')}</p>
      </header>

      {listings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-kraal-300 p-8 text-center opacity-70">
          {t(locale, 'listing.status.draft')}
        </p>
      ) : (
        <ul className="space-y-3">
          {listings.map((listing) => {
            const movement = assessMovement({
              originZoneId: listing.farm.zoneId,
              destinationZoneId: listing.farm.zoneId,
              restrictions: restrictions
                .filter((r) => r.zoneId === listing.farm.zoneId)
                .map((r) => ({
                  zoneId: r.zoneId,
                  kind: r.kind,
                  direction: r.direction,
                  reason: r.reason,
                  effectiveAt: r.effectiveAt,
                  liftedAt: r.liftedAt,
                })),
            });

            const firstAnimal = listing.animals[0]?.animal;

            return (
              <li key={listing.id} className="overflow-hidden rounded-xl border border-kraal-200">
                {listing.media[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={listing.media[0].url}
                    alt=""
                    loading="lazy"
                    className="h-40 w-full bg-kraal-100 object-cover"
                  />
                )}
                <div className="p-3">
                  <h2 className="text-lg font-semibold">{listing.title}</h2>
                  <p className="text-xl font-bold text-veld-700">
                    {formatBwp(fromBigInt(listing.askingPrice))}
                    <span className="ml-1 text-sm font-normal opacity-70">
                      {listing.priceBasis === 'PER_HEAD' ? '/ head' : '/ kg'}
                    </span>
                  </p>

                  <p className="mt-1 text-sm opacity-70">
                    {listing.quantity} head
                    {firstAnimal?.breed ? ` · ${firstAnimal.breed}` : ''}
                    {listing.farm.district ? ` · ${listing.farm.district}` : ''}
                  </p>

                  {firstAnimal && (
                    <p className="mt-1 font-mono text-xs opacity-60">
                      {maskLitsId(firstAnimal.litsId)}
                    </p>
                  )}

                  <p
                    className={`mt-2 rounded px-2 py-1 text-xs font-medium ${
                      movement.blocked
                        ? 'bg-danger-500/15 text-danger-500'
                        : movement.permitRequired
                          ? 'bg-warn-500/15 text-warn-500'
                          : 'bg-veld-500/15 text-veld-700'
                    }`}
                  >
                    {t(locale, movement.bannerKey as never)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/sell"
        className="fixed inset-x-4 bottom-4 mx-auto flex max-w-2xl touch-target items-center justify-center rounded-xl bg-veld-600 text-lg font-bold text-white"
      >
        {t(locale, 'listing.create.title')}
      </Link>
    </div>
  );
}
