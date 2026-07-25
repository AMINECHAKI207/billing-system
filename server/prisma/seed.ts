import {
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
  await prisma.reminder.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceEmailLog.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.invoiceSequence.deleteMany();
  await prisma.companySettings.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

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

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
