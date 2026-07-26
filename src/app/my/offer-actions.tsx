'use client';

import { useState } from 'react';

export function OfferActions({ offerId }: { offerId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'accept' | 'decline') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/offers/${offerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? 'Something went wrong');
        return;
      }
      setDone(action === 'accept' ? 'Accepted' : 'Declined');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="mt-2 text-sm font-semibold text-veld-700">{done}</p>;

  return (
    <div className="mt-3">
      {error && <p className="mb-2 text-sm text-danger-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => act('accept')}
          disabled={busy}
          className="touch-target flex-1 rounded-lg bg-veld-600 font-bold text-white disabled:opacity-50"
        >
          Amogela / Accept
        </button>
        <button
          type="button"
          onClick={() => act('decline')}
          disabled={busy}
          className="touch-target flex-1 rounded-lg border border-kraal-300 font-semibold disabled:opacity-50"
        >
          Gana / Decline
        </button>
      </div>
    </div>
  );
}
