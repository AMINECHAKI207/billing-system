import {
  ExpenseSource,
  InvoiceStatus,
  PaymentMethod,
  PrismaClient,
  ReminderStatus,
  ReminderType,
  Role,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function daysFromNow(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  console.log('Starting database seeding...');

  await prisma.recurringExecution.deleteMany();
  await prisma.recurringPlanItem.deleteMany();
  await prisma.recurringPlan.deleteMany();
  await prisma.telegramSession.deleteMany();
  await prisma.telegramLinkCode.deleteMany();
  await prisma.telegramAccount.deleteMany();
  await prisma.aiPendingAction.deleteMany();
  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.contractEmailLog.deleteMany();
  await prisma.contractAuditLog.deleteMany();
  await prisma.contractSignatureLink.deleteMany();
  await prisma.contractVersion.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.creditNoteEmailLog.deleteMany();
  await prisma.creditNoteAuditLog.deleteMany();
  await prisma.creditNoteLine.deleteMany();
  await prisma.creditNote.deleteMany();
  await prisma.expenseAuditLog.deleteMany();
  await prisma.expenseEmailLog.deleteMany();
  await prisma.expenseAIAnalysis.deleteMany();
  await prisma.expenseAttachment.deleteMany();
  await prisma.expenseNote.deleteMany();
  await prisma.expenseType.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.invoiceEmailLog.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.invoiceSequence.deleteMany();
  await prisma.companySettings.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await seedAiAssistantPermissions();
  await seedDefaultCreditNoteReasons();
  await seedDefaultContractTemplates();

  const [adminPasswordHash, employeePasswordHash] = await Promise.all([
    bcrypt.hash('admin123', 12),
    bcrypt.hash('employee123', 12),
  ]);

  const admin = await prisma.user.create({
    data: {
      name: 'System Admin',
      email: 'admin@billingsystem.com',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
    },
  });

  const employeeA = await prisma.user.create({
    data: {
      name: 'Sara Benali',
      email: 'sara@billingsystem.com',
      passwordHash: employeePasswordHash,
      role: Role.EMPLOYEE,
    },
  });

  const employeeB = await prisma.user.create({
    data: {
      name: 'Youssef Alaoui',
      email: 'youssef@billingsystem.com',
      passwordHash: employeePasswordHash,
      role: Role.EMPLOYEE,
    },
  });

  const [adminRole, employeeRole] = await Promise.all([
    prisma.rbacRole.findUniqueOrThrow({ where: { name: 'ADMIN' } }),
    prisma.rbacRole.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } }),
  ]);
  await prisma.user.update({ where: { id: admin.id }, data: { rbacRoleId: adminRole.id } });
  await prisma.user.updateMany({
    where: { id: { in: [employeeA.id, employeeB.id] } },
    data: { rbacRoleId: employeeRole.id },
  });

  await prisma.companySettings.create({
    data: {
      id: 1,
      name: 'Atlas Digital Services',
      address: 'Boulevard Anfa, Casablanca, Morocco',
      phone: '+212 522 000 111',
      email: 'billing@atlas-digital.ma',
      taxNumber: 'IF: 40218973',
      defaultCurrency: 'MAD',
      defaultTaxRate: 20,
      vatEnabled: true,
      moroccoVatRate: 20,
      paymentTerms: 'Paiement a 30 jours par virement bancaire.',
      bankDetails: 'Banque: Attijariwafa Bank\nRIB: 007 780 0001234567890123 89',
    },
  });

  await prisma.product.createMany({
    data: [
      {
        name: 'Developpement web',
        description: 'Conception et developpement applicatif full-stack',
        unit: 'jour',
        unitPrice: 1200,
        taxRate: 20,
      },
      {
        name: 'Maintenance mensuelle',
        description: 'Support correctif, surveillance et petites evolutions',
        unit: 'mois',
        unitPrice: 2500,
        taxRate: 20,
      },
      {
        name: 'Design interface',
        description: 'Maquettes UI et parcours utilisateur',
        unit: 'forfait',
        unitPrice: 4500,
        taxRate: 20,
      },
    ],
  });

  const expenseCategories = await Promise.all([
    prisma.expenseCategory.create({
      data: {
        name: 'Transport',
        expenseTypes: {
          create: [
            { name: 'Taxi' },
            { name: 'Fuel' },
            { name: 'Train' },
          ],
        },
      },
      include: { expenseTypes: true },
    }),
    prisma.expenseCategory.create({
      data: {
        name: 'Meals',
        expenseTypes: {
          create: [
            { name: 'Restaurant' },
            { name: 'Coffee' },
          ],
        },
      },
      include: { expenseTypes: true },
    }),
    prisma.expenseCategory.create({
      data: {
        name: 'Office',
        expenseTypes: {
          create: [
            { name: 'Supplies' },
            { name: 'Software' },
          ],
        },
      },
      include: { expenseTypes: true },
    }),
  ]);

  const acme = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Acme Corporation',
      email: 'billing@acmecorp.com',
      phone: '+212 600 111 222',
      company: 'Acme Corporation',
      address: '123 Tech Park',
      city: 'Casablanca',
      country: 'Morocco',
      countryCode: 'MA',
      postalCode: '20000',
      taxNumber: 'IF: 12345678',
    },
  });

  const globalReach = await prisma.customer.create({
    data: {
      createdById: employeeA.id,
      name: 'Global Reach LLC',
      email: 'finance@globalreach.com',
      phone: '+212 600 333 444',
      company: 'Global Reach LLC',
      address: '456 Business Boulevard',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      postalCode: '75008',
      taxNumber: 'IF: 87654321',
    },
  });

  const transportCategory = expenseCategories.find((category) => category.name === 'Transport')!;
  const taxiType = transportCategory.expenseTypes.find((type) => type.name === 'Taxi')!;
  await prisma.expenseNote.create({
    data: {
      categoryId: transportCategory.id,
      expenseTypeId: taxiType.id,
      createdById: employeeA.id,
      expenseDate: daysFromNow(-2),
      amountTTC: 180,
      amountHT: 150,
      vatAmount: 30,
      vatRate: 20,
      merchantName: 'Taxi Casablanca',
      receiptNumber: 'TAXI-2026-001',
      currency: 'MAD',
      comment: 'Client meeting transport.',
      source: ExpenseSource.MANUAL,
    },
  });

  const draftInvoice = await prisma.invoice.create({
    data: {
      customerId: acme.id,
      createdById: admin.id,
      invoiceNumber: 'INV-2026-0001',
      status: InvoiceStatus.DRAFT,
      issueDate: daysFromNow(0),
      dueDate: daysFromNow(30),
      subtotal: 4500,
      taxRate: 20,
      taxAmount: 900,
      customerCountry: 'Morocco',
      customerCountryCode: 'MA',
      discount: 0,
      total: 5400,
      amountPaid: 0,
      balanceDue: 5400,
      currency: 'MAD',
      notes: 'Proposition en cours de validation.',
      terms: 'Paiement a 30 jours apres validation.',
      items: {
        create: [
          {
            description: 'Design interface',
            unit: 'forfait',
            quantity: 1,
            unitPrice: 4500,
            taxRate: 20,
            total: 5400,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  const sentInvoice = await prisma.invoice.create({
    data: {
      customerId: globalReach.id,
      createdById: employeeA.id,
      invoiceNumber: 'INV-2026-0002',
      status: InvoiceStatus.SENT,
      issueDate: daysFromNow(-5),
      dueDate: daysFromNow(20),
      subtotal: 7200,
      taxRate: 0,
      taxAmount: 0,
      customerCountry: 'France',
      customerCountryCode: 'FR',
      discount: 0,
      total: 7200,
      amountPaid: 0,
      balanceDue: 7200,
      currency: 'MAD',
      sentAt: daysFromNow(-5),
      terms: 'Paiement par virement sous 20 jours.',
      items: {
        create: [
          {
            description: 'Developpement web',
            unit: 'jour',
            quantity: 6,
            unitPrice: 1200,
            taxRate: 0,
            total: 7200,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  const partiallyPaidInvoice = await prisma.invoice.create({
    data: {
      customerId: acme.id,
      createdById: employeeB.id,
      invoiceNumber: 'INV-2026-0003',
      status: InvoiceStatus.PARTIALLY_PAID,
      issueDate: daysFromNow(-20),
      dueDate: daysFromNow(5),
      subtotal: 5000,
      taxRate: 20,
      taxAmount: 1000,
      customerCountry: 'Morocco',
      customerCountryCode: 'MA',
      discount: 0,
      total: 6000,
      amountPaid: 2500,
      balanceDue: 3500,
      currency: 'MAD',
      sentAt: daysFromNow(-20),
      terms: 'Solde a regler avant echeance.',
      items: {
        create: [
          {
            description: 'Maintenance mensuelle',
            unit: 'mois',
            quantity: 2,
            unitPrice: 2500,
            taxRate: 20,
            total: 6000,
            sortOrder: 1,
          },
        ],
      },
      payments: {
        create: [
          {
            recordedById: employeeB.id,
            amount: 2500,
            paymentDate: daysFromNow(-10),
            method: PaymentMethod.BANK_TRANSFER,
            reference: 'VIR-ACME-2500',
            notes: 'Acompte recu.',
          },
        ],
      },
    },
  });

  const paidInvoice = await prisma.invoice.create({
    data: {
      customerId: globalReach.id,
      createdById: admin.id,
      invoiceNumber: 'INV-2026-0004',
      status: InvoiceStatus.PAID,
      issueDate: daysFromNow(-45),
      dueDate: daysFromNow(-15),
      subtotal: 9000,
      taxRate: 0,
      taxAmount: 0,
      customerCountry: 'France',
      customerCountryCode: 'FR',
      discount: 300,
      total: 8700,
      amountPaid: 8700,
      balanceDue: 0,
      currency: 'MAD',
      sentAt: daysFromNow(-45),
      paidAt: daysFromNow(-12),
      notes: 'Facture soldee.',
      terms: 'Paiement recu par virement.',
      items: {
        create: [
          {
            description: 'Developpement web',
            unit: 'jour',
            quantity: 5,
            unitPrice: 1200,
            taxRate: 0,
            total: 6000,
            sortOrder: 1,
          },
          {
            description: 'Design interface',
            unit: 'forfait',
            quantity: 1,
            unitPrice: 3000,
            taxRate: 0,
            total: 3000,
            sortOrder: 2,
          },
        ],
      },
      payments: {
        create: [
          {
            recordedById: admin.id,
            amount: 8700,
            paymentDate: daysFromNow(-12),
            method: PaymentMethod.BANK_TRANSFER,
            reference: 'VIR-GR-8700',
            notes: 'Paiement total.',
          },
        ],
      },
    },
  });

  await prisma.reminder.createMany({
    data: [
      {
        invoiceId: sentInvoice.id,
        sentById: employeeA.id,
        type: ReminderType.BEFORE_DUE,
        recipientEmail: globalReach.email,
        subject: `Rappel avant echeance - ${sentInvoice.invoiceNumber}`,
        body: 'Bonjour Global Reach LLC,\n\nNous vous rappelons que cette facture arrive bientot a echeance.\n\nCordialement,\nAtlas Digital Services',
        status: ReminderStatus.PENDING,
      },
      {
        invoiceId: partiallyPaidInvoice.id,
        sentById: employeeB.id,
        type: ReminderType.BEFORE_DUE,
        recipientEmail: acme.email,
        subject: `Solde restant - ${partiallyPaidInvoice.invoiceNumber}`,
        body: 'Bonjour Acme Corporation,\n\nUn solde reste a regler sur cette facture partiellement payee.\n\nCordialement,\nAtlas Digital Services',
        status: ReminderStatus.SENT,
        sentAt: daysFromNow(-2),
      },
      {
        invoiceId: draftInvoice.id,
        sentById: admin.id,
        type: ReminderType.MANUAL,
        recipientEmail: acme.email,
        subject: `Validation facture brouillon - ${draftInvoice.invoiceNumber}`,
        body: 'Bonjour Acme Corporation,\n\nMerci de confirmer les elements du devis avant emission de la facture.\n\nCordialement,\nAtlas Digital Services',
        status: ReminderStatus.PENDING,
      },
    ],
  });

  await prisma.invoiceEmailLog.createMany({
    data: [
      {
        invoiceId: sentInvoice.id,
        sentById: employeeA.id,
        recipientEmail: globalReach.email,
        subject: `Facture ${sentInvoice.invoiceNumber}`,
        message: 'Facture envoyee au client.',
        status: 'SENT',
        deliveryMode: 'local',
        messageId: `seed-${sentInvoice.invoiceNumber}`,
      },
      {
        invoiceId: paidInvoice.id,
        sentById: admin.id,
        recipientEmail: globalReach.email,
        subject: `Facture ${paidInvoice.invoiceNumber}`,
        message: 'Facture envoyee et reglee.',
        status: 'SENT',
        deliveryMode: 'local',
        messageId: `seed-${paidInvoice.invoiceNumber}`,
      },
    ],
  });

  await prisma.invoiceSequence.create({
    data: {
      year: new Date().getFullYear(),
      nextNumber: 5,
    },
  });

  console.log('Seeding completed successfully.');
  console.log('Accounts:');
  console.log('Admin: admin@billingsystem.com / admin123');
  console.log('Employee: sara@billingsystem.com / employee123');
  console.log('Employee: youssef@billingsystem.com / employee123');
  console.log(`Invoices created: ${[draftInvoice, sentInvoice, partiallyPaidInvoice, paidInvoice].length}`);
}

const defaultCreditNoteReasons = [
  ['BILLING_ERROR', 'Erreur de facturation', 'Billing error', 'خطأ في الفوترة', 'Correction for an incorrect invoice amount, reference, or billing information.', 'CORRECTION', true, 10],
  ['PRICE_CORRECTION', 'Correction de prix', 'Price correction', 'تصحيح السعر', 'Correction applied because the invoiced price was incorrect.', 'CORRECTION', true, 20],
  ['QUANTITY_CORRECTION', 'Correction de quantité', 'Quantity correction', 'تصحيح الكمية', 'Correction applied because the invoiced quantity was incorrect.', 'CORRECTION', true, 30],
  ['PRODUCT_RETURN', 'Retour de produit', 'Product return', 'إرجاع منتج', 'Credit note issued after returned goods.', 'RETURN', false, 40],
  ['SERVICE_CANCELLATION', 'Annulation de service', 'Service cancellation', 'إلغاء خدمة', 'Credit note issued after a cancelled service.', 'CANCELLATION', false, 50],
  ['DUPLICATE_INVOICE', 'Facture en double', 'Duplicate invoice', 'فاتورة مكررة', 'Credit note issued to reverse a duplicate invoice.', 'CORRECTION', true, 60],
  ['COMMERCIAL_DISCOUNT', 'Remise commerciale', 'Commercial discount', 'خصم تجاري', 'Commercial gesture or discount granted after invoicing.', 'COMMERCIAL', false, 70],
  ['CUSTOMER_REFUND', 'Remboursement client', 'Customer refund', 'استرداد للعميل', 'Credit note linked to an amount to refund to the customer.', 'REFUND', false, 80],
  ['ORDER_CANCELLATION', 'Annulation de commande', 'Order cancellation', 'إلغاء الطلب', 'Credit note issued after order cancellation.', 'CANCELLATION', false, 90],
  ['TAX_CORRECTION', 'Correction de TVA', 'Tax correction', 'تصحيح الضريبة', 'Correction of VAT or tax calculation.', 'CORRECTION', true, 100],
  ['DELIVERY_PROBLEM', 'Problème de livraison', 'Delivery issue', 'مشكلة في التسليم', 'Credit note issued due to a delivery issue.', 'DELIVERY', true, 110],
  ['OTHER', 'Autre', 'Other', 'آخر', 'Other reason requiring a detailed explanation.', 'OTHER', true, 120],
] as const;

const aiAssistantPermissions = [
  ['ai_assistant.access', 'Access the secure AI admin assistant', 'access'],
  ['ai_assistant.use_read_tools', 'Use read-only AI assistant tools', 'use_read_tools'],
  ['ai_assistant.use_write_tools', 'Prepare AI assistant actions requiring confirmation', 'use_write_tools'],
  ['ai_assistant.confirm_actions', 'Confirm pending AI assistant actions', 'confirm_actions'],
  ['ai_assistant.view_history', 'View AI assistant conversation history', 'view_history'],
  ['ai_assistant.manage_tools', 'Manage AI assistant tool access', 'manage_tools'],
] as const;

async function seedAiAssistantPermissions() {
  for (const [key, description, action] of aiAssistantPermissions) {
    await prisma.permission.upsert({
      where: { key },
      update: { description, resource: 'ai_assistant', action },
      create: { key, description, resource: 'ai_assistant', action },
    });
  }

  const adminRole = await prisma.rbacRole.findUnique({ where: { name: 'ADMIN' } });
  if (!adminRole) return;

  const permissions = await prisma.permission.findMany({
    where: { key: { in: aiAssistantPermissions.map(([key]) => key) } },
    select: { id: true },
  });

  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: adminRole.id,
      permissionId: permission.id,
      scope: 'ALL',
    })),
    skipDuplicates: true,
  });
}

async function seedDefaultCreditNoteReasons() {
  for (const [code, nameFr, nameEn, nameAr, description, category, requiresComment, sortOrder] of defaultCreditNoteReasons) {
    await prisma.creditNoteReason.upsert({
      where: { code },
      update: {
        nameFr,
        nameEn,
        nameAr,
        description,
        category,
        requiresComment,
        isActive: true,
        isSystem: true,
        sortOrder,
      },
      create: {
        code,
        nameFr,
        nameEn,
        nameAr,
        description,
        category,
        requiresComment,
        isActive: true,
        isSystem: true,
        sortOrder,
      },
    });
  }
}

const defaultContractTemplates = [
  {
    code: 'SERVICE_AGREEMENT',
    nameFr: 'Contrat de prestation de services',
    nameEn: 'Service agreement',
    nameAr: '\u0639\u0642\u062f \u062a\u0642\u062f\u064a\u0645 \u062e\u062f\u0645\u0627\u062a',
    description: 'Modele standard pour prestations de services.',
    content: [
      'Objet du contrat',
      'Le prestataire fournit les services decrits dans la proposition acceptee.',
      '',
      'Obligations',
      'Chaque partie s engage a executer ses obligations avec diligence et bonne foi.',
      '',
      'Paiement',
      'Les montants, taxes et echeances sont definis dans les conditions particulieres.',
      '',
      'Confidentialite',
      'Les informations confidentielles doivent rester protegees pendant et apres le contrat.',
    ].join('\n'),
    sortOrder: 10,
  },
  {
    code: 'MAINTENANCE',
    nameFr: 'Contrat de maintenance',
    nameEn: 'Maintenance contract',
    nameAr: '\u0639\u0642\u062f \u0635\u064a\u0627\u0646\u0629',
    description: 'Modele pour maintenance et support.',
    content: [
      'Objet du contrat',
      'Le prestataire assure la maintenance corrective et preventive des services convenus.',
      '',
      'Niveaux de service',
      'Les delais d intervention sont definis dans les conditions particulieres.',
      '',
      'Paiement',
      'La facturation suit la periodicite convenue entre les parties.',
    ].join('\n'),
    sortOrder: 20,
  },
  {
    code: 'SUBSCRIPTION',
    nameFr: 'Contrat d abonnement',
    nameEn: 'Subscription contract',
    nameAr: '\u0639\u0642\u062f \u0627\u0634\u062a\u0631\u0627\u0643',
    description: 'Modele pour abonnement recurrent.',
    content: [
      'Objet du contrat',
      'Le client souscrit a un service recurrent selon les conditions particulieres.',
      '',
      'Renouvellement',
      'Le renouvellement est gere selon le type choisi dans le contrat.',
      '',
      'Resiliation',
      'Chaque partie peut resilier selon les preavis convenus.',
    ].join('\n'),
    sortOrder: 30,
  },
] as const;

async function seedDefaultContractTemplates() {
  for (const template of defaultContractTemplates) {
    await prisma.contractTemplate.upsert({
      where: { code: template.code },
      update: {
        nameFr: template.nameFr,
        nameEn: template.nameEn,
        nameAr: template.nameAr,
        description: template.description,
        content: template.content,
        isActive: true,
        isSystem: true,
        sortOrder: template.sortOrder,
      },
      create: {
        ...template,
        isActive: true,
        isSystem: true,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
