import { test as base, expect } from '@playwright/test';

const ignoredRequestPatterns = [/favicon\.ico$/, /\/ready$/, /\/health$/];
const ignoredConsolePatterns = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/,
];

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        if (!ignoredConsolePatterns.some((pattern) => pattern.test(text))) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!ignoredRequestPatterns.some((pattern) => pattern.test(url))) {
        failedRequests.push(`${request.method()} ${url} ${request.failure()?.errorText ?? ''}`.trim());
      }
    });

    await use(page);

    if (consoleErrors.length || pageErrors.length || failedRequests.length) {
      await testInfo.attach('runtime-errors', {
        body: [
          ...consoleErrors.map((item) => `console: ${item}`),
          ...pageErrors.map((item) => `pageerror: ${item}`),
          ...failedRequests.map((item) => `requestfailed: ${item}`),
        ].join('\n'),
        contentType: 'text/plain',
      });
    }

    expect(consoleErrors, 'unexpected browser console errors').toEqual([]);
    expect(pageErrors, 'unexpected page errors').toEqual([]);
    expect(failedRequests, 'unexpected failed requests').toEqual([]);
  },
});

export { expect };
