import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractSignatureStatus,
  ContractStatus,
  DevisStatus,
  PermissionScope,
  Role,
} from '@prisma/client';
import { prisma } from './src/config/database';
import { aiAssistantService } from './src/modules/ai-assistant/aiAssistant.service';
import { contractService } from './src/modules/contract/contract.service';
import { invoiceService } from './src/modules/invoice/invoice.service';
import { devisService } from './src/modules/devis/devis.service';

// Focused intent-routing / tool-selection verification.
// IMPORTANT: this script never calls aiAssistantService.confirmAction() on any
// AI-produced WRITE pending action, so no destructive business write is ever
// executed by the assistant itself. Fixture setup below (contract/invoice/
// devis/timesheet creation) goes directly through the business services,
// exactly like the tracked aiAssistantWorkflow.test.ts does for its own setup.

const runId = Date.now();
const adminEmail = `intent-admin-${runId}@example.com`;
const customerEmail = `intent-client-${runId}@example.com`;

type Row = { scenario: string; content: string; classifiedBy?: string; domain?: string; action?: string; isWrite?: boolean; needsClarification?: boolean; resultType: string; toolName?: string; actionStatus?: string };
const rows: Row[] = [];

async function record(scenario: string, content: string, run: () => Promise<{ executionResult: unknown }>) {
  const before = new Date();
  const result = await run();
  const audit = await prisma.auditLog.findFirst({
    where: { module: 'ai_assistant', action: 'AI_INTENT_DETECTED', createdAt: { gte: before } },
    orderBy: { createdAt: 'asc' },
  });
  const metadata = (audit?.metadata ?? {}) as Record<string, unknown>;
  const execution = result.executionResult as { type?: string; toolName?: string; action?: { toolName?: string; status?: string } } | null;
  rows.push({
    scenario,
    content,
    classifiedBy: metadata.classifiedBy as string | undefined,
    domain: metadata.domain as string | undefined,
    action: metadata.action as string | undefined,
    isWrite: metadata.isWrite as boolean | undefined,
    needsClarification: metadata.needsClarification as boolean | undefined,
    resultType: execution?.type ?? 'none',
    toolName: execution?.toolName ?? execution?.action?.toolName,
    actionStatus: execution?.action?.status,
  });
}

