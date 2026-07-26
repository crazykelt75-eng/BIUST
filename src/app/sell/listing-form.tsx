'use client';

/**
 * Listing creation.
 *
 * MASTER_PROMPT.md §3.5–3.6: under three minutes, camera first, works with the
 * signal coming and going, Setswana by default.
 *
 * Structural choices that follow from that:
 *   - Four short steps rather than one long form. A dropped connection or a
 *     locked screen loses at most one step's worth of attention.
 *   - Every change autosaves to IndexedDB. There is no save button because
 *     there is no moment at which the farmer should be responsible for
 *     remembering to press one.
 *   - Publish while offline queues rather than fails. Pressing the button is a
 *     promise, not a gamble.
 *   - Photos are compressed on device before storage or upload — a camera frame
 *     is 4–8 MB and the farmer is paying for that bundle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '../../i18n/client';
import {
  type DraftPhoto,
  type ListingDraft,
  compressImage,
  deleteDraft,
  newDraftId,
  queuePublish,
  saveDraft,
} from '../../lib/drafts';

const MIN_PHOTOS = 3;

type Step = 'photos' | 'animals' | 'price' | 'review';
const STEPS: Step[] = ['photos', 'animals', 'price', 'review'];

interface AnimalRow {
  litsId: string;
  sex: string;
  breed: string;
  estimatedAgeMonths: string;
  weightKg: string;
  weightMethod: string;
  pregnancyStatus: string;
}

const emptyAnimal = (): AnimalRow => ({
  litsId: '',
  sex: 'OX',
  breed: 'TSWANA',
  estimatedAgeMonths: '',
  weightKg: '',
  weightMethod: 'VISUAL_ESTIMATE',
  pregnancyStatus: '',
});

const FEMALE = new Set(['COW', 'HEIFER', 'WEANER_FEMALE']);

export function ListingForm({ farmId }: { farmId: string }) {
  const { t, locale, setLocale } = useLocale();

  const [draftId] = useState(newDraftId);
  const [step, setStep] = useState<Step>('photos');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [animals, setAnimals] = useState<AnimalRow[]>([emptyAnimal()]);
  const [title, setTitle] = useState('');
  const [priceBasis, setPriceBasis] = useState('PER_HEAD');
  const [price, setPrice] = useState('');
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Object URLs leak if they are not revoked; on a long session with many
  // photos that is real memory on a device that does not have much.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const persist = useCallback(
    (partial: Partial<ListingDraft>) => {
      const draft: ListingDraft = {
        id: draftId,
        farmId,
        title,
        priceBasis,
        askingPrice: price ? Math.round(Number(price) * 100) : undefined,
        quantity: animals.length,
        animals: animals as unknown as Record<string, unknown>[],
        photos,
        updatedAt: Date.now(),
        ...partial,
      };
      // Fire and forget: the form must never wait on disk.
      void saveDraft(draft);
    },
    [animals, draftId, farmId, photos, price, priceBasis, title],
  );

  useEffect(() => {
    persist({});
  }, [persist]);

  async function onCapture(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setBusy(true);
    try {
      const added: DraftPhoto[] = [];
      for (const file of files) {
        const blob = await compressImage(file);
        added.push({ id: `${Date.now()}-${added.length}`, blob, capturedAt: Date.now() });
      }
      setPhotos((current) => [...current, ...added]);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  function previewUrl(photo: DraftPhoto): string {
    const url = URL.createObjectURL(photo.blob);
    objectUrls.current.push(url);
    return url;
  }

  function updateAnimal(index: number, patch: Partial<AnimalRow>) {
    setAnimals((current) =>
      current.map((animal, i) => (i === index ? { ...animal, ...patch } : animal)),
    );
  }

  function validate(): string[] {
    const found: string[] = [];
    if (photos.length < MIN_PHOTOS) found.push(t('error.photos.minimum'));
    if (!price || Number(price) <= 0) found.push(t('error.price.required'));
    animals.forEach((animal) => {
      if (!animal.litsId.trim()) found.push(t('error.lits.required'));
    });
    return found;
  }

  async function onPublish() {
    const found = validate();
    setErrors(found);
    if (found.length > 0) return;

    setBusy(true);
    const payload = {
      category: 'CATTLE',
      farmId,
      title: title || t('listing.create.title'),
      priceBasis,
      askingPrice: Math.round(Number(price) * 100),
      quantity: animals.length,
      animals: animals.map((animal) => ({
        litsId: animal.litsId.trim(),
        sex: animal.sex,
        breed: animal.breed,
        estimatedAgeMonths: animal.estimatedAgeMonths
          ? Number(animal.estimatedAgeMonths)
          : undefined,
        weightKg: animal.weightKg ? Number(animal.weightKg) : undefined,
        weightMethod: animal.weightKg ? animal.weightMethod : undefined,
        pregnancyStatus: FEMALE.has(animal.sex)
          ? animal.pregnancyStatus || 'OPEN'
          : undefined,
      })),
    };

    try {
      if (!navigator.onLine) {
        await queuePublish({
          id: draftId,
          draftId,
          payload,
          photoIds: photos.map((p) => p.id),
        });
        setNotice(t('listing.create.saved_offline'));
        return;
      }

      const body = new FormData();
      body.set('listing', JSON.stringify(payload));
      photos.forEach((photo, index) => {
        body.append('photos', photo.blob, `photo-${index}.webp`);
      });

      const response = await fetch('/api/listings', { method: 'POST', body });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as
          | { failures?: { message: string }[]; message?: string }
          | null;
        setErrors(
          detail?.failures?.map((f) => translateKey(f.message)) ??
            [detail?.message ?? t('error.generic')],
        );
        return;
      }

      // Only now is the draft safe to remove.
      await deleteDraft(draftId);
      window.location.href = '/';
    } catch {
      // A network failure mid-publish is the common case, not the exception.
      await queuePublish({
        id: draftId,
        draftId,
        payload,
        photoIds: photos.map((p) => p.id),
      });
      setNotice(t('error.offline'));
    } finally {
      setBusy(false);
    }
  }

  function translateKey(message: string): string {
    return message.startsWith('error.') ? t(message as never) : message;
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-xl px-4 pb-32">
      <header className="flex items-center justify-between py-4">
        <h1 className="text-2xl font-bold">{t('listing.create.title')}</h1>
        <button
          type="button"
          onClick={() => setLocale(locale === 'TN' ? 'EN' : 'TN')}
          className="touch-target rounded-lg border border-kraal-300 px-3 text-sm font-semibold"
        >
          {locale === 'TN' ? 'English' : 'Setswana'}
        </button>
      </header>

      {!online && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-warn-500/15 p-3 text-sm font-medium text-warn-500"
        >
          {t('error.offline')}
        </p>
      )}

      <ol className="mb-6 flex gap-1" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-veld-500' : 'bg-kraal-200'}`}
          />
        ))}
      </ol>

      {errors.length > 0 && (
        <ul role="alert" className="mb-4 space-y-1 rounded-lg bg-danger-500/10 p-3 text-sm">
          {errors.map((error) => (
            <li key={error} className="text-danger-500">
              {error}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-veld-500/15 p-3 text-sm font-medium">
          {notice}
        </p>
      )}

      {step === 'photos' && (
        <section>
          <h2 className="text-lg font-semibold">{t('listing.create.photos')}</h2>
          <p className="mb-4 text-sm opacity-80">{t('listing.create.photos.hint')}</p>

          <div className="mb-4 grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <img
                key={photo.id}
                src={previewUrl(photo)}
                alt=""
                className="aspect-square w-full rounded-lg object-cover"
              />
            ))}
          </div>

          <label className="touch-target flex w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-kraal-300 text-lg font-semibold">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={onCapture}
              className="sr-only"
            />
            {busy ? '…' : `+ ${t('listing.create.photos')}`}
          </label>

          <p className="mt-2 text-sm opacity-70">
            {photos.length} / {MIN_PHOTOS}
          </p>
        </section>
      )}

      {step === 'animals' && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('listing.create.lits')}</h2>

          {animals.map((animal, index) => (
            <fieldset key={index} className="mb-4 rounded-xl border border-kraal-200 p-3">
              <legend className="px-1 text-sm font-semibold">#{index + 1}</legend>

              <label className="block text-sm font-medium">
                {t('listing.create.lits')}
                <input
                  value={animal.litsId}
                  onChange={(e) => updateAnimal(index, { litsId: e.target.value })}
                  placeholder="BW123456789"
                  inputMode="text"
                  autoCapitalize="characters"
                  className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-lg"
                />
                <span className="text-xs opacity-70">{t('listing.create.lits.hint')}</span>
              </label>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium">
                  Sex
                  <select
                    value={animal.sex}
                    onChange={(e) => updateAnimal(index, { sex: e.target.value })}
                    className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-2"
                  >
                    {['BULL', 'COW', 'OX', 'HEIFER', 'WEANER_MALE', 'WEANER_FEMALE', 'CALF'].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value.replace('_', ' ')}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  {t('listing.create.weight')}
                  <input
                    value={animal.weightKg}
                    onChange={(e) => updateAnimal(index, { weightKg: e.target.value })}
                    inputMode="numeric"
                    className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-lg"
                  />
                </label>
              </div>

              {animal.weightKg && (
                <label className="mt-3 block text-sm font-medium">
                  {t('listing.create.weight.method')}
                  <select
                    value={animal.weightMethod}
                    onChange={(e) => updateAnimal(index, { weightMethod: e.target.value })}
                    className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-2"
                  >
                    <option value="WEIGHBRIDGE">Weighbridge</option>
                    <option value="SCALE">Scale</option>
                    <option value="TAPE_ESTIMATE">Tape</option>
                    <option value="VISUAL_ESTIMATE">Estimate</option>
                  </select>
                </label>
              )}

              {FEMALE.has(animal.sex) && (
                <label className="mt-3 block text-sm font-medium">
                  Pregnancy
                  <select
                    value={animal.pregnancyStatus}
                    onChange={(e) => updateAnimal(index, { pregnancyStatus: e.target.value })}
                    className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-2"
                  >
                    <option value="OPEN">Open</option>
                    <option value="PREGNANT">Pregnant</option>
                    <option value="LACTATING">Lactating</option>
                  </select>
                </label>
              )}
            </fieldset>
          ))}

          <button
            type="button"
            onClick={() => setAnimals((current) => [...current, emptyAnimal()])}
            className="touch-target w-full rounded-xl border-2 border-dashed border-kraal-300 font-semibold"
          >
            +
          </button>
        </section>
      )}

      {step === 'price' && (
        <section className="space-y-4">
          <label className="block text-sm font-medium">
            {t('listing.create.title')}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-lg"
            />
          </label>

          <label className="block text-sm font-medium">
            {t('listing.create.price')} (BWP)
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="touch-target mt-1 w-full rounded-lg border border-kraal-300 px-3 text-2xl font-semibold"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-medium">Basis</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {[
                ['PER_HEAD', 'Per head'],
                ['PER_KG_LIVE', 'Per kg'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriceBasis(value!)}
                  aria-pressed={priceBasis === value}
                  className={`touch-target rounded-lg border font-semibold ${
                    priceBasis === value
                      ? 'border-veld-600 bg-veld-500/15'
                      : 'border-kraal-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </section>
      )}

      {step === 'review' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{title || t('listing.create.title')}</h2>
          <dl className="rounded-xl border border-kraal-200 p-3 text-sm">
            <div className="flex justify-between py-1">
              <dt className="opacity-70">{t('listing.create.photos')}</dt>
              <dd className="font-semibold">{photos.length}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="opacity-70">Animals</dt>
              <dd className="font-semibold">{animals.length}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="opacity-70">{t('listing.create.price')}</dt>
              <dd className="font-semibold">BWP {price || '—'}</dd>
            </div>
          </dl>
        </section>
      )}

      <nav className="fixed inset-x-0 bottom-0 border-t border-kraal-200 bg-[var(--background)] p-3">
        <div className="mx-auto flex max-w-xl gap-3">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => setStep(STEPS[stepIndex - 1]!)}
              className="touch-target flex-1 rounded-xl border border-kraal-300 font-semibold"
            >
              {t('action.back')}
            </button>
          )}

          {step === 'review' ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={busy}
              className="touch-target flex-[2] rounded-xl bg-veld-600 font-bold text-white disabled:opacity-60"
            >
              {busy ? '…' : t('action.publish')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(STEPS[stepIndex + 1]!)}
              className="touch-target flex-[2] rounded-xl bg-veld-600 font-bold text-white"
            >
              {t('action.continue')}
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
