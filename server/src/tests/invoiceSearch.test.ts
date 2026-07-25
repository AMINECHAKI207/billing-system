import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
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
  };
};

type InvoiceResponse = {
  invoice: {
    id: string;
    invoiceNumber: string;
  };
};

type InvoiceListResponse = {
  data: Array<{
    id: string;
    invoiceNumber: string;
  }>;
  meta: {
    total: number;
  };
};

const runId = Date.now();
const adminEmail = `invoice-search-admin-${runId}@example.com`;
const customerEmail = `invoice-search-customer-${runId}@example.com`;
const customerPhone = `+212600${String(runId).slice(-6)}`;
const customerTaxNumber = `IF-SEARCH-${runId}`;
const customerCompany = `Search Company ${runId}`;
const customerName = `Search Customer ${runId}`;
const password = 'InvoiceSearch123!';

let createdInvoiceId: string | undefined;
let createdCustomerId: string | undefined;

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUser();

    const adminLogin = await login(baseUrl);
    const customer = await createCustomer(baseUrl, adminLogin.accessToken);
    createdCustomerId = customer.id;

    const invoice = await createInvoice(baseUrl, adminLogin.accessToken, customer.id);
    createdInvoiceId = invoice.id;

    await assertInvoiceSearch(baseUrl, adminLogin.accessToken, invoice.id, invoice.invoiceNumber);
    await assertInvoiceSearch(baseUrl, adminLogin.accessToken, invoice.id, customerName);
    await assertInvoiceSearch(baseUrl, adminLogin.accessToken, invoice.id, customerEmail);
    await assertInvoiceSearch(baseUrl, adminLogin.accessToken, invoice.id, customerCompany);
    await assertInvoiceSearch(baseUrl, adminLogin.accessToken, invoice.id, customerPhone);
    await assertInvoiceSearch(baseUrl, adminLogin.accessToken, invoice.id, customerTaxNumber);

    console.log('invoice search tests passed');
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
      name: 'Invoice Search Admin',
      email: adminEmail,
      passwordHash,
      role: Role.ADMIN,
    },
  });
}

async function login(baseUrl: string) {
  const response = await api<LoginResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password },
  });

  assert.equal(response.status, 200);
  return response.body.data;
}

async function createCustomer(baseUrl: string, token: string) {
  const response = await api<CustomerResponse>(baseUrl, '/customers', {
    method: 'POST',
    token,
    body: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      company: customerCompany,
      taxNumber: customerTaxNumber,
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
          description: 'Invoice search coverage',
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

async function assertInvoiceSearch(
  baseUrl: string,
  token: string,
  invoiceId: string,
  search: string
) {
  const response = await api<InvoiceListResponse>(
    baseUrl,
    `/invoices?search=${encodeURIComponent(search)}`,
    { token }
  );

  assert.equal(response.status, 200);
  assert.ok(
    response.body.data.data.some((invoice) => invoice.id === invoiceId),
    `Expected invoice to be found by search "${search}"`
  );
}

async function api<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiEnvelope<T>,
  };
}

async function cleanup() {
  if (createdInvoiceId) {
    await prisma.invoice.deleteMany({ where: { id: createdInvoiceId } });
  }

  if (createdCustomerId) {
    await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
  }

  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
