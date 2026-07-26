import assert from 'assert/strict';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import zlib from 'zlib';
import { InvoiceStatus, PermissionScope, Role } from '@prisma/client';

let prisma: typeof import('@config/database').prisma;
let createApp: typeof import('../app').createApp;
let shutdownBackgroundRemovalWorker: typeof import('@services/backgroundRemoval.service').shutdownBackgroundRemovalWorker;

type LoginResponse = {
  user: { id: string; email: string; role: Role };
  accessToken: string;
};

type SettingsUploadResponse = {
  settings: {
    name?: string;
    signatureUrl?: string | null;
    stampUrl?: string | null;
  };
};

type SignInvoiceResponse = {
  invoice: {
    id: string;
    invoiceNumber: string;
    isSigned: boolean;
    signatureUrl?: string | null;
    stampUrl?: string | null;
    signedBy?: { email: string };
  };
};

const password = 'SignatureTest123!';
const runId = randomUUID();
const adminEmail = `signature-admin-${runId}@example.com`;
const employeeEmail = `signature-employee-${runId}@example.com`;
const pngBuffer = createPngBuffer();

async function main() {
  process.env.AI_BACKGROUND_REMOVAL_IMAGE_SIZE = '384';
  process.env.AI_BACKGROUND_REMOVAL_MODEL = 'ZhengPeng7/BiRefNet_lite';
  process.env.AI_BACKGROUND_REMOVAL_TIMEOUT_MS = '240000';

  ({ prisma } = await import('@config/database'));
  ({ createApp } = await import('../app'));
  ({ shutdownBackgroundRemovalWorker } = await import('@services/backgroundRemoval.service'));

  const passwordHash = await bcrypt.hash(password, 12);
  const [admin, employee] = await prisma.user.createManyAndReturn({
    data: [
      { name: 'Signature Admin', email: adminEmail, passwordHash, role: Role.ADMIN },
      { name: 'Signature Employee', email: employeeEmail, passwordHash, role: Role.EMPLOYEE },
    ],
  });

    assert.ok(admin);
    assert.ok(employee);

  const [adminRole, employeeRole] = await Promise.all([
  prisma.rbacRole.findUniqueOrThrow({
    where: { name: 'ADMIN' },
  }),
  prisma.rbacRole.findUniqueOrThrow({
    where: { name: 'EMPLOYEE' },
  }),
]);

const signPermission = await prisma.permission.upsert({
  where: { key: 'invoices.sign' },
  update: {},
  create: {
    key: 'invoices.sign',
    resource: 'invoices',
    action: 'sign',
    description: 'Sign invoices',
  },
});

await prisma.rolePermission.upsert({
  where: {
    roleId_permissionId: {
      roleId: adminRole.id,
      permissionId: signPermission.id,
    },
  },
  update: {
    scope: PermissionScope.ALL,
  },
  create: {
    roleId: adminRole.id,
    permissionId: signPermission.id,
    scope: PermissionScope.ALL,
  },
});

const updatePermission = await prisma.permission.upsert({
  where: { key: 'invoices.update' },
  update: {},
  create: {
    key: 'invoices.update',
    resource: 'invoices',
    action: 'update',
    description: 'Update invoices',
  },
});

await prisma.rolePermission.upsert({
  where: {
    roleId_permissionId: {
      roleId: adminRole.id,
      permissionId: updatePermission.id,
    },
  },
  update: {
    scope: PermissionScope.ALL,
  },
  create: {
    roleId: adminRole.id,
    permissionId: updatePermission.id,
    scope: PermissionScope.ALL,
  },
});

await prisma.user.update({
  where: { id: admin.id },
  data: { rbacRoleId: adminRole.id },
});

await prisma.user.update({
  where: { id: employee.id },
  data: { rbacRoleId: employeeRole.id },
});



  const customer = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Signature Customer',
      email: `signature-customer-${runId}@example.com`,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const unsignedInvoice = await createInvoice(admin.id, customer.id, `SIG-${runId}-UNSIGNED`);
  const invoiceWithoutAssets = await createInvoice(admin.id, customer.id, `SIG-${runId}-NO-ASSETS`);
  const invoiceToSign = await createInvoice(admin.id, customer.id, `SIG-${runId}-SIGNED`);
  const invoiceToUnsign = await createInvoice(admin.id, customer.id, `SIG-${runId}-UNSIGN`);
  const invoiceForSnapshot = await createInvoice(admin.id, customer.id, `SIG-${runId}-SNAPSHOT`);

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const adminLogin = await login(baseUrl, adminEmail);
    const employeeLogin = await login(baseUrl, employeeEmail);

    await resetCompanyAssets();

    const settingsUpdate = await api<SettingsUploadResponse>(baseUrl, '/settings/company', {
      method: 'PUT',
      token: adminLogin.accessToken,
      body: JSON.stringify({
        name: 'Billing System Test',
        address: '',
        phone: '',
        email: '',
        taxNumber: '',
        logoUrl: '',
        signatureUrl: '/uploads/company-assets/ignored.png',
        stampUrl: '/uploads/company-assets/ignored.png',
        defaultCurrency: 'MAD',
        defaultTaxRate: 20,
        paymentTerms: '',
        bankDetails: '',
      }),
    });
    assert.equal(settingsUpdate.status, 200);
    assert.equal(settingsUpdate.body.data.settings.signatureUrl, null);
    assert.equal(settingsUpdate.body.data.settings.stampUrl, null);

    const reloadedSettings = await api<SettingsUploadResponse>(baseUrl, '/settings/company', {
      method: 'GET',
      token: adminLogin.accessToken,
    });
    assert.equal(reloadedSettings.status, 200);
    assert.equal(reloadedSettings.body.data.settings.name, 'Billing System Test');

    const signWithoutAssets = await api(baseUrl, `/invoices/${invoiceWithoutAssets.id}/sign`, {
      method: 'POST',
      token: adminLogin.accessToken,
    });
    assert.equal(signWithoutAssets.status, 400);

    const employeeUpload = await uploadAsset(baseUrl, '/settings/company/signature', employeeLogin.accessToken, pngBuffer);
    assert.equal(employeeUpload.status, 403);

    const invalidUpload = await uploadAsset(
      baseUrl,
      '/settings/company/signature',
      adminLogin.accessToken,
      Buffer.from('not an image'),
      'signature.txt',
      'text/plain'
    );
    assert.equal(invalidUpload.status, 400);

    const largeUpload = await uploadAsset(
      baseUrl,
      '/settings/company/stamp',
      adminLogin.accessToken,
      Buffer.alloc(2 * 1024 * 1024 + 1),
      'stamp.png',
      'image/png'
    );
    assert.equal(largeUpload.status, 400);

    const previewRemoval = await uploadAssetBuffer(
      baseUrl,
      '/settings/company/remove-background-preview',
      adminLogin.accessToken,
      pngBuffer,
      'preview.png',
      'image/png'
    );
    assert.equal(previewRemoval.status, 200);
    assert.equal(previewRemoval.contentType.includes('image/png'), true);
    assert.ok((await countPngTransparentPixels(previewRemoval.buffer)) > 0);

    const signatureUpload = await uploadAsset(
      baseUrl,
      '/settings/company/signature',
      adminLogin.accessToken,
      previewRemoval.buffer,
      'signature-transparent.png',
      'image/png'
    );
    assert.equal(signatureUpload.status, 200);
    assert.ok(signatureUpload.body.data.settings.signatureUrl);
    assert.match(signatureUpload.body.data.settings.signatureUrl, /\.png$/);
    assert.ok(await countTransparentPixels(signatureUpload.body.data.settings.signatureUrl) > 0);

    const stampUpload = await uploadAsset(
      baseUrl,
      '/settings/company/stamp',
      adminLogin.accessToken,
      previewRemoval.buffer,
      'stamp-transparent.png',
      'image/png'
    );
    assert.equal(stampUpload.status, 200);
    assert.ok(stampUpload.body.data.settings.stampUrl);
    assert.match(stampUpload.body.data.settings.stampUrl, /\.png$/);
    assert.ok(await countTransparentPixels(stampUpload.body.data.settings.stampUrl) > 0);

    const employeeSign = await api(baseUrl, `/invoices/${invoiceToSign.id}/sign`, {
      method: 'POST',
      token: employeeLogin.accessToken,
    });
    assert.equal(employeeSign.status, 403);

    const signResult = await api<SignInvoiceResponse>(baseUrl, `/invoices/${invoiceToSign.id}/sign`, {
      method: 'POST',
      token: adminLogin.accessToken,
    });
    assert.equal(signResult.status, 200);
    assert.equal(signResult.body.data.invoice.isSigned, true);
    assert.ok(signResult.body.data.invoice.signedBy);
    assert.equal(signResult.body.data.invoice.signedBy.email, adminEmail);
    assert.ok(signResult.body.data.invoice.signatureUrl);
    assert.ok(signResult.body.data.invoice.stampUrl);

    const signAgain = await api(baseUrl, `/invoices/${invoiceToSign.id}/sign`, {
      method: 'POST',
      token: adminLogin.accessToken,
    });
    assert.equal(signAgain.status, 409);

    const signForCancel = await api<SignInvoiceResponse>(baseUrl, `/invoices/${invoiceToUnsign.id}/sign`, {
      method: 'POST',
      token: adminLogin.accessToken,
    });
    assert.equal(signForCancel.status, 200);
    assert.equal(signForCancel.body.data.invoice.isSigned, true);

    const employeeCancelSignature = await api(baseUrl, `/invoices/${invoiceToUnsign.id}/sign`, {
      method: 'DELETE',
      token: employeeLogin.accessToken,
    });
    assert.equal(employeeCancelSignature.status, 403);

    const cancelSignature = await api<SignInvoiceResponse>(baseUrl, `/invoices/${invoiceToUnsign.id}/sign`, {
      method: 'DELETE',
      token: adminLogin.accessToken,
    });
    assert.equal(cancelSignature.status, 200);
    assert.equal(cancelSignature.body.data.invoice.isSigned, false);
    assert.equal(cancelSignature.body.data.invoice.signatureUrl, null);
    assert.equal(cancelSignature.body.data.invoice.stampUrl, null);

    const cancelSignatureAgain = await api(baseUrl, `/invoices/${invoiceToUnsign.id}/sign`, {
      method: 'DELETE',
      token: adminLogin.accessToken,
    });
    assert.equal(cancelSignatureAgain.status, 409);

    const unsignedAfterCancelPdf = await apiBuffer(baseUrl, `/invoices/${invoiceToUnsign.id}/pdf`, adminLogin.accessToken);
    assert.equal(unsignedAfterCancelPdf.status, 200);
    assert.equal(countPdfImages(unsignedAfterCancelPdf.buffer), 0);

    const unsignedPdf = await apiBuffer(baseUrl, `/invoices/${unsignedInvoice.id}/pdf`, adminLogin.accessToken);
    assert.equal(unsignedPdf.status, 200);
    assert.equal(countPdfPages(unsignedPdf.buffer), 1);
    assert.equal(countPdfImages(unsignedPdf.buffer), 0);

    const signedPdf = await apiBuffer(baseUrl, `/invoices/${invoiceToSign.id}/pdf`, adminLogin.accessToken);
    assert.equal(signedPdf.status, 200);
    assert.equal(countPdfPages(signedPdf.buffer), 1);
    assert.ok(countPdfImages(signedPdf.buffer) >= 2);
    assert.ok(signedPdf.buffer.length > unsignedPdf.buffer.length);

    const snapshotSign = await api<SignInvoiceResponse>(baseUrl, `/invoices/${invoiceForSnapshot.id}/sign`, {
      method: 'POST',
      token: adminLogin.accessToken,
    });
    assert.equal(snapshotSign.status, 200);
    const snapshotSignatureUrl = snapshotSign.body.data.invoice.signatureUrl;

    const replacementUpload = await uploadAsset(
      baseUrl,
      '/settings/company/signature',
      adminLogin.accessToken,
      pngBuffer,
      'replacement.png'
    );
    assert.equal(replacementUpload.status, 200);
    assert.notEqual(replacementUpload.body.data.settings.signatureUrl, snapshotSignatureUrl);

    const snapshotInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceForSnapshot.id },
      select: { signatureUrl: true },
    });
    assert.equal(snapshotInvoice.signatureUrl, snapshotSignatureUrl);

    console.log('invoice signature and stamp tests passed');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await prisma.invoice.deleteMany({
      where: {
        invoiceNumber: {
          in: [
            unsignedInvoice.invoiceNumber,
            invoiceWithoutAssets.invoiceNumber,
            invoiceToSign.invoiceNumber,
            invoiceToUnsign.invoiceNumber,
            invoiceForSnapshot.invoiceNumber,
          ],
        },
      },
    });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, employeeEmail] } } });
    await resetCompanyAssets();
    shutdownBackgroundRemovalWorker();
    await prisma.$disconnect();
  }
}

