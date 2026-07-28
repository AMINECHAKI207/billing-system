import {
  DevisStatus,
  InvoiceStatus,
  PaymentMethod,
  PermissionScope,
  PrismaClient,
  Role,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.e2e'), override: true });

const prisma = new PrismaClient();
const password = process.env.E2E_PASSWORD ?? 'E2ePassword123!';

function dateFromToday(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function assertE2eDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!/(e2e|test)/i.test(databaseName)) {
    throw new Error(`Refusing to seed non-E2E database: ${databaseName}`);
  }
}

async function resetData() {
  await prisma.recurringExecution.deleteMany();
  await prisma.recurringPlanItem.deleteMany();
  await prisma.recurringPlan.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceEmailLog.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.devisItem.deleteMany();
  await prisma.devis.deleteMany();
  await prisma.invoiceSequence.deleteMany();
  await prisma.devisSequence.deleteMany();
  await prisma.companySettings.deleteMany();
  await prisma.product.deleteMany();
  await prisma.userClientAssignment.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rolePermission.deleteMany({ where: { role: { isSystem: false } } });
  await prisma.rbacRole.deleteMany({ where: { isSystem: false } });
}

async function permissionsByKey() {
  const permissions = await prisma.permission.findMany();
  return Object.fromEntries(permissions.map((permission) => [permission.key, permission]));
}

async function createRole(name: string, scopeByPermission: Record<string, PermissionScope>) {
  const permissions = await permissionsByKey();
  const role = await prisma.rbacRole.create({
    data: {
      name,
      description: `${name} E2E role`,
      isSystem: false,
    },
  });

  await prisma.rolePermission.createMany({
    data: Object.entries(scopeByPermission).map(([key, scope]) => ({
      roleId: role.id,
      permissionId: permissions[key]!.id,
      scope,
    })),
  });

  return role;
}

