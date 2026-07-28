import { test, expect } from '../helpers/test';
import { loginViaUi, goToView } from '../helpers/auth';
import { expectNoDuplicateIds, expectNoHorizontalOverflow } from '../helpers/a11y';

test('@smoke login, navigation, shell, toaster and responsive basics', async ({ page }) => {
  await loginViaUi(page);

  await expect(page.locator('aside')).toBeVisible();
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('dir', /ltr|rtl/);
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();

  await goToView(page, /clients|clients|العملاء/i);
  await expect(page).toHaveURL(/\/clients$/);
  await goToView(page, /invoices|factures|الفواتير/i);
  await expect(page).toHaveURL(/\/invoices$/);
  await goToView(page, /devis|quotes|عروض/i);
  await expect(page).toHaveURL(/\/devis$/);

  await expectNoDuplicateIds(page);
  await expectNoHorizontalOverflow(page);
});
