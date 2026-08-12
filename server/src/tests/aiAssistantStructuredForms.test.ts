import assert from 'assert/strict';
import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractRenewalType,
  PermissionScope,
  Role,
} from '@prisma/client';
import { prisma } from '@config/database';
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import { contractService } from '@modules/contract/contract.service';
import type { AssistantUser } from '@modules/ai-assistant/tools/toolTypes';

const runId = Date.now();
const adminEmail = `ai-forms-admin-${runId}@example.com`;
const customerEmail = `ai-forms-customer-${runId}@example.com`;

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'AI Forms Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Test AI Client',
      company: 'Test AI Client',
      email: customerEmail,
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
      'clients.create',
      'contracts.view',
      'contracts.create',
      'contracts.time_entries.create',
      'invoices.view',
      'invoices.create',
      'devis.create',
    ],
    permissionScopes: {
      'ai_assistant.access': PermissionScope.ALL,
      'ai_assistant.use_read_tools': PermissionScope.ALL,
      'ai_assistant.use_write_tools': PermissionScope.ALL,
      'ai_assistant.confirm_actions': PermissionScope.ALL,
      'ai_assistant.view_history': PermissionScope.ALL,
      'clients.view': PermissionScope.ALL,
      'clients.create': PermissionScope.ALL,
      'contracts.view': PermissionScope.ALL,
      'contracts.create': PermissionScope.ALL,
      'contracts.time_entries.create': PermissionScope.ALL,
      'invoices.view': PermissionScope.ALL,
      'invoices.create': PermissionScope.ALL,
      'devis.create': PermissionScope.ALL,
    },
  };

  let contractId: string | null = null;
  let invoiceId: string | null = null;

  try {
    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'en' });

    const invoiceReply = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
      language: 'en',
      content: 'Create an invoice for Test AI Client',
    });

    assert.ok(invoiceReply.executionResult);
    assert.equal((invoiceReply.executionResult as { type?: string }).type, 'structured_form');
    const invoiceForm = (invoiceReply.executionResult as { form: any }).form;
    assert.equal(invoiceForm.toolName, 'create_invoice');
    assert.equal(invoiceForm.values.customerId, customer.id);
    assert.equal(
      invoiceForm.fields.find((field: any) => field.path === 'customerId')?.displayValue,
      'Test AI Client'
    );
    assert.ok(Array.isArray(invoiceForm.missingFields));
    assert.ok(invoiceForm.missingFields.includes('dueDate'));
    assert.ok(invoiceForm.missingFields.includes('items'));

    const invoicePending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'en',
      toolName: 'create_invoice',
      input: {
        customerId: customer.id,
        issueDate: '2026-08-09',
        dueDate: '2026-08-30',
        currency: 'MAD',
        items: [
          {
            description: 'Website development',
            quantity: 1,
            unitPrice: 1000,
            taxRate: 20,
          },
        ],
      },
    }) as { type: string; action?: { id: string } };

    assert.equal(invoicePending.type, 'pending_action');
    assert.ok(invoicePending.action?.id);

    const invoiceResult = await aiAssistantService.confirmAction(assistantUser, invoicePending.action!.id);
    assert.equal(invoiceResult.action.status, 'EXECUTED');
    invoiceId = String((invoiceResult.result as Record<string, unknown>).id);
    const persistedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    assert.ok(persistedInvoice);

    const quoteFormResult = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_quote',
      input: { customerId: customer.id },
    }) as { type: string; form?: { toolName?: string } };
    assert.equal(quoteFormResult.type, 'structured_form');
    assert.equal(quoteFormResult.form?.toolName, 'create_quote');

    const contractFormResult = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_contract',
      input: { clientId: customer.id },
    }) as { type: string; form?: { toolName?: string } };
    assert.equal(contractFormResult.type, 'structured_form');
    assert.equal(contractFormResult.form?.toolName, 'create_contract');

    const contract = await contractService.create(assistantUser, PermissionScope.ALL, {
      clientId: customer.id,
      title: `Structured form contract ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: '2026-08-09',
      endDate: '2026-09-09',
      renewalType: ContractRenewalType.NONE,
      amount: 0,
      currency: 'MAD',
      pricingType: ContractPricingType.HOURLY,
      unitRate: 500,
      billingFrequency: ContractBillingFrequency.MONTHLY,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      content: 'Contrat de test pour formulaire structure IA.',
    });
    contractId = contract.id;

    const timesheetFormResult = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_timesheet',
      input: { contractId: contract.id },
    }) as { type: string; form?: { toolName?: string; values?: Record<string, unknown> } };
    assert.equal(timesheetFormResult.type, 'structured_form');
    assert.equal(timesheetFormResult.form?.toolName, 'create_timesheet');
    assert.equal(timesheetFormResult.form?.values?.contractId, contract.id);

    console.log('PASS aiAssistantStructuredForms.test.ts');
  } finally {
    if (invoiceId) {
      await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => undefined);
    }
    if (contractId) {
      await prisma.contract.delete({ where: { id: contractId } }).catch(() => undefined);
    }
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    const conversations = await prisma.aiConversation.findMany({ where: { userId: admin.id }, select: { id: true } });
    if (conversations.length > 0) {
      const ids = conversations.map((item) => item.id);
      await prisma.aiMessage.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.aiConversation.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.customer.deleteMany({ where: { id: customer.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error('FAIL aiAssistantStructuredForms.test.ts');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
