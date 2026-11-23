import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { UI_LANGUAGES } from '@jobhunter/shared';
import en from './locales/en.json';
import de from './locales/de.json';
import pt from './locales/pt.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

export const resources = { en: { t: en }, de: { t: de }, pt: { t: pt }, es: { t: es }, fr: { t: fr } } as const;

function storedLanguage(): string | null {
  try {
    return localStorage.getItem('jh_lang');
  } catch {
    return null;
  }
}

const browser = typeof navigator === 'undefined' ? 'en' : navigator.language.slice(0, 2);
const initial =
  [storedLanguage(), browser].find((l): l is string => !!l && (UI_LANGUAGES as readonly string[]).includes(l)) ?? 'en';

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: 'en',
  defaultNS: 't',
  interpolation: { escapeValue: false },
});

export function setUiLanguage(lang: string): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem('jh_lang', lang);
  } catch {
    /* storage unavailable */
  }
}

export default i18n;
