import { test, expect } from '../helpers/test';
import { loginViaUi } from '../helpers/auth';

test.beforeEach(async ({ page }) => {
  await loginViaUi(page);
});

test('reports page and report APIs load with date filters', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.locator('main')).toBeVisible();

  const api = page.context().request;
  const aging = await api.get('/api/reports/receivables-aging');
  expect(aging.ok()).toBeTruthy();
  const tax = await api.get('/api/reports/tax-summary?from=2026-01-01&to=2026-12-31');
  expect(tax.ok()).toBeTruthy();
});
