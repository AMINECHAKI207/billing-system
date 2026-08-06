import bcrypt from 'bcryptjs';
import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractSignatureStatus,
  ContractStatus,
  ContractTimeEntryStatus,
  PermissionScope,
  Prisma,
  Role,
} from '@prisma/client';
import { prisma } from '@config/database';
import { contractService } from '@modules/contract/contract.service';

export const demoPrefix = 'DEMO-TIMESHEETS';
export const demoEmployeeEmail = 'demo.timesheets.employee@example.com';
export const demoManagerEmail = 'demo.timesheets.manager@example.com';
export const demoPassword = 'DemoTimesheets123!';
export const demoClientEmail = 'demo.timesheets.client@example.com';
export const demoClientName = 'Demo Client - Timesheets';
export const demoContractTitle = `${demoPrefix} - Demo Hourly Support Contract`;

type DemoUser = { id: string; name: string; email: string };

const employeePermissions = [
  'contracts.view',
  'contracts.time_entries.create',
  'contracts.time_entries.update',
  'contracts.time_entries.submit',
  'contracts.pdf.preview',
  'contracts.pdf.download',
];

const managerPermissions = [
  'contracts.view',
  'contracts.create',
  'contracts.update',
  'contracts.send',
  'contracts.sign.company',
  'contracts.pdf.preview',
  'contracts.pdf.download',
  'contracts.billing.generate',
  'contracts.time_entries.create',
  'contracts.time_entries.update',
  'contracts.time_entries.submit',
  'contracts.time_entries.approve',
  'contracts.time_entries.reject',
  'contracts.email.history',
  'invoices.view',
  'invoices.create',
  'audit_logs.view',
];

export function assertDemoEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run DEMO-TIMESHEETS scripts in production.');
  }
}

export async function ensureDemoDataset(options: { resetContractState?: boolean } = {}) {
  const resetContractState = options.resetContractState ?? true;
  assertDemoEnvironment();
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  await ensureDemoPermissions();

  const employeeRole = await ensureRole('DEMO_TIMESHEETS_EMPLOYEE', employeePermissions, PermissionScope.SELECTED);
  const managerRole = await ensureRole('DEMO_TIMESHEETS_MANAGER', managerPermissions, PermissionScope.ALL);

  const employee = await prisma.user.upsert({
    where: { email: demoEmployeeEmail },
    update: {
      name: 'Demo Timesheets Employee',
      role: Role.EMPLOYEE,
      rbacRoleId: employeeRole.id,
      isActive: true,
    },
    create: {
      name: 'Demo Timesheets Employee',
      email: demoEmployeeEmail,
      passwordHash,
      role: Role.EMPLOYEE,
      rbacRoleId: employeeRole.id,
      isActive: true,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: demoManagerEmail },
    update: {
      name: 'Demo Timesheets Manager',
      role: Role.ADMIN,
      rbacRoleId: managerRole.id,
      isActive: true,
    },
    create: {
      name: 'Demo Timesheets Manager',
      email: demoManagerEmail,
      passwordHash,
      role: Role.ADMIN,
      rbacRoleId: managerRole.id,
      isActive: true,
    },
  });

  const existingClient = await prisma.customer.findFirst({ where: { email: demoClientEmail } });
  const client = existingClient
    ? await prisma.customer.update({
        where: { id: existingClient.id },
        data: {
          name: demoClientName,
          company: demoClientName,
          country: 'Morocco',
          countryCode: 'MA',
          address: 'Demo address',
          city: 'Casablanca',
          createdById: manager.id,
          isActive: true,
        },
      })
    : await prisma.customer.create({
        data: {
          name: demoClientName,
          company: demoClientName,
          email: demoClientEmail,
          country: 'Morocco',
          countryCode: 'MA',
          address: 'Demo address',
          city: 'Casablanca',
          createdById: manager.id,
        },
      });

  await prisma.userClientAssignment.upsert({
    where: { userId_clientId: { userId: employee.id, clientId: client.id } },
    update: {},
    create: { userId: employee.id, clientId: client.id },
  });

  await prisma.userClientAssignment.upsert({
    where: { userId_clientId: { userId: manager.id, clientId: client.id } },
    update: {},
    create: { userId: manager.id, clientId: client.id },
  });

  let contract = await prisma.contract.findFirst({
    where: { clientId: client.id, title: demoContractTitle },
    include: { currentVersion: true },
  });

  const period = demoPeriod();
  if (!contract) {
    contract = await contractService.create(manager, PermissionScope.ALL, {
      clientId: client.id,
      title: demoContractTitle,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: period.startDate,
      endDate: period.endDate,
      renewalType: 'NONE',
      amount: 100000,
      currency: 'MAD',
      pricingType: ContractPricingType.HOURLY,
      unitRate: 500,
      estimatedQuantity: 200,
      billingFrequency: ContractBillingFrequency.MONTHLY,
      billingStartDate: period.startDate,
      billingEndDate: period.endDate,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      summary: `${demoPrefix} demo contract for contract-based timesheets.`,
      terms: 'Development-only demo terms for the contract-based timesheets workflow.',
      content: 'Development-only demo contract content for contract-based timesheets. This contract is used to demonstrate time entry submission, approval and invoice generation.',
    });
  }

  if (resetContractState) {
    await resetDemoContractState(contract.id);
  }

  contract = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      createdById: manager.id,
      clientId: client.id,
      title: demoContractTitle,
      status: ContractStatus.ACTIVE,
      pricingType: ContractPricingType.HOURLY,
      unitRate: new Prisma.Decimal(500),
      estimatedQuantity: new Prisma.Decimal(200),
      amount: new Prisma.Decimal(100000),
      fixedAmount: null,
      currency: 'MAD',
      taxRate: new Prisma.Decimal(20),
      billingFrequency: ContractBillingFrequency.MONTHLY,
      startDate: new Date(period.startDate),
      endDate: new Date(period.endDate),
      billingStartDate: new Date(period.startDate),
      billingEndDate: new Date(period.endDate),
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      signedAt: new Date(),
      activatedAt: new Date(),
    },
    include: { currentVersion: true },
  });

  if (contract.currentVersionId) {
    await prisma.contractVersion.update({
      where: { id: contract.currentVersionId },
      data: {
        isSigned: true,
        signatureStatus: ContractSignatureStatus.COMPLETED,
        companySignedById: manager.id,
        companySignedAt: new Date(),
        clientSignedAt: new Date(),
      },
    });
  }

  return { manager, employee, client, contract };
}

