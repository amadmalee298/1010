'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { getDictionary, type Dictionary, type Locale } from './index';

const I18nContext = createContext<{ locale: Locale; t: Dictionary }>({ locale: 'th', t: getDictionary('th') });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, t: getDictionary(locale) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
