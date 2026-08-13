import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TIER_REQUIREMENTS } from '../../domain/verification';
import { currentUser } from '../../lib/session';
import { resolveLocale, t } from '../../i18n/messages';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * Verification prompt.
 *
 * Shown when a capability needs a tier the user has not reached. Progressive by
 * design (§8.1): you verify at the moment you want to do the thing that needs
 * it, which is also when you are most willing to bother.
 */
export default async function VerifyPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const locale = resolveLocale((await headers()).get('accept-language'));

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="text-2xl font-bold">{t(locale, 'verify.required')}</h1>
      <p className="mt-2 opacity-80">{t(locale, 'verify.t2.explain')}</p>

      <ul className="mt-6 space-y-2">
        {TIER_REQUIREMENTS.T2_VERIFIED_FARMER.map((requirement) => (
          <li key={requirement} className="rounded-lg border border-kraal-200 p-3 text-sm">
            {requirement}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm opacity-70">{t(locale, 'verify.pending')}</p>

      <Link
        href="/onboarding"
        className="touch-target mt-6 flex items-center justify-center rounded-xl bg-veld-600 font-bold text-white"
      >
        {t(locale, 'action.continue')}
      </Link>

      <Link
        href="/"
        className="touch-target mt-3 flex items-center justify-center rounded-xl border border-kraal-300 font-semibold"
      >
        {t(locale, 'action.back')}
      </Link>
    </div>
  );
}
