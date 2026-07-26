/**
 * Listing input validation.
 *
 * MASTER_PROMPT.md §4.2. The schema is polymorphic by category — one deep
 * vertical (cattle) rather than ten shallow ones — so category-specific rules
 * live in their own schema and the shared listing fields are validated once.
 */

import { z } from 'zod';

/**
 * LITS identifier format.
 *
 * PROVISIONAL. This accepts the shape Botswana LITS numbers are observed to
 * take — a BW country prefix followed by digits — but the authoritative format
 * has not been confirmed with the Department of Veterinary Services, and that
 * confirmation is an open item (§14). The validator is deliberately permissive
 * about separators and case so a farmer keying a tag from memory is not
 * blocked by punctuation, and deliberately strict about the country prefix and
 * digit count so obvious typos are caught at entry rather than at the loading
 * ramp.
 *
 * When the real format is confirmed, change it here and nowhere else.
 */
const LITS_PATTERN = /^BW[- ]?(\d[- ]?){8,14}$/i;

export function normaliseLitsId(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidLitsId(raw: string): boolean {
  return LITS_PATTERN.test(raw.trim());
}

/** Public display form — the full number is revealed only after escrow funding. */
export function maskLitsId(litsId: string): string {
  const normalised = normaliseLitsId(litsId);
  if (normalised.length <= 6) return normalised;
  const head = normalised.slice(0, 2);
  const tail = normalised.slice(-4);
  return `${head}-****-${tail}`;
}

export const litsIdSchema = z
  .string()
  .trim()
  .min(1, 'error.lits.required')
  .refine(isValidLitsId, 'error.lits.format')
  .transform(normaliseLitsId);

// ─────────────────────────────────────────────────────────────────────────────
// Animal
// ─────────────────────────────────────────────────────────────────────────────

export const cattleBreedSchema = z.enum([
  'TSWANA',
  'BRAHMAN',
  'SIMMENTAL',
  'BONSMARA',
  'AFRIKANER',
  'COMPOSITE',
  'OTHER',
]);

export const animalSexSchema = z.enum([
  'BULL',
  'COW',
  'OX',
  'HEIFER',
  'WEANER_MALE',
  'WEANER_FEMALE',
  'CALF',
]);

export const weightMethodSchema = z.enum([
  'WEIGHBRIDGE',
  'SCALE',
  'TAPE_ESTIMATE',
  'VISUAL_ESTIMATE',
]);

const FEMALE_SEXES = new Set(['COW', 'HEIFER', 'WEANER_FEMALE']);

/**
 * The plain object shape, kept separate from the refined schema below.
 *
 * `superRefine` returns a ZodEffects, which has no `.partial()` — and drafts
 * need exactly that. Keeping the base object addressable is what lets a
 * half-finished animal record be saved from a kraal with no signal.
 */
const animalBaseSchema = z
  .object({
    litsId: litsIdSchema,
    breed: cattleBreedSchema.optional(),
    sex: animalSexSchema,
    dateOfBirth: z.coerce.date().optional(),
    estimatedAgeMonths: z.number().int().min(0).max(300).optional(),
    /** Dentition — the field butchers actually filter on. */
    dentition: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6), z.literal(8)]).optional(),
    weightKg: z.number().int().min(10).max(1_500).optional(),
    weightMethod: weightMethodSchema.optional(),
    weighedAt: z.coerce.date().optional(),
    bodyCondition: z.number().int().min(1).max(5).optional(),
    hornStatus: z.enum(['HORNED', 'POLLED', 'DEHORNED']).optional(),
    pregnancyStatus: z.enum(['OPEN', 'PREGNANT', 'LACTATING', 'NOT_APPLICABLE']).optional(),
    pregnancyMonths: z.number().int().min(0).max(10).optional(),
    temperament: z.enum(['DOCILE', 'AVERAGE', 'WILD']).optional(),
    sireLitsId: z.string().transform(normaliseLitsId).optional(),
    damLitsId: z.string().transform(normaliseLitsId).optional(),
  });

export const animalSchema = animalBaseSchema
  .superRefine((animal, ctx) => {
    // A weight without its method is a number nobody can act on. A visual
    // estimate and a weighbridge ticket are not the same claim, and the
    // difference is what most weight disputes turn on (§3.4).
    if (animal.weightKg !== undefined && animal.weightMethod === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weightMethod'],
        message: 'A weight must record how it was measured',
      });
    }

    if (FEMALE_SEXES.has(animal.sex) && animal.pregnancyStatus === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pregnancyStatus'],
        message: 'Pregnancy status is required for female cattle',
      });
    }

    if (animal.pregnancyStatus === 'PREGNANT' && animal.pregnancyMonths === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pregnancyMonths'],
        message: 'How many months pregnant?',
      });
    }

    if (animal.dateOfBirth === undefined && animal.estimatedAgeMonths === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedAgeMonths'],
        message: 'Give either a date of birth or an estimated age',
      });
    }

    if (animal.sireLitsId && animal.sireLitsId === animal.damLitsId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['damLitsId'],
        message: 'Sire and dam cannot be the same animal',
      });
    }
  });

