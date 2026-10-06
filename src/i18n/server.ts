import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, getDictionary, isLocale, type Dictionary, type Locale } from './index';

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get('locale')?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT(): Promise<Dictionary> {
  return getDictionary(await getLocale());
}
