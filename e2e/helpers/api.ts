import type { APIRequestContext } from '@playwright/test';
import { expect } from './test';

export async function expectApiOk(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.ok(), `${path} should succeed`).toBeTruthy();
  return response.json();
}

export async function expectApiStatus(request: APIRequestContext, path: string, status: number) {
  const response = await request.get(path);
  expect(response.status(), `${path} status`).toBe(status);
  return response;
}