export type AnimalInput = z.infer<typeof animalSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────────────────────

export const priceBasisSchema = z.enum([
  'PER_HEAD',
  'PER_KG_LIVE',
  'PER_KG_CARCASS',
  'PER_LOT',
]);

export const saleMechanismSchema = z.enum([
  'FIXED_PRICE',
  'BEST_OFFER',
  'SEALED_BID_TENDER',
  'TIMED_AUCTION',
  'GROUP_BUY',
]);

/** Mechanisms available in Phase 1. See §5 and the licensing note in §3.7. */
export const PHASE_1_MECHANISMS = ['FIXED_PRICE', 'BEST_OFFER'] as const;

export const MIN_PHOTOS = 3;

const baseListingSchema = z.object({
  farmId: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4_000).optional(),
  voiceNoteUrl: z.string().url().optional(),
  saleMechanism: saleMechanismSchema.default('BEST_OFFER'),
  priceBasis: priceBasisSchema,
  /** Thebe. */
  askingPrice: z.number().int().positive('error.price.required'),
  priceNegotiable: z.boolean().default(true),
  quantity: z.number().int().min(1).default(1),
  lotSplittable: z.boolean().default(false),
  minPurchaseQty: z.number().int().min(1).default(1),
  availableFrom: z.coerce.date().optional(),
  availableUntil: z.coerce.date().optional(),
  collectionTerms: z.enum(['BUYER_COLLECTS', 'SELLER_DELIVERS', 'NEGOTIABLE']).default('BUYER_COLLECTS'),
  inspectionWelcome: z.boolean().default(true),
  photoUrls: z.array(z.string().url()).default([]),
});

export const cattleListingSchema = baseListingSchema
  .extend({
    category: z.literal('CATTLE'),
    animals: z.array(animalSchema).min(1, 'At least one animal is required'),
  })
  .superRefine((listing, ctx) => {
    if (listing.photoUrls.length < MIN_PHOTOS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['photoUrls'],
        message: 'error.photos.minimum',
      });
    }

    if (listing.animals.length !== listing.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: `Quantity is ${listing.quantity} but ${listing.animals.length} animal record(s) were given`,
      });
    }

    if (listing.minPurchaseQty > listing.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minPurchaseQty'],
        message: 'Minimum purchase cannot exceed the number of animals for sale',
      });
    }

    if (!listing.lotSplittable && listing.minPurchaseQty !== listing.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minPurchaseQty'],
        message: 'A lot that cannot be split must be bought whole',
      });
    }

    // A duplicate tag within one listing is a data-entry slip, not fraud —
    // catch it here with a helpful message rather than letting the global
    // uniqueness constraint reject the whole submission opaquely.
    const seen = new Set<string>();
    listing.animals.forEach((animal, index) => {
      if (seen.has(animal.litsId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['animals', index, 'litsId'],
          message: 'This ear tag number appears twice in this listing',
        });
      }
      seen.add(animal.litsId);
    });

    if (
      listing.availableFrom &&
      listing.availableUntil &&
      listing.availableUntil <= listing.availableFrom
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availableUntil'],
        message: 'The end of the availability window must come after the start',
      });
    }

    if (
      (listing.priceBasis === 'PER_KG_LIVE' || listing.priceBasis === 'PER_KG_CARCASS') &&
      listing.animals.every((a) => a.weightKg === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceBasis'],
        message: 'Pricing per kilogram requires at least one recorded weight',
      });
    }
  });

export type CattleListingInput = z.infer<typeof cattleListingSchema>;

/**
 * Draft schema — everything optional except what identifies the draft.
 *
 * Drafts are saved constantly from a phone at a kraal, often offline and
 * half-finished (§3.5). Validation applies at publish, not at every autosave;
 * refusing to save an incomplete draft would lose a farmer's work.
 */
export const listingDraftSchema = baseListingSchema.partial().extend({
  farmId: z.string().min(1),
  category: z.literal('CATTLE').default('CATTLE'),
  animals: z.array(animalBaseSchema.partial()).optional(),
});

export type ListingDraftInput = z.infer<typeof listingDraftSchema>;

export interface ValidationFailure {
  path: string;
  message: string;
}

/** Flatten a Zod error into something a form can render field by field. */
export function toFailures(error: z.ZodError): ValidationFailure[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
