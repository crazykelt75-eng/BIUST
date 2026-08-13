'use client';

import { useState } from 'react';

import { useLocale } from '../../i18n/client';

const ZONES = [
  ['Z6', 'Zone 6 — Central'],
  ['Z3', 'Zone 3 — North East'],
  ['Z7', 'Zone 7 — Kgatleng'],
];

const DOCS: [string, string][] = [
  ['NATIONAL_ID', 'Omang / National ID'],
  ['FARM_REGISTRATION', 'Farm registration or lease'],
  ['BRAND_MARK', 'Brand mark'],
];

/**
 * Farm registration plus verification submission, in one pass.
 *
 * Combined deliberately: a farmer who has just been told they cannot sell is
 * already at the point of maximum willingness to hand over paperwork, and
 * splitting it across two visits loses most of them.
 */
export function OnboardingForm({ hasFarm }: { hasFarm: boolean }) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [zoneCode, setZoneCode] = useState('Z6');
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [farmDone, setFarmDone] = useState(hasFarm);

  async function createFarm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/farms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, district, zoneCode }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        setError(body.message ?? t('error.generic'));
        return;
      }
      setFarmDone(true);
    } catch {
      setError(t('error.offline'));
    } finally {
      setBusy(false);
    }
  }

  async function submitDoc(kind: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/verifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      if (response.ok) setSubmitted((s) => [...s, kind]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-8">
      <h1 className="text-2xl font-bold">{t('verify.required')}</h1>
      <p className="mt-1 opacity-80">{t('verify.t2.explain')}</p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-500/10 p-3 text-sm text-danger-500">
          {error}
        </p>
      )}

      {!farmDone ? (
        <section className="mt-6 space-y-4">
          <h2 className="font-semibold">1. Polase ya gago / Your farm</h2>

          <label className="block text-sm font-medium">
            Leina la polase / Farm name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-lg"
            />
          </label>

          <label className="block text-sm font-medium">
            Kgaolo / District
            <input
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder="Serowe"
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-lg"
            />
          </label>

          <label className="block text-sm font-medium">
            Kgaolo ya bolwetse / Disease-control zone
            <select
              value={zoneCode}
              onChange={(e) => setZoneCode(e.target.value)}
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-2"
            >
              {ZONES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={createFarm}
            disabled={busy || name.trim().length < 2}
            className="touch-target w-full rounded-xl bg-veld-600 font-bold text-white disabled:opacity-50"
          >
            {busy ? '…' : t('action.continue')}
          </button>
        </section>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="font-semibold">2. Dikwalo / Documents</h2>
          <p className="text-sm opacity-70">{t('verify.pending')}</p>

          {DOCS.map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => submitDoc(kind)}
              disabled={busy || submitted.includes(kind)}
              className={`touch-target flex w-full items-center justify-between rounded-xl border px-4 text-left font-medium ${
                submitted.includes(kind)
                  ? 'border-veld-600 bg-veld-500/15'
                  : 'border-kraal-300'
              }`}
            >
              <span>{label}</span>
              <span>{submitted.includes(kind) ? '✓' : '+'}</span>
            </button>
          ))}

          <a
            href="/"
            className="touch-target mt-4 flex items-center justify-center rounded-xl border border-kraal-300 font-semibold"
          >
            {t('action.back')}
          </a>
        </section>
      )}
    </div>
  );
}
