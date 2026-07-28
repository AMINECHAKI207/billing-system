import { test, expect } from '../helpers/test';
import { loginViaUi } from '../helpers/auth';

test('theme switches between light and dark and persists', async ({ page }) => {
  await loginViaUi(page);
  const html = page.locator('html');
  const themeButton = page.locator('button[aria-pressed]').first();

  const initialClass = await html.getAttribute('class');
  await themeButton.click();
  await expect(html).not.toHaveAttribute('class', initialClass ?? '');
  const switchedClass = await html.getAttribute('class');
  await page.reload();
  await expect(html).toHaveAttribute('class', switchedClass ?? '');
});
