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

type LoginResponse = {
  user: {
    id: string;
    email: string;
    role: Role;
  };
  accessToken: string;
};

const runId = Date.now();
const userEmail = `password-user-${runId}@example.com`;
const oldPassword = 'OldPassword123!';
const newPassword = 'NewPassword123!';

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUser();

    const loginResult = await login(baseUrl, oldPassword);

    const wrongCurrentPassword = await api<null>(baseUrl, '/auth/password', {
      method: 'PATCH',
      token: loginResult.accessToken,
      body: {
        currentPassword: 'WrongPassword123!',
        newPassword,
      },
    });
    assert.equal(wrongCurrentPassword.status, 401);

    const samePassword = await api<null>(baseUrl, '/auth/password', {
      method: 'PATCH',
      token: loginResult.accessToken,
      body: {
        currentPassword: oldPassword,
        newPassword: oldPassword,
      },
    });
    assert.equal(samePassword.status, 400);

    const changePassword = await api<null>(baseUrl, '/auth/password', {
      method: 'PATCH',
      token: loginResult.accessToken,
      body: {
        currentPassword: oldPassword,
        newPassword,
      },
    });
    assert.equal(changePassword.status, 200);

    const oldLogin = await api<LoginResponse>(baseUrl, '/auth/login', {
      method: 'POST',
      body: {
        email: userEmail,
        password: oldPassword,
      },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await login(baseUrl, newPassword);
    assert.equal(newLogin.user.email, userEmail);
    assert.equal(newLogin.user.role, Role.EMPLOYEE);

    console.log('change password tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await prisma.$disconnect();
  }
}

async function seedUser() {
  const passwordHash = await bcrypt.hash(oldPassword, 4);

  await prisma.user.create({
    data: {
      name: 'Password User',
      email: userEmail,
      passwordHash,
      role: Role.EMPLOYEE,
    },
  });
}

async function login(baseUrl: string, password: string) {
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
