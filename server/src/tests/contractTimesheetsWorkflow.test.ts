import assert from 'assert/strict';
import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractSignatureStatus,
  ContractStatus,
  ContractTimeEntryStatus,
  PermissionScope,
  Role,
} from '@prisma/client';
import { prisma } from '@config/database';
import { contractService } from '@modules/contract/contract.service';

const runId = Date.now();
const adminEmail = `timesheets-admin-${runId}@example.com`;
const employeeEmail = `timesheets-employee-${runId}@example.com`;
const customerEmail = `timesheets-client-${runId}@example.com`;

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'Timesheets Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });
  const employee = await prisma.user.create({
    data: {
      name: 'Timesheets Employee',
      email: employeeEmail,
      passwordHash: 'not-used',
      role: Role.EMPLOYEE,
    },
  });
  const client = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Timesheets Client',
      email: customerEmail,
      company: 'Timesheets Client SARL',
      country: 'Morocco',
      countryCode: 'MA',
    },
  });
  await prisma.userClientAssignment.create({
    data: {
      userId: employee.id,
      clientId: client.id,
    },
  });

  try {
    const contract = await contractService.create(admin, PermissionScope.ALL, {
      clientId: client.id,
      title: `Contrat horaire ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: today(),
      endDate: futureDate(30),
      renewalType: 'NONE',
      amount: 0,
      currency: 'MAD',
      pricingType: ContractPricingType.HOURLY,
      unitRate: 500,
      billingFrequency: ContractBillingFrequency.MONTHLY,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      content: 'Contrat horaire de test pour les feuilles de temps.',
    });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: ContractStatus.ACTIVE } });
    await prisma.contractVersion.update({
      where: { id: contract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
    });

    const firstEntry = await contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
      workDate: today(),
      startTime: atTime('09:00'),
      endTime: atTime('12:30'),
      breakMinutes: 30,
      description: 'Analyse et developpement',
      activityType: 'Development',
      billable: true,
      submit: false,
    });
    assert.equal(firstEntry.status, ContractTimeEntryStatus.DRAFT);
    assert.equal(firstEntry.durationMinutes, 180);
    assert.equal(firstEntry.billableMinutes, 180);
    assert.equal(Number(firstEntry.quantity), 3);
    assert.equal(Number(firstEntry.calculatedAmount), 1500);
    assert.equal(firstEntry.currency, 'MAD');

    await assert.rejects(
      () => contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
        workDate: today(),
        startTime: atTime('11:00'),
        endTime: atTime('13:00'),
        breakMinutes: 0,
        description: 'Chevauchement interdit',
        billable: true,
        submit: false,
      }),
      /overlaps/
    );

    const edited = await contractService.updateTimeEntry(contract.id, firstEntry.id, employee, PermissionScope.SELECTED, {
      description: 'Analyse, developpement et revue',
      internalNote: 'Note interne test',
    });
    assert.equal(edited.status, ContractTimeEntryStatus.DRAFT);
    assert.equal(edited.description, 'Analyse, developpement et revue');

    const submitted = await contractService.submitTimeEntry(contract.id, firstEntry.id, employee, PermissionScope.SELECTED);
    assert.equal(submitted.status, ContractTimeEntryStatus.SUBMITTED);
    await assert.rejects(
      () => contractService.updateTimeEntry(contract.id, firstEntry.id, employee, PermissionScope.SELECTED, {
        description: 'Modification interdite apres soumission',
      }),
      /Only draft or rejected/
    );

    const approved = await contractService.approveTimeEntry(contract.id, firstEntry.id, admin, PermissionScope.ALL);
    assert.equal(approved.status, ContractTimeEntryStatus.APPROVED);

    const invoice = await contractService.generateBillingInvoice(contract.id, admin, PermissionScope.ALL, {
      periodStart: today(),
      periodEnd: futureDate(30),
    });
    assert.equal(invoice.contractId, contract.id);
    assert.equal(Number(invoice.subtotal), 1500);
    assert.equal(Number(invoice.taxRate), 20);

    const invoicedEntry = await prisma.contractTimeEntry.findUniqueOrThrow({ where: { id: firstEntry.id } });
    assert.equal(invoicedEntry.status, ContractTimeEntryStatus.INVOICED);
    assert.equal(invoicedEntry.invoiceId, invoice.id);

    const rejectedCandidate = await contractService.createTimeEntry(contract.id, employee, PermissionScope.SELECTED, {
      workDate: futureDate(1),
      quantity: 2,
      breakMinutes: 0,
      description: 'Support client',
      billable: true,
      submit: true,
    });
    assert.equal(rejectedCandidate.status, ContractTimeEntryStatus.SUBMITTED);
    const rejected = await contractService.rejectTimeEntry(contract.id, rejectedCandidate.id, admin, PermissionScope.ALL, {
      reason: 'Description insuffisante',
    });
    assert.equal(rejected.status, ContractTimeEntryStatus.REJECTED);
    assert.equal(rejected.rejectionReason, 'Description insuffisante');
  } finally {
    await prisma.contractEmailLog.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractAuditLog.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractSignatureLink.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: client.id } } });
    await prisma.invoice.deleteMany({ where: { customerId: client.id } });
    await prisma.contractTimeEntry.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contract.deleteMany({ where: { clientId: client.id } });
    await prisma.userClientAssignment.deleteMany({ where: { clientId: client.id } });
    await prisma.customer.delete({ where: { id: client.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, employee.id] } } });
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function atTime(time: string) {
  return new Date(`${today()}T${time}:00`).toISOString();
}

main()
  .then(() => {
    console.log('Contract timesheets workflow tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
