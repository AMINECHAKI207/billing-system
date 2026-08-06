import { useTranslation } from 'react-i18next';
import {
  formatLocalizedCurrency,
  formatLocalizedDate,
  translateExpenseStatus,
} from '@/i18n/localized';

type LocalizedPageTemplateProps = {
  status: string;
  amount: number;
  currency: string;
  date: string;
};

export function LocalizedPageTemplate({ status, amount, currency, date }: LocalizedPageTemplateProps) {
  const { t, i18n } = useTranslation();

  return (
    <section className="space-y-4 text-start">
      <header>
        <h1 className="text-xl font-semibold text-foreground">{t('templates.localizedPage.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('templates.localizedPage.description')}</p>
      </header>

      <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('templates.localizedPage.status')}</dt>
          <dd className="text-sm font-semibold">{translateExpenseStatus(t, status)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('templates.localizedPage.amount')}</dt>
          <dd className="text-sm font-semibold">{formatLocalizedCurrency(amount, currency, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('templates.localizedPage.date')}</dt>
          <dd className="text-sm font-semibold">{formatLocalizedDate(date, i18n.language)}</dd>
        </div>
      </dl>
    </section>
  );
}
