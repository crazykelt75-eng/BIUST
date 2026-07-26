import { describe, expect, it } from 'vitest';

import { pula } from '../money';
import {
  animalSchema,
  cattleListingSchema,
  isValidLitsId,
  maskLitsId,
  normaliseLitsId,
} from './validation';

const VALID_LITS = 'BW123456789';

function animal(overrides: Record<string, unknown> = {}) {
  return {
    litsId: VALID_LITS,
    sex: 'OX',
    estimatedAgeMonths: 30,
    weightKg: 400,
    weightMethod: 'WEIGHBRIDGE',
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    category: 'CATTLE',
    farmId: 'farm-1',
    title: '6 Brahman tollies',
    priceBasis: 'PER_HEAD',
    askingPrice: pula(8_000),
    quantity: 1,
    photoUrls: [
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg',
      'https://cdn.example.com/3.jpg',
    ],
    animals: [animal()],
    ...overrides,
  };
}

describe('LITS identifiers', () => {
  it('accepts the observed Botswana format', () => {
    expect(isValidLitsId('BW123456789')).toBe(true);
    expect(isValidLitsId('bw-1234-5678-90')).toBe(true);
    expect(isValidLitsId('BW 1234 5678')).toBe(true);
  });

  it('rejects obvious typos', () => {
    expect(isValidLitsId('123456789')).toBe(false); // no country prefix
    expect(isValidLitsId('BW123')).toBe(false); // too short
    expect(isValidLitsId('ZA123456789')).toBe(false); // wrong country
    expect(isValidLitsId('')).toBe(false);
  });

  it('normalises separators and case so a keyed-in tag is not rejected on punctuation', () => {
    expect(normaliseLitsId('bw-1234 5678-90')).toBe('BW1234567890');
  });

  it('masks for public display, revealing only the last four', () => {
    expect(maskLitsId('BW123456789')).toBe('BW-****-6789');
  });
});

describe('animal records', () => {
  it('accepts a well-formed record', () => {
    expect(animalSchema.safeParse(animal()).success).toBe(true);
  });

  it('refuses a weight with no method', () => {
    // A visual estimate and a weighbridge ticket are not the same claim, and
    // the difference is what most weight disputes turn on.
    const result = animalSchema.safeParse(animal({ weightMethod: undefined }));
    expect(result.success).toBe(false);
  });

  it('requires pregnancy status for females', () => {
    const result = animalSchema.safeParse(animal({ sex: 'HEIFER' }));
    expect(result.success).toBe(false);
  });

  it('accepts a female with pregnancy status given', () => {
    const result = animalSchema.safeParse(
      animal({ sex: 'HEIFER', pregnancyStatus: 'OPEN' }),
    );
    expect(result.success).toBe(true);
  });

  it('requires months when pregnant', () => {
    const result = animalSchema.safeParse(
      animal({ sex: 'COW', pregnancyStatus: 'PREGNANT' }),
    );
    expect(result.success).toBe(false);
  });

  it('requires an age or a date of birth', () => {
    const result = animalSchema.safeParse(animal({ estimatedAgeMonths: undefined }));
    expect(result.success).toBe(false);
  });

  it('rejects an animal that is its own parent twice over', () => {
    const result = animalSchema.safeParse(
      animal({ sireLitsId: 'BW999888777', damLitsId: 'BW999888777' }),
    );
    expect(result.success).toBe(false);
  });

  it('only accepts real dentition values', () => {
    expect(animalSchema.safeParse(animal({ dentition: 4 })).success).toBe(true);
    expect(animalSchema.safeParse(animal({ dentition: 3 })).success).toBe(false);
  });
});

describe('listings', () => {
  it('accepts a well-formed listing', () => {
    expect(cattleListingSchema.safeParse(listing()).success).toBe(true);
  });

  it('requires at least three photos', () => {
    const result = cattleListingSchema.safeParse(listing({ photoUrls: ['https://a/1.jpg'] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'error.photos.minimum')).toBe(true);
    }
  });

  it('requires the animal count to match the stated quantity', () => {
    const result = cattleListingSchema.safeParse(listing({ quantity: 6 }));
    expect(result.success).toBe(false);
  });

  it('catches the same ear tag entered twice in one listing', () => {
    const result = cattleListingSchema.safeParse(
      listing({ quantity: 2, animals: [animal(), animal()] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('appears twice'))).toBe(true);
    }
  });

  it('refuses per-kg pricing with no weight recorded anywhere', () => {
    const result = cattleListingSchema.safeParse(
      listing({
        priceBasis: 'PER_KG_LIVE',
        animals: [animal({ weightKg: undefined, weightMethod: undefined })],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('refuses a minimum purchase larger than the lot', () => {
    const result = cattleListingSchema.safeParse(
      listing({ quantity: 1, lotSplittable: true, minPurchaseQty: 5 }),
    );
    expect(result.success).toBe(false);
  });

  it('requires an unsplittable lot to be bought whole', () => {
    const result = cattleListingSchema.safeParse(
      listing({
        quantity: 2,
        animals: [animal(), animal({ litsId: 'BW987654321' })],
        lotSplittable: false,
        minPurchaseQty: 1,
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a splittable lot with a sensible minimum', () => {
    const result = cattleListingSchema.safeParse(
      listing({
        quantity: 2,
        animals: [animal(), animal({ litsId: 'BW987654321' })],
        lotSplittable: true,
        minPurchaseQty: 1,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('refuses an availability window that ends before it starts', () => {
    const result = cattleListingSchema.safeParse(
      listing({
        availableFrom: '2026-08-01T00:00:00Z',
        availableUntil: '2026-07-01T00:00:00Z',
      }),
    );
    expect(result.success).toBe(false);
  });
});
