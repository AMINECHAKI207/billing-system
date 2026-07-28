import { test, expect } from '../helpers/test';
import { loginViaUi } from '../helpers/auth';
import { expectNoHorizontalOverflow } from '../helpers/a11y';

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`critical pages have no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await loginViaUi(page);
    for (const path of ['/dashboard', '/clients', '/invoices', '/devis', '/payments', '/reports', '/settings']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
}
