import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
import { AddressInfo } from 'net';
import { Role } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '@config/database';

type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

type UserPayload = {
  user: {
    id: string;
    email: string;
    role: Role;
    themePreference: 'light' | 'dark';
    passwordHash?: string;
  };
};

type LoginResponse = UserPayload & {
  accessToken: string;
};

const runId = Date.now();
const userEmail = `theme-user-${runId}@example.com`;
const password = 'ThemeUser123!';

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUser();

    const loginResult = await login(baseUrl);
    assert.equal(loginResult.user.themePreference, 'light');

    const updateResult = await api<UserPayload>(baseUrl, '/auth/theme', {
      method: 'PATCH',
      token: loginResult.accessToken,
      body: { themePreference: 'dark' },
    });
    assert.equal(updateResult.status, 200);
    assert.equal(updateResult.body.data.user.themePreference, 'dark');
    assert.equal(updateResult.body.data.user.passwordHash, undefined);

    const storedUser = await prisma.user.findUnique({ where: { email: userEmail } });
    assert.equal(storedUser?.themePreference, 'dark');

    const meResult = await api<UserPayload>(baseUrl, '/auth/me', {
      token: loginResult.accessToken,
    });
    assert.equal(meResult.status, 200);
    assert.equal(meResult.body.data.user.themePreference, 'dark');

    const invalidResult = await api<null>(baseUrl, '/auth/theme', {
      method: 'PATCH',
      token: loginResult.accessToken,
      body: { themePreference: 'system' },
    });
    assert.equal(invalidResult.status, 400);

    console.log('theme preference tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await prisma.$disconnect();
  }
}

async function seedUser() {
  const passwordHash = await bcrypt.hash(password, 4);

  await prisma.user.create({
    data: {
      name: 'Theme User',
      email: userEmail,
      passwordHash,
      role: Role.EMPLOYEE,
    },
  });
}

async function login(baseUrl: string) {
  const response = await api<LoginResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: {
      email: userEmail,
      password,
    },
  });

  assert.equal(response.status, 200);
  return response.body.data;
}

async function api<T>(
  baseUrl: string,
  requestPath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as ApiEnvelope<T>,
  };
}

async function cleanup() {
  await prisma.user.deleteMany({
    where: { email: userEmail },
  });
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
