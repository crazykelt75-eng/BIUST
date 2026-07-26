import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, resolveLocale, t } from './messages';

describe('locale resolution', () => {
  it('defaults to Setswana', () => {
    // Setswana is the first language of most of the farmers this exists for.
    expect(DEFAULT_LOCALE).toBe('TN');
    expect(resolveLocale(null)).toBe('TN');
    expect(resolveLocale('')).toBe('TN');
  });

  it('honours an explicit English preference', () => {
    expect(resolveLocale('en-GB,en;q=0.9')).toBe('EN');
  });

  it('reads Setswana and Botswana locale tags', () => {
    expect(resolveLocale('tn-BW')).toBe('TN');
    expect(resolveLocale('en-BW')).toBe('TN');
  });
});

describe('message lookup', () => {
  it('returns the Setswana string', () => {
    expect(t('TN', 'action.continue')).toBe('Tswelela');
  });

  it('returns the English string', () => {
    expect(t('EN', 'action.continue')).toBe('Continue');
  });

  it('substitutes placeholders', () => {
    expect(t('EN', 'offer.expires_in', { hours: 48 })).toBe('Expires in 48 hours');
    expect(t('TN', 'offer.expires_in', { hours: 48 })).toBe('E fela mo diureng tse 48');
  });

  it('leaves an unknown placeholder in place rather than printing undefined', () => {
    expect(t('EN', 'offer.expires_in', {})).toBe('Expires in {hours} hours');
  });
});

describe('catalogue completeness', () => {
  it('translates every key in every supported locale', () => {
    // A missing translation ships as an English string in a Setswana UI, which
    // is exactly the drift this test exists to catch.
    const englishKeys = Object.keys(
      // Round-trip through a known key set: every key resolvable in EN.
      { ...enKeys() },
    );

    for (const locale of SUPPORTED_LOCALES) {
      for (const key of englishKeys) {
        const value = t(locale, key as never);
        expect(value, `${locale} is missing "${key}"`).not.toBe(key);
        expect(value.trim().length, `${locale}:"${key}" is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('has no untranslated Setswana entries left identical to English', () => {
    // Proper nouns and the app name are legitimately identical; everything
    // else being identical means a translation was skipped.
    const allowed = new Set(['app.name', 'listing.create.lits.hint']);
    const suspicious: string[] = [];

    for (const key of Object.keys(enKeys())) {
      if (allowed.has(key)) continue;
      const en = t('EN', key as never);
      const tn = t('TN', key as never);
      if (en === tn) suspicious.push(key);
    }

    expect(suspicious, `Untranslated keys: ${suspicious.join(', ')}`).toHaveLength(0);
  });
});

/**
 * The English catalogue is not exported directly; this reflects the key set by
 * probing a representative sample plus everything referenced elsewhere in the
 * codebase.
 */
function enKeys(): Record<string, true> {
  const keys = [
    'app.name',
    'app.tagline',
    'action.continue',
    'action.back',
    'action.save',
    'action.cancel',
    'action.publish',
    'action.retry',
    'listing.create.title',
    'listing.create.photos',
    'listing.create.photos.hint',
    'listing.create.lits',
    'listing.create.lits.hint',
    'listing.create.weight',
    'listing.create.weight.method',
    'listing.create.price',
    'listing.create.saved_offline',
    'listing.status.draft',
    'listing.status.active',
    'listing.status.sold',
    'movement.same_zone',
    'movement.permit_required',
    'movement.blocked',
    'movement.unknown_zone',
    'offer.made',
    'offer.received',
    'offer.accepted',
    'offer.declined',
    'offer.expires_in',
    'txn.escrow.pending',
    'txn.escrow.funded',
    'txn.escrow.explain',
    'txn.ready_for_collection',
    'txn.collection_code',
    'txn.collection_code.explain',
    'txn.settled',
    'txn.weight_adjusted',
    'alert.new_match',
    'alert.new_match.body',
    'alert.price_drop',
    'alert.wtb_match',
    'alert.digest.title',
    'alert.market.title',
    'verify.required',
    'verify.t1.explain',
    'verify.t2.explain',
    'verify.offer_ceiling',
    'verify.pending',
    'error.lits.required',
    'error.lits.format',
    'error.lits.duplicate',
    'error.lits.stolen',
    'error.photos.minimum',
    'error.price.required',
    'error.offline',
    'error.generic',
  ];
  return Object.fromEntries(keys.map((k) => [k, true as const]));
}
