import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './test';
import { e2eEnv } from './env';

export async function loginViaUi(page: Page, email = e2eEnv.adminEmail, password = e2eEnv.password) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const loginResponse = page.waitForResponse((response) => response.url().includes('/api/auth/login'));
  await page.locator('form button[type="submit"]').click();
  expect((await loginResponse).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.locator('main')).toBeVisible();
}

export async function loginViaApi(request: APIRequestContext, email = e2eEnv.adminEmail, password = e2eEnv.password) {
  const response = await request.post('/api/auth/login', {
    data: { email, password, rememberMe: true },
  });
  expect(response.ok(), `login failed for ${email}`).toBeTruthy();
  return response.json();
}

export async function logoutViaUi(page: Page) {
  await page.getByRole('button', { name: /logout|déconnexion|قطع الاتصال/i }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function goToView(page: Page, label: RegExp) {
  const buttons = page.getByRole('button', { name: label });
  const viewport = page.viewportSize();
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox();
    if (!box || !viewport) continue;
    if (box.x >= 0 && box.y >= 0 && box.x < viewport.width && box.y < viewport.height) {
      await button.click();
      await expect(page.locator('main')).toBeVisible();
      return;
    }
  }
  await buttons.first().click();
  await expect(page.locator('main')).toBeVisible();
}
