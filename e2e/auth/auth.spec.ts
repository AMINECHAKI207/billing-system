import { test, expect } from '../helpers/test';
import { e2eEnv } from '../helpers/env';
import { loginViaApi, loginViaUi } from '../helpers/auth';

test('login page loads and validates fields @smoke', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('form')).toBeVisible();

  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login$/);

  await page.locator('input[type="email"]').fill('not-an-email');
  await page.locator('input[type="password"]').fill('x');
  await page.locator('form button[type="submit"]').click();
  const isValidEmailInput = await page.locator('input[type="email"]').evaluate((element) => (element as HTMLInputElement).validity.valid);
  expect(isValidEmailInput).toBe(false);
});

test('valid admin login persists after refresh and logout works', async ({ page }) => {
  await loginViaUi(page, e2eEnv.adminEmail);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.locator('.profile-trigger').click();
  await page.getByRole('button', { name: /disconnect|deconnexion|déconnexion|قطع الاتصال|logout/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await expect(page).not.toHaveURL(/\/dashboard$/);
});

test('invalid and unknown credentials are rejected with handled UI error', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(e2eEnv.adminEmail);
  await page.locator('input[type="password"]').fill('wrong-password');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(/unable to connect|invalid|impossible|incorrect|connexion/i).first()).toBeVisible();

  await page.locator('input[type="email"]').fill('unknown@example.test');
  await page.locator('input[type="password"]').fill(e2eEnv.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(/unable to connect|invalid|impossible|incorrect|connexion/i).first()).toBeVisible();
});

test('protected API and direct protected URL require authentication', async ({ page, request }) => {
  const unauthenticated = await request.get('/api/auth/me');
  expect(unauthenticated.status()).toBe(401);

  await page.goto('/invoices');
  await expect(page).toHaveURL(/\/login$/);
});

test('employee login returns scoped permissions from API', async ({ request }) => {
  await loginViaApi(request, e2eEnv.employeeSelectedEmail);
  const me = await request.get('/api/auth/me');
  expect(me.ok()).toBeTruthy();
  const body = await me.json();
  expect(body.data.user.role).toBe('EMPLOYEE');
  expect(body.data.user.permissions).toContain('clients.view');
});
