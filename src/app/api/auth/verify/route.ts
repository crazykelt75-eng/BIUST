import { NextResponse } from 'next/server';

import { prisma } from '../../../../db/client';
import { SESSION_COOKIE, clientIp, sessionCookieOptions } from '../../../../lib/session';
import { AuthError, verifyCode } from '../../../../services/auth-service';

export async function POST(request: Request) {
  let challengeId: string;
  let code: string;
  try {
    const body = (await request.json()) as { challengeId?: string; code?: string };
    challengeId = body.challengeId ?? '';
    code = body.code ?? '';
  } catch {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
  }

  try {
    const result = await verifyCode(prisma, {
      challengeId,
      code,
      userAgent: request.headers.get('user-agent') ?? undefined,
      ip: await clientIp(),
    });

    // The raw token leaves the server exactly once, into an httpOnly cookie.
    // It is never in the response body, where script or a log could reach it.
    const response = NextResponse.json({ userId: result.userId, isNewUser: result.isNewUser });
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ message: error.message, code: error.code }, { status: 400 });
    }
    console.error('OTP verify failed', error);
    return NextResponse.json({ message: 'error.generic' }, { status: 500 });
  }
}
