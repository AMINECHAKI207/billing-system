import { prisma } from '@config/database';
import {
  demoEmployeeEmail,
  demoManagerEmail,
  demoPassword,
  demoPrefix,
  generateDemoInvoice,
  seedDemoTimesheets,
} from '../src/demo/timesheets-demo.shared';

async function main() {
  const shouldGenerateInvoice = process.argv.includes('--generate-invoice');
  const result = await seedDemoTimesheets();
  console.log(`${demoPrefix} seed completed.`);
  console.log(`Contract: ${result.contract.contractNumber} (${result.contract.id})`);
  console.log(`Client: ${result.client.company ?? result.client.name}`);
  console.log(`Employee login: ${demoEmployeeEmail} / ${demoPassword}`);
  console.log(`Manager login: ${demoManagerEmail} / ${demoPassword}`);
  console.log('Entry statuses:', {
    draft: result.entries.draft.status,
    submitted: result.entries.submitted.status,
    nonBillable: 'APPROVED',
    approved: 'APPROVED',
  });
  console.log('Consumption before invoice:', result.consumption);

  if (shouldGenerateInvoice) {
    const invoiceResult = await generateDemoInvoice();
    console.log(`Invoice generated: ${invoiceResult.invoice.invoiceNumber} (${invoiceResult.invoice.id})`);
    console.log('Consumption after invoice:', invoiceResult.consumption);
  } else {
    console.log('Invoice generation skipped. Run with -- --generate-invoice to execute the final demo billing step.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
