import assert from 'assert/strict';
import { CreditNoteStatus, CreditNoteType, InvoiceStatus, PermissionScope, Role } from '@prisma/client';
import { prisma } from '@config/database';
import { creditNoteService } from '@modules/credit-note/creditNote.service';

const runId = Date.now();
const adminEmail = `credit-note-admin-${runId}@example.com`;
const customerEmail = `credit-note-customer-${runId}@example.com`;

async function main() {
  const reason = await seedReason();
  const otherReason = await seedOtherReason();
  const requiredCommentReason = await seedRequiredCommentReason();
  const admin = await prisma.user.create({
    data: {
      name: 'Credit Note Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Credit Note Customer',
      email: customerEmail,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const draftInvoice = await createInvoice(admin.id, customer.id, InvoiceStatus.DRAFT, 1200);
  await assert.rejects(
    () => creditNoteService.create(admin.id, PermissionScope.ALL, {
      invoiceId: draftInvoice.id,
      type: CreditNoteType.FULL,
      issueDate: today(),
      reasonId: reason.id,
      reason: 'Draft invoice test',
    }),
    /Draft or cancelled invoices/
  );

  const invoice = await createInvoice(admin.id, customer.id, InvoiceStatus.SENT, 1200);
  const normalWithoutExplanation = await creditNoteService.create(admin.id, PermissionScope.ALL, {
    invoiceId: invoice.id,
    type: CreditNoteType.PARTIAL,
    issueDate: today(),
    reasonId: reason.id,
    amountTTC: 50,
  });
  assert.equal(normalWithoutExplanation.status, CreditNoteStatus.DRAFT);
  assert.equal(normalWithoutExplanation.reason, 'Remise commerciale');

  await assert.rejects(
    () => creditNoteService.create(admin.id, PermissionScope.ALL, {
      invoiceId: invoice.id,
      type: CreditNoteType.PARTIAL,
      issueDate: today(),
      reasonId: otherReason.id,
      amountTTC: 50,
    }),
    /requires a detailed explanation/
  );

  const otherWithExplanation = await creditNoteService.create(admin.id, PermissionScope.ALL, {
    invoiceId: invoice.id,
    type: CreditNoteType.PARTIAL,
    issueDate: today(),
    reasonId: otherReason.id,
    reason: 'Customer-specific adjustment after invoice review',
    amountTTC: 50,
  });
  assert.equal(otherWithExplanation.status, CreditNoteStatus.DRAFT);

  await assert.rejects(
    () => creditNoteService.create(admin.id, PermissionScope.ALL, {
      invoiceId: invoice.id,
      type: CreditNoteType.PARTIAL,
      issueDate: today(),
      reasonId: requiredCommentReason.id,
      amountTTC: 50,
    }),
    /requires a detailed explanation/
  );

  const requiredCommentWithExplanation = await creditNoteService.create(admin.id, PermissionScope.ALL, {
    invoiceId: invoice.id,
    type: CreditNoteType.PARTIAL,
    issueDate: today(),
    reasonId: requiredCommentReason.id,
    reason: 'Correcting a duplicated invoice issued to the same customer',
    amountTTC: 50,
  });
  assert.equal(requiredCommentWithExplanation.status, CreditNoteStatus.DRAFT);

  const draftCredit = await creditNoteService.create(admin.id, PermissionScope.ALL, {
    invoiceId: invoice.id,
    type: CreditNoteType.PARTIAL,
    issueDate: today(),
    reasonId: reason.id,
    reason: 'Commercial discount',
    amountTTC: 300,
  });
  assert.equal(draftCredit.status, CreditNoteStatus.DRAFT);
  assert.match(draftCredit.creditNoteNumber, /^CN-\d{4}-\d{4}$/);

  const validated = await creditNoteService.validate(draftCredit.id, admin.id, PermissionScope.ALL);
  assert.equal(validated.status, CreditNoteStatus.VALIDATED);

  await assert.rejects(
    () => creditNoteService.create(admin.id, PermissionScope.ALL, {
      invoiceId: invoice.id,
      type: CreditNoteType.PARTIAL,
      issueDate: today(),
      reasonId: reason.id,
      reason: 'Too high credit',
      amountTTC: 1000,
    }),
    /remaining creditable/
  );

  const refunded = await creditNoteService.refund(validated.id, admin.id, PermissionScope.ALL, {
    amount: 120,
    refundDate: today(),
    comment: 'Partial refund',
  });
  assert.equal(Number(refunded.refundedAmount), 120);

  await assert.rejects(
    () => creditNoteService.refund(validated.id, admin.id, PermissionScope.ALL, {
      amount: 1200,
      refundDate: today(),
    }),
    /cannot exceed/
  );

  const removableDraft = await creditNoteService.create(admin.id, PermissionScope.ALL, {
    invoiceId: invoice.id,
    type: CreditNoteType.PARTIAL,
    issueDate: today(),
    reasonId: reason.id,
    reason: 'Draft removal',
    amountTTC: 100,
  });
  const removal = await creditNoteService.remove(removableDraft.id, admin.id, PermissionScope.ALL);
  assert.equal(removal.deleted, true);

  const inactiveReason = await prisma.creditNoteReason.create({
    data: {
      code: `INACTIVE_${runId}`,
      nameFr: 'Motif inactif',
      nameEn: 'Inactive reason',
      nameAr: 'Motif inactif',
      isActive: false,
      requiresComment: false,
      sortOrder: 999,
    },
  });
  await assert.rejects(
    () => creditNoteService.create(admin.id, PermissionScope.ALL, {
      invoiceId: invoice.id,
      type: CreditNoteType.PARTIAL,
      issueDate: today(),
      reasonId: inactiveReason.id,
      reason: 'Inactive reason test',
      amountTTC: 50,
    }),
    /Inactive credit note reasons/
  );

  await cleanup();
  console.log('credit notes workflow tests passed');
}

async function seedReason() {
  return prisma.creditNoteReason.upsert({
    where: { code: 'COMMERCIAL_DISCOUNT' },
    update: { isActive: true },
    create: {
      code: 'COMMERCIAL_DISCOUNT',
      nameFr: 'Remise commerciale',
      nameEn: 'Commercial discount',
      nameAr: 'Remise commerciale',
      category: 'COMMERCIAL',
      isActive: true,
      isSystem: true,
      requiresComment: false,
      sortOrder: 70,
    },
  });
}

async function seedOtherReason() {
  return prisma.creditNoteReason.upsert({
    where: { code: 'OTHER' },
    update: { isActive: true, requiresComment: true },
    create: {
      code: 'OTHER',
      nameFr: 'Autre',
      nameEn: 'Other',
      nameAr: 'آخر',
      category: 'OTHER',
      isActive: true,
      isSystem: true,
      requiresComment: true,
      sortOrder: 120,
    },
  });
}

async function seedRequiredCommentReason() {
  return prisma.creditNoteReason.upsert({
    where: { code: 'DUPLICATE_INVOICE' },
    update: { isActive: true, requiresComment: true },
    create: {
      code: 'DUPLICATE_INVOICE',
      nameFr: 'Facture en double',
      nameEn: 'Duplicate invoice',
      nameAr: 'فاتورة مكررة',
      category: 'CORRECTION',
      isActive: true,
      isSystem: true,
      requiresComment: true,
      sortOrder: 60,
    },
  });
}

async function createInvoice(createdById: string, customerId: string, status: InvoiceStatus, total: number) {
  return prisma.invoice.create({
    data: {
      customerId,
      createdById,
      invoiceNumber: `CNTEST-${runId}-${status}-${Math.random().toString(16).slice(2, 8)}`,
      status,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      subtotal: total / 1.2,
      taxRate: 20,
      taxAmount: total - total / 1.2,
      total,
      amountPaid: status === InvoiceStatus.PAID ? total : 0,
      balanceDue: status === InvoiceStatus.PAID ? 0 : total,
      currency: 'MAD',
      customerCountry: 'Morocco',
      customerCountryCode: 'MA',
      items: {
        create: [{
          description: 'Service test',
          quantity: 1,
          unitPrice: total / 1.2,
          taxRate: 20,
          total,
          sortOrder: 1,
        }],
      },
    },
  });
}

async function cleanup() {
  await prisma.creditNote.deleteMany({ where: { customer: { email: customerEmail } } });
  await prisma.creditNoteReason.deleteMany({ where: { code: `INACTIVE_${runId}` } });
  await prisma.invoice.deleteMany({ where: { customer: { email: customerEmail } } });
  await prisma.customer.deleteMany({ where: { email: customerEmail } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

main()
  .catch(async (error) => {
    await cleanup().catch(() => undefined);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
