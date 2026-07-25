import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
import { AddressInfo } from 'net';
import { InvoiceStatus, Prisma, Role } from '@prisma/client';
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

type SettingsResponse = {
  settings: { vatEnabled: boolean; moroccoVatRate: string | number; defaultTaxRate: string | number };
};

type CustomerResponse = {
  customer: { id: string; country: string; countryCode: string };
};

type InvoiceResponse = {
  invoice: {
    id: string;
    subtotal: string | number;
    taxRate: string | number;
    taxAmount: string | number;
    total: string | number;
    customerCountry: string;
    customerCountryCode: string;
    vatOverridden: boolean;
    vatOverrideReason?: string | null;
    vatOverriddenAt?: string | null;
    vatOverriddenById?: string | null;
  };
};

const runId = Date.now();
const adminEmail = `vat-admin-${runId}@example.com`;
const employeeEmail = `vat-employee-${runId}@example.com`;
const password = 'DynamicVat123!';
const createdCustomerIds: string[] = [];
const createdInvoiceIds: string[] = [];
let originalSettings:
  | Prisma.CompanySettingsUpdateInput
  | null = null;

async function main() {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUsersAndSettings();

    const adminLogin = await login(baseUrl, adminEmail);
    const employeeLogin = await login(baseUrl, employeeEmail);

    const morocco = await createCustomer(baseUrl, adminLogin.accessToken, 'Morocco', 'MA');
    const france = await createCustomer(baseUrl, adminLogin.accessToken, 'France', 'FR');
    const spain = await createCustomer(baseUrl, adminLogin.accessToken, 'Spain', 'ES');
    const usa = await createCustomer(baseUrl, adminLogin.accessToken, 'United States', 'US');

    const moroccoInvoice = await createInvoice(baseUrl, adminLogin.accessToken, morocco.id);
    assertInvoiceTotals(moroccoInvoice, 20, 200, 1200, 'MA');

    const franceInvoice = await createInvoice(baseUrl, adminLogin.accessToken, france.id);
    assertInvoiceTotals(franceInvoice, 0, 0, 1000, 'FR');

    const spainInvoice = await createInvoice(baseUrl, adminLogin.accessToken, spain.id);
    assertInvoiceTotals(spainInvoice, 0, 0, 1000, 'ES');

    const usaInvoice = await createInvoice(baseUrl, adminLogin.accessToken, usa.id);
    assertInvoiceTotals(usaInvoice, 0, 0, 1000, 'US');

    const vatUpdate = await api<SettingsResponse>(baseUrl, '/settings/company', {
      method: 'PUT',
      token: adminLogin.accessToken,
      body: {
        name: 'VAT Test Company',
        defaultCurrency: 'MAD',
        defaultTaxRate: 20,
        vatEnabled: true,
        moroccoVatRate: 18,
      },
    });
    assert.equal(vatUpdate.status, 200);
    assert.equal(Number(vatUpdate.body.data.settings.moroccoVatRate), 18);

    const moroccoAfterChange = await createInvoice(baseUrl, adminLogin.accessToken, morocco.id);
    assertInvoiceTotals(moroccoAfterChange, 18, 180, 1180, 'MA');

    const oldInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: moroccoInvoice.id },
      select: { taxRate: true, taxAmount: true, total: true },
    });
    assert.equal(Number(oldInvoice.taxRate), 20);
    assert.equal(Number(oldInvoice.taxAmount), 200);
    assert.equal(Number(oldInvoice.total), 1200);

    const override = await createInvoice(baseUrl, adminLogin.accessToken, morocco.id, {
      taxRate: 7,
      vatOverrideReason: 'Convention client exoneree partiellement',
    });
    assertInvoiceTotals(override, 7, 70, 1070, 'MA');
    assert.equal(override.vatOverridden, true);
    assert.equal(override.vatOverrideReason, 'Convention client exoneree partiellement');
    assert.ok(override.vatOverriddenAt);
    assert.equal(override.vatOverriddenById, adminLogin.user.id);

    const employeeOverride = await api<InvoiceResponse>(baseUrl, '/invoices', {
      method: 'POST',
      token: employeeLogin.accessToken,
      body: buildInvoicePayload(morocco.id, { taxRate: 5, vatOverrideReason: 'Unauthorized' }),
    });
    assert.equal(employeeOverride.status, 403);

    const missingCountry = await api<CustomerResponse>(baseUrl, '/customers', {
      method: 'POST',
      token: adminLogin.accessToken,
      body: {
        name: `Missing Country ${runId}`,
        email: `missing-country-${runId}@example.com`,
      },
    });
    assert.equal(missingCountry.status, 400);
    assert.match(missingCountry.body.message, /Please select the customer's country/);

    const pdf = await apiBuffer(baseUrl, `/invoices/${moroccoAfterChange.id}/pdf`, adminLogin.accessToken);
    assert.equal(pdf.status, 200);
    assert.ok(pdf.buffer.subarray(0, 4).equals(Buffer.from('%PDF')));
    const pdfInvoice = await api<InvoiceResponse>(
      baseUrl,
      `/invoices/${moroccoAfterChange.id}`,
      { token: adminLogin.accessToken }
    );
    assertInvoiceTotals(pdfInvoice.body.data.invoice, 18, 180, 1180, 'MA');

    console.log('dynamic VAT tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await prisma.$disconnect();
  }
}

