import assert from 'assert/strict';
import { ContractTimeEntryStatus, PermissionScope } from '@prisma/client';
import { prisma } from '@config/database';
import { contractService } from '@modules/contract/contract.service';
import {
  calculateDemoConsumption,
  cleanDemoTimesheets,
  demoEntryDates,
  seedDemoTimesheets,
} from '../demo/timesheets-demo.shared';

async function main() {
  await cleanDemoTimesheets({ includeUsers: true });
  const demo = await seedDemoTimesheets();

  try {
    assert.equal(demo.contract.pricingType, 'HOURLY');
    assert.equal(Number(demo.contract.unitRate), 500);
    assert.equal(Number(demo.contract.estimatedQuantity), 200);

    const entriesBeforeInvoice = await prisma.contractTimeEntry.findMany({
      where: { contractId: demo.contract.id },
      orderBy: { workDate: 'asc' },
    });

    assert.equal(entriesBeforeInvoice.length, 4);
    assert.equal(entriesBeforeInvoice.filter((entry) => entry.status === ContractTimeEntryStatus.DRAFT).length, 1);
    assert.equal(entriesBeforeInvoice.filter((entry) => entry.status === ContractTimeEntryStatus.SUBMITTED).length, 1);
    assert.equal(entriesBeforeInvoice.filter((entry) => entry.status === ContractTimeEntryStatus.APPROVED).length, 2);
    assert.equal(entriesBeforeInvoice.filter((entry) => !entry.billable).length, 1);
    assert.equal(entriesBeforeInvoice.every((entry) => Number(entry.appliedRate ?? 0) === 500), true);

    const before = await calculateDemoConsumption(demo.contract.id);
    assert.equal(before.budgetTotal, 100000);
    assert.equal(before.grossInvoiced, 0);
    assert.equal(before.approvedReadyToInvoice, 1000);
    assert.equal(before.committed, 1000);
    assert.equal(before.remainingBudget, 99000);
    assert.equal(before.plannedHours, 200);
    assert.equal(before.recordedHours, 10);
    assert.equal(before.submittedHours, 3);
    assert.equal(before.approvedHours, 3);

    const dates = demoEntryDates();
    const invoice = await contractService.generateBillingInvoice(demo.contract.id, demo.manager, PermissionScope.ALL, {
      periodStart: dates.day1,
      periodEnd: dates.day4,
    });

    assert.equal(invoice.contractId, demo.contract.id);
    assert.equal(Number(invoice.subtotal), 1000);
    assert.equal(Number(invoice.taxRate), 20);
    assert.equal(Number(invoice.taxAmount), 200);
    assert.equal(Number(invoice.total), 1200);
    assert.equal(invoice.items.length, 1);
    assert.equal(Number(invoice.items[0]!.quantity), 2);

    const entriesAfterInvoice = await prisma.contractTimeEntry.findMany({ where: { contractId: demo.contract.id } });
    const invoicedEntries = entriesAfterInvoice.filter((entry) => entry.status === ContractTimeEntryStatus.INVOICED);
    assert.equal(invoicedEntries.length, 1);
    assert.equal(invoicedEntries[0]!.invoiceId, invoice.id);

    const after = await calculateDemoConsumption(demo.contract.id);
    assert.equal(after.grossInvoiced, 1000);
    assert.equal(after.approvedReadyToInvoice, 0);
    assert.equal(after.committed, 1000);
    assert.equal(after.invoicedHours, 2);

    await assert.rejects(
      () => contractService.generateBillingInvoice(demo.contract.id, demo.manager, PermissionScope.ALL, {
        periodStart: dates.day1,
        periodEnd: dates.day4,
      }),
      /already exists|No approved/
    );

    const audits = await prisma.contractAuditLog.findMany({ where: { contractId: demo.contract.id } });
    assert.ok(audits.some((audit) => audit.action === 'TIME_ENTRY_SUBMITTED'));
    assert.ok(audits.some((audit) => audit.action === 'TIME_ENTRY_APPROVED'));
    assert.ok(audits.some((audit) => audit.action === 'INVOICE_GENERATED'));
  } finally {
    await cleanDemoTimesheets({ includeUsers: true });
  }
}

main()
  .then(() => {
    console.log('Contract timesheets demo workflow test passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