export async function seedDemoTimesheets() {
  const { manager, employee, client, contract } = await ensureDemoDataset();
  const dates = demoEntryDates();

  const draft = await contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
    workDate: dates.day1,
    startTime: atTime(dates.day1, '09:00'),
    endTime: atTime(dates.day1, '13:00'),
    breakMinutes: 0,
    activityType: 'Development',
    description: `${demoPrefix} - Development draft entry`,
    billable: true,
    submit: false,
  });

  const submitted = await contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
    workDate: dates.day2,
    startTime: atTime(dates.day2, '09:00'),
    endTime: atTime(dates.day2, '12:00'),
    breakMinutes: 0,
    activityType: 'Support',
    description: `${demoPrefix} - Support submitted entry`,
    billable: true,
    submit: true,
  });

  const nonBillable = await contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
    workDate: dates.day3,
    startTime: atTime(dates.day3, '14:00'),
    endTime: atTime(dates.day3, '15:00'),
    breakMinutes: 0,
    activityType: 'Internal meeting',
    description: `${demoPrefix} - Internal meeting non-billable`,
    billable: false,
    submit: true,
  });
  await contractService.approveTimeEntry(contract.id, nonBillable.id, manager, PermissionScope.ALL);

  const approved = await contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
    workDate: dates.day4,
    startTime: atTime(dates.day4, '10:00'),
    endTime: atTime(dates.day4, '12:00'),
    breakMinutes: 0,
    activityType: 'Development',
    description: `${demoPrefix} - Development approved ready to invoice`,
    billable: true,
    submit: true,
  });
  await contractService.approveTimeEntry(contract.id, approved.id, manager, PermissionScope.ALL);

  const consumption = await calculateDemoConsumption(contract.id);

  return {
    manager,
    employee,
    client,
    contract,
    entries: { draft, submitted, nonBillable, approved },
    consumption,
  };
}

export async function generateDemoInvoice() {
  const { manager, contract } = await ensureDemoDataset({ resetContractState: false });
  const dates = demoEntryDates();
  const invoice = await contractService.generateBillingInvoice(contract.id, manager, PermissionScope.ALL, {
    periodStart: dates.day1,
    periodEnd: dates.day4,
  });
  const consumption = await calculateDemoConsumption(contract.id);
  return { invoice, consumption };
}

export async function cleanDemoTimesheets(options: { includeUsers?: boolean } = {}) {
  assertDemoEnvironment();
  const client = await prisma.customer.findFirst({ where: { email: demoClientEmail } });
  if (!client) return;

  const contracts = await prisma.contract.findMany({
    where: { clientId: client.id },
    select: { id: true },
  });
  const contractIds = contracts.map((contract) => contract.id);
  if (contractIds.length) {
    await prisma.invoiceEmailLog.deleteMany({ where: { invoice: { contractId: { in: contractIds } } } });
    await prisma.payment.deleteMany({ where: { invoice: { contractId: { in: contractIds } } } });
    await prisma.reminder.deleteMany({ where: { invoice: { contractId: { in: contractIds } } } });
    await prisma.creditNoteAuditLog.deleteMany({ where: { creditNote: { invoice: { contractId: { in: contractIds } } } } });
    await prisma.creditNoteEmailLog.deleteMany({ where: { creditNote: { invoice: { contractId: { in: contractIds } } } } });
    await prisma.creditNote.deleteMany({ where: { invoice: { contractId: { in: contractIds } } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { contractId: { in: contractIds } } } });
    await prisma.contractBillingJob.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.invoice.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractTimeEntry.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractMilestone.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractBillingScheduleItem.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractEmailLog.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractAuditLog.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractSignatureLink.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contract.updateMany({ where: { id: { in: contractIds } }, data: { currentVersionId: null, signedVersionId: null } });
    await prisma.contractVersion.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  }

  await prisma.userClientAssignment.deleteMany({ where: { clientId: client.id } });
  await prisma.customer.delete({ where: { id: client.id } });

  if (options.includeUsers) {
    await prisma.user.deleteMany({ where: { email: { in: [demoEmployeeEmail, demoManagerEmail] } } });
  }
}

