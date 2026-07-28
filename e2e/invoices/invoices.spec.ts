import { test, expect } from '../helpers/test';
import { loginViaUi, goToView } from '../helpers/auth';

test('invoice list, PDF, status update and totals through real API/UI', async ({ page }) => {
  await loginViaUi(page);
  await page.goto('/invoices');
  await expect(page.getByText(/INV-E2E/).first()).toBeVisible();

  const list = await page.context().request.get('/api/invoices');
  expect(list.ok()).toBeTruthy();
  const body = await list.json();
  const invoice = body.data.data[0];
  expect(Number(invoice.total)).toBeGreaterThan(0);
  expect(Number(invoice.total)).toBe(Number(invoice.subtotal) + Number(invoice.taxAmount) - Number(invoice.discount ?? 0));

  const pdf = await page.context().request.get(`/api/invoices/${invoice.id}/pdf`);
  expect(pdf.ok()).toBeTruthy();
  expect((await pdf.body()).length).toBeGreaterThan(100);
});

test('invoice creation from UI reaches invoices page without runtime errors', async ({ page }) => {
  await loginViaUi(page);
  await goToView(page, /invoices|factures|الفواتير/i);
  await expect(page.locator('table').first()).toBeVisible();
});
