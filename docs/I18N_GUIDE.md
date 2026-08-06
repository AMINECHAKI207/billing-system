# Internationalization Guide

This frontend uses `react-i18next` with three synchronized locale files:

- `client/src/i18n/locales/en.json`
- `client/src/i18n/locales/fr.json`
- `client/src/i18n/locales/ar.json`

## Adding Text

Always add a translation key to all three locale files before rendering new user-facing text.

Correct:

```tsx
const { t } = useTranslation();

<button>{t('expenses.actions.submit')}</button>
```

Incorrect:

```tsx
<button>Submit</button>
```

Run:

```bash
npm run i18n:check
npm run i18n:scan
```

## Enum And Status Labels

Never render raw enum values such as `PAID`, `REJECTED`, `SUBMITTED`, or `PROCESSING`.

Use centralized helpers from `client/src/i18n/localized.ts`:

```tsx
translateExpenseStatus(t, expense.status)
translateStatus(t, 'creditNote', creditNote.status)
```

Add new enum labels to the matching locale namespace in all locales.

## Dates, Numbers, And Currency

Use localized helpers:

```tsx
formatLocalizedDate(invoice.issueDate, i18n.language)
formatLocalizedNumber(total, i18n.language)
formatLocalizedCurrency(total, invoice.currency, i18n.language)
```

## RTL

Arabic automatically sets:

```html
<html lang="ar" dir="rtl">
```

English and French use `dir="ltr"`. New components should inherit direction and prefer logical CSS where possible:

- `text-align: start/end`
- `margin-inline-*`
- `padding-inline-*`
- `border-inline-*`

Reusable logical utility classes exist in `client/src/index.css`.

## Validation, Toasts, Dialogs

Validation messages, toast text, dialog labels, empty states, loading states, placeholders, tooltips, and button text must use translation keys.

## Commands

```bash
npm run i18n:check
npm run i18n:scan
npm run i18n:test
npm run verify
```

`i18n:test` also verifies that intentionally broken temporary fixtures are detected.

## Adding A New Page

Use `client/src/templates/LocalizedPageTemplate.tsx` as the pattern:

- call `useTranslation()`
- use translation keys for all visible text
- use localized status/date/currency helpers
- avoid raw enum labels
- inherit document direction instead of manually forcing left/right
