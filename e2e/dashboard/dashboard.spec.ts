import { test, expect } from '../helpers/test';
import { loginViaApi } from '../helpers/auth';
import { expectApiOk } from '../helpers/api';

test.beforeEach(async ({ request }) => {
  await loginViaApi(request);
});

test('dashboard loads cards, charts and API data', async ({ page, request }) => {
  const dashboard = await expectApiOk(request, '/api/invoices/dashboard');
  expect(dashboard.data.dashboard.totalInvoices).toBeGreaterThanOrEqual(1);

  await page.goto('/dashboard');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('svg').first()).toBeVisible();
  await expect(page.getByText(/facture|invoice|فاتورة/i).first()).toBeVisible();
});
