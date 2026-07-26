/**
 * Phone-first OTP authentication.
 *
 * Signup and signin are the same flow. There is no "register" step to leak
 * whether a number is already known, and no password to forget — which matters
 * for a user base that shares devices and may not have an email address.
 *
 * Secrets stored here are hashed, never in the clear:
 *   - the OTP code, so a database read cannot be replayed into a login
 *   - the session token, for the same reason
 *
 * Comparisons are constant-time. A timing oracle on a 6-digit code is a real
 * attack, not a theoretical one.
 */

import type { PrismaClient } from '@prisma/client';

import {
  MAX_VERIFY_ATTEMPTS,
  type PhoneValidation,
  canRequestCode,
  challengeState,
  codeExpiryFrom,
  generateCode,
  isWellFormedCode,
  maskPhone,
  normalisePhone,
  sessionExpiryFrom,
} from '../domain/auth/otp';
import { SmsError, resolveSender } from './sms/africas-talking';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SmsSender {
  send(args: { to: string; message: string }): Promise<void>;
}

/**
 * Development sender. Logs the masked number and the code to the server only.
 *
 * Kept here for tests; production selection goes through
 * `resolveSender()` in ./sms/africas-talking, which refuses this fallback.
 */
export const consoleSmsSender: SmsSender = {
  async send({ to, message }) {
    console.info(`[sms] ${maskPhone(to)}: ${message}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────────────────────

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time hex comparison.
 *
 * Both operands are fixed-length digests, so an early length return leaks
 * nothing. The loop deliberately does not break on a mismatch.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * The OTP hash is salted with a server-side pepper.
 *
 * Without it, a leaked database yields a rainbow table of one million entries —
 * which is to say, no protection at all for a 6-digit code.
 */
function pepper(): string {
  const value = process.env.OTP_PEPPER;
  if (!value || value.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new AuthError(
        'OTP_PEPPER must be set to at least 16 characters in production',
        'MISCONFIGURED',
      );
    }
    return 'development-pepper-not-for-production';
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Requesting a code
// ─────────────────────────────────────────────────────────────────────────────

export interface RequestCodeResult {
  /** Always present, so the caller cannot infer whether the phone is known. */
  challengeId: string;
  maskedPhone: string;
  expiresAt: Date;
}

export async function requestCode(
  db: PrismaClient,
  args: { phone: string; ip?: string; sender?: SmsSender },
): Promise<RequestCodeResult> {
  const validation: PhoneValidation = normalisePhone(args.phone);
  if (!validation.valid) {
    throw new AuthError(
      validation.reason === 'NOT_BOTSWANA'
        ? 'That is not a Botswana mobile number'
        : 'That does not look like a phone number',
      `PHONE_${validation.reason}`,
    );
  }
  const phone = validation.e164;

  const windowStart = new Date(Date.now() - 60 * 60_000);
  const recent = await db.otpChallenge.findMany({
    where: { phone, createdAt: { gte: windowStart } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const verdict = canRequestCode(recent.map((r) => r.createdAt));
  if (!verdict.allowed) {
    throw new AuthError(
      'Too many codes requested. Please wait before trying again.',
      'RATE_LIMITED',
      verdict.retryAfterSeconds,
    );
  }

  // Invalidate any outstanding challenge for this number. Two live codes means
  // two chances to brute force, and a user who requested a second code is not
  // going to use the first.
  await db.otpChallenge.updateMany({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  const code = generateCode();
  const expiresAt = codeExpiryFrom();

  const challenge = await db.otpChallenge.create({
    data: {
      phone,
      codeHash: await sha256Hex(`${pepper()}:${phone}:${code}`),
      expiresAt,
      requestedIp: args.ip ?? null,
    },
    select: { id: true },
  });

  const sender = args.sender ?? resolveSender();
  const delivery = await db.smsDelivery.create({
    data: { phone, kind: 'OTP', provider: sender.constructor?.name ?? 'unknown' },
    select: { id: true },
  });

  try {
    // Setswana first — it is the default language, and the first line is what
    // shows in a lock-screen notification.
    await sender.send({
      to: phone,
      message: `Kraal: ${code}. E fela mo metsotsong e 5. / Expires in 5 minutes.`,
    });
    await db.smsDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SENT', sentAt: new Date(), attempts: 1 },
    });
  } catch (error) {
    const smsError = error instanceof SmsError ? error : null;
    await db.smsDelivery.update({
      where: { id: delivery.id },
      data: {
        status: smsError?.kind === 'PERMANENT' ? 'REJECTED' : 'FAILED',
        attempts: 1,
        failureCode: smsError?.code ?? null,
        failureText: smsError?.message ?? 'Unknown SMS failure',
      },
    });

    // The challenge is consumed rather than left live: a code nobody received
    // is only useful to someone guessing at it.
    await db.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    throw new AuthError(
      'We could not send the code. Please check the number and try again.',
      'SMS_FAILED',
    );
  }

  return { challengeId: challenge.id, maskedPhone: maskPhone(phone), expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifying and signing in
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifyResult {
  userId: string;
  /** Raw token — returned once, never stored. Set it as an httpOnly cookie. */
  token: string;
  expiresAt: Date;
  /** True when this verification created the account. */
  isNewUser: boolean;
}

export async function verifyCode(
  db: PrismaClient,
  args: { challengeId: string; code: string; userAgent?: string; ip?: string },
): Promise<VerifyResult> {
  if (!isWellFormedCode(args.code)) {
    throw new AuthError('That code is not valid', 'BAD_CODE');
  }

  const challenge = await db.otpChallenge.findUnique({
    where: { id: args.challengeId },
    select: { id: true, phone: true, codeHash: true, attempts: true, expiresAt: true, consumedAt: true },
  });

  if (!challenge) throw new AuthError('That code is not valid', 'BAD_CODE');

  const state = challengeState(challenge);
  if (!state.usable) {
    throw new AuthError(
      state.reason === 'EXPIRED'
        ? 'That code has expired. Request a new one.'
        : 'That code is no longer valid. Request a new one.',
      state.reason,
    );
  }

  // Count the attempt BEFORE comparing. If the process dies mid-verify, the
  // attempt must still be spent — otherwise the cap is bypassable by killing
  // the request, which is entirely within an attacker's control.
  const { attempts } = await db.otpChallenge.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });

  const expected = await sha256Hex(`${pepper()}:${challenge.phone}:${args.code.trim()}`);

  if (!timingSafeEqual(expected, challenge.codeHash)) {
    const remaining = MAX_VERIFY_ATTEMPTS - attempts;
    throw new AuthError(
      remaining > 0
        ? `That code is not correct. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
        : 'Too many wrong attempts. Request a new code.',
      'WRONG_CODE',
    );
  }

  // Correct. Burn the challenge so the code cannot be replayed.
  await db.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const existing = await db.user.findUnique({
    where: { phone: challenge.phone },
    select: { id: true, suspendedAt: true },
  });

  if (existing?.suspendedAt) {
    throw new AuthError('This account is suspended', 'ACCOUNT_SUSPENDED');
  }

  const user =
    existing ??
    (await db.user.create({
      data: { phone: challenge.phone, phoneVerifiedAt: new Date(), tier: 'T0_UNVERIFIED' },
      select: { id: true, suspendedAt: true },
    }));

  if (existing) {
    await db.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date() },
    });
  }

  const token = createToken();
  const expiresAt = sessionExpiryFrom();

  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: await sha256Hex(token),
      userAgent: args.userAgent ?? null,
      ipAddress: args.ip ?? null,
      expiresAt,
    },
  });

  return { userId: user.id, token, expiresAt, isNewUser: existing === null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionUser {
  userId: string;
  phone: string;
  tier:
    | 'T0_UNVERIFIED'
    | 'T1_IDENTIFIED'
    | 'T2_VERIFIED_FARMER'
    | 'T3_TRUSTED_TRADER'
    | 'TB_VERIFIED_BUTCHER'
    | 'TT_VERIFIED_TRANSPORTER';
  locale: 'TN' | 'EN';
}

/**
 * Resolve a bearer token to a user, or null.
 *
 * Returns null for every failure mode rather than distinguishing them. A caller
 * has no legitimate use for knowing whether a token was expired, revoked, or
 * never existed, and an attacker does.
 */
export async function resolveSession(
  db: PrismaClient,
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: await sha256Hex(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, phone: true, tier: true, preferredLocale: true, suspendedAt: true } },
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt <= new Date()) return null;
  if (session.user.suspendedAt !== null) return null;

  // Slide the expiry, but only once a day. Writing on every request turns a
  // read path into a write path for no benefit.
  const slideThreshold = new Date(sessionExpiryFrom().getTime() - 24 * 60 * 60 * 1000);
  if (session.expiresAt < slideThreshold) {
    await db.session.update({
      where: { id: session.id },
      data: { expiresAt: sessionExpiryFrom(), lastSeenAt: new Date() },
    });
  }

  return {
    userId: session.user.id,
    phone: session.user.phone,
    tier: session.user.tier,
    locale: session.user.preferredLocale,
  };
}

export async function revokeSession(db: PrismaClient, token: string): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: await sha256Hex(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Sign out everywhere — for a lost phone, which is the common case here. */
export async function revokeAllSessions(db: PrismaClient, userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString('base64url');
}

/** Housekeeping: drop spent and expired challenges. Run daily. */
export async function pruneExpiredChallenges(db: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db.otpChallenge.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
  });
  return result.count;
}