async function createInvoice(createdById: string, customerId: string, invoiceNumber: string) {
  return prisma.invoice.create({
    data: {
      customerId,
      createdById,
      invoiceNumber,
      status: InvoiceStatus.SENT,
      issueDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-31'),
      subtotal: 1000,
      taxRate: 20,
      taxAmount: 200,
      discount: 0,
      total: 1200,
      amountPaid: 0,
      balanceDue: 1200,
      currency: 'MAD',
      sentAt: new Date('2026-07-01'),
      items: {
        create: [
          {
            description: 'Prestation signature',
            unit: 'forfait',
            quantity: 1,
            unitPrice: 1000,
            taxRate: 20,
            total: 1200,
            sortOrder: 1,
          },
        ],
      },
    },
  });
}

async function resetCompanyAssets() {
  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: 'Billing System Demo',
      defaultCurrency: 'MAD',
      defaultTaxRate: 20,
      signatureUrl: null,
      stampUrl: null,
    },
    update: {
      signatureUrl: null,
      stampUrl: null,
    },
  });
}

async function login(baseUrl: string, email: string) {
  const response = await api<LoginResponse>(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  assert.equal(response.status, 200);
  return response.body.data;
}

async function uploadAsset(
  baseUrl: string,
  path: string,
  token: string,
  content: Buffer,
  fileName = 'signature.png',
  type = 'image/png'
) {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type }), fileName);

  return api<SettingsUploadResponse>(baseUrl, path, {
    method: 'POST',
    token,
    body: formData,
  });
}

