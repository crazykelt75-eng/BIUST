import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import { LocaleProvider } from '../i18n/client';
import { resolveLocale, t } from '../i18n/messages';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kraal',
  description: 'Buy and sell livestock, farmer to farmer',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Do not lock zoom. Users with low vision need to pinch, and locking it is a
  // common accessibility failure in "app-like" web builds.
  maximumScale: 5,
  themeColor: '#4a7c3f',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));

  return (
    <html lang={locale === 'TN' ? 'tn' : 'en'}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-veld-600 focus:px-4 focus:py-2 focus:text-white"
          >
            {t(locale, 'action.continue')}
          </a>
          <main id="main">{children}</main>
        </LocaleProvider>
      </body>
    </html>
  );
}
