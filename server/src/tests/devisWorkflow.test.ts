import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
import { AddressInfo } from 'net';
import { DevisStatus, Role } from '@prisma/client';
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

type CustomerResponse = {
  customer: { id: string };
};

type DevisResponse = {
  devis: {
    id: string;
    devisNumber: string;
    status: DevisStatus;
    total: string | number;
    isSigned: boolean;
    signatureUrl?: string | null;
    stampUrl?: string | null;
    generatedInvoice?: { id: string; invoiceNumber: string } | null;
    items: Array<{ description: string; lineTotal: string | number }>;
  };
};

type ConvertResponse = DevisResponse & {
  invoice: {
    id: string;
    invoiceNumber: string;
    sourceDevisId: string;
    sourceDevis?: { id: string; devisNumber: string };
    total: string | number;
    isSigned: boolean;
    signatureUrl?: string | null;
    stampUrl?: string | null;
    items: Array<{ description: string; total: string | number }>;
  };
};

type DeleteDraftsResponse = {
  deletedCount: number;
};

const runId = Date.now();
const adminEmail = `devis-admin-${runId}@example.com`;
const customerEmail = `devis-customer-${runId}@example.com`;
const password = 'DevisWorkflow123!';
const createdDevisIds: string[] = [];
const createdInvoiceIds: string[] = [];
let createdCustomerId: string | undefined;

