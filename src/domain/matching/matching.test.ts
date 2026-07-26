import { describe, expect, it } from 'vitest';

import { pula } from '../money';
import {
  MAX_INSTANT_ALERTS_PER_DAY,
  type DeliveryContext,
  decideDelivery,
  inQuietHours,
  nextDigestAt,
} from './delivery';
import {
  type AlertProfileSpec,
  type ListingCandidate,
  INSTANT_ALERT_THRESHOLD,
  haversineKm,
  isMatch,
  scoreMatch,
} from './score';

// Serowe and Palapye — about 65 km apart, both Central District.
const SEROWE = { lat: -22.3875, lng: 26.7108 };
const PALAPYE = { lat: -22.5461, lng: 27.1252 };
const GABORONE = { lat: -24.6282, lng: 25.9231 };

const KABELO: AlertProfileSpec = {
  userId: 'kabelo',
  categories: ['CATTLE'],
  breeds: ['BRAHMAN', 'TSWANA'],
  sexes: ['WEANER_MALE', 'WEANER_FEMALE'],
  maxPrice: pula(10_000),
  centerPoint: PALAPYE,
  radiusKm: 150,
  keywords: [],
};

const WEANERS: ListingCandidate = {
  id: 'l1',
  sellerId: 'mpho',
  category: 'CATTLE',
  title: 'Brahman weaners, 12 head',
  askingPrice: pula(7_500),
  location: SEROWE,
  sellerTier: 'T2_VERIFIED_FARMER',
  sellerRating: 4.6,
  breeds: ['BRAHMAN'],
  sexes: ['WEANER_MALE'],
  ageMonthsRange: [8, 10],
  weightKgRange: [180, 220],
};

describe('distance', () => {
  it('measures Serowe to Palapye at roughly 65 km', () => {
    const d = haversineKm(SEROWE, PALAPYE);
    expect(d).toBeGreaterThan(45);
    expect(d).toBeLessThan(85);
  });
});

describe('hard rejections', () => {
  it('never alerts a seller about their own listing', () => {
    const result = scoreMatch({ ...KABELO, userId: 'mpho' }, WEANERS);
    expect(isMatch(result)).toBe(false);
  });

  it('rejects listings outside the stated radius', () => {
    const result = scoreMatch(KABELO, { ...WEANERS, location: GABORONE });
    expect(isMatch(result)).toBe(false);
    if (!isMatch(result)) expect(result.rejectedBecause).toMatch(/outside the 150 km radius/);
  });

  it('rejects listings above the stated budget', () => {
    const result = scoreMatch(KABELO, { ...WEANERS, askingPrice: pula(14_000) });
    expect(isMatch(result)).toBe(false);
  });

  it('rejects the wrong category outright', () => {
    const result = scoreMatch(KABELO, { ...WEANERS, category: 'POULTRY' });
    expect(isMatch(result)).toBe(false);
  });

  it('respects a minimum seller tier', () => {
    const result = scoreMatch(
      { ...KABELO, minSellerTier: 'T3_TRUSTED_TRADER' },
      WEANERS,
    );
    expect(isMatch(result)).toBe(false);
  });

  it('rejects animals outside the wanted age band', () => {
    const result = scoreMatch(
      { ...KABELO, minAgeMonths: 18, maxAgeMonths: 30 },
      WEANERS,
    );
    expect(isMatch(result)).toBe(false);
  });
});

describe('scoring', () => {
  it('scores a strong local match above the instant threshold', () => {
    const result = scoreMatch(KABELO, WEANERS);
    expect(isMatch(result)).toBe(true);
    if (isMatch(result)) {
      expect(result.score).toBeGreaterThan(INSTANT_ALERT_THRESHOLD);
      expect(result.reasons).toContain('Breed matches');
      expect(result.distanceKm).toBeLessThan(100);
    }
  });

  it('scores a nearer listing above an otherwise identical distant one', () => {
    const near = scoreMatch(KABELO, { ...WEANERS, location: PALAPYE });
    const far = scoreMatch(KABELO, { ...WEANERS, location: SEROWE });
    if (isMatch(near) && isMatch(far)) {
      expect(near.score).toBeGreaterThan(far.score);
    }
  });

  it('scores a cheaper listing above an otherwise identical dearer one', () => {
    const cheap = scoreMatch(KABELO, { ...WEANERS, askingPrice: pula(5_000) });
    const dear = scoreMatch(KABELO, { ...WEANERS, askingPrice: pula(9_800) });
    if (isMatch(cheap) && isMatch(dear)) {
      expect(cheap.score).toBeGreaterThan(dear.score);
    }
  });

  it('rewards a trusted trader over an unverified seller', () => {
    const trusted = scoreMatch(KABELO, { ...WEANERS, sellerTier: 'T3_TRUSTED_TRADER' });
    const plain = scoreMatch(KABELO, { ...WEANERS, sellerTier: 'T1_IDENTIFIED' });
    if (isMatch(trusted) && isMatch(plain)) {
      expect(trusted.score).toBeGreaterThan(plain.score);
      expect(trusted.reasons).toContain('Trusted trader');
    }
  });

  it('does not punish a profile that expressed no breed preference', () => {
    // Saying nothing about breed is not the same as wanting a breed and missing it.
    const unopinionated = scoreMatch({ ...KABELO, breeds: [], sexes: [] }, WEANERS);
    if (isMatch(unopinionated)) {
      expect(unopinionated.components.specFit).toBe(1);
    }
  });

  it('reports a component breakdown so weights can be tuned later', () => {
    const result = scoreMatch(KABELO, WEANERS);
    if (isMatch(result)) {
      expect(result.components).toHaveProperty('specFit');
      expect(result.components).toHaveProperty('proximity');
      expect(result.components).toHaveProperty('price');
      expect(result.components).toHaveProperty('sellerQuality');
    }
  });
});

