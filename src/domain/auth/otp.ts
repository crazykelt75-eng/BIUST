/**
 * One-time-code rules.
 *
 * Pure policy, no I/O, so the security decisions are readable in one place and
 * testable without a database.
 *
 * The threat model that shapes this:
 *   - **Brute force.** A 6-digit code is one in a million, which is only
 *     adequate if attempts are strictly capped. Five attempts per challenge,
 *     then the challenge dies — not the code, the whole challenge, so an
 *     attacker cannot keep guessing against a code they know is still live.
 *   - **SMS pumping.** Each send costs real money and an attacker can burn a
 *     budget by requesting codes in a loop. Requests per phone are capped and
 *     the cap is per-window, not per-session.
 *   - **User enumeration.** The response must not differ between a registered
 *     and unregistered phone. Signup and signin are the same flow, which
 *     removes the distinction entirely rather than trying to paper over it.
 *   - **Shared devices.** Sessions are short by default; anything that moves
 *     money is gated on verification tier, not on holding a session.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 5;
export const MAX_VERIFY_ATTEMPTS = 5;

/** Per phone, per window. Deliberately low — each send costs money. */
export const MAX_REQUESTS_PER_WINDOW = 3;
export const REQUEST_WINDOW_MINUTES = 15;

/** Sessions expire in 30 days, sliding on use. */
export const SESSION_TTL_DAYS = 30;

export type PhoneValidation =
  | { valid: true; e164: string }
  | { valid: false; reason: 'EMPTY' | 'FORMAT' | 'NOT_BOTSWANA' };

/**
 * Normalise a Botswana mobile number to E.164.
 *
 * Accepts the forms people actually type: `71234567`, `071234567`,
 * `+267 71 234 567`, `26771234567`. Rejecting a valid number because of a
 * space is a support ticket and a lost signup.
 *
 * Botswana mobile prefixes are 7x. Landlines (2x, 3x, 4x, 5x, 6x) cannot
 * receive SMS, so they are rejected here rather than failing silently at send
 * time and leaving the user staring at a code that will never arrive.
 */
export function normalisePhone(raw: string): PhoneValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: false, reason: 'EMPTY' };

  const digits = trimmed.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return { valid: false, reason: 'FORMAT' };

  let national: string;
  if (digits.startsWith('267')) {
    national = digits.slice(3);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  if (national.length !== 8) return { valid: false, reason: 'FORMAT' };
  if (!national.startsWith('7')) return { valid: false, reason: 'NOT_BOTSWANA' };

  return { valid: true, e164: `+267${national}` };
}

/** Mask for display and logs. Never log a full number alongside a code. */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return '***';
  return `${e164.slice(0, 7)}***${e164.slice(-2)}`;
}

/**
 * Generate a numeric code using a CSPRNG.
 *
 * `Math.random()` is predictable and has been the root cause of real account
 * takeovers. The rejection-sampling loop avoids the modulo bias that
 * `value % 1000000` would introduce — small, but free to avoid.
 */
export function generateCode(): string {
  const max = 10 ** CODE_LENGTH;
  const limit = Math.floor(0xffffffff / max) * max;

  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (value >= limit);

  return (value % max).toString().padStart(CODE_LENGTH, '0');
}

export function isWellFormedCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code.trim());
}

export type RequestVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number };

/**
 * May another code be sent to this phone?
 *
 * `recentRequests` is the timestamps of codes sent to this number inside the
 * window, newest first.
 */
export function canRequestCode(recentRequests: Date[], now = new Date()): RequestVerdict {
  const windowStart = new Date(now.getTime() - REQUEST_WINDOW_MINUTES * 60_000);
  const inWindow = recentRequests.filter((at) => at > windowStart);

  if (inWindow.length < MAX_REQUESTS_PER_WINDOW) return { allowed: true };

  const oldest = inWindow[inWindow.length - 1]!;
  const retryAt = new Date(oldest.getTime() + REQUEST_WINDOW_MINUTES * 60_000);
  return {
    allowed: false,
    reason: 'RATE_LIMITED',
    retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
  };
}

export type ChallengeState =
  | { usable: true }
  | { usable: false; reason: 'EXPIRED' | 'CONSUMED' | 'TOO_MANY_ATTEMPTS' };

export function challengeState(
  challenge: { expiresAt: Date; consumedAt: Date | null; attempts: number },
  now = new Date(),
): ChallengeState {
  if (challenge.consumedAt !== null) return { usable: false, reason: 'CONSUMED' };
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { usable: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  if (challenge.expiresAt <= now) return { usable: false, reason: 'EXPIRED' };
  return { usable: true };
}

export function codeExpiryFrom(now = new Date()): Date {
  return new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
}

export function sessionExpiryFrom(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
