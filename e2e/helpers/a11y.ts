import type { Page } from '@playwright/test';
import { expect } from './test';

export async function expectNoDuplicateIds(page: Page) {
  const duplicateIds = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]')).map((item) => item.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}
