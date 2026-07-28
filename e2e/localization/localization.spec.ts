import { test, expect } from '../helpers/test';
import { loginViaUi } from '../helpers/auth';

test('language switching persists and Arabic applies RTL/sidebar direction', async ({ page }) => {
  await loginViaUi(page);

  await page.getByRole('button', { name: /language|langue|اللغة/i }).first().click();
  await page.getByRole('listbox', { name: /language|langue|اللغة/i }).getByRole('option', { name: /العربية AR/i }).click();
  await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('aside')).toHaveClass(/right-0/);
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('body')).not.toContainText('????');

  await page.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole('listbox').getByRole('option', { name: /English EN/i }).click();
  await expect(page.locator('main')).toHaveAttribute('dir', 'ltr');
});

test('no raw translation keys are visible on main authenticated views', async ({ page }) => {
  await loginViaUi(page);
  for (const path of ['/dashboard', '/clients', '/invoices', '/devis', '/payments', '/reports', '/settings']) {
    await page.goto(path);
    const visibleText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(visibleText).not.toMatch(/\b(app|audit|devis|i18nDynamic)\.[a-zA-Z0-9_.]+/);
    expect(visibleText).not.toContain('????');
  }
});
