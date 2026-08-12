import assert from 'assert/strict';
import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractSignatureStatus,
  ContractStatus,
  PermissionScope,
  Role,
} from '@prisma/client';
import { prisma } from '@config/database';
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import { contractService } from '@modules/contract/contract.service';

const runId = Date.now();
const adminEmail = `ai-contract-admin-${runId}@example.com`;
const clientEmail = `global-reach-${runId}@example.com`;

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'AI Contract Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const client = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Global Reach LLC',
      email: clientEmail,
      company: 'Global Reach LLC',
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
      'contracts.time_entries.submit',
      'contracts.time_entries.approve',
      'contracts.billing.generate',
      'invoices.view',
    ],
    permissionScopes: {
      'ai_assistant.access': PermissionScope.ALL,
      'ai_assistant.use_read_tools': PermissionScope.ALL,
      'ai_assistant.use_write_tools': PermissionScope.ALL,
      'ai_assistant.confirm_actions': PermissionScope.ALL,
      'ai_assistant.view_history': PermissionScope.ALL,
      'clients.view': PermissionScope.ALL,
      'contracts.view': PermissionScope.ALL,
      'contracts.create': PermissionScope.ALL,
      'contracts.time_entries.create': PermissionScope.ALL,
      'contracts.time_entries.submit': PermissionScope.ALL,
      'contracts.time_entries.approve': PermissionScope.ALL,
      'contracts.billing.generate': PermissionScope.ALL,
      'invoices.view': PermissionScope.ALL,
    },
  };

  try {
    const unsignedContract = await createHourlyContract(admin, client.id, `AI unsigned contract ${runId}`, 450);
    await prisma.contractVersion.update({
      where: { id: unsignedContract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.NOT_STARTED, isSigned: false },
    });

    const noEntriesContract = await createHourlyContract(admin, client.id, `AI no entries contract ${runId}`, 475);
    await prisma.contractVersion.update({
      where: { id: noEntriesContract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
    });

    const readyContract = await createHourlyContract(admin, client.id, `AI ready contract ${runId}`, 500);
    await prisma.contractVersion.update({
      where: { id: readyContract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
    });

    const readyEntry = await contractService.createTimeEntry(readyContract.id, admin, PermissionScope.ALL, {
      workDate: today(),
      startTime: atTime('09:00'),
      endTime: atTime('12:00'),
      breakMinutes: 0,
      activityType: 'Support',
      description: 'Timesheet pret pour facturation IA',
      billable: true,
    });
    await contractService.submitTimeEntry(readyContract.id, readyEntry.id, admin, PermissionScope.ALL);
    await contractService.approveTimeEntry(readyContract.id, readyEntry.id, admin, PermissionScope.ALL);

    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'fr' });

    const scenario1PendingBefore = await prisma.aiPendingAction.count({
      where: { conversationId: conversation.id, status: 'PENDING' },
    });
    const invalidSignatureIntent = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
      language: 'fr',
      content: 'Cree une facture pour ce contrat',
      context: {
        entityType: 'contract',
        entityId: unsignedContract.id,
        readableReference: unsignedContract.contractNumber,
      },
    });
    assert.equal(invalidSignatureIntent.executionResult, null);
    assert.match(invalidSignatureIntent.message.content, /workflow de signature|signature du contrat/i);
    assert.equal(
      await prisma.aiPendingAction.count({ where: { conversationId: conversation.id, status: 'PENDING' } }),
      scenario1PendingBefore
    );

    const scenario2PendingBefore = await prisma.aiPendingAction.count({
      where: { conversationId: conversation.id, status: 'PENDING' },
    });
    const noEntriesIntent = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
      language: 'fr',
      content: 'Cree une facture pour ce contrat',
      context: {
        entityType: 'contract',
        entityId: noEntriesContract.id,
        readableReference: noEntriesContract.contractNumber,
      },
    });
    assert.equal(noEntriesIntent.executionResult, null);
    assert.match(noEntriesIntent.message.content, /aucune entree approuvee non facturee/i);
    assert.equal(
      await prisma.aiPendingAction.count({ where: { conversationId: conversation.id, status: 'PENDING' } }),
      scenario2PendingBefore
    );

    const typoInvoiceIntent = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
      language: 'en',
      content: 'create invoice for Global Reacj LLC',
    });
    assert.equal(typoInvoiceIntent.executionResult, null);
    assert.match(typoInvoiceIntent.message.content, /global reacj llc/i);
    assert.match(typoInvoiceIntent.message.content, /exact customer name|contract reference|nom client exact|reference de contrat/i);

    const invoiceCountBefore = await prisma.invoice.count({ where: { customerId: client.id } });
    const pendingWorkflow = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      toolName: 'contract_invoice_workflow',
      input: { contractId: readyContract.id, periodStart: today(), periodEnd: futureDate(30) },
      idempotencyKey: `focused-invoice-${runId}`,
    });
    assert.equal((pendingWorkflow as { type: string }).type, 'pending_action');
    const pendingAction = (pendingWorkflow as { action: { id: string; status: string } }).action;
    assert.equal(pendingAction.status, 'PENDING');

    const revisedWorkflow = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      toolName: 'contract_invoice_workflow',
      input: { contractId: readyContract.id, periodStart: today(), periodEnd: futureDate(30) },
      idempotencyKey: `focused-invoice-${runId}`,
      replaceActionId: pendingAction.id,
    });
    assert.equal((revisedWorkflow as { type: string }).type, 'pending_action');
    assert.equal((revisedWorkflow as { action: { id: string } }).action.id, pendingAction.id);

    const firstConfirmation = await aiAssistantService.confirmAction(assistantUser, pendingAction.id);
    const secondConfirmation = await aiAssistantService.confirmAction(assistantUser, pendingAction.id);
    const firstInvoice = (firstConfirmation.result as { invoice: { id: string; invoiceNumber: string } }).invoice;
    const secondInvoice = (secondConfirmation.result as { invoice: { id: string; invoiceNumber: string } }).invoice;

    assert.equal(firstConfirmation.action.status, 'EXECUTED');
    assert.equal(secondConfirmation.action.status, 'EXECUTED');
    assert.equal(firstInvoice.id, secondInvoice.id);
    assert.ok(firstInvoice.invoiceNumber.startsWith('INV-'));
    assert.equal(
      await prisma.invoice.count({ where: { customerId: client.id } }),
      invoiceCountBefore + 1
    );

    const persistedInvoice = await prisma.invoice.findUnique({ where: { id: firstInvoice.id } });
    assert.ok(persistedInvoice, 'Expected the generated invoice to exist in the database');

    const updatedAction = await prisma.aiPendingAction.findUniqueOrThrow({ where: { id: pendingAction.id } });
    assert.equal(updatedAction.status, 'EXECUTED');

    console.log(JSON.stringify({
      scenario1: 'PASS',
      scenario2: 'PASS',
      scenario3: 'PASS',
      typoResolution: 'PASS',
      invoiceCreated: true,
      invoiceId: firstInvoice.id,
      invoiceNumber: firstInvoice.invoiceNumber,
    }));
  } finally {
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    await prisma.aiMessage.deleteMany({ where: { conversation: { userId: admin.id } } });
    await prisma.aiConversation.deleteMany({ where: { userId: admin.id } });
    await prisma.contractEmailLog.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractAuditLog.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractSignatureLink.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: client.id } } });
    await prisma.invoice.deleteMany({ where: { customerId: client.id } });
    await prisma.contractTimeEntry.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contract.deleteMany({ where: { clientId: client.id } });
    await prisma.customer.deleteMany({ where: { id: client.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  }
}

async function createHourlyContract(admin: { id: string }, clientId: string, title: string, unitRate: number) {
  const contract = await contractService.create(admin as never, PermissionScope.ALL, {
    clientId,
    title,
    contractType: 'SERVICE',
    language: 'fr',
    startDate: today(),
    endDate: futureDate(30),
    renewalType: 'NONE',
    amount: 0,
    currency: 'MAD',
    pricingType: ContractPricingType.HOURLY,
    unitRate,
    billingFrequency: ContractBillingFrequency.MONTHLY,
    taxRate: 20,
    paymentTermsDays: 30,
    autoInvoiceEnabled: false,
    prorationPolicy: ContractProrationPolicy.NONE,
    content: `${title} - contenu de test pour prevalidation IA.`,
  });
  await prisma.contract.update({
    where: { id: contract.id },
    data: { status: ContractStatus.ACTIVE },
  });
  return contract;
}

function today() {
  return '2026-08-08';
}

function futureDate(days: number) {
  const date = new Date('2026-08-08T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function atTime(time: string) {
  return `${today()}T${time}:00.000Z`;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
