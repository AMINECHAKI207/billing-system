import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type LanguageSwitcherProps = {
  className?: string;
};

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();

  const changeLanguage = async (language: 'fr' | 'en' | 'ar') => {
    await i18n.changeLanguage(language);
    localStorage.setItem('language', language);

    const isArabic = language === 'ar';

    document.documentElement.lang = language;
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
  };

  return (
    <select
      value={i18n.language}
      onChange={(event) =>
        changeLanguage(event.target.value as 'fr' | 'en' | 'ar')
      }
      aria-label={t('language.label')}
      className={cn(
        'rounded-md border px-3 py-2 bg-background text-foreground',
        className
      )}
    >
      <option value="fr">{t('language.french')}</option>
      <option value="en">{t('language.english')}</option>
      <option value="ar">{t('language.arabic')}</option>
    </select>
  );
}
