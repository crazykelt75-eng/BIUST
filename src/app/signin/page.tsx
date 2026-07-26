import { redirect } from 'next/navigation';

import { currentUser } from '../../lib/session';
import { SignInForm } from './signin-form';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  // Already signed in — no reason to sit on a sign-in screen.
  if (await currentUser()) redirect('/');
  return <SignInForm />;
}
