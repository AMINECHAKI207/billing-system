import { test, expect } from '../helpers/test';
import { loginViaUi } from '../helpers/auth';

test.beforeEach(async ({ page }) => {
  await loginViaUi(page);
});

test('payment creation updates invoice balance and rejects overpayment', async ({ page }) => {
  const api = page.context().request;
  const invoices = await (await api.get('/api/invoices')).json();
  const invoice = invoices.data.data.find((item: { balanceDue: string | number }) => Number(item.balanceDue) > 0);
  expect(invoice).toBeTruthy();

  const before = Number(invoice.balanceDue);
  const payment = await api.post(`/api/invoices/${invoice.id}/payments`, {
    data: {
      amount: 100,
      paymentDate: new Date().toISOString().slice(0, 10),
      method: 'BANK_TRANSFER',
      reference: `E2E-${Date.now()}`,
    },
  });
  expect(payment.ok()).toBeTruthy();
  const paid = await payment.json();
  expect(Number(paid.data.invoice.balanceDue)).toBe(before - 100);

  const overpay = await api.post(`/api/invoices/${invoice.id}/payments`, {
    data: {
      amount: 9999999,
      paymentDate: new Date().toISOString().slice(0, 10),
      method: 'BANK_TRANSFER',
    },
  });
  expect([400, 409]).toContain(overpay.status());
});

test('payments list loads in UI and API', async ({ page }) => {
  await page.goto('/payments');
  await expect(page.locator('main')).toBeVisible();
  const response = await page.context().request.get('/api/payments');
  expect(response.ok()).toBeTruthy();
});
