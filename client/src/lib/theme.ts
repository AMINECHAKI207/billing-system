import type { ThemePreference } from '@/types';

export const THEME_STORAGE_KEY = 'themePreference';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

export function getStoredTheme(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getInitialTheme(): ThemePreference {
  return getStoredTheme() ?? 'light';
}

/** Apply the persisted theme before React renders to avoid a light-mode flash. */
export function initializeTheme(): ThemePreference {
  const theme = getInitialTheme();
  applyTheme(theme);
  return theme;
}

export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function persistTheme(theme: ThemePreference): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The UI must still switch when storage is unavailable (private mode/policy).
  }
}
