/**
 * Auth against a real database.
 *
 * The properties worth proving here are security properties, so the tests are
 * mostly adversarial: replay, brute force, enumeration, and revocation.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../db/client';
import { MAX_VERIFY_ATTEMPTS } from '../domain/auth/otp';
import {
  AuthError,
  type SmsSender,
  requestCode,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  verifyCode,
} from './auth-service';

const PHONE = '71234567';
const E164 = '+26771234567';

/** Captures the code so tests can use it, the way an SMS gateway would. */
function captureSender(): SmsSender & { lastCode: () => string } {
  let last = '';
  return {
    async send({ message }) {
      last = message.match(/\b(\d{6})\b/)?.[1] ?? '';
    },
    lastCode: () => last,
  };
}

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sessions, otp_challenges, users RESTART IDENTITY CASCADE',
  );
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('requesting a code', () => {
  it('creates a challenge and sends the code by SMS', async () => {
    const sender = captureSender();
    const result = await requestCode(prisma, { phone: PHONE, sender });

    expect(result.challengeId).toBeTruthy();
    expect(result.maskedPhone).toBe('+267712***67');
    expect(sender.lastCode()).toMatch(/^\d{6}$/);
  });

  it('never stores the code in the clear', async () => {
    const sender = captureSender();
    await requestCode(prisma, { phone: PHONE, sender });

    const challenge = await prisma.otpChallenge.findFirstOrThrow();
    expect(challenge.codeHash).not.toBe(sender.lastCode());
    expect(challenge.codeHash).toHaveLength(64);
    // A database read must not be replayable into a login.
    expect(JSON.stringify(challenge)).not.toContain(sender.lastCode());
  });

  it('invalidates an outstanding challenge when a new code is requested', async () => {
    const sender = captureSender();
    const first = await requestCode(prisma, { phone: PHONE, sender });
    const firstCode = sender.lastCode();

    await requestCode(prisma, { phone: PHONE, sender });

    // Two live codes would double the brute-force surface.
    await expect(
      verifyCode(prisma, { challengeId: first.challengeId, code: firstCode }),
    ).rejects.toThrow(/no longer valid/);
  });

  it('rate limits repeated requests', async () => {
    const sender = captureSender();
    await requestCode(prisma, { phone: PHONE, sender });
    await requestCode(prisma, { phone: PHONE, sender });
    await requestCode(prisma, { phone: PHONE, sender });

    await expect(requestCode(prisma, { phone: PHONE, sender })).rejects.toThrow(/Too many codes/);
  });

  it('rejects a landline before spending an SMS on it', async () => {
    const sender = captureSender();
    const spy = vi.spyOn(sender, 'send');
    await expect(requestCode(prisma, { phone: '3971234', sender })).rejects.toThrow(AuthError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not reveal whether the phone is already registered', async () => {
    const sender = captureSender();
    const unknown = await requestCode(prisma, { phone: PHONE, sender });

    await prisma.user.create({ data: { phone: '+26771111111' } });
    const known = await requestCode(prisma, { phone: '71111111', sender });

    // Same shape, same fields. Nothing to distinguish the two.
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
  });
});

describe('verifying a code', () => {
  async function issue() {
    const sender = captureSender();
    const { challengeId } = await requestCode(prisma, { phone: PHONE, sender });
    return { challengeId, code: sender.lastCode() };
  }

  it('creates the account and a session on first correct code', async () => {
    const { challengeId, code } = await issue();
    const result = await verifyCode(prisma, { challengeId, code });

    expect(result.isNewUser).toBe(true);
    expect(result.token).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { phone: E164 } });
    expect(user.phoneVerifiedAt).not.toBeNull();
    expect(user.tier).toBe('T0_UNVERIFIED');
  });

  it('signs an existing user in rather than creating a duplicate', async () => {
    const first = await issue();
    await verifyCode(prisma, { challengeId: first.challengeId, code: first.code });

    const second = await issue();
    const result = await verifyCode(prisma, {
      challengeId: second.challengeId,
      code: second.code,
    });

    expect(result.isNewUser).toBe(false);
    expect(await prisma.user.count()).toBe(1);
  });

  it('never stores the session token in the clear', async () => {
    const { challengeId, code } = await issue();
    const result = await verifyCode(prisma, { challengeId, code });

    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(result.token);
    expect(JSON.stringify(session)).not.toContain(result.token);
  });

  it('burns the challenge so a correct code cannot be replayed', async () => {
    const { challengeId, code } = await issue();
    await verifyCode(prisma, { challengeId, code });

    await expect(verifyCode(prisma, { challengeId, code })).rejects.toThrow(/no longer valid/);
    expect(await prisma.session.count()).toBe(1);
  });

  it('spends an attempt on every wrong guess and dies at the cap', async () => {
    const { challengeId, code } = await issue();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await expect(verifyCode(prisma, { challengeId, code: wrong })).rejects.toThrow();
    }

    // Even the CORRECT code is refused now. The challenge is dead, not the guess.
    await expect(verifyCode(prisma, { challengeId, code })).rejects.toThrow(
      /no longer valid/,
    );
    expect(await prisma.session.count()).toBe(0);
  });

  it('counts the attempt before comparing, so killing the request does not bypass the cap', async () => {
    const { challengeId } = await issue();
    await expect(verifyCode(prisma, { challengeId, code: '000000' })).rejects.toThrow();

    const challenge = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(challenge.attempts).toBe(1);
  });

  it('rejects an expired code', async () => {
    const { challengeId, code } = await issue();
    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(verifyCode(prisma, { challengeId, code })).rejects.toThrow(/expired/);
  });

  it('rejects a malformed code without touching the database', async () => {
    await expect(
      verifyCode(prisma, { challengeId: 'whatever', code: 'abc' }),
    ).rejects.toThrow(/not valid/);
  });

  it('refuses a suspended account', async () => {
    const first = await issue();
    await verifyCode(prisma, { challengeId: first.challengeId, code: first.code });
    await prisma.user.updateMany({ data: { suspendedAt: new Date() } });

    const second = await issue();
    await expect(
      verifyCode(prisma, { challengeId: second.challengeId, code: second.code }),
    ).rejects.toThrow(/suspended/);
  });
});

