import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { InvoiceStatus, PermissionScope, Role } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '@config/database';
import { env } from '@config/env';

// Force local email mode for this test
env.SMTP_USER = 'demo@example.com';
env.SMTP_PASS = 'replace_with_smtp_password';
env.SMTP_FROM_EMAIL = 'demo@example.com';

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
    status: InvoiceStatus;
    emailLogs?: Array<{
      status: string;
      recipientEmail: string;
      deliveryMode: string | null;
      filePath: string | null;
    }>;
  };
};

type EmailSendResponse = {
  invoice: {
    id: string;
    status: InvoiceStatus;
  };
  delivery: {
    mode: 'smtp' | 'local';
    filePath?: string;
    messageId?: string;
  };
};

type EmailStatusResponse = {
  emailStatus: {
    mode: 'smtp' | 'local';
    user: string;
    localOutputDir?: string;
  };
};

type EmailLogsResponse = {
  emailLogs: Array<{
    invoiceId: string;
    status: string;
    recipientEmail: string;
  }>;
};

const runId = Date.now();
const adminEmail = `email-admin-${runId}@example.com`;
const employeeEmail = `email-employee-${runId}@example.com`;
const customerEmail = `email-customer-${runId}@example.com`;
const recipientEmail = `invoice-recipient-${runId}@example.com`;
const password = 'EmailTest123!';
const createdLocalFiles = new Set<string>();

let createdInvoiceId: string | undefined;
let createdCustomerId: string | undefined;

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUsers();

    const adminLogin = await login(baseUrl, adminEmail);
    const employeeLogin = await login(baseUrl, employeeEmail);

    const employeeEmailStatus = await api<EmailStatusResponse>(baseUrl, '/settings/email-status', {
      token: employeeLogin.accessToken,
    });
    assert.equal(employeeEmailStatus.status, 403);

    const emailStatus = await api<EmailStatusResponse>(baseUrl, '/settings/email-status', {
      token: adminLogin.accessToken,
    });
    assert.equal(emailStatus.status, 200);
    assert.equal(emailStatus.body.data.emailStatus.mode, 'local');
    assert.ok(!emailStatus.body.data.emailStatus.user.includes('replace_with_smtp_password'));

    const customer = await createCustomer(baseUrl, adminLogin.accessToken);
    createdCustomerId = customer.id;

    const invoice = await createInvoice(baseUrl, adminLogin.accessToken, customer.id);
    createdInvoiceId = invoice.id;

    const sendResult = await api<EmailSendResponse>(baseUrl, `/invoices/${invoice.id}/email`, {
      method: 'POST',
      token: adminLogin.accessToken,
      body: {
        recipientEmail,
        subject: `Invoice email workflow ${runId}`,
        message: 'Please find the invoice attached.',
      },
    });
    console.log('SEND EMAIL RESPONSE:', sendResult.status, sendResult.body);
    assert.equal(sendResult.status, 200);
    assert.equal(sendResult.body.data.delivery.mode, 'local');
    assert.equal(sendResult.body.data.invoice.status, InvoiceStatus.SENT);
    assert.ok(sendResult.body.data.delivery.filePath);

    await assertLocalEmailFile(sendResult.body.data.delivery.filePath!);

    const invoiceDetail = await api<InvoiceResponse>(baseUrl, `/invoices/${invoice.id}`, {
      token: adminLogin.accessToken,
    });
    assert.equal(invoiceDetail.status, 200);

    const emailLogs = invoiceDetail.body.data.invoice.emailLogs ?? [];
    assert.ok(emailLogs.length >= 1);
    const latestEmailLog = emailLogs[0];
    assert.ok(latestEmailLog);
    assert.equal(latestEmailLog.status, 'SENT');
    assert.equal(latestEmailLog.recipientEmail, recipientEmail);
    assert.equal(latestEmailLog.deliveryMode, 'local');

    const recentLogs = await api<EmailLogsResponse>(baseUrl, '/settings/email-logs', {
      token: adminLogin.accessToken,
    });
    assert.equal(recentLogs.status, 200);
    assert.ok(
      recentLogs.body.data.emailLogs.some(
        (log) =>
          log.invoiceId === invoice.id &&
          log.recipientEmail === recipientEmail &&
          log.status === 'SENT'
      )
    );

    const testEmail = await api<{ delivery: { mode: 'smtp' | 'local'; filePath?: string } }>(
      baseUrl,
      '/settings/email-test',
      {
        method: 'POST',
        token: adminLogin.accessToken,
        body: { recipientEmail: adminEmail },
      }
    );
    assert.equal(testEmail.status, 200);
    assert.equal(testEmail.body.data.delivery.mode, 'local');
    if (testEmail.body.data.delivery.filePath) {
      await assertLocalEmailFile(testEmail.body.data.delivery.filePath);
    }

    console.log('invoice email workflow tests passed');
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

  const [adminRole, employeeRole] = await Promise.all([
    prisma.rbacRole.findUniqueOrThrow({
      where: { name: 'ADMIN' },
    }),
    prisma.rbacRole.findUniqueOrThrow({
      where: { name: 'EMPLOYEE' },
    }),
  ]);
