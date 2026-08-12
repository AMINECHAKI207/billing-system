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
const adminEmail = `ai-foundation-admin-${runId}@example.com`;
const clientEmail = `ai-foundation-client-${runId}@example.com`;

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'AI Foundation Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const client = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'AI Foundation Client',
      email: clientEmail,
      company: 'AI Foundation Client SARL',
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const basePermissions = [
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
    'contracts.billing.generate',
    'devis.convert',
    'devis.view',
    'invoices.view',
    'invoices.create',
  ];

  const baseScopes: Record<string, PermissionScope> = Object.fromEntries(
    basePermissions.map((permission) => [permission, PermissionScope.ALL])
  );

  const assistantUser = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    themePreference: admin.themePreference,
    isActive: admin.isActive,
    rbacRoleId: null,
    permissions: basePermissions,
    permissionScopes: baseScopes,
  };

  try {
    const contract = await contractService.create(admin as never, PermissionScope.ALL, {
      clientId: client.id,
      title: `AI foundation contract ${runId}`,
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
      content: 'Contrat de test pour stabilisation IA.',
    });

    await prisma.contract.update({
      where: { id: contract.id },
      data: { status: ContractStatus.ACTIVE },
    });
    await prisma.contractVersion.update({
      where: { id: contract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
    });

    const entry = await contractService.createTimeEntry(contract.id, admin as never, PermissionScope.ALL, {
      workDate: today(),
      startTime: `${today()}T09:00:00.000Z`,
      endTime: `${today()}T11:00:00.000Z`,
      breakMinutes: 0,
      activityType: 'Support',
      description: 'Entry for failure test',
      billable: true,
    });

    const visibleWithoutConfirm = aiAssistantService.listTools({
      ...assistantUser,
      permissions: assistantUser.permissions.filter((permission) => permission !== 'ai_assistant.confirm_actions'),
      permissionScopes: Object.fromEntries(Object.entries(baseScopes).filter(([permission]) => permission !== 'ai_assistant.confirm_actions')),
    });
    assert.equal(visibleWithoutConfirm.some((tool) => tool.name === 'create_timesheet'), false);

    const visibleWithoutInvoiceCreate = aiAssistantService.listTools({
      ...assistantUser,
      permissions: assistantUser.permissions.filter((permission) => permission !== 'invoices.create'),
      permissionScopes: Object.fromEntries(Object.entries(baseScopes).filter(([permission]) => permission !== 'invoices.create')),
    });
    assert.equal(visibleWithoutInvoiceCreate.some((tool) => tool.name === 'convert_quote_to_invoice'), false);

    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'fr' });
    const pending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      toolName: 'update_draft_timesheet',
      input: {
        contractId: contract.id,
        timeEntryId: entry.id,
        description: 'This preview should fail after state change',
      },
      idempotencyKey: `phase1-failure-${runId}`,
    });

    const pendingAction = (pending as { action: { id: string } }).action;
    await contractService.submitTimeEntry(contract.id, entry.id, admin as never, PermissionScope.ALL);

    await assert.rejects(
      () => aiAssistantService.confirmAction(assistantUser, pendingAction.id),
      /draft or rejected/i
    );

    const failedAction = await prisma.aiPendingAction.findUniqueOrThrow({ where: { id: pendingAction.id } });
    assert.equal(failedAction.status, 'FAILED');

    console.log('AI assistant foundation phase 1 tests passed');
  } finally {
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    await prisma.aiMessage.deleteMany({ where: { conversation: { userId: admin.id } } });
    await prisma.aiConversation.deleteMany({ where: { userId: admin.id } });
    await prisma.contractTimeEntry.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contract.deleteMany({ where: { clientId: client.id } });
    await prisma.customer.deleteMany({ where: { id: client.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  }
}

function today() {
  return '2026-08-09';
}

function futureDate(days: number) {
  const date = new Date('2026-08-09T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
