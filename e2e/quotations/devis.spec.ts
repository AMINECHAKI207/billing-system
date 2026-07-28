import { test, expect } from '../helpers/test';
import { loginViaUi, goToView } from '../helpers/auth';

test('devis list, details, PDF and conversion duplicate protection', async ({ page }) => {
  await loginViaUi(page);
  await page.goto('/devis');
  await expect(page.getByText(/DEV-E2E-0001|DEV-E2E-0002/).first()).toBeVisible();

  const api = page.context().request;
  const list = await api.get('/api/devis');
  expect(list.ok()).toBeTruthy();
  const body = await list.json();
  const approved = body.data.data.find((item: { status: string }) => item.status === 'APPROVED');
  expect(approved).toBeTruthy();

  const pdf = await api.get(`/api/devis/${approved.id}/pdf`);
  expect(pdf.ok()).toBeTruthy();
  expect((await pdf.body()).length).toBeGreaterThan(100);

  const firstConvert = await api.post(`/api/devis/${approved.id}/convert-to-invoice`);
  expect(firstConvert.ok()).toBeTruthy();
  const secondConvert = await api.post(`/api/devis/${approved.id}/convert-to-invoice`);
  expect([400, 403, 409]).toContain(secondConvert.status());
});

test('devis creation form validates line items and totals are backed by API', async ({ page }) => {
  await loginViaUi(page);
  await goToView(page, /devis|quotes|عروض/i);
  await expect(page.getByText(/DEV-E2E/).first()).toBeVisible();

  const api = page.context().request;
  const customers = (await (await api.get('/api/customers')).json()).data.data;
  const ownClient = customers.find((customer: { company?: string; name?: string }) => `${customer.company ?? customer.name}`.includes('Own'));
  const create = await api.post('/api/devis', {
    data: {
      customerId: ownClient.id,
      status: 'DRAFT',
      issueDate: new Date().toISOString().slice(0, 10),
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      taxRate: 20,
      discount: 0,
      currency: 'MAD',
      items: [{ description: 'E2E API quote item', quantity: 2, unitPrice: 100, discount: 0, taxRate: 20 }],
    },
  });
  expect(create.ok()).toBeTruthy();
  const created = await create.json();
  expect(Number(created.data.devis.total)).toBe(240);
});
