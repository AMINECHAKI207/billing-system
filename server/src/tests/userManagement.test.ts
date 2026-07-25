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

type UserResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    isActive: boolean;
    passwordHash?: string;
  };
};

type UserListResponse = {
  data: UserResponse['user'][];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

const runId = Date.now();
const adminEmail = `users-admin-${runId}@example.com`;
const employeeEmail = `users-employee-${runId}@example.com`;
const managedEmail = `managed-user-${runId}@example.com`;
const updatedManagedEmail = `managed-user-updated-${runId}@example.com`;
const password = 'UsersTest123!';

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUsers();

    const adminLogin = await login(baseUrl, adminEmail);
    const employeeLogin = await login(baseUrl, employeeEmail);

    const employeeList = await api<UserListResponse>(baseUrl, '/users', {
      token: employeeLogin.accessToken,
    });
    assert.equal(employeeList.status, 403);

    const createResult = await api<UserResponse>(baseUrl, '/users', {
      method: 'POST',
      token: adminLogin.accessToken,
      body: {
        name: 'Managed User',
        email: managedEmail,
        password,
        role: Role.EMPLOYEE,
      },
    });
    assert.equal(createResult.status, 201);
    assert.equal(createResult.body.data.user.role, Role.EMPLOYEE);
    assert.equal(createResult.body.data.user.isActive, true);
    assert.equal(createResult.body.data.user.passwordHash, undefined);

    const managedUserId = createResult.body.data.user.id;

    const listResult = await api<UserListResponse>(baseUrl, `/users?search=${managedEmail}`, {
      token: adminLogin.accessToken,
    });
    assert.equal(listResult.status, 200);
    assert.equal(listResult.body.data.data.length, 1);
    assert.equal(listResult.body.data.data[0]?.email, managedEmail);

    const updateResult = await api<UserResponse>(baseUrl, `/users/${managedUserId}`, {
      method: 'PUT',
      token: adminLogin.accessToken,
      body: {
        name: 'Managed Admin',
        email: updatedManagedEmail,
        role: Role.ADMIN,
        isActive: false,
        password: 'NewUsersTest123!',
      },
    });
    assert.equal(updateResult.status, 200);
    assert.equal(updateResult.body.data.user.name, 'Managed Admin');
    assert.equal(updateResult.body.data.user.email, updatedManagedEmail);
    assert.equal(updateResult.body.data.user.role, Role.ADMIN);
    assert.equal(updateResult.body.data.user.isActive, false);

    const updatedRawUser = await prisma.user.findUnique({ where: { id: managedUserId } });
    assert.ok(updatedRawUser);
    assert.equal(await bcrypt.compare('NewUsersTest123!', updatedRawUser.passwordHash), true);

    const selfDeactivate = await api<UserResponse>(baseUrl, `/users/${adminLogin.user.id}`, {
      method: 'PUT',
      token: adminLogin.accessToken,
      body: { isActive: false },
    });
    assert.equal(selfDeactivate.status, 400);

    const adminAfterBlockedUpdate = await prisma.user.findUnique({
      where: { id: adminLogin.user.id },
    });
    assert.equal(adminAfterBlockedUpdate?.isActive, true);

    console.log('user management tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await prisma.$disconnect();
  }
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(password, 4);

  await prisma.user.createMany({
    data: [
      {
        name: 'Users Admin',
        email: adminEmail,
        passwordHash,
        role: Role.ADMIN,
      },
      {
        name: 'Users Employee',
        email: employeeEmail,
        passwordHash,
        role: Role.EMPLOYEE,
      },
    ],
  });
}

async function login(baseUrl: string, email: string) {
  const response = await api<LoginResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
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
    where: {
      email: {
        in: [adminEmail, employeeEmail, managedEmail, updatedManagedEmail],
      },
    },
  });
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
