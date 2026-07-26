/**
 * Verification tiers and the capabilities they unlock.
 *
 * MASTER_PROMPT.md §8.1. Tiers gate capability, and the gate is enforced here
 * and in middleware — never in the UI alone. Hiding a button is not access
 * control.
 *
 * Progressive by design: nobody completes a twelve-step onboarding to browse.
 * You verify when you want to do the thing that needs verification, which is
 * also the moment you are most motivated to bother.
 */

export type VerificationTier =
  | 'T0_UNVERIFIED'
  | 'T1_IDENTIFIED'
  | 'T2_VERIFIED_FARMER'
  | 'T3_TRUSTED_TRADER'
  | 'TB_VERIFIED_BUTCHER'
  | 'TT_VERIFIED_TRANSPORTER';

export type Capability =
  | 'BROWSE_LISTINGS'
  | 'SAVE_SEARCHES'
  | 'RECEIVE_ALERTS'
  | 'RECEIVE_SMS_ALERTS'
  | 'MAKE_OFFER'
  | 'CREATE_LISTING'
  | 'POST_WANT_TO_BUY'
  | 'FORWARD_CONTRACT'
  | 'BID_TRANSPORT_JOB'
  | 'JOIN_SYNDICATE'
  | 'INITIATE_SYNDICATE'
  | 'BULK_TOOLS'
  | 'API_ACCESS';

const TIER_CAPABILITIES: Record<VerificationTier, Capability[]> = {
  T0_UNVERIFIED: ['BROWSE_LISTINGS', 'SAVE_SEARCHES', 'RECEIVE_ALERTS'],
  T1_IDENTIFIED: [
    'BROWSE_LISTINGS',
    'SAVE_SEARCHES',
    'RECEIVE_ALERTS',
    'RECEIVE_SMS_ALERTS',
    'MAKE_OFFER',
    'JOIN_SYNDICATE',
  ],
  T2_VERIFIED_FARMER: [
    'BROWSE_LISTINGS',
    'SAVE_SEARCHES',
    'RECEIVE_ALERTS',
    'RECEIVE_SMS_ALERTS',
    'MAKE_OFFER',
    'CREATE_LISTING',
    'JOIN_SYNDICATE',
    'INITIATE_SYNDICATE',
  ],
  T3_TRUSTED_TRADER: [
    'BROWSE_LISTINGS',
    'SAVE_SEARCHES',
    'RECEIVE_ALERTS',
    'RECEIVE_SMS_ALERTS',
    'MAKE_OFFER',
    'CREATE_LISTING',
    'JOIN_SYNDICATE',
    'INITIATE_SYNDICATE',
    'BULK_TOOLS',
  ],
  TB_VERIFIED_BUTCHER: [
    'BROWSE_LISTINGS',
    'SAVE_SEARCHES',
    'RECEIVE_ALERTS',
    'RECEIVE_SMS_ALERTS',
    'MAKE_OFFER',
    'POST_WANT_TO_BUY',
    'FORWARD_CONTRACT',
    'BULK_TOOLS',
    'API_ACCESS',
    'JOIN_SYNDICATE',
  ],
  TT_VERIFIED_TRANSPORTER: [
    'BROWSE_LISTINGS',
    'SAVE_SEARCHES',
    'RECEIVE_ALERTS',
    'RECEIVE_SMS_ALERTS',
    'BID_TRANSPORT_JOB',
  ],
};

/**
 * Offer ceilings in thebe. T1 is capped because an identity check alone does
 * not establish that someone can pay for forty head of cattle.
 */
const OFFER_CEILING: Partial<Record<VerificationTier, number>> = {
  T0_UNVERIFIED: 0,
  T1_IDENTIFIED: 2_000_000, // BWP 20,000
};

/** Concurrent open syndicate pledges, capped by tier to limit exposure (§6.4). */
const SYNDICATE_PLEDGE_CAP: Record<VerificationTier, number> = {
  T0_UNVERIFIED: 0,
  T1_IDENTIFIED: 1,
  T2_VERIFIED_FARMER: 3,
  T3_TRUSTED_TRADER: 10,
  TB_VERIFIED_BUTCHER: 5,
  TT_VERIFIED_TRANSPORTER: 0,
};

export function can(tier: VerificationTier, capability: Capability): boolean {
  return TIER_CAPABILITIES[tier].includes(capability);
}

export interface CapabilityVerdict {
  allowed: boolean;
  reason?: string;
  /** What the user would need to do to unlock this. Drives the upgrade prompt. */
  requiredTier?: VerificationTier;
}

export function checkCapability(
  tier: VerificationTier,
  capability: Capability,
): CapabilityVerdict {
  if (can(tier, capability)) return { allowed: true };

  const requiredTier = (Object.keys(TIER_CAPABILITIES) as VerificationTier[]).find((t) =>
    TIER_CAPABILITIES[t].includes(capability),
  );

  return {
    allowed: false,
    reason: `${capability} requires a higher verification tier`,
    ...(requiredTier ? { requiredTier } : {}),
  };
}

export function checkOfferAmount(tier: VerificationTier, amountThebe: number): CapabilityVerdict {
  const base = checkCapability(tier, 'MAKE_OFFER');
  if (!base.allowed) return base;

  const ceiling = OFFER_CEILING[tier];
  if (ceiling !== undefined && amountThebe > ceiling) {
    return {
      allowed: false,
      reason:
        `Offers above BWP ${(ceiling / 100).toLocaleString()} require farm verification. ` +
        'Verify your farm to make unlimited offers.',
      requiredTier: 'T2_VERIFIED_FARMER',
    };
  }
  return { allowed: true };
}

export function syndicatePledgeCap(tier: VerificationTier): number {
  return SYNDICATE_PLEDGE_CAP[tier];
}

/** Documents required to reach a tier, for the onboarding checklist. */
export const TIER_REQUIREMENTS: Record<VerificationTier, string[]> = {
  T0_UNVERIFIED: ['Phone number'],
  T1_IDENTIFIED: ['National ID (Omang)', 'Selfie match'],
  T2_VERIFIED_FARMER: ['National ID', 'Farm registration or lease', 'Brand mark photo'],
  T3_TRUSTED_TRADER: [
    '5 settled transactions',
    'Rating of 4.5 or above',
    'No unresolved disputes',
  ],
  TB_VERIFIED_BUTCHER: ['Business registration', 'Abattoir or butchery licence'],
  TT_VERIFIED_TRANSPORTER: [
    'Vehicle registration',
    'Driving licence',
    'Livestock transport permit',
    'Insurance certificate',
  ],
};

/** T3 is earned through behaviour, not paperwork — this is the promotion test. */
export function qualifiesForTrustedTrader(stats: {
  settledTransactions: number;
  averageRating: number;
  unresolvedDisputes: number;
}): boolean {
  return (
    stats.settledTransactions >= 5 &&
    stats.averageRating >= 4.5 &&
    stats.unresolvedDisputes === 0
  );
}
