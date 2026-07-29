import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import http from 'http';
import { AddressInfo } from 'net';
import { ExpenseNoteStatus, ExpenseSource, Role } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '@config/database';
import { sanitizeExcelString } from '@utils/excel';

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message: string;
};

type LoginResponse = {
  user: { id: string; email: string; role: Role };
  accessToken: string;
};

type CategoryResponse = {
  category: { id: string; name: string; active: boolean };
};

type TypeResponse = {
  type: { id: string; categoryId: string; name: string; active: boolean };
};

type NoteResponse = {
  expenseNote: {
    id: string;
    categoryId: string;
    expenseTypeId: string;
    amountTTC: string | number;
    vatAmount: string | number;
    source: ExpenseSource;
    status: ExpenseNoteStatus;
    merchantName?: string | null;
    rejectionReason?: string | null;
    changesRequestedReason?: string | null;
    auditLogs?: Array<{ action: string; reason?: string | null }>;
  };
};

const runId = Date.now();
const adminEmail = `expense-admin-${runId}@example.com`;
const employeeEmail = `expense-employee-${runId}@example.com`;
const otherEmployeeEmail = `expense-other-${runId}@example.com`;
const password = 'ExpenseNotes123!';
const createdCategoryIds: string[] = [];
const createdTypeIds: string[] = [];
const createdNoteIds: string[] = [];

async function main() {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    assert.equal(sanitizeExcelString('=SUM(A1:A2)'), "'=SUM(A1:A2)");
    assert.equal(sanitizeExcelString(' +CMD'), "' +CMD");
    assert.equal(sanitizeExcelString('-10'), "'-10");
    assert.equal(sanitizeExcelString('@merchant'), "'@merchant");
    assert.equal(sanitizeExcelString('Safe Merchant'), 'Safe Merchant');

    await seedUsers();
    const loginResponse = await login(baseUrl, adminEmail);
    const employeeLogin = await login(baseUrl, employeeEmail);
    const otherEmployeeLogin = await login(baseUrl, otherEmployeeEmail);

    const category = await createCategory(baseUrl, loginResponse.accessToken, `Expense Test ${runId}`);
    createdCategoryIds.push(category.id);
    const type = await createType(baseUrl, loginResponse.accessToken, category.id, `Taxi Test ${runId}`);
    createdTypeIds.push(type.id);

    const otherCategory = await createCategory(baseUrl, loginResponse.accessToken, `Expense Other ${runId}`);
    createdCategoryIds.push(otherCategory.id);

    const invalidRelation = await api<NoteResponse>(baseUrl, '/expense-notes', {
      method: 'POST',
      token: loginResponse.accessToken,
      body: notePayload(otherCategory.id, type.id),
    });
    assert.equal(invalidRelation.status, 400);

    const created = await api<NoteResponse>(baseUrl, '/expense-notes', {
      method: 'POST',
      token: loginResponse.accessToken,
      body: notePayload(category.id, type.id),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.expenseNote.status, ExpenseNoteStatus.DRAFT);
    assert.equal(created.body.data.expenseNote.categoryId, category.id);
    assert.equal(created.body.data.expenseNote.expenseTypeId, type.id);
    assert.equal(Number(created.body.data.expenseNote.amountTTC), 120);
    assert.equal(Number(created.body.data.expenseNote.vatAmount), 20);
    createdNoteIds.push(created.body.data.expenseNote.id);

    const updated = await api<NoteResponse>(baseUrl, `/expense-notes/${created.body.data.expenseNote.id}`, {
      method: 'PATCH',
      token: loginResponse.accessToken,
      body: { merchantName: 'Updated Merchant' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.expenseNote.merchantName, 'Updated Merchant');

    const list = await api<{ data: NoteResponse['expenseNote'][]; meta: { total: number } }>(baseUrl, '/expense-notes?search=Updated%20Merchant', {
      token: loginResponse.accessToken,
    });
    assert.equal(list.status, 200);
    assert.ok(list.body.data.meta.total >= 1);

    const invalidUpload = new FormData();
    invalidUpload.append('receipt', new Blob(['not a receipt'], { type: 'text/plain' }), 'receipt.txt');
    const uploadResponse = await fetch(`${baseUrl}/expense-notes/analyze-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginResponse.accessToken}` },
      body: invalidUpload,
    });
    assert.equal(uploadResponse.status, 400);

    const deleted = await api<never>(baseUrl, `/expense-notes/${created.body.data.expenseNote.id}`, {
      method: 'DELETE',
      token: loginResponse.accessToken,
    });
    assert.equal(deleted.status, 204);
    createdNoteIds.splice(createdNoteIds.indexOf(created.body.data.expenseNote.id), 1);

    const employeeCreated = await api<NoteResponse>(baseUrl, '/expense-notes', {
      method: 'POST',
      token: employeeLogin.accessToken,
      body: notePayload(category.id, type.id),
    });
    assert.equal(employeeCreated.status, 201);
    createdNoteIds.push(employeeCreated.body.data.expenseNote.id);

    const otherEmployeeLookup = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}`, {
      token: otherEmployeeLogin.accessToken,
    });
    assert.equal(otherEmployeeLookup.status, 404);

    const invalidIdLookup = await api<NoteResponse>(baseUrl, '/expense-notes/not-a-uuid', {
      token: employeeLogin.accessToken,
    });
    assert.equal(invalidIdLookup.status, 400);

    const unauthorizedBulkExport = await api<unknown>(baseUrl, '/expense-notes/export', {
      method: 'POST',
      token: otherEmployeeLogin.accessToken,
      body: { ids: [employeeCreated.body.data.expenseNote.id], format: 'excel' },
    });
    assert.equal(unauthorizedBulkExport.status, 403);

    const employeeApprove = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/approve`, {
      method: 'POST',
      token: employeeLogin.accessToken,
    });
    assert.equal(employeeApprove.status, 403);

    const submitted = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/submit`, {
      method: 'POST',
      token: employeeLogin.accessToken,
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.expenseNote.status, ExpenseNoteStatus.SUBMITTED);

    const adminSubmittedList = await api<{ data: NoteResponse['expenseNote'][]; meta: { total: number } }>(baseUrl, '/expense-notes?status=SUBMITTED', {
      token: loginResponse.accessToken,
    });
    assert.equal(adminSubmittedList.status, 200);
    assert.ok(adminSubmittedList.body.data.data.some((note) => note.id === employeeCreated.body.data.expenseNote.id));

    const requestWithoutReason = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/request-changes`, {
      method: 'POST',
      token: loginResponse.accessToken,
      body: { reason: '' },
    });
    assert.equal(requestWithoutReason.status, 400);

    const changes = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/request-changes`, {
      method: 'POST',
      token: loginResponse.accessToken,
      body: { reason: 'Please correct the merchant name.' },
    });
    assert.equal(changes.status, 200);
    assert.equal(changes.body.data.expenseNote.status, ExpenseNoteStatus.CHANGES_REQUESTED);
    assert.equal(changes.body.data.expenseNote.changesRequestedReason, 'Please correct the merchant name.');

    const employeeCorrection = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}`, {
      method: 'PATCH',
      token: employeeLogin.accessToken,
      body: { merchantName: 'Corrected Merchant' },
    });
    assert.equal(employeeCorrection.status, 400);

    const resubmitted = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/submit`, {
      method: 'POST',
      token: employeeLogin.accessToken,
    });
    assert.equal(resubmitted.status, 200);
    assert.equal(resubmitted.body.data.expenseNote.status, ExpenseNoteStatus.SUBMITTED);

    const rejectWithoutReason = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/reject`, {
      method: 'POST',
      token: loginResponse.accessToken,
      body: { reason: '' },
    });
    assert.equal(rejectWithoutReason.status, 400);

    const approved = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/approve`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.expenseNote.status, ExpenseNoteStatus.APPROVED);

    const employeeApprovedEdit = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}`, {
      method: 'PATCH',
      token: employeeLogin.accessToken,
      body: { merchantName: 'Forbidden Merchant' },
    });
    assert.equal(employeeApprovedEdit.status, 400);

    const paid = await api<NoteResponse>(baseUrl, `/expense-notes/${employeeCreated.body.data.expenseNote.id}/mark-paid`, {
      method: 'POST',
      token: loginResponse.accessToken,
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.data.expenseNote.status, ExpenseNoteStatus.PAID);
    assert.ok((paid.body.data.expenseNote.auditLogs ?? []).some((log) => log.action === 'PAID'));

    console.log('expense notes tests passed');
  } finally {
    await cleanup();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
    });
    await prisma.$disconnect();
  }
}

