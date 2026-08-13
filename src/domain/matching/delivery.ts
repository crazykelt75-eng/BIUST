/**
 * Delivery decisions for a matched alert: send now, roll into a digest, or drop.
 *
 * MASTER_PROMPT.md §9.2. Everything here exists to protect the user's attention,
 * because an alert channel that cries wolf gets muted, and a muted channel is
 * the same as no product. SMS additionally costs real money per message, so
 * restraint here is a line item as well as a courtesy.
 */

import type { VerificationTier } from '../verification';
import { can } from '../verification';
import { DIGEST_THRESHOLD, INSTANT_ALERT_THRESHOLD } from './score';

export type Channel = 'PUSH' | 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP' | 'USSD';
export type Urgency = 'INSTANT' | 'HOURLY_DIGEST' | 'DAILY_DIGEST';

export type DeliveryAction = 'SEND_NOW' | 'DEFER_TO_DIGEST' | 'DEFER_PAST_QUIET_HOURS' | 'SUPPRESS';

export interface DeliveryDecision {
  action: DeliveryAction;
  reason: string;
  /** When the action is a deferral. */
  deliverAt?: Date;
  /** Maps to AlertSend.status for the log. */
  logStatus: 'QUEUED' | 'SUPPRESSED_RATE_LIMIT' | 'SUPPRESSED_QUIET_HOURS' | 'SUPPRESSED_DUPLICATE';
}

export interface DeliveryContext {
  matchScore: number;
  channel: Channel;
  urgency: Urgency;
  tier: VerificationTier;
  quietHoursStart: number;
  quietHoursEnd: number;
  /** Instant alerts already sent to this user today, across all profiles. */
  instantSentToday: number;
  /** True if this user already got an alert for this listing in the last 7 days. */
  alreadyAlerted: boolean;
  /**
   * Transaction events (offer received, escrow funded, collection code) bypass
   * quiet hours and rate limits. Somebody's money or animals are moving.
   */
  timeCritical: boolean;
  now: Date;
}

export const MAX_INSTANT_ALERTS_PER_DAY = 5;

export function decideDelivery(ctx: DeliveryContext): DeliveryDecision {
  if (ctx.timeCritical) {
    return {
      action: 'SEND_NOW',
      reason: 'Time-critical transaction event — bypasses quiet hours and rate limits',
      logStatus: 'QUEUED',
    };
  }

  if (ctx.alreadyAlerted) {
    return {
      action: 'SUPPRESS',
      reason: 'Already alerted about this listing in the last 7 days',
      logStatus: 'SUPPRESSED_DUPLICATE',
    };
  }

  if (ctx.matchScore < DIGEST_THRESHOLD) {
    return {
      action: 'SUPPRESS',
      reason: `Match score ${ctx.matchScore.toFixed(2)} is below the digest threshold`,
      logStatus: 'SUPPRESSED_DUPLICATE',
    };
  }

  if (ctx.channel === 'SMS' && !can(ctx.tier, 'RECEIVE_SMS_ALERTS')) {
    return {
      action: 'DEFER_TO_DIGEST',
      reason: 'SMS alerts require identity verification; falling back to in-app',
      deliverAt: nextDigestAt(ctx.now, 'DAILY_DIGEST'),
      logStatus: 'QUEUED',
    };
  }

  if (ctx.urgency !== 'INSTANT' || ctx.matchScore < INSTANT_ALERT_THRESHOLD) {
    const reason =
      ctx.urgency !== 'INSTANT'
        ? 'Profile is set to digest delivery'
        : `Match score ${ctx.matchScore.toFixed(2)} is below the instant threshold`;
    return {
      action: 'DEFER_TO_DIGEST',
      reason,
      deliverAt: nextDigestAt(ctx.now, ctx.urgency === 'INSTANT' ? 'DAILY_DIGEST' : ctx.urgency),
      logStatus: 'QUEUED',
    };
  }

  if (ctx.instantSentToday >= MAX_INSTANT_ALERTS_PER_DAY) {
    return {
      action: 'DEFER_TO_DIGEST',
      reason: `Daily instant-alert cap of ${MAX_INSTANT_ALERTS_PER_DAY} reached; rolled into the digest`,
      deliverAt: nextDigestAt(ctx.now, 'DAILY_DIGEST'),
      logStatus: 'SUPPRESSED_RATE_LIMIT',
    };
  }

  if (inQuietHours(ctx.now, ctx.quietHoursStart, ctx.quietHoursEnd)) {
    return {
      action: 'DEFER_PAST_QUIET_HOURS',
      reason: 'Within the user\'s quiet hours',
      deliverAt: quietHoursEndAt(ctx.now, ctx.quietHoursEnd),
      logStatus: 'SUPPRESSED_QUIET_HOURS',
    };
  }

  return { action: 'SEND_NOW', reason: 'Strong match, within limits', logStatus: 'QUEUED' };
}

/** Handles windows that wrap midnight, e.g. 21:00 → 06:00. */
export function inQuietHours(now: Date, startHour: number, endHour: number): boolean {
  const hour = now.getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function quietHoursEndAt(now: Date, endHour: number): Date {
  const result = new Date(now);
  result.setMinutes(0, 0, 0);
  if (now.getHours() < endHour) {
    result.setHours(endHour);
  } else {
    result.setDate(result.getDate() + 1);
    result.setHours(endHour);
  }
  return result;
}

export function nextDigestAt(now: Date, urgency: Urgency): Date {
  const result = new Date(now);
  result.setMinutes(0, 0, 0);
  if (urgency === 'HOURLY_DIGEST') {
    result.setHours(result.getHours() + 1);
    return result;
  }
  // Daily digest lands at 06:00 — early enough to act on before the day's work.
  result.setHours(6);
  if (result <= now) result.setDate(result.getDate() + 1);
  return result;
}