// ─── Delivery ────────────────────────────────────────────────────────────────

const BASE_DELIVERY: DeliveryContext = {
  matchScore: 0.8,
  channel: 'PUSH',
  urgency: 'INSTANT',
  tier: 'T2_VERIFIED_FARMER',
  quietHoursStart: 21,
  quietHoursEnd: 6,
  instantSentToday: 0,
  alreadyAlerted: false,
  timeCritical: false,
  now: new Date('2026-07-26T14:00:00'),
};

describe('quiet hours', () => {
  it('handles a window that wraps midnight', () => {
    expect(inQuietHours(new Date('2026-07-26T22:00:00'), 21, 6)).toBe(true);
    expect(inQuietHours(new Date('2026-07-26T03:00:00'), 21, 6)).toBe(true);
    expect(inQuietHours(new Date('2026-07-26T14:00:00'), 21, 6)).toBe(false);
    expect(inQuietHours(new Date('2026-07-26T06:00:00'), 21, 6)).toBe(false);
  });

  it('defers a late-night alert to morning', () => {
    const decision = decideDelivery({
      ...BASE_DELIVERY,
      now: new Date('2026-07-26T23:30:00'),
    });
    expect(decision.action).toBe('DEFER_PAST_QUIET_HOURS');
    expect(decision.deliverAt?.getHours()).toBe(6);
  });
});

describe('delivery decisions', () => {
  it('sends a strong match immediately', () => {
    expect(decideDelivery(BASE_DELIVERY).action).toBe('SEND_NOW');
  });

  it('suppresses a repeat alert for the same listing', () => {
    const decision = decideDelivery({ ...BASE_DELIVERY, alreadyAlerted: true });
    expect(decision.action).toBe('SUPPRESS');
    expect(decision.logStatus).toBe('SUPPRESSED_DUPLICATE');
  });

  it('rolls a weak match into the digest rather than pushing it', () => {
    const decision = decideDelivery({ ...BASE_DELIVERY, matchScore: 0.45 });
    expect(decision.action).toBe('DEFER_TO_DIGEST');
  });

  it('drops a match too weak even for the digest', () => {
    expect(decideDelivery({ ...BASE_DELIVERY, matchScore: 0.2 }).action).toBe('SUPPRESS');
  });

  it('rolls overflow into the digest once the daily cap is hit', () => {
    const decision = decideDelivery({
      ...BASE_DELIVERY,
      instantSentToday: MAX_INSTANT_ALERTS_PER_DAY,
    });
    expect(decision.action).toBe('DEFER_TO_DIGEST');
    expect(decision.logStatus).toBe('SUPPRESSED_RATE_LIMIT');
  });

  it('gates SMS behind identity verification, since it costs real money', () => {
    const decision = decideDelivery({
      ...BASE_DELIVERY,
      channel: 'SMS',
      tier: 'T0_UNVERIFIED',
    });
    expect(decision.action).toBe('DEFER_TO_DIGEST');
  });

  it('lets a verified user receive SMS', () => {
    const decision = decideDelivery({
      ...BASE_DELIVERY,
      channel: 'SMS',
      tier: 'T1_IDENTIFIED',
    });
    expect(decision.action).toBe('SEND_NOW');
  });
});

describe('time-critical events bypass everything', () => {
  it('sends a collection code at 3am past the cap and quiet hours', () => {
    const decision = decideDelivery({
      ...BASE_DELIVERY,
      timeCritical: true,
      now: new Date('2026-07-27T03:00:00'),
      instantSentToday: 99,
      matchScore: 0,
    });
    expect(decision.action).toBe('SEND_NOW');
  });
});

describe('digest scheduling', () => {
  it('schedules the daily digest for 6am', () => {
    const at = nextDigestAt(new Date('2026-07-26T14:00:00'), 'DAILY_DIGEST');
    expect(at.getHours()).toBe(6);
    expect(at.getDate()).toBe(27);
  });

  it('schedules the hourly digest for the next hour', () => {
    const at = nextDigestAt(new Date('2026-07-26T14:20:00'), 'HOURLY_DIGEST');
    expect(at.getHours()).toBe(15);
    expect(at.getMinutes()).toBe(0);
  });
});