async function main() {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    await seedUser();
    const loginResponse = await login(baseUrl);
    const customer = await createCustomer(baseUrl, loginResponse.accessToken);
    createdCustomerId = customer.id;

    const draft = await createDevis(baseUrl, loginResponse.accessToken, customer.id);
    createdDevisIds.push(draft.id);
    assert.equal(draft.status, DevisStatus.DRAFT);
    assert.match(draft.devisNumber, /^DEV-\d{4}-\d{4}$/);

    const updated = await updateDevis(baseUrl, loginResponse.accessToken, draft.id, customer.id);
    assert.equal(updated.items[0]?.description, 'Updated quote service');

    await configureCompanySignatureSnapshot();
    const signedDraftResponse = await api<DevisResponse>(baseUrl, `/devis/${draft.id}/sign`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(signedDraftResponse.status, 200);
    assert.equal(signedDraftResponse.body.data.devis.status, DevisStatus.DRAFT);
    assert.equal(signedDraftResponse.body.data.devis.isSigned, true);

    const cancelledDraftSignature = await api<DevisResponse>(baseUrl, `/devis/${draft.id}/sign`, {
      method: 'DELETE',
      token: loginResponse.accessToken,
    });
    assert.equal(cancelledDraftSignature.status, 200);
    assert.equal(cancelledDraftSignature.body.data.devis.status, DevisStatus.DRAFT);
    assert.equal(cancelledDraftSignature.body.data.devis.isSigned, false);

    const draftConversion = await api<ConvertResponse>(baseUrl, `/devis/${draft.id}/convert-to-invoice`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(draftConversion.status, 400);

    const sent = await postDevisAction(baseUrl, loginResponse.accessToken, draft.id, 'send');
    assert.equal(sent.status, DevisStatus.SENT);
    const approved = await postDevisAction(baseUrl, loginResponse.accessToken, draft.id, 'approve');
    assert.equal(approved.status, DevisStatus.APPROVED);

    const duplicateApprovedCatalog = await api<DevisResponse>(baseUrl, '/devis', {
      method: 'POST',
      token: loginResponse.accessToken,
      body: devisPayload(customer.id, 'Updated quote service'),
    });
    assert.equal(duplicateApprovedCatalog.status, 409);

    const differentCatalog = await createDevisWithDescription(baseUrl, loginResponse.accessToken, customer.id, 'Different catalog service');
    createdDevisIds.push(differentCatalog.id);
    assert.notEqual(differentCatalog.devisNumber, approved.devisNumber);

    const signedResponse = await api<DevisResponse>(baseUrl, `/devis/${draft.id}/sign`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(signedResponse.status, 200);
    const signed = signedResponse.body.data.devis;
    assert.equal(signed.isSigned, true);
    assert.equal(signed.signatureUrl, '/uploads/company-assets/devis-signature-test.png');
    assert.equal(signed.stampUrl, '/uploads/company-assets/devis-stamp-test.png');

    const convertedResponse = await api<ConvertResponse>(baseUrl, `/devis/${draft.id}/convert-to-invoice`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(convertedResponse.status, 201);
    const converted = convertedResponse.body.data;
    createdInvoiceIds.push(converted.invoice.id);
    assert.equal(converted.devis.status, DevisStatus.CONVERTED);
    assert.equal(converted.invoice.sourceDevisId, draft.id);
    assert.equal(converted.invoice.sourceDevis?.devisNumber, draft.devisNumber);
    assert.equal(converted.invoice.isSigned, true);
    assert.equal(converted.invoice.signatureUrl, signed.signatureUrl);
    assert.equal(converted.invoice.stampUrl, signed.stampUrl);
    assert.equal(Number(converted.invoice.total), Number(converted.devis.total));
    assert.equal(converted.invoice.items[0]?.description, converted.devis.items[0]?.description);

    const cancelConvertedSignature = await api<DevisResponse>(baseUrl, `/devis/${draft.id}/sign`, {
      method: 'DELETE',
      token: loginResponse.accessToken,
    });
    assert.equal(cancelConvertedSignature.status, 200);
    assert.equal(cancelConvertedSignature.body.data.devis.status, DevisStatus.CONVERTED);
    assert.equal(cancelConvertedSignature.body.data.devis.isSigned, false);
    assert.equal(cancelConvertedSignature.body.data.devis.signatureUrl, null);
    assert.equal(cancelConvertedSignature.body.data.devis.stampUrl, null);

    const linkedInvoiceAfterCancel = await prisma.invoice.findUniqueOrThrow({
      where: { id: converted.invoice.id },
      select: { isSigned: true, signatureUrl: true, stampUrl: true },
    });
    assert.equal(linkedInvoiceAfterCancel.isSigned, true);
    assert.equal(linkedInvoiceAfterCancel.signatureUrl, signed.signatureUrl);
    assert.equal(linkedInvoiceAfterCancel.stampUrl, signed.stampUrl);

    const duplicate = await api<ConvertResponse>(baseUrl, `/devis/${draft.id}/convert-to-invoice`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(duplicate.status, 409);

    const pdfResponse = await fetch(`${baseUrl}/devis/${draft.id}/pdf`, {
      headers: { Authorization: `Bearer ${loginResponse.accessToken}` },
    });
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
    assert.ok((await pdfResponse.arrayBuffer()).byteLength > 100);

    const rejectedDraft = await createDevis(baseUrl, loginResponse.accessToken, customer.id);
    createdDevisIds.push(rejectedDraft.id);
    const rejected = await postDevisAction(baseUrl, loginResponse.accessToken, rejectedDraft.id, 'reject');
    assert.equal(rejected.status, DevisStatus.REJECTED);
    const rejectedConversion = await api<ConvertResponse>(baseUrl, `/devis/${rejectedDraft.id}/convert-to-invoice`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(rejectedConversion.status, 400);

    const bulkDraftOne = await createDevis(baseUrl, loginResponse.accessToken, customer.id);
    const bulkDraftTwo = await createDevis(baseUrl, loginResponse.accessToken, customer.id);
    createdDevisIds.push(bulkDraftOne.id, bulkDraftTwo.id);
    assert.notEqual(bulkDraftOne.id, bulkDraftTwo.id);
    assert.notEqual(bulkDraftOne.devisNumber, bulkDraftTwo.devisNumber);

    const sameCustomerQuotes = await api<{ data: DevisResponse['devis'][]; meta: { total: number } }>(baseUrl, `/devis?customerId=${customer.id}`, {
      token: loginResponse.accessToken,
    });
    assert.equal(sameCustomerQuotes.status, 200);
    assert.ok(sameCustomerQuotes.body.data.meta.total >= 3);

    const bulkDelete = await api<DeleteDraftsResponse>(baseUrl, '/devis/drafts', {
      method: 'DELETE',
      token: loginResponse.accessToken,
    });
    assert.equal(bulkDelete.status, 200);
    assert.ok(bulkDelete.body.data.deletedCount >= 2);

    const deletedDraftLookup = await api<DevisResponse>(baseUrl, `/devis/${bulkDraftOne.id}`, {
      token: loginResponse.accessToken,
    });
    assert.equal(deletedDraftLookup.status, 404);

    const rejectedLookup = await api<DevisResponse>(baseUrl, `/devis/${rejectedDraft.id}`, {
      token: loginResponse.accessToken,
    });
    assert.equal(rejectedLookup.status, 200);
    assert.equal(rejectedLookup.body.data.devis.status, DevisStatus.REJECTED);

    console.log('devis workflow tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await prisma.$disconnect();
  }
}

async function seedUser() {
  const passwordHash = await bcrypt.hash(password, 4);
  await prisma.user.create({
    data: {
      name: 'Devis Workflow Admin',
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
      name: 'Devis Customer',
      email: customerEmail,
      company: `Devis Company ${runId}`,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });
  assert.equal(response.status, 201);
  return response.body.data.customer;
}

async function createDevis(baseUrl: string, token: string, customerId: string) {
  return createDevisWithDescription(baseUrl, token, customerId, 'Initial quote service');
}

async function createDevisWithDescription(baseUrl: string, token: string, customerId: string, description: string) {
  const response = await api<DevisResponse>(baseUrl, '/devis', {
    method: 'POST',
    token,
    body: devisPayload(customerId, description),
  });
  assert.equal(response.status, 201);
  return response.body.data.devis;
}

async function updateDevis(baseUrl: string, token: string, devisId: string, customerId: string) {
  const response = await api<DevisResponse>(baseUrl, `/devis/${devisId}`, {
    method: 'PATCH',
    token,
    body: devisPayload(customerId, 'Updated quote service'),
  });
  assert.equal(response.status, 200);
  return response.body.data.devis;
}

async function postDevisAction(baseUrl: string, token: string, devisId: string, action: 'send' | 'approve' | 'reject') {
  const response = await api<DevisResponse>(baseUrl, `/devis/${devisId}/${action}`, {
    method: 'POST',
    token,
  });
  assert.equal(response.status, 200);
  return response.body.data.devis;
}

async function configureCompanySignatureSnapshot() {
  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: 'Billing System',
      address: 'Test address',
      email: 'billing@example.com',
      signatureUrl: '/uploads/company-assets/devis-signature-test.png',
      stampUrl: '/uploads/company-assets/devis-stamp-test.png',
    },
    update: {
      signatureUrl: '/uploads/company-assets/devis-signature-test.png',
      stampUrl: '/uploads/company-assets/devis-stamp-test.png',
    },
  });
}

function devisPayload(customerId: string, description: string) {
  return {
    customerId,
    status: DevisStatus.DRAFT,
    issueDate: '2026-07-26',
    validUntil: '2026-08-26',
    discount: 25,
    currency: 'MAD',
    notes: 'Quote test notes',
    terms: 'Quote test terms',
    items: [
      {
        description,
        unit: 'service',
        quantity: 2,
        unitPrice: 150,
        discount: 10,
        taxRate: 20,
      },
    ],
  };
}

async function api<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
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
  await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
  await prisma.devis.deleteMany({ where: { id: { in: createdDevisIds } } });
  if (createdCustomerId) {
    await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
  }
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
