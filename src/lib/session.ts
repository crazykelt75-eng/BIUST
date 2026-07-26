/**
 * Session cookie handling and route guards.
 *
 * MASTER_PROMPT.md §8.1: tier gates are enforced server-side, never in the UI
 * alone. Hiding a button is not access control, and this module is where that
 * commitment is actually kept for HTTP requests.
 */

import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { prisma } from '../db/client';
import { type Capability, checkCapability } from '../domain/verification';
import { type SessionUser, resolveSession } from '../services/auth-service';

export const SESSION_COOKIE = 'kraal_session';

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Not readable by JavaScript, so an XSS bug cannot exfiltrate the session.
    secure: process.env.NODE_ENV === 'production',
    // 'lax' still sends the cookie on top-level navigation (following an SMS
    // link, say) while blocking it on cross-site POSTs.
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

/** The signed-in user, or null. Safe to call from any server component. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(prisma, store.get(SESSION_COOKIE)?.value);
}

export class UnauthorisedError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly requiredTier?: string,
  ) {
    super(message);
    this.name = 'UnauthorisedError';
  }
}

/** Require a signed-in user. Throws rather than returning null. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorisedError('Not signed in', 401);
  return user;
}

/**
 * Require a capability.
 *
 * The tier check happens here, on the server, against the user's live tier —
 * not against anything the client sent. A client that fakes a tier gets a 403.
 */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  const verdict = checkCapability(user.tier, capability);

  if (!verdict.allowed) {
    throw new UnauthorisedError(
      verdict.reason ?? 'Verification required',
      403,
      verdict.requiredTier,
    );
  }

  return user;
}

/** Translate an auth failure into a response. Never leaks internals. */
export function toErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof UnauthorisedError) {
    return NextResponse.json(
      {
        message: error.message,
        code: error.status === 401 ? 'NOT_SIGNED_IN' : 'VERIFICATION_REQUIRED',
        requiredTier: error.requiredTier,
      },
      { status: error.status },
    );
  }
  return null;
}

/** Best-effort client IP, for rate limiting and abuse investigation only. */
export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  // Left-most entry is the original client; the rest are proxies. Not
  // trustworthy for authorisation — only ever for rate limiting.
  return forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined;
}
