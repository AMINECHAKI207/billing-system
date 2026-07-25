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

type TaxSummaryResponse = {
  report: {
    totals: {
      invoiceCount: number;
      subtotal: number;
      discount: number;
      taxableBase: number;
      taxAmount: number;
      total: number;
      amountPaid: number;
      balanceDue: number;
    };
    taxRates: Array<{
      taxRate: number;
      invoiceCount: number;
      subtotal: number;
      taxAmount: number;
      total: number;
    }>;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      taxRate: number;
      taxAmount: number;
      total: number;
    }>;
  };
};

const runId = Date.now();
const userEmail = `reports-admin-${runId}@example.com`;
const customerEmail = `reports-customer-${runId}@example.com`;
const password = 'ReportsTest123!';
const invoiceIds: string[] = [];
let customerId: string | undefined;

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUser();

    const { accessToken } = await login(baseUrl);
    const customer = await createCustomer(baseUrl, accessToken);
    customerId = customer.id;

    const invoiceA = await createInvoice(baseUrl, accessToken, customer.id, {
      issueDate: '2026-03-10',
      status: InvoiceStatus.SENT,
      unitPrice: 100,
      taxRate: 20,
    });
    invoiceIds.push(invoiceA.id);

    const invoiceB = await createInvoice(baseUrl, accessToken, customer.id, {
      issueDate: '2026-04-12',
      status: InvoiceStatus.SENT,
      unitPrice: 200,
      taxRate: 10,
    });
    invoiceIds.push(invoiceB.id);

    const cancelledInvoice = await createInvoice(baseUrl, accessToken, customer.id, {
      issueDate: '2026-04-15',
      status: InvoiceStatus.CANCELLED,
      unitPrice: 1000,
      taxRate: 20,
    });
    invoiceIds.push(cancelledInvoice.id);

    const reportResult = await api<TaxSummaryResponse>(
      baseUrl,
      '/reports/tax-summary?dateFrom=2026-03-01&dateTo=2026-04-30',
      { token: accessToken }
    );

    assert.equal(reportResult.status, 200);
    assert.equal(reportResult.body.data.report.totals.invoiceCount, 2);
    assert.equal(reportResult.body.data.report.totals.subtotal, 300);
    assert.equal(reportResult.body.data.report.totals.taxableBase, 300);
    assert.equal(reportResult.body.data.report.totals.taxAmount, 40);
    assert.equal(reportResult.body.data.report.totals.total, 340);
    assert.equal(reportResult.body.data.report.totals.balanceDue, 340);
    assert.equal(reportResult.body.data.report.taxRates.length, 2);
    assert.ok(reportResult.body.data.report.invoices.every((invoice) => invoice.id !== cancelledInvoice.id));

    const reversedDates = await api<TaxSummaryResponse>(
      baseUrl,
      '/reports/tax-summary?dateFrom=2026-05-01&dateTo=2026-04-01',
      { token: accessToken }
    );
    assert.equal(reversedDates.status, 400);

    console.log('tax summary report tests passed');
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
      name: 'Reports Admin',
      email: userEmail,
      passwordHash,
      role: Role.ADMIN,
    },
  });
}

async function login(baseUrl: string) {
  const response = await api<LoginResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email: userEmail, password },
  });

  assert.equal(response.status, 200);
  return response.body.data;
}

async function createCustomer(baseUrl: string, token: string) {
  const response = await api<CustomerResponse>(baseUrl, '/customers', {
    method: 'POST',
    token,
    body: {
      name: 'Reports Customer',
      email: customerEmail,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  assert.equal(response.status, 201);
  return response.body.data.customer;
}

async function createInvoice(
  baseUrl: string,
  token: string,
  customerId: string,
  input: {
    issueDate: string;
    status: InvoiceStatus;
    unitPrice: number;
    taxRate: number;
  }
) {
  const response = await api<InvoiceResponse>(baseUrl, '/invoices', {
    method: 'POST',
    token,
    body: {
      customerId,
      status: input.status,
      issueDate: input.issueDate,
      dueDate: '2026-12-31',
      taxRate: input.taxRate,
      vatOverrideReason: `Tax report coverage ${input.taxRate}`,
      discount: 0,
      currency: 'MAD',
      items: [
        {
          description: `Tax report item ${input.taxRate}`,
          unit: 'service',
          quantity: 1,
          unitPrice: input.unitPrice,
          taxRate: input.taxRate,
        },
      ],
    },
  });

  assert.equal(response.status, 201);
  return response.body.data.invoice;
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
  await prisma.invoice.deleteMany({
    where: { id: { in: invoiceIds } },
  });

  if (customerId) {
    await prisma.customer.deleteMany({
      where: { id: customerId },
    });
  }

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
