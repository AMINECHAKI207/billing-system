import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
import { AddressInfo } from 'net';
import { InvoiceStatus, PaymentMethod, Role } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '@config/database';

type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

type LoginResponse = {
  user: { id: string; email: string; role: Role };
  accessToken: string;
};

type DashboardResponse = {
  dashboard: {
    totalInvoices: number;
    totalClients: number;
    totalRevenue: number;
    totalPaid: number;
    totalUnpaid: number;
    paidInvoices: number;
    unpaidInvoices: number;
    overdueInvoices: number;
    overdueAmount: number;
    dueSoonAmount: number;
    monthlyRevenue: Array<{ month: string; revenue: number; unpaid: number; invoiceCount: number }>;
    invoiceStatusCounts: Array<{ status: InvoiceStatus; count: number; amount: number }>;
    topClients: Array<{ customer: string; revenue: number; invoiceCount: number }>;
    recentPayments: Array<{ amount: number; invoiceNumber: string; customer: string }>;
    upcomingDeadlines: Array<{ invoiceNumber: string; balanceDue: number; customer: string }>;
  };
};

const runId = Date.now();
const adminEmail = `dashboard-admin-${runId}@example.com`;
const password = 'DashboardStats123!';
const invoiceNumbers = [
  `DASH-${runId}-001`,
  `DASH-${runId}-002`,
  `DASH-${runId}-003`,
  `DASH-${runId}-004`,
  `DASH-${runId}-005`,
];
const createdCustomerIds: string[] = [];

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedDashboardFixture();
    const adminLogin = await login(baseUrl);
    const response = await api<DashboardResponse>(
      baseUrl,
      '/invoices/dashboard?period=custom&dateFrom=2099-01-01&dateTo=2099-12-31&months=6',
      { token: adminLogin.accessToken }
    );

    assert.equal(response.status, 200);
    const dashboard = response.body.data.dashboard;

    assert.equal(dashboard.totalInvoices, 5);
    assert.equal(dashboard.totalClients, 2);
    assert.equal(dashboard.totalRevenue, 3600);
    assert.equal(dashboard.totalPaid, 1450);
    assert.equal(dashboard.totalUnpaid, 2150);
    assert.equal(dashboard.paidInvoices, 1);
    assert.equal(dashboard.unpaidInvoices, 3);
    assert.equal(dashboard.overdueInvoices, 1);
    assert.equal(dashboard.overdueAmount, 800);
    assert.equal(dashboard.dueSoonAmount, 1350);
    assert.equal(dashboard.monthlyRevenue.length, 6);
    assert.ok(dashboard.monthlyRevenue.some((month) => month.revenue >= 3600));
    assertStatusCount(dashboard, InvoiceStatus.DRAFT, 1);
    assertStatusCount(dashboard, InvoiceStatus.SENT, 1);
    assertStatusCount(dashboard, InvoiceStatus.PAID, 1);
    assertStatusCount(dashboard, InvoiceStatus.PARTIALLY_PAID, 1);
    assertStatusCount(dashboard, InvoiceStatus.OVERDUE, 1);
    const topClient = dashboard.topClients[0];
    assert.ok(topClient);
    assert.equal(topClient.customer, `Dashboard Alpha ${runId}`);
    assert.equal(topClient.revenue, 2200);
    assert.ok(dashboard.recentPayments.some((payment) => payment.amount === 1200));
    assert.ok(dashboard.upcomingDeadlines.some((invoice) => invoice.balanceDue === 1000));

    console.log('dashboard stats tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await prisma.$disconnect();
  }
}

async function seedDashboardFixture() {
  const passwordHash = await bcrypt.hash(password, 4);
  const admin = await prisma.user.create({
    data: {
      name: 'Dashboard Admin',
      email: adminEmail,
      passwordHash,
      role: Role.ADMIN,
    },
  });

  const [alpha, beta] = await Promise.all([
    prisma.customer.create({
      data: {
        name: `Dashboard Alpha ${runId}`,
        email: `dashboard-alpha-${runId}@example.com`,
        company: `Dashboard Alpha ${runId}`,
        country: 'Morocco',
        countryCode: 'MA',
        createdById: admin.id,
      },
    }),
    prisma.customer.create({
      data: {
        name: `Dashboard Beta ${runId}`,
        email: `dashboard-beta-${runId}@example.com`,
        company: `Dashboard Beta ${runId}`,
        country: 'Morocco',
        countryCode: 'MA',
        createdById: admin.id,
      },
    }),
  ]);
  createdCustomerIds.push(alpha.id, beta.id);

  const today = new Date();
  const paymentDate = new Date(2099, 11, 20);
  const issueDate = new Date(2099, 11, 5);
  const dueSoon = new Date(today);
  dueSoon.setDate(today.getDate() + 5);
  const overdue = new Date(today);
  overdue.setDate(today.getDate() - 5);

  const invoices = await Promise.all([
    createInvoice(alpha.id, admin.id, invoiceNumbers[0]!, InvoiceStatus.DRAFT, 500, 0, issueDate, dueSoon),
    createInvoice(alpha.id, admin.id, invoiceNumbers[1]!, InvoiceStatus.SENT, 1000, 0, issueDate, dueSoon),
    createInvoice(alpha.id, admin.id, invoiceNumbers[2]!, InvoiceStatus.PAID, 1200, 1200, issueDate, dueSoon),
    createInvoice(beta.id, admin.id, invoiceNumbers[3]!, InvoiceStatus.OVERDUE, 800, 0, issueDate, overdue),
    createInvoice(beta.id, admin.id, invoiceNumbers[4]!, InvoiceStatus.PARTIALLY_PAID, 600, 250, issueDate, dueSoon),
  ]);

  await prisma.payment.createMany({
    data: [
      {
        invoiceId: invoices[2].id,
        recordedById: admin.id,
        amount: 1200,
        paymentDate,
        method: PaymentMethod.BANK_TRANSFER,
        reference: `DASH-PAY-${runId}-1`,
      },
      {
        invoiceId: invoices[4].id,
        recordedById: admin.id,
        amount: 250,
        paymentDate,
        method: PaymentMethod.CASH,
        reference: `DASH-PAY-${runId}-2`,
      },
    ],
  });
}

async function createInvoice(
  customerId: string,
  createdById: string,
  invoiceNumber: string,
  status: InvoiceStatus,
  total: number,
  amountPaid: number,
  issueDate: Date,
  dueDate: Date
) {
  return prisma.invoice.create({
    data: {
      customerId,
      createdById,
      invoiceNumber,
      status,
      issueDate,
      dueDate,
      subtotal: total,
      taxRate: 0,
      taxAmount: 0,
      discount: 0,
      total,
      amountPaid,
      balanceDue: total - amountPaid,
      customerCountry: 'Morocco',
      customerCountryCode: 'MA',
      currency: 'MAD',
      items: {
        create: {
          description: `Dashboard fixture ${invoiceNumber}`,
          quantity: 1,
          unitPrice: total,
          taxRate: 0,
          total,
          sortOrder: 0,
        },
      },
    },
  });
}

function assertStatusCount(dashboard: DashboardResponse['dashboard'], status: InvoiceStatus, count: number) {
  assert.equal(
    dashboard.invoiceStatusCounts.find((item) => item.status === status)?.count,
    count
  );
}

async function login(baseUrl: string) {
  const response = await api<LoginResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password },
  });

  assert.equal(response.status, 200);
  return response.body.data;
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
  await prisma.invoice.deleteMany({ where: { invoiceNumber: { in: invoiceNumbers } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