async function seedUsers() {
  const [adminRole, employeeRole] = await Promise.all([
    prisma.rbacRole.findUniqueOrThrow({ where: { name: 'ADMIN' } }),
    prisma.rbacRole.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } }),
  ]);
  await prisma.user.create({
    data: {
      name: 'Expense Admin',
      email: adminEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: Role.ADMIN,
      rbacRoleId: adminRole.id,
    },
  });
  await prisma.user.createMany({
    data: [
      {
        name: 'Expense Employee',
        email: employeeEmail,
        passwordHash: await bcrypt.hash(password, 12),
        role: Role.EMPLOYEE,
        rbacRoleId: employeeRole.id,
      },
      {
        name: 'Other Expense Employee',
        email: otherEmployeeEmail,
        passwordHash: await bcrypt.hash(password, 12),
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

async function createCategory(baseUrl: string, token: string, name: string) {
  const response = await api<CategoryResponse>(baseUrl, '/expense-notes/categories', {
    method: 'POST',
    token,
    body: { name },
  });
  assert.equal(response.status, 201);
  return response.body.data.category;
}

async function createType(baseUrl: string, token: string, categoryId: string, name: string) {
  const response = await api<TypeResponse>(baseUrl, '/expense-notes/types', {
    method: 'POST',
    token,
    body: { categoryId, name },
  });
  assert.equal(response.status, 201);
  return response.body.data.type;
}

function notePayload(categoryId: string, expenseTypeId: string) {
  return {
    categoryId,
    expenseTypeId,
    expenseDate: '2026-07-28',
    amountTTC: 120,
    amountHT: 100,
    vatAmount: 20,
    vatRate: 20,
    merchantName: 'Test Merchant',
    receiptNumber: `NF-${runId}`,
    currency: 'MAD',
    comment: 'Manual expense note test',
    source: ExpenseSource.MANUAL,
  };
}

async function cleanup() {
  await prisma.expenseAuditLog.deleteMany({ where: { expenseNoteId: { in: createdNoteIds } } });
  await prisma.expenseAIAnalysis.deleteMany({ where: { requestedBy: { email: { in: [adminEmail, employeeEmail, otherEmployeeEmail] } } } });
  await prisma.expenseAttachment.deleteMany({ where: { uploadedBy: { email: { in: [adminEmail, employeeEmail, otherEmployeeEmail] } } } });
  await prisma.expenseNote.deleteMany({ where: { id: { in: createdNoteIds } } });
  await prisma.expenseType.deleteMany({ where: { id: { in: createdTypeIds } } });
  await prisma.expenseCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, employeeEmail, otherEmployeeEmail] } } });
}

async function api<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
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
  const body = text ? JSON.parse(text) as ApiEnvelope<T> : ({} as ApiEnvelope<T>);
  return { status: response.status, body };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