async function seedUsersAndSettings() {
  const passwordHash = await bcrypt.hash(password, 4);
  originalSettings = await prisma.companySettings.findUnique({
    where: { id: 1 },
    select: {
      name: true,
      defaultTaxRate: true,
      vatEnabled: true,
      moroccoVatRate: true,
    },
  });
  await prisma.user.createMany({
    data: [
      { name: 'VAT Admin', email: adminEmail, passwordHash, role: Role.ADMIN },
      { name: 'VAT Employee', email: employeeEmail, passwordHash, role: Role.EMPLOYEE },
    ],
  });

  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: 'VAT Test Company',
      defaultCurrency: 'MAD',
      defaultTaxRate: 20,
      vatEnabled: true,
      moroccoVatRate: 20,
    },
    update: {
      name: 'VAT Test Company',
      defaultTaxRate: 20,
      vatEnabled: true,
      moroccoVatRate: 20,
    },
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

async function createCustomer(baseUrl: string, token: string, country: string, countryCode: string) {
  const response = await api<CustomerResponse>(baseUrl, '/customers', {
    method: 'POST',
    token,
    body: {
      name: `${country} Customer ${runId}`,
      email: `${countryCode.toLowerCase()}-customer-${runId}@example.com`,
      country,
      countryCode,
    },
  });

  assert.equal(response.status, 201);
  createdCustomerIds.push(response.body.data.customer.id);
  return response.body.data.customer;
}

async function createInvoice(
  baseUrl: string,
  token: string,
  customerId: string,
  override: { taxRate?: number; vatOverrideReason?: string } = {}
) {
  const response = await api<InvoiceResponse>(baseUrl, '/invoices', {
    method: 'POST',
    token,
    body: buildInvoicePayload(customerId, override),
  });

  assert.equal(response.status, 201);
  createdInvoiceIds.push(response.body.data.invoice.id);
  return response.body.data.invoice;
}

function buildInvoicePayload(
  customerId: string,
  override: { taxRate?: number; vatOverrideReason?: string } = {}
) {
  return {
    customerId,
    status: InvoiceStatus.SENT,
    issueDate: '2026-07-22',
    dueDate: '2026-08-22',
    discount: 0,
    currency: 'MAD',
    ...override,
    items: [
      {
        description: 'Dynamic VAT service',
        unit: 'service',
        quantity: 1,
        unitPrice: 1000,
      },
    ],
  };
}

function assertInvoiceTotals(
  invoice: InvoiceResponse['invoice'],
  taxRate: number,
  taxAmount: number,
  total: number,
  countryCode: string
) {
  assert.equal(Number(invoice.subtotal), 1000);
  assert.equal(Number(invoice.taxRate), taxRate);
  assert.equal(Number(invoice.taxAmount), taxAmount);
  assert.equal(Number(invoice.total), total);
  assert.equal(invoice.customerCountryCode, countryCode);
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

async function apiBuffer(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return {
    status: response.status,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

async function cleanup() {
  await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, employeeEmail] } } });
  if (originalSettings) {
    await prisma.companySettings.update({
      where: { id: 1 },
      data: originalSettings,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