async function main() {
  assertE2eDatabase();
  await resetData();

  const allOperationalPermissions = [
    'dashboard.view',
    'clients.view',
    'clients.create',
    'clients.update',
    'clients.delete',
    'invoices.view',
    'invoices.create',
    'invoices.update',
    'invoices.sign',
    'invoices.send',
    'payments.view',
    'payments.create',
    'reports.view',
    'reminders.view',
    'reminders.create',
    'reminders.manage',
    'products.view',
    'products.create',
    'products.update',
    'users.view',
    'users.create',
    'users.update',
    'roles.view',
    'roles.create',
    'roles.update',
    'roles.delete',
    'permissions.view',
    'permissions.assign',
    'settings.view',
    'settings.update',
    'recurring.view',
    'recurring.create',
    'recurring.update',
    'recurring.run',
    'devis.view',
    'devis.create',
    'devis.update',
    'devis.delete',
    'devis.send',
    'devis.approve',
    'devis.reject',
    'devis.convert',
    'devis.download',
    'devis.sign',
  ];

  const scopedPermissions = new Set([
    'clients.view',
    'clients.create',
    'clients.update',
    'clients.delete',
    'invoices.view',
    'invoices.create',
    'invoices.update',
    'invoices.sign',
    'invoices.send',
    'payments.view',
    'payments.create',
    'recurring.view',
    'recurring.create',
    'recurring.update',
    'recurring.run',
    'devis.view',
    'devis.create',
    'devis.update',
    'devis.delete',
    'devis.send',
    'devis.approve',
    'devis.reject',
    'devis.convert',
    'devis.download',
    'devis.sign',
  ]);

  const allRole = await createRole(
    'E2E_EMPLOYEE_ALL',
    Object.fromEntries(allOperationalPermissions.map((key) => [key, PermissionScope.ALL]))
  );
  const ownRole = await createRole(
    'E2E_EMPLOYEE_OWN',
    Object.fromEntries(allOperationalPermissions.map((key) => [key, scopedPermissions.has(key) ? PermissionScope.OWN : PermissionScope.ALL]))
  );
  const selectedRole = await createRole(
    'E2E_EMPLOYEE_SELECTED',
    Object.fromEntries(allOperationalPermissions.map((key) => [key, scopedPermissions.has(key) ? PermissionScope.SELECTED : PermissionScope.ALL]))
  );
  const restrictedRole = await createRole('E2E_RESTRICTED', {
    'dashboard.view': PermissionScope.ALL,
    'clients.view': PermissionScope.OWN,
    'invoices.view': PermissionScope.OWN,
  });

  const adminRole = await prisma.rbacRole.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.create({
    data: {
      name: 'E2E Admin',
      email: process.env.E2E_ADMIN_EMAIL ?? 'e2e.admin@billingsystem.test',
      passwordHash,
      role: Role.ADMIN,
      rbacRoleId: adminRole.id,
    },
  });
  const employeeAll = await prisma.user.create({
    data: {
      name: 'E2E Employee All',
      email: process.env.E2E_EMPLOYEE_ALL_EMAIL ?? 'e2e.employee.all@billingsystem.test',
      passwordHash,
      role: Role.EMPLOYEE,
      rbacRoleId: allRole.id,
    },
  });
  const employeeOwn = await prisma.user.create({
    data: {
      name: 'E2E Employee Own',
      email: process.env.E2E_EMPLOYEE_OWN_EMAIL ?? 'e2e.employee.own@billingsystem.test',
      passwordHash,
      role: Role.EMPLOYEE,
      rbacRoleId: ownRole.id,
    },
  });
  const employeeSelected = await prisma.user.create({
    data: {
      name: 'E2E Employee Selected',
      email: process.env.E2E_EMPLOYEE_SELECTED_EMAIL ?? 'e2e.employee.selected@billingsystem.test',
      passwordHash,
      role: Role.EMPLOYEE,
      rbacRoleId: selectedRole.id,
    },
  });
  await prisma.user.create({
    data: {
      name: 'E2E Restricted',
      email: process.env.E2E_RESTRICTED_EMAIL ?? 'e2e.restricted@billingsystem.test',
      passwordHash,
      role: Role.EMPLOYEE,
      rbacRoleId: restrictedRole.id,
    },
  });

  await prisma.companySettings.create({
    data: {
      id: 1,
      name: 'E2E Billing System',
      address: 'E2E Avenue, Casablanca, Morocco',
      phone: '+212 600 000 000',
      email: 'billing-e2e@example.test',
      taxNumber: 'IF: E2E0001',
      defaultCurrency: 'MAD',
      defaultTaxRate: 20,
      vatEnabled: true,
      moroccoVatRate: 20,
      paymentTerms: 'E2E payment terms',
      bankDetails: 'E2E Bank\nRIB: 000 000 0000000000000000 00',
    },
  });

  await prisma.product.createMany({
    data: [
      { name: 'E2E Consulting', description: 'E2E consulting service', unit: 'day', unitPrice: 1000, taxRate: 20 },
      { name: 'E2E Support', description: 'E2E monthly support', unit: 'month', unitPrice: 2500, taxRate: 20 },
    ],
  });

  const moroccoClient = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'E2E Morocco Client',
      email: 'morocco-client@example.test',
      company: 'E2E Morocco SARL',
      city: 'Casablanca',
      country: 'Morocco',
      countryCode: 'MA',
      address: 'Casablanca E2E',
      taxNumber: 'IF: E2EMA',
    },
  });
  const ownClient = await prisma.customer.create({
    data: {
      createdById: employeeOwn.id,
      name: 'E2E Own Client',
      email: 'own-client@example.test',
      company: 'E2E Own LLC',
      city: 'Rabat',
      country: 'Morocco',
      countryCode: 'MA',
      address: 'Rabat E2E',
    },
  });
  const internationalClient = await prisma.customer.create({
    data: {
      createdById: employeeAll.id,
      name: 'E2E France Client',
      email: 'france-client@example.test',
      company: 'E2E France SAS',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      address: 'Paris E2E',
    },
  });

  await prisma.userClientAssignment.createMany({
    data: [
      { userId: employeeSelected.id, clientId: moroccoClient.id },
      { userId: employeeSelected.id, clientId: internationalClient.id },
      { userId: employeeAll.id, clientId: moroccoClient.id },
      { userId: employeeAll.id, clientId: internationalClient.id },
      { userId: employeeOwn.id, clientId: ownClient.id },
    ],
  });

  const draftInvoice = await prisma.invoice.create({
    data: {
      customerId: moroccoClient.id,
      createdById: admin.id,
      invoiceNumber: 'INV-E2E-0001',
      status: InvoiceStatus.DRAFT,
      issueDate: dateFromToday(0),
      dueDate: dateFromToday(30),
      subtotal: 1000,
      taxRate: 20,
      taxAmount: 200,
      customerCountry: 'Morocco',
      customerCountryCode: 'MA',
      total: 1200,
      amountPaid: 0,
      balanceDue: 1200,
      currency: 'MAD',
      items: { create: [{ description: 'E2E Consulting', unit: 'day', quantity: 1, unitPrice: 1000, taxRate: 20, total: 1200, sortOrder: 1 }] },
    },
  });
  await prisma.invoice.create({
    data: {
      customerId: internationalClient.id,
      createdById: employeeAll.id,
      invoiceNumber: 'INV-E2E-0002',
      status: InvoiceStatus.PARTIALLY_PAID,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(20),
      subtotal: 2500,
      taxRate: 0,
      taxAmount: 0,
      customerCountry: 'France',
      customerCountryCode: 'FR',
      total: 2500,
      amountPaid: 500,
      balanceDue: 2000,
      currency: 'MAD',
      items: { create: [{ description: 'E2E Support', unit: 'month', quantity: 1, unitPrice: 2500, taxRate: 0, total: 2500, sortOrder: 1 }] },
      payments: { create: [{ recordedById: employeeAll.id, amount: 500, paymentDate: dateFromToday(-5), method: PaymentMethod.BANK_TRANSFER, reference: 'E2E-PAY-001' }] },
    },
  });

  await prisma.devis.create({
    data: {
      devisNumber: 'DEV-E2E-0001',
      companyId: 1,
      customerId: moroccoClient.id,
      createdById: admin.id,
      status: DevisStatus.DRAFT,
      issueDate: dateFromToday(0),
      validUntil: dateFromToday(30),
      subtotal: 1000,
      taxRate: 20,
      taxAmount: 200,
      customerCountry: 'Morocco',
      customerCountryCode: 'MA',
      total: 1200,
      currency: 'MAD',
      items: { create: [{ description: 'E2E Consulting quote', unit: 'day', quantity: 1, unitPrice: 1000, discount: 0, taxRate: 20, lineTotal: 1200, sortOrder: 1 }] },
    },
  });
  await prisma.devis.create({
    data: {
      devisNumber: 'DEV-E2E-0002',
      companyId: 1,
      customerId: internationalClient.id,
      createdById: employeeAll.id,
      status: DevisStatus.APPROVED,
      issueDate: dateFromToday(-1),
      validUntil: dateFromToday(29),
      subtotal: 2500,
      taxRate: 0,
      taxAmount: 0,
      customerCountry: 'France',
      customerCountryCode: 'FR',
      total: 2500,
      currency: 'MAD',
      items: { create: [{ description: 'E2E Support quote', unit: 'month', quantity: 1, unitPrice: 2500, discount: 0, taxRate: 0, lineTotal: 2500, sortOrder: 1 }] },
    },
  });

  await prisma.invoiceSequence.create({ data: { year: new Date().getFullYear(), nextNumber: 3 } });
  await prisma.devisSequence.create({ data: { year: new Date().getFullYear(), nextNumber: 3 } });

  console.log('E2E seed complete');
  console.log(`Admin: ${admin.email} / ${password}`);
  console.log(`Employee ALL: ${employeeAll.email} / ${password}`);
  console.log(`Employee OWN: ${employeeOwn.email} / ${password}`);
  console.log(`Employee SELECTED: ${employeeSelected.email} / ${password}`);
  console.log(`Draft invoice: ${draftInvoice.invoiceNumber}`);
}

main()
  .catch((error) => {
    console.error('E2E seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
