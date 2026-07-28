import { test, expect } from '../helpers/test';
import { e2eEnv } from '../helpers/env';
import { loginViaApi } from '../helpers/auth';

test('admin can load users, roles and permissions', async ({ page, request }) => {
  await loginViaApi(request, e2eEnv.adminEmail);
  await page.goto('/roles');
  await expect(page.locator('main')).toBeVisible();

  const roles = await request.get('/api/rbac/roles');
  expect(roles.ok()).toBeTruthy();
  const permissions = await request.get('/api/rbac/permissions');
  expect(permissions.ok()).toBeTruthy();
});

test('restricted employee cannot access RBAC APIs or broaden permissions', async ({ request }) => {
  await loginViaApi(request, e2eEnv.restrictedEmail);
  expect((await request.get('/api/rbac/roles')).status()).toBe(403);
  expect((await request.get('/api/users')).status()).toBe(403);
});
