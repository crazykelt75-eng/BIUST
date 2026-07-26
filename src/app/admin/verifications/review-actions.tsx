'use client';

import { useState } from 'react';

export function ReviewActions({ verificationId }: { verificationId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/verifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationId, approve }),
      });
      const body = (await response.json()) as { tier?: string; message?: string };
      setDone(response.ok ? `→ ${body.tier}` : (body.message ?? 'Failed'));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="mt-2 text-sm font-semibold text-veld-700">{done}</p>;

  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        onClick={() => review(true)}
        disabled={busy}
        className="touch-target flex-1 rounded-lg bg-veld-600 font-bold text-white disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={() => review(false)}
        disabled={busy}
        className="touch-target flex-1 rounded-lg border border-kraal-300 font-semibold disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
