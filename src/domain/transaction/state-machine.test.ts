import { describe, expect, it } from 'vitest';

import {
  STATE_TIMEOUTS,
  type TransactionState,
  type TransitionContext,
  assertTransition,
  canTransition,
  deadlineFor,
  holdsFunds,
  stateAfterEscrowFunded,
  timeoutActionFor,
} from './state-machine';

const CLEAR: TransitionContext = {
  zoneRestricted: false,
  permitRequired: false,
  permitApproved: false,
  escrowConfirmed: true,
  actorRole: 'SYSTEM',
};

describe('happy path', () => {
  it('walks a same-zone sale from offer to closed', () => {
    const path: TransactionState[] = [
      'OFFER_MADE',
      'OFFER_ACCEPTED',
      'ESCROW_PENDING',
      'ESCROW_FUNDED',
      'READY_FOR_COLLECTION',
      'DELIVERED',
      'INSPECTION_WINDOW',
      'SETTLED',
      'CLOSED',
    ];

    for (let i = 0; i < path.length - 1; i++) {
      const verdict = canTransition(path[i]!, path[i + 1]!, CLEAR);
      expect(verdict.allowed, `${path[i]} → ${path[i + 1]}: ${verdict.reason}`).toBe(true);
    }
  });

  it('routes a cross-zone sale through the permit state', () => {
    expect(stateAfterEscrowFunded({ permitRequired: true })).toBe('PERMIT_PENDING');
    expect(stateAfterEscrowFunded({ permitRequired: false })).toBe('READY_FOR_COLLECTION');
  });
});

describe('zone restrictions are a hard block', () => {
  const restricted = { ...CLEAR, zoneRestricted: true };

  it('refuses to advance to collection while a restriction is active', () => {
    const verdict = canTransition('ESCROW_FUNDED', 'READY_FOR_COLLECTION', restricted);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/disease-control restriction/);
  });

  it('refuses to advance to transit as well', () => {
    expect(canTransition('READY_FOR_COLLECTION', 'IN_TRANSIT', restricted).allowed).toBe(false);
  });

  it('still allows cancellation and refund while restricted', () => {
    // A restriction must not trap a buyer's money. Unwinding stays available.
    expect(canTransition('ESCROW_FUNDED', 'CANCELLED', restricted).allowed).toBe(true);
  });

  it('blocks even when a permit was already approved', () => {
    const verdict = canTransition('PERMIT_PENDING', 'READY_FOR_COLLECTION', {
      ...restricted,
      permitApproved: true,
    });
    expect(verdict.allowed).toBe(false);
  });
});

describe('permit gating', () => {
  it('will not skip the permit state when one is required', () => {
    const verdict = canTransition('ESCROW_FUNDED', 'READY_FOR_COLLECTION', {
      ...CLEAR,
      permitRequired: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/movement permit/);
  });

  it('will not release for collection on an unapproved permit', () => {
    const verdict = canTransition('PERMIT_PENDING', 'READY_FOR_COLLECTION', {
      ...CLEAR,
      permitRequired: true,
      permitApproved: false,
    });
    expect(verdict.allowed).toBe(false);
  });

  it('releases once the permit is approved', () => {
    const verdict = canTransition('PERMIT_PENDING', 'READY_FOR_COLLECTION', {
      ...CLEAR,
      permitRequired: true,
      permitApproved: true,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe('escrow confirmation', () => {
  it('refuses to mark escrow funded on an unconfirmed payment', () => {
    const verdict = canTransition('ESCROW_PENDING', 'ESCROW_FUNDED', {
      ...CLEAR,
      escrowConfirmed: false,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/not confirmation/);
  });
});

describe('authority', () => {
  it('does not let a seller settle their own sale', () => {
    const verdict = canTransition('INSPECTION_WINDOW', 'SETTLED', {
      ...CLEAR,
      actorRole: 'SELLER',
    });
    expect(verdict.allowed).toBe(false);
  });

  it('lets the buyer settle', () => {
    expect(
      canTransition('INSPECTION_WINDOW', 'SETTLED', { ...CLEAR, actorRole: 'BUYER' }).allowed,
    ).toBe(true);
  });

  it('lets the timeout settle', () => {
    expect(
      canTransition('INSPECTION_WINDOW', 'SETTLED', { ...CLEAR, actorRole: 'SYSTEM' }).allowed,
    ).toBe(true);
  });
});

describe('illegal transitions', () => {
  it('rejects skipping escrow entirely', () => {
    expect(canTransition('OFFER_MADE', 'SETTLED', CLEAR).allowed).toBe(false);
  });

  it('rejects moving on from a terminal state', () => {
    const verdict = canTransition('CLOSED', 'OFFER_MADE', CLEAR);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/terminal/);
  });

  it('throws from the asserting wrapper', () => {
    expect(() => assertTransition('OFFER_MADE', 'SETTLED', CLEAR)).toThrow(/Illegal transition/);
  });
});

describe('timeouts', () => {
  it('gives every waiting state a deadline and an action', () => {
    const waiting: TransactionState[] = [
      'OFFER_MADE',
      'ESCROW_PENDING',
      'PERMIT_PENDING',
      'READY_FOR_COLLECTION',
      'INSPECTION_WINDOW',
    ];
    for (const state of waiting) {
      expect(STATE_TIMEOUTS[state], `${state} has no timeout`).toBeDefined();
      expect(timeoutActionFor(state)).not.toBeNull();
    }
  });

  it('auto-settles the inspection window rather than auto-refunding', () => {
    // Silence favours the seller who has already performed. The alternative
    // lets a buyer strand a seller's money by doing nothing at all.
    expect(timeoutActionFor('INSPECTION_WINDOW')).toBe('AUTO_SETTLE');
  });

  it('computes deadlines from the state entry time', () => {
    const entered = new Date('2026-07-26T08:00:00Z');
    expect(deadlineFor('OFFER_MADE', entered)?.toISOString()).toBe('2026-07-28T08:00:00.000Z');
    expect(deadlineFor('INSPECTION_WINDOW', entered)?.toISOString()).toBe(
      '2026-07-27T08:00:00.000Z',
    );
  });

  it('has no deadline for settled states', () => {
    expect(deadlineFor('SETTLED', new Date())).toBeNull();
    expect(deadlineFor('CLOSED', new Date())).toBeNull();
  });
});

describe('funds at risk', () => {
  it('knows which states are holding somebody money', () => {
    expect(holdsFunds('ESCROW_FUNDED')).toBe(true);
    expect(holdsFunds('DISPUTED')).toBe(true);
    expect(holdsFunds('OFFER_MADE')).toBe(false);
    expect(holdsFunds('CLOSED')).toBe(false);
  });
});
