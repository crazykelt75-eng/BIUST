import { NextResponse } from 'next/server';

import { prisma } from '../../../../db/client';
import { clientIp } from '../../../../lib/session';
import { AuthError, requestCode } from '../../../../services/auth-service';

export async function POST(request: Request) {
  let phone: string;
  try {
    const body = (await request.json()) as { phone?: string };
    phone = body.phone ?? '';
  } catch {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
  }

  try {
    const result = await requestCode(prisma, { phone, ip: await clientIp() });
    // The response shape is identical whether or not this phone is registered.
    return NextResponse.json({
      challengeId: result.challengeId,
      maskedPhone: result.maskedPhone,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // A configuration failure is our problem, not the caller's, and telling
      // them about it only helps someone probing the deployment.
      if (error.code === 'MISCONFIGURED') {
        console.error('Auth misconfigured', error.message);
        return NextResponse.json({ message: 'error.generic' }, { status: 500 });
      }
      return NextResponse.json(
        { message: error.message, code: error.code },
        {
          status: error.code === 'RATE_LIMITED' ? 429 : 400,
          headers: error.retryAfterSeconds
            ? { 'Retry-After': String(error.retryAfterSeconds) }
            : undefined,
        },
      );
    }
    console.error('OTP request failed', error);
    return NextResponse.json({ message: 'error.generic' }, { status: 500 });
  }
}
