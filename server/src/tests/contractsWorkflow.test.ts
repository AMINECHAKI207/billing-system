import assert from 'assert/strict';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ContractBillingFrequency, ContractPricingType, ContractProrationPolicy, ContractStatus, PermissionScope, Role } from '@prisma/client';
import { env } from '@config/env';
import { prisma } from '@config/database';
import { settingsService } from '@modules/settings/settings.service';
import { contractService } from '@modules/contract/contract.service';
import { renderContractPdfBuffer } from '@modules/contract/contract.pdf';

const runId = Date.now();
const adminEmail = `contracts-admin-${runId}@example.com`;
const customerEmail = `contracts-client-${runId}@example.com`;

async function main() {
  const previousCompanyAssets = await prisma.companySettings.findUnique({
    where: { id: 1 },
    select: { signatureUrl: true, stampUrl: true },
  });
  await ensureCompanySettings();

  const admin = await prisma.user.create({
    data: {
      name: 'Contracts Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const client = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Contracts Client',
      email: customerEmail,
      company: 'Contracts Client SARL',
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  try {
    const templates = await contractService.listTemplates();
    assert.ok(templates.length >= 3);

    const created = await contractService.create(admin, PermissionScope.ALL, {
      clientId: client.id,
      templateId: templates[0]?.id,
      title: `Contrat test ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: today(),
      endDate: futureDate(30),
      renewalType: 'MANUAL',
      renewalNoticeDays: 15,
      amount: 2500,
      currency: 'MAD',
      pricingType: ContractPricingType.FIXED,
      fixedAmount: 2500,
      billingFrequency: ContractBillingFrequency.ONE_TIME,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      summary: 'Contrat de test automatise.',
      terms: 'Conditions contractuelles de test.',
      content: 'Ce contrat de test contient suffisamment de contenu pour etre valide.',
    });
    assert.equal(created.status, ContractStatus.DRAFT);
    assert.match(created.contractNumber, /^CTR-\d{4}-\d{4}$/);
    assert.equal(created.currentVersion?.versionNumber, 1);

    const updated = await contractService.update(created.id, admin, PermissionScope.ALL, {
      title: `Contrat test modifie ${runId}`,
      content: 'Contenu contractuel modifie avec une nouvelle version valide.',
    });
    assert.equal(updated.currentVersion?.versionNumber, 2);

    await prisma.companySettings.update({ where: { id: 1 }, data: { signatureUrl: null, stampUrl: null } });
    await assert.rejects(
      () => contractService.signForCompany(updated.id, admin, PermissionScope.ALL),
      /Company signature is required/
    );
    await ensureCompanySettings();

    const signedCompany = await contractService.signForCompany(updated.id, admin, PermissionScope.ALL);
    assert.equal(signedCompany.status, ContractStatus.DRAFT);
    assert.equal(signedCompany.currentVersion?.signatureStatus, 'COMPANY_SIGNED');
    assert.ok(signedCompany.currentVersion?.signedPdfHash);

    await assert.rejects(
      () => contractService.transition(updated.id, admin, PermissionScope.ALL, ContractStatus.SIGNED),
      /marked as signed directly/
    );

    const sent = await contractService.sendByEmail(signedCompany.id, admin, PermissionScope.ALL, {
      to: customerEmail,
      pdfLanguage: 'fr',
      signatureLinkExpiresInDays: 7,
    }, 'http://127.0.0.1:5173');
    assert.equal(sent.contract.status, ContractStatus.SENT);
    const emailHistory = await contractService.getEmailHistory(updated.id, admin.id, PermissionScope.ALL);
    assert.equal(emailHistory.length >= 1, true);
    const token = sent.signatureUrl.split('/').pop();
    assert.ok(token);

    await assert.rejects(
      () => contractService.update(updated.id, admin, PermissionScope.ALL, {
        title: 'Should fail',
      }),
      /Only draft contracts/
    );

    const viewed = await contractService.getPublicContract(token!);
    assert.equal(viewed.id, updated.id);

    const signed = await contractService.signPublicContract(token!, {
      signerName: 'Client Signer',
      signerEmail: customerEmail,
      accepted: true,
    });
    assert.equal(signed.status, ContractStatus.ACTIVE);
    assert.equal(signed.currentVersion?.signatureStatus, 'COMPLETED');

    const generatedInvoice = await contractService.generateBillingInvoice(signed.id, admin, PermissionScope.ALL, {
      periodStart: today(),
      periodEnd: futureDate(30),
    });
    assert.equal(generatedInvoice.contractId, signed.id);
    assert.equal(Number(generatedInvoice.subtotal), 2500);
    assert.equal(Number(generatedInvoice.taxRate), 20);
    await assert.rejects(
      () => contractService.generateBillingInvoice(signed.id, admin, PermissionScope.ALL, {
        periodStart: today(),
        periodEnd: futureDate(30),
      }),
      /already exists/
    );

    await assert.rejects(
      () => contractService.signPublicContract(token!, {
        signerName: 'Client Signer',
        signerEmail: customerEmail,
        accepted: true,
      }),
      /expired or unavailable/
    );

    const pdf = await renderContractPdfBuffer(signed, await settingsService.getCompanySettings(), 'fr');
    assert.ok(pdf.length > 1000);
    const preview = await contractService.previewPdf(signed.id, admin.id, PermissionScope.ALL, 'fr');
    assert.ok(preview.buffer.length > 1000);

    const revoked = await contractService.revokeSignature(signed.id, admin, PermissionScope.ALL, {
      reason: 'Correction contractuelle',
      internalNote: 'Test revocation',
      confirmed: true,
    });
    assert.equal(revoked.currentVersion?.signatureStatus, 'REVOKED');

    await assert.rejects(
      () => contractService.revokeSignature(revoked.id, admin, PermissionScope.ALL, {
        reason: '',
        confirmed: true,
      }),
      /required/
    );

    const terminated = await contractService.transition(revoked.id, admin, PermissionScope.ALL, ContractStatus.TERMINATED);
    assert.equal(terminated.status, ContractStatus.TERMINATED);

    const cancellable = await contractService.create(admin, PermissionScope.ALL, {
      clientId: client.id,
      title: `Contrat annulable ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: today(),
      endDate: futureDate(20),
      renewalType: 'NONE',
      amount: 500,
      currency: 'MAD',
      pricingType: ContractPricingType.FIXED,
      fixedAmount: 500,
      billingFrequency: ContractBillingFrequency.ONE_TIME,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      content: 'Ce contrat annulable contient suffisamment de contenu pour etre valide.',
    });
    const cancelled = await contractService.transition(cancellable.id, admin, PermissionScope.ALL, ContractStatus.CANCELLED);
    assert.equal(cancelled.status, ContractStatus.CANCELLED);

    await contractService.create(admin, PermissionScope.ALL, {
      clientId: client.id,
      title: `Contrat brouillon stats ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: today(),
      endDate: futureDate(15),
      renewalType: 'NONE',
      amount: 750,
      currency: 'MAD',
      pricingType: ContractPricingType.FIXED,
      fixedAmount: 750,
      billingFrequency: ContractBillingFrequency.ONE_TIME,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      content: 'Ce contrat brouillon permet de verifier les compteurs globaux.',
    });

    const listed = await contractService.list(admin.id, PermissionScope.ALL, {
      page: '1',
      limit: '1',
      search: String(runId),
    });
    assert.equal(listed.meta.total, 3);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.stats.DRAFT, 1);
    assert.equal(listed.stats.TERMINATED, 1);
    assert.equal(listed.stats.CANCELLED, 1);
    assert.equal(listed.stats.SIGNATURE_PENDING, 0);
    assert.equal(listed.stats.SIGNED, undefined);

    const found = await contractService.getById(signed.id, admin.id, PermissionScope.ALL);
    assert.equal(found.auditLogs?.some((event) => event.action === 'CLIENT_SIGNED'), true);
    assert.equal(found.auditLogs?.some((event) => event.action === 'PDF_PREVIEWED'), true);
  } finally {
    await prisma.contractEmailLog.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractAuditLog.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractSignatureLink.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: client.id } } });
    await prisma.invoice.deleteMany({ where: { customerId: client.id } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contract.deleteMany({ where: { clientId: client.id } });
    await prisma.customer.delete({ where: { id: client.id } });
    await prisma.user.delete({ where: { id: admin.id } });
    if (previousCompanyAssets) {
      await prisma.companySettings.update({
        where: { id: 1 },
        data: previousCompanyAssets,
      });
    }
  }
}

async function ensureCompanySettings() {
  const signatureUrl = await ensureTestAsset('signature');
  const stampUrl = await ensureTestAsset('stamp');
  await prisma.companySettings.upsert({
    where: { id: 1 },
    update: { signatureUrl, stampUrl },
    create: {
      id: 1,
      name: 'Atlas Digital Services',
      address: 'Casablanca',
      phone: '+212 522 000 111',
      email: 'billing@example.com',
      taxNumber: 'IF: TEST',
      defaultCurrency: 'MAD',
      defaultTaxRate: 20,
      vatEnabled: true,
      moroccoVatRate: 20,
      signatureUrl,
      stampUrl,
    },
  });
}

async function ensureTestAsset(kind: 'signature' | 'stamp') {
  const directory = path.resolve(process.cwd(), env.UPLOADS_DIR, 'company-assets');
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${kind}-contract-test.png`;
  const filePath = path.join(directory, fileName);
  const svg = kind === 'signature'
    ? `<svg width="360" height="140" viewBox="0 0 360 140" xmlns="http://www.w3.org/2000/svg">
        <rect width="360" height="140" fill="none"/>
        <path d="M32 92 C80 28, 112 116, 160 62 S238 52, 328 86" fill="none" stroke="#065f46" stroke-width="8" stroke-linecap="round"/>
        <path d="M58 104 H312" stroke="#047857" stroke-width="3" stroke-linecap="round"/>
      </svg>`
    : `<svg width="240" height="240" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
        <rect width="240" height="240" fill="none"/>
        <circle cx="120" cy="120" r="82" fill="none" stroke="#065f46" stroke-width="10"/>
        <circle cx="120" cy="120" r="58" fill="none" stroke="#10b981" stroke-width="4"/>
        <text x="120" y="116" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="#065f46">TEST</text>
        <text x="120" y="146" text-anchor="middle" font-family="Arial" font-size="18" fill="#047857">STAMP</text>
      </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(filePath, png);
  return `/uploads/company-assets/${fileName}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

main()
  .then(() => {
    console.log('Contracts workflow tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
