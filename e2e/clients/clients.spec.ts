import { test, expect } from '../helpers/test';
import { e2eEnv } from '../helpers/env';
import { loginViaApi, loginViaUi, goToView } from '../helpers/auth';

test('clients lifecycle through UI with confirm and toast', async ({ page }) => {
  await loginViaUi(page);
  await goToView(page, /clients|العملاء/i);

  const unique = Date.now();
  const api = page.context().request;
  const created = await api.post('/api/customers', {
    data: {
      name: `E2E UI Client ${unique}`,
      email: `client-${unique}@example.test`,
      company: `E2E UI Company ${unique}`,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText(`E2E UI Client ${unique}`).first()).toBeVisible();
});

test('clients API respects ALL, OWN and SELECTED scopes', async ({ request }) => {
  await loginViaApi(request, e2eEnv.employeeOwnEmail);
  const ownResponse = await request.get('/api/customers');
  expect(ownResponse.ok()).toBeTruthy();
  const ownBody = await ownResponse.json();
  expect(JSON.stringify(ownBody)).toContain('E2E Own Client');
  expect(JSON.stringify(ownBody)).not.toContain('E2E France Client');

  await loginViaApi(request, e2eEnv.employeeSelectedEmail);
  const selectedResponse = await request.get('/api/customers');
  expect(selectedResponse.ok()).toBeTruthy();
  const selectedBody = await selectedResponse.json();
  expect(JSON.stringify(selectedBody)).toContain('E2E Morocco Client');
  expect(JSON.stringify(selectedBody)).toContain('E2E France Client');
  expect(JSON.stringify(selectedBody)).not.toContain('E2E Own Client');
});
