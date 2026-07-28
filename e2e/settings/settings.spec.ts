import { test, expect } from '../helpers/test';
import { loginViaUi } from '../helpers/auth';

test.beforeEach(async ({ page }) => {
  await loginViaUi(page);
});

test('settings load, update and persist company information', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('main')).toBeVisible();

  const api = page.context().request;
  const suffix = Date.now();
  const update = await api.put('/api/settings/company', {
    data: {
      name: `E2E Billing System ${suffix}`,
      address: 'E2E Avenue',
      phone: '+212 600 000 000',
      email: 'billing-e2e@example.test',
      taxNumber: 'IF: E2E0001',
      defaultCurrency: 'MAD',
      defaultTaxRate: 20,
      vatEnabled: true,
      moroccoVatRate: 20,
      paymentTerms: 'E2E terms',
      bankDetails: 'E2E bank',
    },
  });
  expect(update.ok()).toBeTruthy();
  const settings = await (await api.get('/api/settings/company')).json();
  expect(settings.data.settings.name).toBe(`E2E Billing System ${suffix}`);
});
