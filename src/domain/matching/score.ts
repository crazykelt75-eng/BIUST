/**
 * Alert match scoring.
 *
 * MASTER_PROMPT.md §9.2. The notification engine is the product — the original
 * brief was "other farmers get notified". A dead classifieds board and a daily
 * habit differ mostly in whether this file is any good.
 *
 * The score is returned with its component breakdown rather than as a bare
 * number, so every send can be logged with *why* it scored what it did. Without
 * that, tuning the weights against real conversion is guesswork.
 */

import type { VerificationTier } from '../verification';

export type ListingCategory =
  | 'CATTLE'
  | 'SMALL_STOCK'
  | 'POULTRY'
  | 'PIGS'
  | 'BREEDING_SERVICE'
  | 'FEED_FODDER'
  | 'CROPS_PRODUCE'
  | 'BY_PRODUCTS'
  | 'EQUIPMENT'
  | 'GRAZING_LEASE';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface AlertProfileSpec {
  userId: string;
  categories: ListingCategory[];
  breeds: string[];
  sexes: string[];
  minAgeMonths?: number;
  maxAgeMonths?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  /** Thebe. */
  maxPrice?: number;
  centerPoint?: GeoPoint;
  radiusKm: number;
  minSellerTier?: VerificationTier;
  minSellerRating?: number;
  keywords: string[];
}

export interface ListingCandidate {
  id: string;
  sellerId: string;
  category: ListingCategory;
  title: string;
  description?: string;
  /** Thebe, on the listing's price basis. */
  askingPrice: number;
  location?: GeoPoint;
  sellerTier: VerificationTier;
  sellerRating?: number;
  breeds: string[];
  sexes: string[];
  ageMonthsRange?: [number, number];
  weightKgRange?: [number, number];
}

export interface MatchComponents {
  specFit: number;
  proximity: number;
  price: number;
  sellerQuality: number;
}

export interface MatchResult {
  score: number;
  components: MatchComponents;
  distanceKm: number | null;
  /** Why this matched, for the alert body and for tuning. */
  reasons: string[];
}

export interface NoMatch {
  score: 0;
  rejectedBecause: string;
}

const WEIGHTS: MatchComponents = {
  specFit: 0.4,
  proximity: 0.25,
  price: 0.2,
  sellerQuality: 0.15,
};

const TIER_RANK: Record<VerificationTier, number> = {
  T0_UNVERIFIED: 0,
  T1_IDENTIFIED: 1,
  T2_VERIFIED_FARMER: 2,
  TB_VERIFIED_BUTCHER: 2,
  TT_VERIFIED_TRANSPORTER: 2,
  T3_TRUSTED_TRADER: 3,
};

/** Great-circle distance in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function overlaps(range: [number, number] | undefined, min?: number, max?: number): boolean {
  if (!range) return true;
  const [lo, hi] = range;
  if (min !== undefined && hi < min) return false;
  if (max !== undefined && lo > max) return false;
  return true;
}

/**
 * Score a listing against an alert profile.
 *
 * Returns a `NoMatch` for hard rejections rather than a low score, because
 * "wrong district entirely" and "slightly pricier than hoped" are different
 * kinds of no and should not be resolvable by lowering a threshold.
 */
