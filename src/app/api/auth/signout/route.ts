import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { prisma } from '../../../../db/client';
import { SESSION_COOKIE } from '../../../../lib/session';
import { revokeSession } from '../../../../services/auth-service';

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  // Revoke server-side as well as clearing the cookie. Clearing alone leaves a
  // live token in whatever captured it.
  if (token) await revokeSession(prisma, token);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
