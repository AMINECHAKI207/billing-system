import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import { applyDocumentDirection } from './localized';

const isDevelopment = import.meta.env.DEV;

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: localStorage.getItem('language') || 'fr',
  fallbackLng: 'fr',
  saveMissing: isDevelopment,
  missingKeyHandler: (_languages, _namespace, key) => {
    if (isDevelopment) console.warn(`[i18n] Missing translation key: ${key}`);
  },
  parseMissingKeyHandler: (key) => {
    if (isDevelopment) console.warn(`[i18n] Displayed fallback translation key: ${key}`);
    return key;
  },
  interpolation: {
    escapeValue: false,
  },
});

const applyDocumentLanguage = (language: string) => {
  applyDocumentDirection(language);
  if (isDevelopment && i18n.language.startsWith('ar')) {
    const resources = JSON.stringify(ar);
    if (/\?{2,}|\uFFFD/.test(resources)) {
      console.warn('[i18n] Arabic locale appears to contain corrupted text.');
    }
  }
};

applyDocumentLanguage(i18n.language);

i18n.on('languageChanged', applyDocumentLanguage);

export default i18n;
