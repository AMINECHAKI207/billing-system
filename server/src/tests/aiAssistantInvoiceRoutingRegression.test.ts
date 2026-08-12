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
import type { AssistantUser } from '@modules/ai-assistant/tools/toolTypes';
import { contractService } from '@modules/contract/contract.service';

const runId = Date.now();
const adminEmail = `ai-invoice-routing-admin-${runId}@example.com`;
const customerEmail = `ai-invoice-routing-customer-${runId}@example.com`;

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'AI Invoice Routing Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Test AI Client',
      email: customerEmail,
      company: 'Test AI Client',
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const assistantUser: AssistantUser = {
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
      'invoices.create',
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
      'invoices.create': PermissionScope.ALL,
      'invoices.view': PermissionScope.ALL,
    },
  };

  try {
    const contract = await createInvoiceReadyContract(admin.id, customer.id);
    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'en' });

    const customerCases = [
      { language: 'en', content: 'Create an invoice for Test AI Client' },
      { language: 'en', content: 'Create an invoice for customer Test AI Client' },
      { language: 'fr', content: 'Crée une facture pour Test AI Client' },
      { language: 'fr', content: 'Dir facture l Test AI Client' },
    ] as const;

    for (const testCase of customerCases) {
      const reply = await aiAssistantService.sendMessage(assistantUser, conversation.id, testCase);
      assert.equal(reply.executionResult, null, `Expected manual invoice clarification for "${testCase.content}"`);
      assert.match(reply.message.content, /Test AI Client/);
      assert.doesNotMatch(reply.message.content, /Test AI\b(?! Client)/);
      assert.match(reply.message.content, /date d emission|issue date/i);
      assert.match(reply.message.content, /date d echeance|due date/i);
      assert.match(reply.message.content, /devise|currency/i);
      assert.match(reply.message.content, /ligne|line item/i);
      assert.doesNotMatch(reply.message.content, /contrat a facturer|searching accessible contracts|contrats accessibles/i);
    }

    const contractCases = [
      { language: 'en', content: `Create an invoice for contract ${contract.contractNumber}` },
      { language: 'en', content: `Invoice ${contract.contractNumber}` },
    ] as const;

    for (const testCase of contractCases) {
      const reply = await aiAssistantService.sendMessage(assistantUser, conversation.id, testCase);
      const execution = reply.executionResult as { type?: string; action?: { toolName?: string } } | null;
      if (execution) {
        assert.equal(execution.type, 'pending_action');
        assert.equal(execution.action?.toolName, 'contract_invoice_workflow');
      } else {
        assert.match(reply.message.content, /approved uninvoiced entries|signature workflow|only active or sent contracts/i);
        assert.doesNotMatch(reply.message.content, /exact customer name|customer id|issue date|due date/i);
      }
    }

    const contextualReply = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
      language: 'en',
      content: 'Create an invoice from this contract',
      context: {
        entityType: 'contract',
        entityId: contract.id,
        readableReference: contract.contractNumber,
      },
    });
    const contextualExecution = contextualReply.executionResult as { type?: string; action?: { toolName?: string } } | null;
    if (contextualExecution) {
      assert.equal(contextualExecution.type, 'pending_action');
      assert.equal(contextualExecution.action?.toolName, 'contract_invoice_workflow');
    } else {
      assert.match(contextualReply.message.content, /approved uninvoiced entries|signature workflow|only active or sent contracts/i);
    }

    console.log('PASS aiAssistantInvoiceRoutingRegression.test.ts');
  } finally {
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    await prisma.aiMessage.deleteMany({ where: { conversation: { userId: admin.id } } });
    await prisma.aiConversation.deleteMany({ where: { userId: admin.id } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: customer.id } } });
    await prisma.invoice.deleteMany({ where: { customerId: customer.id } });
    await prisma.contractEmailLog.deleteMany({ where: { contract: { clientId: customer.id } } });
    await prisma.contractAuditLog.deleteMany({ where: { contract: { clientId: customer.id } } });
    await prisma.contractSignatureLink.deleteMany({ where: { contract: { clientId: customer.id } } });
    await prisma.contractTimeEntry.deleteMany({ where: { contract: { clientId: customer.id } } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: customer.id } } });
    await prisma.contract.deleteMany({ where: { clientId: customer.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
}

async function createInvoiceReadyContract(adminId: string, customerId: string) {
  const contract = await contractService.create({ id: adminId } as never, PermissionScope.ALL, {
    clientId: customerId,
    title: `AI routing contract ${runId}`,
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
    content: 'Routing regression contract fixture.',
  });

  await prisma.contract.update({
    where: { id: contract.id },
    data: { status: ContractStatus.ACTIVE },
  });

  await prisma.contractVersion.update({
    where: { id: contract.currentVersionId! },
    data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
  });

  const entry = await contractService.createTimeEntry(contract.id, { id: adminId } as never, PermissionScope.ALL, {
    workDate: today(),
    startTime: atTime('09:00'),
    endTime: atTime('12:00'),
    breakMinutes: 0,
    activityType: 'Support',
    description: 'Invoice-ready routing fixture entry',
    billable: true,
  });
  await contractService.submitTimeEntry(contract.id, entry.id, { id: adminId } as never, PermissionScope.ALL);
  await contractService.approveTimeEntry(contract.id, entry.id, { id: adminId } as never, PermissionScope.ALL);

  return contract;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function atTime(time: string) {
  return `${today()}T${time}:00.000Z`;
}

main()
  .catch((error) => {
    console.error('FAIL aiAssistantInvoiceRoutingRegression.test.ts');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
