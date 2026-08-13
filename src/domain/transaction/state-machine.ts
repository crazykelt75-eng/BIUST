/**
 * Transaction state machine.
 *
 * MASTER_PROMPT.md §7.2. Two rules give this module its shape:
 *
 *   - No state may sit indefinitely. Every waiting state carries a timeout and
 *     an automatic action, so a transaction can never quietly strand a farmer's
 *     animals or a buyer's money because someone stopped replying.
 *
 *   - A zone restriction is a hard block, not a warning (§3.2). While a
 *     disease-control restriction is active, a transaction cannot advance to
 *     collection. Moving cattle out of a restricted zone is illegal, and a
 *     marketplace that merely warns about it is a marketplace that facilitates
 *     it.
 */

export type TransactionState =
  | 'OFFER_MADE'
  | 'OFFER_ACCEPTED'
  | 'ESCROW_PENDING'
  | 'ESCROW_FUNDED'
  | 'PERMIT_PENDING'
  | 'READY_FOR_COLLECTION'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'INSPECTION_WINDOW'
  | 'SETTLED'
  | 'DISPUTED'
  | 'RESOLVED'
  | 'REVERSED'
  | 'CANCELLED'
  | 'CLOSED';

export type ActorRole = 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';

export interface TransitionContext {
  /** True while a disease-control restriction blocks the required movement. */
  zoneRestricted: boolean;
  /** True when the trade crosses zones and a DVS permit is needed. */
  permitRequired: boolean;
  permitApproved: boolean;
  /** True only once the deposit is BANK-CONFIRMED, never on initiation (§7.4). */
  escrowConfirmed: boolean;
  actorRole: ActorRole;
}

export interface TransitionVerdict {
  allowed: boolean;
  reason?: string;
}

const TERMINAL: ReadonlySet<TransactionState> = new Set(['CLOSED']);