describe('sessions', () => {
  async function signIn() {
    const sender = captureSender();
    const { challengeId } = await requestCode(prisma, { phone: PHONE, sender });
    return verifyCode(prisma, { challengeId, code: sender.lastCode() });
  }

  it('resolves a valid token to the user', async () => {
    const { token, userId } = await signIn();
    const session = await resolveSession(prisma, token);

    expect(session?.userId).toBe(userId);
    expect(session?.phone).toBe(E164);
    expect(session?.tier).toBe('T0_UNVERIFIED');
  });

  it('returns null for anything invalid, without saying why', async () => {
    await signIn();
    expect(await resolveSession(prisma, 'not-a-real-token')).toBeNull();
    expect(await resolveSession(prisma, '')).toBeNull();
    expect(await resolveSession(prisma, undefined)).toBeNull();
  });

  it('rejects a revoked session', async () => {
    const { token } = await signIn();
    await revokeSession(prisma, token);
    expect(await resolveSession(prisma, token)).toBeNull();
  });

  it('rejects an expired session', async () => {
    const { token } = await signIn();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect(await resolveSession(prisma, token)).toBeNull();
  });

  it('rejects sessions for a suspended user', async () => {
    const { token, userId } = await signIn();
    await prisma.user.update({ where: { id: userId }, data: { suspendedAt: new Date() } });
    expect(await resolveSession(prisma, token)).toBeNull();
  });

  it('signs out everywhere — the lost-phone case', async () => {
    const first = await signIn();
    const second = await signIn();

    const revoked = await revokeAllSessions(prisma, first.userId);
    expect(revoked).toBe(2);
    expect(await resolveSession(prisma, first.token)).toBeNull();
    expect(await resolveSession(prisma, second.token)).toBeNull();
  });
});
