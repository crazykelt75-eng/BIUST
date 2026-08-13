'use client';

/**
 * Client-side locale context.
 *
 * The whole catalogue is small enough to ship in one chunk, so there is no
 * lazy-loading dance here. On a 2G connection a second round trip to fetch
 * translations costs far more than the few kilobytes it saves.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { DEFAULT_LOCALE, type Locale, type MessageKey, t } from './messages';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = 'kraal.locale';

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next === 'TN' ? 'tn' : 'en';
    } catch {
      // Private browsing or storage disabled — the choice just will not persist.
    }
  }, []);

  const translate = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => t(locale, key, params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t: translate }),
    [locale, setLocale, translate],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used inside a LocaleProvider');
  }
  return context;
}

/** Read a previously chosen locale, for hydration. */
export function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'TN' || value === 'EN' ? value : null;
  } catch {
    return null;
  }
}