async function main() {
  const admin = await prisma.user.create({
    data: { name: 'Intent Test Admin', email: adminEmail, passwordHash: 'not-used', role: Role.ADMIN },
  });
  const client = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'AI Client SARL',
      email: customerEmail,
      company: 'AI Client SARL',
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const assistantUser = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    themePreference: admin.themePreference,
    isActive: admin.isActive,
    rbacRoleId: null,
    permissions: [
      'ai_assistant.access',
      'ai_assistant.use_read_tools',
      'ai_assistant.use_write_tools',
      'ai_assistant.confirm_actions',
      'ai_assistant.view_history',
      'clients.view',
      'contracts.view',
      'contracts.create',
      'contracts.time_entries.create',
      'contracts.time_entries.update',
      'contracts.time_entries.submit',
      'contracts.time_entries.approve',
      'contracts.billing.generate',
      'invoices.view',
      'invoices.create',
      'invoices.update',
      'invoices.send',
      'devis.view',
      'devis.create',
      'devis.convert',
    ],
    permissionScopes: Object.fromEntries([
      'ai_assistant.access', 'ai_assistant.use_read_tools', 'ai_assistant.use_write_tools',
      'ai_assistant.confirm_actions', 'ai_assistant.view_history', 'clients.view',
      'contracts.view', 'contracts.create', 'contracts.time_entries.create',
      'contracts.time_entries.update', 'contracts.time_entries.submit', 'contracts.time_entries.approve',
      'contracts.billing.generate', 'invoices.view', 'invoices.create', 'invoices.update',
      'invoices.send', 'devis.view', 'devis.create', 'devis.convert',
    ].map((permission) => [permission, PermissionScope.ALL])),
  };

  try {
    // --- Fixtures (created directly via services, not via the AI assistant) ---
    const contract = await contractService.create(admin, PermissionScope.ALL, {
      clientId: client.id,
      title: `Intent routing contract ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: today(),
      endDate: futureDate(60),
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
      content: 'Contrat de test pour le routage semantique de l intention IA.',
    });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: ContractStatus.ACTIVE } });
    await prisma.contractVersion.update({
      where: { id: contract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
    });

    const timeEntry = await contractService.createTimeEntry(contract.id, admin, PermissionScope.ALL, {
      workDate: today(),
      startTime: atTime('09:00'),
      endTime: atTime('11:00'),
      breakMinutes: 0,
      activityType: 'Development',
      description: 'Fixture entry for approval routing test',
      billable: true,
    } as never);
    await contractService.submitTimeEntry(contract.id, timeEntry.id, admin, PermissionScope.ALL);

    const invoice = await invoiceService.createInvoice(admin, PermissionScope.ALL, {
      customerId: client.id,
      issueDate: today(),
      dueDate: futureDate(30),
      taxRate: 20,
      discount: 0,
      currency: 'MAD',
      items: [{ description: 'Consulting - initial scope', quantity: 10, unitPrice: 500 }],
    } as never);

    const devis = await devisService.createDevis(admin, PermissionScope.ALL, {
      customerId: client.id,
      status: DevisStatus.APPROVED,
      issueDate: today(),
      validUntil: futureDate(30),
      taxRate: 20,
      discount: 0,
      currency: 'MAD',
      items: [{ description: 'Proposed engagement', quantity: 1, unitPrice: 12000, discount: 0, taxRate: 20 }],
    } as never);

    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'en' });
    const cid = conversation.id;

    // --- 1. Create invoice (canonical phrasing) ---
    await record('create invoice', `Create an invoice for contract ${contract.contractNumber}`, () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: `Create an invoice for contract ${contract.contractNumber}` }));

    // --- 2-4. Paraphrased invoice creation requests ---
    await record('paraphrase 1: make an invoice', 'make an invoice for this customer', () =>
      aiAssistantService.sendMessage(assistantUser, cid, {
        language: 'en',
        content: 'make an invoice for this customer',
        context: { entityType: 'contract', entityId: contract.id, readableReference: contract.contractNumber },
      }));

    await record('paraphrase 2: bill this client', 'bill this client for the work done', () =>
      aiAssistantService.sendMessage(assistantUser, cid, {
        language: 'en',
        content: 'bill this client for the work done',
        context: { entityType: 'contract', entityId: contract.id, readableReference: contract.contractNumber },
      }));

    await record('paraphrase 3: prepare what the customer owes', 'prepare what the customer owes us so far', () =>
      aiAssistantService.sendMessage(assistantUser, cid, {
        language: 'en',
        content: 'prepare what the customer owes us so far',
        context: { entityType: 'contract', entityId: contract.id, readableReference: contract.contractNumber },
      }));

    // --- 5. Arabic/Darija invoice creation request ---
    await record('arabic/darija: create invoice', 'صايب ليا فاتورة لهاد الكليان', () =>
      aiAssistantService.sendMessage(assistantUser, cid, {
        language: 'ar',
        content: 'صايب ليا فاتورة لهاد الكليان',
        context: { entityType: 'contract', entityId: contract.id, readableReference: contract.contractNumber },
      }));

    // --- Conversational context: "show invoice X" then follow-ups referring to "it" ---
    await record('show invoice (read, sets context)', `show invoice ${invoice.invoiceNumber}`, () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: `show invoice ${invoice.invoiceNumber}` }));

    // --- 6. modify invoice ---
    await record('modify invoice', 'change its due date to next month', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'change its due date to next month' }));

    // --- 7. add invoice line ---
    await record('add invoice line', 'add a line item for 2 hours of extra support at 500 MAD', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'add a line item to this invoice for 2 hours of extra support at 500 MAD' }));

    // --- 8. change VAT ---
    await record('change VAT', 'change the VAT rate on this invoice to 10%', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'change the VAT rate on this invoice to 10%' }));

    // --- 9. generate invoice PDF ---
    await record('generate invoice PDF', 'generate its PDF', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'generate its PDF' }));

    // --- 10. send invoice email ---
    await record('send invoice email', 'email this invoice to the client', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'email this invoice to the client' }));

    // --- 11. convert quote to invoice ---
    await record('convert quote to invoice', `convert quote ${devis.devisNumber} into an invoice`, () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: `convert quote ${devis.devisNumber} into an invoice` }));

    // --- 12. approve timesheet ---
    await record('approve timesheet', `approve timesheet ${timeEntry.id} on contract ${contract.contractNumber}`, () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: `approve timesheet ${timeEntry.id} on contract ${contract.contractNumber}` }));

    // --- 13. Ambiguous WRITE request (no target identified, multiple valid interpretations) ---
    await record('ambiguous WRITE request', 'update the invoice', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'update the invoice' }));

    // --- 14. Unsupported request (no tool covers this) ---
    await record('unsupported request', 'reformat my hard drive and install a new operating system', () =>
      aiAssistantService.sendMessage(assistantUser, cid, { language: 'en', content: 'reformat my hard drive and install a new operating system' }));

    // --- Report ---
    console.log('\n=== INTENT ROUTING TEST RESULTS ===\n');
    for (const row of rows) {
      console.log(`[${row.scenario}]`);
      console.log(`  content: ${row.content}`);
      console.log(`  classifiedBy: ${row.classifiedBy ?? '-'} | domain: ${row.domain ?? '-'} | action: ${row.action ?? '-'} | isWrite: ${row.isWrite ?? '-'} | needsClarification: ${row.needsClarification ?? '-'}`);
      console.log(`  result: ${row.resultType} | tool: ${row.toolName ?? '-'} | pendingActionStatus: ${row.actionStatus ?? '-'}`);
      console.log('');
    }

    // Safety assertion: no pending action produced by this script was ever confirmed/executed.
    const executedCount = await prisma.aiPendingAction.count({ where: { userId: admin.id, status: 'EXECUTED' } });
    console.log(`Pending actions actually EXECUTED by this script: ${executedCount} (must be 0)`);
  } finally {
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    await prisma.aiMessage.deleteMany({ where: { conversation: { userId: admin.id } } });
    await prisma.aiConversation.deleteMany({ where: { userId: admin.id } });
    await prisma.devisItem.deleteMany({ where: { devis: { customerId: client.id } } });
    await prisma.devis.deleteMany({ where: { customerId: client.id } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: client.id } } });
    await prisma.invoice.deleteMany({ where: { customerId: client.id } });
    await prisma.contractTimeEntry.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contract.deleteMany({ where: { clientId: client.id } });
    await prisma.customer.deleteMany({ where: { id: client.id } });
    await prisma.user.delete({ where: { id: admin.id } });
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
  return `${today()}T${time}:00.000Z`;
}

main()
  .then(async () => {
    console.log('Intent routing test script completed.');
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