/** Raw edges. Guards below narrow these further. */
const EDGES: Record<TransactionState, readonly TransactionState[]> = {
  OFFER_MADE: ['OFFER_ACCEPTED', 'CANCELLED', 'CLOSED'],
  OFFER_ACCEPTED: ['ESCROW_PENDING', 'CANCELLED'],
  ESCROW_PENDING: ['ESCROW_FUNDED', 'CANCELLED'],
  ESCROW_FUNDED: ['PERMIT_PENDING', 'READY_FOR_COLLECTION', 'CANCELLED'],
  PERMIT_PENDING: ['READY_FOR_COLLECTION', 'CANCELLED'],
  READY_FOR_COLLECTION: ['IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'DISPUTED'],
  DELIVERED: ['INSPECTION_WINDOW', 'DISPUTED'],
  INSPECTION_WINDOW: ['SETTLED', 'DISPUTED'],
  SETTLED: ['CLOSED'],
  DISPUTED: ['RESOLVED'],
  RESOLVED: ['SETTLED', 'REVERSED'],
  REVERSED: ['CLOSED'],
  CANCELLED: ['CLOSED'],
  CLOSED: [],
};

/** States from which physical movement of animals is imminent or underway. */
const MOVEMENT_STATES: ReadonlySet<TransactionState> = new Set([
  'READY_FOR_COLLECTION',
  'IN_TRANSIT',
]);

export function canTransition(
  from: TransactionState,
  to: TransactionState,
  ctx: TransitionContext,
): TransitionVerdict {
  if (TERMINAL.has(from)) {
    return { allowed: false, reason: `${from} is terminal; no further transitions are possible` };
  }

  if (!EDGES[from].includes(to)) {
    return { allowed: false, reason: `No transition from ${from} to ${to}` };
  }

  // Hard block: no movement while a disease-control restriction is active.
  if (MOVEMENT_STATES.has(to) && ctx.zoneRestricted) {
    return {
      allowed: false,
      reason:
        'Movement is blocked by an active disease-control restriction on this zone. ' +
        'The transaction cannot advance to collection until the restriction is lifted. ' +
        'This is a legal prohibition, not a platform preference.',
    };
  }

  if (to === 'ESCROW_FUNDED' && !ctx.escrowConfirmed) {
    return {
      allowed: false,
      reason:
        'Escrow cannot be marked funded until the deposit is confirmed by the bank. ' +
        'Payment initiation is not confirmation.',
    };
  }

  if (from === 'ESCROW_FUNDED' && to === 'READY_FOR_COLLECTION' && ctx.permitRequired) {
    return {
      allowed: false,
      reason: 'This trade crosses zones and requires a DVS movement permit first',
    };
  }

  if (from === 'PERMIT_PENDING' && to === 'READY_FOR_COLLECTION' && !ctx.permitApproved) {
    return { allowed: false, reason: 'Movement permit has not been approved yet' };
  }

  if (to === 'SETTLED' && from === 'INSPECTION_WINDOW' && ctx.actorRole === 'SELLER') {
    return {
      allowed: false,
      reason:
        'Only the buyer, an admin, or the inspection-window timeout may settle. ' +
        'A seller cannot settle their own sale.',
    };
  }

  return { allowed: true };
}

/** Convenience wrapper that throws — for call sites where a refusal is a bug. */
export function assertTransition(
  from: TransactionState,
  to: TransactionState,
  ctx: TransitionContext,
): void {
  const verdict = canTransition(from, to, ctx);
  if (!verdict.allowed) {
    throw new Error(`Illegal transition ${from} → ${to}: ${verdict.reason}`);
  }
}

/**
 * The state a transaction should move to next after escrow funds land — it
 * depends on whether the animals have to cross a zone boundary.
 */
export function stateAfterEscrowFunded(ctx: Pick<TransitionContext, 'permitRequired'>): TransactionState {
  return ctx.permitRequired ? 'PERMIT_PENDING' : 'READY_FOR_COLLECTION';
}

// ─── Timeouts ────────────────────────────────────────────────────────────────

export type TimeoutAction =
  | 'EXPIRE_OFFER'
  | 'CANCEL_AND_STRIKE_BUYER'
  | 'ESCALATE_TO_ADMIN'
  | 'ESCALATE_WITH_HOLDING_COSTS'
  | 'AUTO_SETTLE';

export interface StateTimeout {
  hours: number;
  action: TimeoutAction;
  /** Shown to both parties while the clock runs. */
  description: string;
}

/**
 * Per-state timeouts from §7.2.
 *
 * Note INSPECTION_WINDOW auto-settles rather than auto-refunding: silence
 * favours the seller who has already performed. The alternative lets a buyer
 * strand a seller's money by simply doing nothing.
 */
export const STATE_TIMEOUTS: Partial<Record<TransactionState, StateTimeout>> = {
  OFFER_MADE: {
    hours: 48,
    action: 'EXPIRE_OFFER',
    description: 'Offer expires if the seller does not respond within 48 hours',
  },
  ESCROW_PENDING: {
    hours: 72,
    action: 'CANCEL_AND_STRIKE_BUYER',
    description: 'Cancelled if the buyer does not fund escrow within 72 hours',
  },
  PERMIT_PENDING: {
    hours: 14 * 24,
    action: 'ESCALATE_TO_ADMIN',
    description:
      'Escalated to support after 14 days; both parties may exit without penalty if the ' +
      'permit has not come through',
  },
  READY_FOR_COLLECTION: {
    hours: 7 * 24,
    action: 'ESCALATE_WITH_HOLDING_COSTS',
    description:
      'Escalated after 7 days; the seller may charge agreed holding and feed costs for ' +
      'animals kept beyond the collection window',
  },
  INSPECTION_WINDOW: {
    hours: 24,
    action: 'AUTO_SETTLE',
    description: 'Settles automatically 24 hours after delivery unless a dispute is raised',
  },
};

export function deadlineFor(state: TransactionState, from: Date): Date | null {
  const timeout = STATE_TIMEOUTS[state];
  if (!timeout) return null;
  return new Date(from.getTime() + timeout.hours * 60 * 60 * 1000);
}

export function timeoutActionFor(state: TransactionState): TimeoutAction | null {
  return STATE_TIMEOUTS[state]?.action ?? null;
}

/** States where money is held and a stall has real financial consequence. */
export function holdsFunds(state: TransactionState): boolean {
  return (
    state === 'ESCROW_FUNDED' ||
    state === 'PERMIT_PENDING' ||
    state === 'READY_FOR_COLLECTION' ||
    state === 'IN_TRANSIT' ||
    state === 'DELIVERED' ||
    state === 'INSPECTION_WINDOW' ||
    state === 'DISPUTED' ||
    state === 'RESOLVED'
  );
}