export function scoreMatch(
  profile: AlertProfileSpec,
  listing: ListingCandidate,
): MatchResult | NoMatch {
  const reasons: string[] = [];

  if (listing.sellerId === profile.userId) {
    return { score: 0, rejectedBecause: 'Own listing' };
  }

  if (profile.categories.length > 0 && !profile.categories.includes(listing.category)) {
    return { score: 0, rejectedBecause: `Category ${listing.category} not wanted` };
  }

  let distanceKm: number | null = null;
  if (profile.centerPoint && listing.location) {
    distanceKm = haversineKm(profile.centerPoint, listing.location);
    if (distanceKm > profile.radiusKm) {
      return {
        score: 0,
        rejectedBecause: `${distanceKm.toFixed(0)} km away, outside the ${profile.radiusKm} km radius`,
      };
    }
  }

  if (profile.maxPrice !== undefined && listing.askingPrice > profile.maxPrice) {
    return { score: 0, rejectedBecause: 'Above the buyer\'s stated maximum price' };
  }

  if (profile.minSellerTier && TIER_RANK[listing.sellerTier] < TIER_RANK[profile.minSellerTier]) {
    return { score: 0, rejectedBecause: 'Seller below the required verification tier' };
  }

  if (
    profile.minSellerRating !== undefined &&
    listing.sellerRating !== undefined &&
    listing.sellerRating < profile.minSellerRating
  ) {
    return { score: 0, rejectedBecause: 'Seller rating below the buyer\'s threshold' };
  }

  if (!overlaps(listing.ageMonthsRange, profile.minAgeMonths, profile.maxAgeMonths)) {
    return { score: 0, rejectedBecause: 'Age outside the wanted range' };
  }

  if (!overlaps(listing.weightKgRange, profile.minWeightKg, profile.maxWeightKg)) {
    return { score: 0, rejectedBecause: 'Weight outside the wanted range' };
  }

  // ─── Soft scoring ──────────────────────────────────────────────────────────

  let specPoints = 0;
  let specMax = 0;

  if (profile.breeds.length > 0) {
    specMax += 1;
    if (listing.breeds.some((b) => profile.breeds.includes(b))) {
      specPoints += 1;
      reasons.push('Breed matches');
    }
  }

  if (profile.sexes.length > 0) {
    specMax += 1;
    if (listing.sexes.some((s) => profile.sexes.includes(s))) {
      specPoints += 1;
      reasons.push('Class of animal matches');
    }
  }

  if (profile.keywords.length > 0) {
    specMax += 1;
    const haystack = `${listing.title} ${listing.description ?? ''}`.toLowerCase();
    const hits = profile.keywords.filter((k) => haystack.includes(k.toLowerCase()));
    if (hits.length > 0) {
      specPoints += hits.length / profile.keywords.length;
      reasons.push(`Mentions ${hits.join(', ')}`);
    }
  }

  // A profile with no spec preferences is not a worse match than one whose
  // preferences all happened to hit — it simply expressed no opinion.
  const specFit = specMax === 0 ? 1 : specPoints / specMax;

  let proximity = 1;
  if (distanceKm !== null && profile.radiusKm > 0) {
    // Linear decay across the radius, floored so a listing at the edge of a
    // buyer's stated range still counts for something — they did ask for it.
    proximity = Math.max(0.15, 1 - distanceKm / profile.radiusKm);
    if (distanceKm < 50) reasons.push(`Only ${distanceKm.toFixed(0)} km away`);
  }

  let price = 0.6;
  if (profile.maxPrice !== undefined && profile.maxPrice > 0) {
    const ratio = listing.askingPrice / profile.maxPrice;
    price = Math.max(0, 1 - ratio);
    if (ratio <= 0.85) reasons.push('Comfortably within budget');
  }

  const tierScore = TIER_RANK[listing.sellerTier] / 3;
  const ratingScore = listing.sellerRating !== undefined ? listing.sellerRating / 5 : 0.5;
  const sellerQuality = tierScore * 0.5 + ratingScore * 0.5;
  if (listing.sellerTier === 'T3_TRUSTED_TRADER') reasons.push('Trusted trader');

  const components: MatchComponents = { specFit, proximity, price, sellerQuality };

  const score =
    components.specFit * WEIGHTS.specFit +
    components.proximity * WEIGHTS.proximity +
    components.price * WEIGHTS.price +
    components.sellerQuality * WEIGHTS.sellerQuality;

  return {
    score: Math.round(score * 1000) / 1000,
    components,
    distanceKm,
    reasons,
  };
}

export function isMatch(result: MatchResult | NoMatch): result is MatchResult {
  return !('rejectedBecause' in result);
}

/** Below this, an alert is noise and costs more trust than it earns. */
export const INSTANT_ALERT_THRESHOLD = 0.55;
export const DIGEST_THRESHOLD = 0.35;
