import { Globe2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type SupportedLanguage = 'en' | 'fr' | 'ar';

type LanguageSwitcherProps = {
  className?: string;
  dropdownClassName?: string;
  compact?: boolean;
};

const languages: Array<{
  code: SupportedLanguage;
  labelKey: string;
  shortLabel: string;
}> = [
  { code: 'en', labelKey: 'language.nativeEnglish', shortLabel: 'EN' },
  { code: 'fr', labelKey: 'language.nativeFrench', shortLabel: 'FR' },
  { code: 'ar', labelKey: 'language.nativeArabic', shortLabel: 'AR' },
];

function normalizeLanguage(language: string | undefined): SupportedLanguage {
  if (language?.startsWith('ar')) return 'ar';
  if (language?.startsWith('en')) return 'en';
  return 'fr';
}

export function LanguageSwitcher({ className, dropdownClassName, compact = false }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  const currentOption = languages.find((language) => language.code === currentLanguage) ?? languages[0];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const changeLanguage = async (language: SupportedLanguage) => {
    await i18n.changeLanguage(language);
    localStorage.setItem('language', language);

    const isArabic = language === 'ar';
    document.documentElement.lang = language;
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const openAndFocusCurrent = () => {
    setIsOpen(true);
    window.requestAnimationFrame(() => {
      focusOption(Math.max(0, languages.findIndex((language) => language.code === currentLanguage)));
    });
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openAndFocusCurrent();
    }
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption((index + 1) % languages.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption((index - 1 + languages.length) % languages.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(languages.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={buttonRef}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={t('language.label')}
        className={cn(
          'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30',
          compact ? 'w-auto min-w-16' : 'w-full',
          className
        )}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <Globe2 className="h-4 w-4 text-muted-foreground" />
        <span>{currentOption.shortLabel}</span>
      </button>

      <div
        className={cn(
          'absolute top-[calc(100%+0.5rem)] z-[80] w-44 rounded-xl border border-border bg-card p-1.5 text-sm text-card-foreground opacity-0 shadow-xl transition duration-150 pointer-events-none translate-y-1 scale-95 dark:bg-popover dark:text-popover-foreground',
          currentLanguage === 'ar' ? 'left-0 origin-top-left' : 'right-0 origin-top-right',
          isOpen && 'pointer-events-auto translate-y-0 scale-100 opacity-100',
          dropdownClassName
        )}
        role="listbox"
        aria-label={t('language.label')}
      >
        {languages.map((language, index) => {
          const isSelected = language.code === currentLanguage;

          return (
            <button
              aria-selected={isSelected}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 font-medium transition hover:bg-muted focus:bg-muted focus:outline-none',
                currentLanguage === 'ar' ? 'text-right' : 'text-left',
                isSelected ? 'bg-primary/10 text-primary' : 'text-card-foreground dark:text-popover-foreground'
              )}
              key={language.code}
              onClick={() => changeLanguage(language.code)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              role="option"
              type="button"
            >
              <span>{t(language.labelKey)}</span>
              <span className="text-xs font-semibold text-muted-foreground">{language.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