async function uploadAssetBuffer(
  baseUrl: string,
  path: string,
  token: string,
  content: Buffer,
  fileName = 'signature.png',
  type = 'image/png'
) {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type }), fileName);

  const response = await fetch(`${baseUrl}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    buffer,
  };
}

async function api<T = Record<string, unknown>>(
  baseUrl: string,
  path: string,
  options: {
    method: string;
    token?: string;
    body?: string | FormData;
  }
) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: options.method,
    headers: {
      ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body,
  });

  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body as { data: T; message?: string } };
}

async function apiBuffer(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, buffer };
}

function countPdfImages(buffer: Buffer) {
  const content = buffer.toString('latin1');
  return content.match(/\/Subtype\s*\/Image/g)?.length ?? 0;
}

function countPdfPages(buffer: Buffer) {
  const content = buffer.toString('latin1');
  return content.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

async function countTransparentPixels(assetUrl?: string | null) {
  assert.ok(assetUrl);
  const assetPath = path.resolve(process.cwd(), assetUrl.replace(/^\//, ''));
  assert.equal(fs.existsSync(assetPath), true);

  const { data } = await sharp(assetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let transparent = 0;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 255) < 245) transparent += 1;
  }

  return transparent;
}

async function countPngTransparentPixels(buffer: Buffer) {
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let transparent = 0;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 255) < 245) transparent += 1;
  }

  return transparent;
}

function createPngBuffer() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  const width = 24;
  const height = 16;
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4, 255);
    row[0] = 0;

    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const isMark = x >= 7 && x <= 17 && y >= 5 && y <= 10;
      row[offset] = isMark ? 15 : 255;
      row[offset + 1] = isMark ? 30 : 255;
      row[offset + 2] = isMark ? 60 : 255;
      row[offset + 3] = 255;
    }

    rows.push(row);
  }

  const idat = zlib.deflateSync(Buffer.concat(rows));

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

main().catch(async (error) => {
  console.error(error);
  await prisma?.$disconnect();
  process.exit(1);
});
