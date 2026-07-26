'use client';

import { useState } from 'react';

import { useLocale } from '../../../i18n/client';

/**
 * Make an offer.
 *
 * Deliberately shows no competing offer amounts and gives no indication of
 * where this offer ranks. Displaying live bids and awarding to the highest
 * bidder are the two properties that make a process an auction, and auctions
 * need a licence (MASTER_PROMPT §3.7, §5).
 */
export function OfferPanel({
  listingId,
  askingPrice,
  priceBasis,
  canOffer,
}: {
  listingId: string;
  askingPrice: number;
  priceBasis: string;
  canOffer: boolean;
}) {
  const { t } = useLocale();
  const [amount, setAmount] = useState((askingPrice / 100).toString());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!canOffer) {
    return (
      <a
        href="/onboarding"
        className="touch-target flex items-center justify-center rounded-xl bg-veld-600 font-bold text-white"
      >
        {t('verify.t1.explain')}
      </a>
    );
  }

  if (sent) {
    return (
      <p role="status" className="rounded-xl bg-veld-500/15 p-4 text-center font-semibold">
        {t('offer.made')}
      </p>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          listingId,
          amount: Math.round(Number(amount) * 100),
          message: message || undefined,
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? t('error.generic'));
        return;
      }
      setSent(true);
    } catch {
      setError(t('error.offline'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-danger-500/10 p-3 text-sm text-danger-500">
          {error}
        </p>
      )}

      <label className="block text-sm font-medium">
        Kabo ya gago / Your offer (BWP {priceBasis === 'PER_HEAD' ? 'per head' : 'per kg'})
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-2xl font-semibold"
        />
      </label>

      <label className="block text-sm font-medium">
        Molaetsa / Message
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-kraal-300 p-3"
        />
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={busy || !amount || Number(amount) <= 0}
        className="touch-target w-full rounded-xl bg-veld-600 text-lg font-bold text-white disabled:opacity-50"
      >
        {busy ? '…' : t('offer.made')}
      </button>
    </div>
  );
}
