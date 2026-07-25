import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { InvoiceStatus, Role } from '@prisma/client';
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

type CustomerResponse = {
  customer: {
    id: string;
    email: string;
  };
};

type InvoiceResponse = {
  invoice: {
    id: string;
  };
};

const runId = Date.now();
const adminEmail = `authz-admin-${runId}@example.com`;
const employeeEmail = `authz-employee-${runId}@example.com`;
const adminCustomerEmail = `authz-admin-delete-${runId}@example.com`;
const employeeCustomerEmail = `authz-employee-delete-${runId}@example.com`;
const linkedCustomerEmail = `authz-linked-delete-${runId}@example.com`;
const password = 'AuthzTest123!';
const invoiceIds: string[] = [];

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUsers();

    const adminLogin = await login(baseUrl, adminEmail);
    const employeeLogin = await login(baseUrl, employeeEmail);

    assert.equal(adminLogin.user.role, Role.ADMIN);
    assert.equal(employeeLogin.user.role, Role.EMPLOYEE);
    assert.equal(decodedRole(adminLogin.accessToken), Role.ADMIN);
    assert.equal(decodedRole(employeeLogin.accessToken), Role.EMPLOYEE);

    const employeeMe = await api<{ user: { role: Role } }>(baseUrl, '/auth/me', {
      token: employeeLogin.accessToken,
    });
    assert.equal(employeeMe.status, 200);
    assert.equal(employeeMe.body.data.user.role, Role.EMPLOYEE);

    const adminDeletedCustomer = await createCustomer(
      baseUrl,
      adminLogin.accessToken,
      adminCustomerEmail
    );
    const adminDelete = await api<null>(
      baseUrl,
      `/customers/${adminDeletedCustomer.id}`,
      {
        method: 'DELETE',
        token: adminLogin.accessToken,
      }
    );
    assert.equal(adminDelete.status, 200);

    const deletedCustomer = await prisma.customer.findUnique({
      where: { id: adminDeletedCustomer.id },
    });
    assert.equal(deletedCustomer, null);

    const employeeBlockedCustomer = await createCustomer(
      baseUrl,
      adminLogin.accessToken,
      employeeCustomerEmail
    );
    const employeeDelete = await api<null>(
      baseUrl,
      `/customers/${employeeBlockedCustomer.id}`,
      {
        method: 'DELETE',
        token: employeeLogin.accessToken,
      }
    );
    assert.equal(employeeDelete.status, 403);

    const remainingCustomer = await prisma.customer.findUnique({
      where: { id: employeeBlockedCustomer.id },
    });
    assert.notEqual(remainingCustomer, null);

    const linkedCustomer = await createCustomer(
      baseUrl,
      adminLogin.accessToken,
      linkedCustomerEmail
    );
    const linkedInvoice = await createInvoice(baseUrl, adminLogin.accessToken, linkedCustomer.id);
    invoiceIds.push(linkedInvoice.id);

    const linkedCustomerDelete = await api<null>(
      baseUrl,
      `/customers/${linkedCustomer.id}`,
      {
        method: 'DELETE',
        token: adminLogin.accessToken,
      }
    );
    assert.equal(linkedCustomerDelete.status, 400);

    const customerWithInvoice = await prisma.customer.findUnique({
      where: { id: linkedCustomer.id },
    });
    assert.notEqual(customerWithInvoice, null);

    console.log('customer authorization tests passed');
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
        name: 'Authz Admin',
        email: adminEmail,
        passwordHash,
        role: Role.ADMIN,
      },
      {
        name: 'Authz Employee',
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

async function createCustomer(baseUrl: string, token: string, email: string) {
  const response = await api<CustomerResponse>(baseUrl, '/customers', {
    method: 'POST',
    token,
    body: {
      name: email.split('@')[0],
      email,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  assert.equal(response.status, 201);
  return response.body.data.customer;
}

async function createInvoice(baseUrl: string, token: string, customerId: string) {
  const response = await api<InvoiceResponse>(baseUrl, '/invoices', {
    method: 'POST',
    token,
    body: {
      customerId,
      status: InvoiceStatus.SENT,
      issueDate: '2026-07-22',
      dueDate: '2026-08-22',
      discount: 0,
      currency: 'MAD',
      items: [
        {
          description: 'Linked customer delete guard',
          unit: 'service',
          quantity: 1,
          unitPrice: 100,
          taxRate: 20,
        },
      ],
    },
  });

  assert.equal(response.status, 201);
  return response.body.data.invoice;
}

async function api<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
) {
  const response = await fetch(`${baseUrl}${path}`, {
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

function decodedRole(token: string) {
  const decoded = jwt.decode(token);

  assert.equal(typeof decoded, 'object');
  assert.notEqual(decoded, null);

  return (decoded as { role?: string }).role;
}

async function cleanup() {
  await prisma.invoice.deleteMany({
    where: { id: { in: invoiceIds } },
  });

  await prisma.customer.deleteMany({
    where: {
      email: {
        in: [adminCustomerEmail, employeeCustomerEmail, linkedCustomerEmail],
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [adminEmail, employeeEmail],
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
