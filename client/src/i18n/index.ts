import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: localStorage.getItem('language') || 'fr',
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false,
  },
});

const applyDocumentLanguage = (language: string) => {
  const normalizedLanguage = language.split('-')[0];
  const isArabic = normalizedLanguage === 'ar';

  document.documentElement.lang = normalizedLanguage;
  document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
};

applyDocumentLanguage(i18n.language);

i18n.on('languageChanged', applyDocumentLanguage);

export default i18n;