const sendPermission = await prisma.permission.upsert({
  where: { key: 'invoices.send' },
  update: {},
  create: {
    key: 'invoices.send',
    resource: 'invoices',
    action: 'send',
    description: 'Send invoices by email',
  },
});

const existingGrant = await prisma.rolePermission.updateMany({
  where: {
    roleId: adminRole.id,
    permissionId: sendPermission.id,
  },
  data: {
    scope: PermissionScope.ALL,
  },
});

if (existingGrant.count === 0) {
  await prisma.rolePermission.create({
    data: {
      roleId: adminRole.id,
      permissionId: sendPermission.id,
      scope: PermissionScope.ALL,
    },
  });
}

  await prisma.user.createMany({
    data: [
      {
        name: 'Email Admin',
        email: adminEmail,
        passwordHash,
        role: Role.ADMIN,
        rbacRoleId: adminRole.id,
      },
      {
        name: 'Email Employee',
        email: employeeEmail,
        passwordHash,
        role: Role.EMPLOYEE,
        rbacRoleId: employeeRole.id,
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

async function createCustomer(baseUrl: string, token: string) {
  const response = await api<CustomerResponse>(baseUrl, '/customers', {
    method: 'POST',
    token,
    body: {
      name: 'Email Workflow Customer',
      email: customerEmail,
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
      status: InvoiceStatus.DRAFT,
      issueDate: '2026-07-21',
      dueDate: '2026-08-20',
      discount: 0,
      currency: 'MAD',
      items: [
        {
          description: 'Email workflow service',
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

async function assertLocalEmailFile(filePath: string) {
  const emailDir = path.resolve(process.cwd(), 'uploads', 'emails');
  const resolvedFilePath = path.resolve(filePath);

  assert.ok(resolvedFilePath.startsWith(emailDir));

  const content = await fs.readFile(resolvedFilePath, 'utf8');
  assert.match(content, /Mode: local development fallback/);

  createdLocalFiles.add(resolvedFilePath);

  const baseName = path.basename(resolvedFilePath, '.txt');
  const entries = await fs.readdir(emailDir);
  for (const entry of entries) {
    if (entry.startsWith(baseName)) {
      createdLocalFiles.add(path.join(emailDir, entry));
    }
  }
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
  if (createdInvoiceId) {
    await prisma.invoice.deleteMany({
      where: { id: createdInvoiceId },
    });
  }

  if (createdCustomerId) {
    await prisma.customer.deleteMany({
      where: { id: createdCustomerId },
    });
  }

  await prisma.user.deleteMany({
    where: {
      email: {
        in: [adminEmail, employeeEmail],
      },
    },
  });

  for (const filePath of createdLocalFiles) {
    await fs.unlink(filePath).catch(() => undefined);
  }
}

main().catch(async (error) => {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