export async function resetDemoContractState(contractId: string) {
  await prisma.invoiceEmailLog.deleteMany({ where: { invoice: { contractId } } });
  await prisma.payment.deleteMany({ where: { invoice: { contractId } } });
  await prisma.reminder.deleteMany({ where: { invoice: { contractId } } });
  await prisma.creditNoteAuditLog.deleteMany({ where: { creditNote: { invoice: { contractId } } } });
  await prisma.creditNoteEmailLog.deleteMany({ where: { creditNote: { invoice: { contractId } } } });
  await prisma.creditNote.deleteMany({ where: { invoice: { contractId } } });
  await prisma.invoiceItem.deleteMany({ where: { invoice: { contractId } } });
  await prisma.contractBillingJob.deleteMany({ where: { contractId } });
  await prisma.invoice.deleteMany({ where: { contractId } });
  await prisma.contractTimeEntry.deleteMany({ where: { contractId } });
  await prisma.contractAuditLog.deleteMany({ where: { contractId, action: { startsWith: 'TIME_ENTRY' } } });
  await prisma.contractAuditLog.deleteMany({ where: { contractId, action: { in: ['INVOICE_GENERATED', 'AUTO_INVOICE_FAILED'] } } });
}

export async function calculateDemoConsumption(contractId: string) {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { timeEntries: true, invoices: true },
  });
  const plannedHours = Number(contract.estimatedQuantity ?? 0);
  const budgetTotal = Number(contract.amount ?? 0);
  const grossInvoiced = contract.invoices.reduce((sum, invoice) => sum + Number(invoice.subtotal), 0);
  const approvedReadyToInvoice = contract.timeEntries
    .filter((entry) => entry.status === ContractTimeEntryStatus.APPROVED && entry.billable && !entry.invoiceId)
    .reduce((sum, entry) => sum + Number(entry.calculatedAmount ?? 0), 0);
  const committed = grossInvoiced + approvedReadyToInvoice;
  const recordedHours = contract.timeEntries.reduce((sum, entry) => sum + entryHours(entry), 0);
  const submittedHours = contract.timeEntries
    .filter((entry) => entry.status === ContractTimeEntryStatus.SUBMITTED)
    .reduce((sum, entry) => sum + entryHours(entry), 0);
  const approvedHours = contract.timeEntries
    .filter((entry) => entry.status === ContractTimeEntryStatus.APPROVED)
    .reduce((sum, entry) => sum + entryHours(entry), 0);
  const invoicedHours = contract.timeEntries
    .filter((entry) => entry.status === ContractTimeEntryStatus.INVOICED)
    .reduce((sum, entry) => sum + entryHours(entry), 0);

  return {
    budgetTotal,
    grossInvoiced,
    netInvoiced: grossInvoiced,
    approvedReadyToInvoice,
    committed,
    remainingBudget: budgetTotal - committed,
    plannedHours,
    recordedHours,
    submittedHours,
    approvedHours,
    invoicedHours,
    consumedHours: approvedHours + invoicedHours,
    remainingHours: plannedHours - (approvedHours + invoicedHours),
  };
}

function entryHours(entry: { durationMinutes: number; quantity: Prisma.Decimal }) {
  return entry.durationMinutes > 0 ? entry.durationMinutes / 60 : Number(entry.quantity);
}

async function ensureDemoPermissions() {
  const permissions = [...new Set([...employeePermissions, ...managerPermissions])];
  await prisma.permission.createMany({
    data: permissions.map((key) => {
      const [resource, ...rest] = key.split('.');
      return {
        key,
        resource: resource ?? 'contracts',
        action: rest.join('.') || key,
        description: `${demoPrefix} permission ${key}`,
      };
    }),
    skipDuplicates: true,
  });
}

async function ensureRole(name: string, permissionKeys: string[], scope: PermissionScope) {
  const role = await prisma.rbacRole.upsert({
    where: { name },
    update: { description: `${demoPrefix} role`, isSystem: false },
    create: { name, description: `${demoPrefix} role`, isSystem: false },
  });
  const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { scope },
      create: { roleId: role.id, permissionId: permission.id, scope },
    });
  }
  return role;
}

export function demoPeriod() {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function demoEntryDates() {
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  return {
    day1: day(-4),
    day2: day(-3),
    day3: day(-2),
    day4: day(-1),
  };
}

function atTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}
