'use client';

/**
 * Sign in with a phone number and a one-time code.
 *
 * No password, because a shared household phone and a remembered password are
 * a bad combination, and because most users here have a phone number long
 * before they have an email address.
 *
 * Two steps, and the second one autofocuses and autosubmits on the sixth digit
 * — an SMS code is the most annoying thing to type on a cracked screen.
 */

import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../i18n/client';

type Step = 'phone' | 'code';

export function SignInForm() {
  const { t, locale, setLocale } = useLocale();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1_000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onRequestCode() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body = (await response.json()) as {
        challengeId?: string;
        maskedPhone?: string;
        message?: string;
      };

      if (!response.ok) {
        setError(body.message ?? t('error.generic'));
        if (response.status === 429) {
          setCooldown(Number(response.headers.get('Retry-After') ?? 60));
        }
        return;
      }

      setChallengeId(body.challengeId ?? '');
      setMaskedPhone(body.maskedPhone ?? '');
      setStep('code');
    } catch {
      setError(t('error.offline'));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(submitted: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, code: submitted }),
      });
      const body = (await response.json()) as { message?: string };

      if (!response.ok) {
        setError(body.message ?? t('error.generic'));
        setCode('');
        codeInput.current?.focus();
        return;
      }

      window.location.href = '/';
    } catch {
      setError(t('error.offline'));
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    // Submit on the sixth digit rather than making them find a button.
    if (digits.length === 6 && !busy) void onVerify(digits);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">{t('app.name')}</h1>
        <p className="opacity-80">{t('app.tagline')}</p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger-500/10 p-3 text-sm text-danger-500">
          {error}
        </p>
      )}

      {step === 'phone' ? (
        <>
          <label className="block text-sm font-medium">
            Nomoro ya mogala / Phone number
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="71 234 567"
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-2xl"
            />
          </label>

          <button
            type="button"
            onClick={onRequestCode}
            disabled={busy || cooldown > 0 || phone.trim().length < 8}
            className="touch-target mt-4 w-full rounded-xl bg-veld-600 text-lg font-bold text-white disabled:opacity-50"
          >
            {cooldown > 0 ? `${cooldown}s` : busy ? '…' : t('action.continue')}
          </button>
        </>
      ) : (
        <>
          <p className="mb-2 text-sm opacity-80">{maskedPhone}</p>
          <label className="block text-sm font-medium">
            Khoutu / Code
            <input
              ref={codeInput}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-center font-mono text-3xl tracking-[0.4em]"
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setStep('phone');
              setCode('');
              setError(null);
            }}
            className="touch-target mt-4 w-full rounded-xl border border-kraal-300 font-semibold"
          >
            {t('action.back')}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => setLocale(locale === 'TN' ? 'EN' : 'TN')}
        className="mt-8 text-sm underline opacity-70"
      >
        {locale === 'TN' ? 'English' : 'Setswana'}
      </button>
    </div>
  );
}
