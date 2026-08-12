import assert from 'assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { ExpenseSource, PermissionScope, Role, ContractPricingType, ContractBillingFrequency, ContractProrationPolicy } from '@prisma/client';
import { prisma } from '@config/database';
import { env } from '@config/env';
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import { contractService } from '@modules/contract/contract.service';
import { invoiceService } from '@modules/invoice/invoice.service';
import { settingsRepository } from '@modules/settings/settings.repository';

const runId = Date.now();
const adminEmail = `ai-phase2-admin-${runId}@example.com`;
const clientEmail = `ai-phase2-client-${runId}@example.com`;
const productName = `AI Phase2 Product ${runId}`;
const permissionKey = `ai_phase2.${runId}.manage`;

async function main() {
  const originalSettings = await settingsRepository.getCompanySettings();
  const admin = await prisma.user.create({
    data: {
      name: 'AI Phase2 Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: `AI Phase2 Client ${runId}`,
      email: clientEmail,
      company: `AI Phase2 Client ${runId} SARL`,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const permissions = [
    'ai_assistant.access',
    'ai_assistant.use_read_tools',
    'ai_assistant.use_write_tools',
    'ai_assistant.confirm_actions',
    'clients.view',
    'contracts.view',
    'contracts.email.history',
    'contract_templates.view',
    'invoices.view',
    'invoices.create',
    'products.view',
    'products.create',
    'products.update',
    'recurring.view',
    'recurring.create',
    'recurring.update',
    'recurring.run',
    'reminders.view',
    'reminders.create',
    'reminders.manage',
    'expense_notes.view',
    'expense_notes.create',
    'expense_notes.update',
    'expense_notes.export.excel',
    'expense_categories.manage',
    'expense_types.manage',
    'settings.view',
    'settings.update',
    'permissions.view',
    'permissions.assign',
  ];

  const permissionScopes: Record<string, PermissionScope> = Object.fromEntries(
    permissions.map((permission) => [permission, PermissionScope.ALL])
  );

  const user = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    themePreference: admin.themePreference,
    isActive: admin.isActive,
    rbacRoleId: null,
    permissions,
    permissionScopes,
  };

  const limitedUser = {
    ...user,
    permissions: permissions.filter((permission) => ![
      'products.create',
      'recurring.run',
      'reminders.manage',
      'expense_categories.manage',
      'settings.update',
      'permissions.assign',
    ].includes(permission)),
    permissionScopes: Object.fromEntries(
      Object.entries(permissionScopes).filter(([permission]) => ![
        'products.create',
        'recurring.run',
        'reminders.manage',
        'expense_categories.manage',
        'settings.update',
        'permissions.assign',
      ].includes(permission))
    ),
  };

  const exportOnlyPdfUser = {
    ...user,
    permissions: permissions.filter((permission) => permission !== 'expense_notes.export.excel').concat('expense_notes.pdf.bulk_export'),
    permissionScopes: {
      ...permissionScopes,
      'expense_notes.pdf.bulk_export': PermissionScope.ALL,
    },
  };

  const recurringConversation = await aiAssistantService.createConversation(user, { language: 'fr' });
  const genericConversation = await aiAssistantService.createConversation(user, { language: 'fr' });

  const contract = await contractService.create(admin as never, PermissionScope.ALL, {
    clientId: customer.id,
    title: `AI Phase2 Contract ${runId}`,
    contractType: 'SERVICE',
    language: 'fr',
    startDate: '2026-08-09',
    endDate: '2026-09-30',
    renewalType: 'NONE',
    amount: 0,
    currency: 'MAD',
    pricingType: ContractPricingType.HOURLY,
    unitRate: 400,
    billingFrequency: ContractBillingFrequency.MONTHLY,
    taxRate: 20,
    paymentTermsDays: 30,
    autoInvoiceEnabled: false,
    prorationPolicy: ContractProrationPolicy.NONE,
    content: 'Contrat IA Phase 2 pour test des outils avances.',
  });

  const manualReminderInvoice = await invoiceService.createInvoice(admin as never, PermissionScope.ALL, {
    customerId: customer.id,
    status: 'SENT',
    issueDate: '2026-08-01',
    dueDate: '2026-08-15',
    currency: 'MAD',
    discount: 0,
    items: [{ description: 'Reminder service', quantity: 1, unitPrice: 1200, taxRate: 20 }],
  });

  const dueReminderInvoice = await invoiceService.createInvoice(admin as never, PermissionScope.ALL, {
    customerId: customer.id,
    status: 'OVERDUE',
    issueDate: '2026-07-10',
    dueDate: '2026-07-20',
    currency: 'MAD',
    discount: 0,
    items: [{ description: 'Overdue reminder service', quantity: 1, unitPrice: 850, taxRate: 20 }],
  });

  const availableTools = aiAssistantService.listTools(user).map((tool) => tool.name);
  assert.equal(availableTools.includes('create_product'), true);
  assert.equal(availableTools.includes('run_recurring_plan_now'), true);
  assert.equal(availableTools.includes('create_permission'), true);
  assert.equal(availableTools.includes('list_contract_templates'), true);

  const restrictedTools = aiAssistantService.listTools(limitedUser).map((tool) => tool.name);
  assert.equal(restrictedTools.includes('create_product'), false);
  assert.equal(restrictedTools.includes('run_recurring_plan_now'), false);
  assert.equal(restrictedTools.includes('run_due_reminders'), false);
  assert.equal(restrictedTools.includes('create_expense_category'), false);
  assert.equal(restrictedTools.includes('delete_company_asset'), false);
  assert.equal(restrictedTools.includes('create_permission'), false);

  const exportTools = aiAssistantService.listTools(exportOnlyPdfUser).map((tool) => tool.name);
  assert.equal(exportTools.includes('export_expenses'), true);

  await assert.rejects(
    () => aiAssistantService.executeTool(limitedUser, {
      conversationId: genericConversation.id,
      toolName: 'create_product',
      input: {
        name: `Blocked Product ${runId}`,
        unitPrice: 10,
        taxRate: 20,
      },
    }),
    /not allowed|required authorization|permission/i
  );

  const createdProduct = await confirmTool(user, genericConversation.id, 'create_product', {
    name: productName,
    description: 'Produit test AI Phase 2',
    unit: 'service',
    unitPrice: 100,
    taxRate: 20,
    isActive: true,
  }, `phase2-product-create-${runId}`);
  assert.equal(createdProduct.name, productName);

  const updatedProduct = await confirmTool(user, genericConversation.id, 'update_product', {
    id: createdProduct.id,
    unitPrice: 125,
    description: 'Produit test AI Phase 2 mis a jour',
  }, `phase2-product-update-${runId}`);
  assert.equal(Number(updatedProduct.unitPrice), 125);

  const recurringPlan = await confirmTool(user, recurringConversation.id, 'create_recurring_plan', {
    customerId: customer.id,
    name: `AI Phase2 Recurring ${runId}`,
    frequency: 'MONTHLY',
    intervalCount: 1,
    startDate: '2026-08-09',
    dueDays: 15,
    autoSend: false,
    currency: 'MAD',
    discount: 0,
    items: [{ description: 'Monthly support', quantity: 1, unitPrice: 700, taxRate: 20 }],
  }, `phase2-recurring-create-${runId}`);
  assert.equal(recurringPlan.name.includes(`AI Phase2 Recurring ${runId}`), true);

  const updatedPlan = await confirmTool(user, recurringConversation.id, 'update_recurring_plan', {
    id: recurringPlan.id,
    notes: 'Plan AI Phase 2 mis a jour',
  }, `phase2-recurring-update-${runId}`);
  assert.equal(updatedPlan.notes, 'Plan AI Phase 2 mis a jour');

  const pausedPlan = await confirmTool(user, recurringConversation.id, 'change_recurring_plan_status', {
    id: recurringPlan.id,
    status: 'PAUSED',
  }, `phase2-recurring-pause-${runId}`);
  assert.equal(pausedPlan.status, 'PAUSED');

  const activePlan = await confirmTool(user, recurringConversation.id, 'change_recurring_plan_status', {
    id: recurringPlan.id,
    status: 'ACTIVE',
  }, `phase2-recurring-active-${runId}`);
  assert.equal(activePlan.status, 'ACTIVE');

  const runNowPending = await aiAssistantService.executeTool(user, {
    conversationId: recurringConversation.id,
    toolName: 'run_recurring_plan_now',
    input: { id: recurringPlan.id },
    idempotencyKey: `phase2-recurring-run-${runId}`,
  }) as { action: { id: string } };
  const firstRun = await aiAssistantService.confirmAction(user, runNowPending.action.id);
  const secondRun = await aiAssistantService.confirmAction(user, runNowPending.action.id);
  const recurringExecutions = await prisma.recurringExecution.findMany({ where: { planId: recurringPlan.id } });
  const recurringInvoices = await prisma.invoice.findMany({ where: { recurringPlanId: recurringPlan.id } });
  assert.equal(recurringExecutions.length, 1);
  assert.equal(recurringInvoices.length, 1);
  assert.equal((firstRun.action.status as string), 'EXECUTED');
  assert.equal((secondRun.action.status as string), 'EXECUTED');

  const createdReminder = await confirmTool(user, genericConversation.id, 'create_reminder', {
    invoiceId: manualReminderInvoice.id,
    type: 'MANUAL',
    recipientEmail: customer.email,
    subject: `Phase 2 Reminder ${runId}`,
    body: 'Merci de regler cette facture des que possible.',
    sendEmail: false,
  }, `phase2-reminder-create-${runId}`);
  assert.equal(createdReminder.invoiceId, manualReminderInvoice.id);
  assert.equal(createdReminder.status, 'PENDING');

  const dueReminders = await confirmTool(user, genericConversation.id, 'run_due_reminders', {}, `phase2-reminder-run-due-${runId}`);
  assert.equal(dueReminders.createdCount >= 1, true);

  const expenseCategory = await confirmTool(user, genericConversation.id, 'create_expense_category', {
    name: `AI Phase2 Category ${runId}`,
    active: true,
  }, `phase2-expense-category-create-${runId}`);
  assert.equal(expenseCategory.name, `AI Phase2 Category ${runId}`);

  const updatedCategory = await confirmTool(user, genericConversation.id, 'update_expense_category', {
    id: expenseCategory.id,
    name: `AI Phase2 Category ${runId} Updated`,
  }, `phase2-expense-category-update-${runId}`);
  assert.equal(updatedCategory.name, `AI Phase2 Category ${runId} Updated`);

  const expenseType = await confirmTool(user, genericConversation.id, 'create_expense_type', {
    categoryId: expenseCategory.id,
    name: `AI Phase2 Type ${runId}`,
    active: true,
  }, `phase2-expense-type-create-${runId}`);
  assert.equal(expenseType.name, `AI Phase2 Type ${runId}`);

  const updatedType = await confirmTool(user, genericConversation.id, 'update_expense_type', {
    id: expenseType.id,
    name: `AI Phase2 Type ${runId} Updated`,
  }, `phase2-expense-type-update-${runId}`);
  assert.equal(updatedType.name, `AI Phase2 Type ${runId} Updated`);

  const expenseNote = await confirmTool(user, genericConversation.id, 'create_expense', {
    categoryId: expenseCategory.id,
    expenseTypeId: expenseType.id,
    expenseDate: new Date('2026-08-09T10:00:00.000Z').toISOString(),
    amountTTC: 240,
    amountHT: 200,
    vatAmount: 40,
    vatRate: 20,
    comment: `AI Phase2 Expense ${runId}`,
    merchantName: 'Phase2 Merchant',
    receiptNumber: `PH2-${runId}`,
    currency: 'MAD',
    source: ExpenseSource.MANUAL,
  }, `phase2-expense-create-${runId}`);
  assert.equal(expenseNote.comment, `AI Phase2 Expense ${runId}`);

  const expenseExport = await confirmTool(user, genericConversation.id, 'export_expenses', {
    ids: [expenseNote.id],
    format: 'excel',
    language: 'fr',
    includeReceipts: false,
  }, `phase2-expense-export-${runId}`);
  assert.equal(expenseExport.fileName.endsWith('.xlsx'), true);
  assert.equal(expenseExport.sizeBytes > 0, true);

  const createdPermission = await confirmTool(user, genericConversation.id, 'create_permission', {
    key: permissionKey,
    description: 'Permission de test AI Phase 2',
  }, `phase2-permission-create-${runId}`);
  assert.equal(createdPermission.key, permissionKey);

  await confirmTool(user, genericConversation.id, 'delete_permission', {
    id: createdPermission.id,
  }, `phase2-permission-delete-${runId}`);
  const deletedPermission = await prisma.permission.findUnique({ where: { id: createdPermission.id } });
  assert.equal(deletedPermission, null);

  const uploadsRoot = path.resolve(process.cwd(), env.UPLOADS_DIR);
  const assetDir = path.join(uploadsRoot, 'company-assets');
  await fs.mkdir(assetDir, { recursive: true });
  const signatureFileName = `signature-phase2-${runId}.png`;
  const signaturePath = path.join(assetDir, signatureFileName);
  await fs.writeFile(signaturePath, tinyPngBuffer(), { flag: 'w' });
  await settingsRepository.updateCompanyAsset('signature', `/uploads/company-assets/${signatureFileName}`);

  let settingsBackgroundStatus: 'PASS' | 'BLOCKED' = 'PASS';
  try {
    const cleanedSettings = await confirmTool(user, genericConversation.id, 'remove_company_asset_background', {
      kind: 'signature',
    }, `phase2-settings-clean-bg-${runId}`);
    assert.equal(typeof cleanedSettings.signatureUrl, 'string');
    assert.equal(cleanedSettings.signatureUrl.includes('/uploads/company-assets/'), true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/torch|background|vipspng|worker ia/i.test(message)) {
      settingsBackgroundStatus = 'BLOCKED';
    } else {
      throw error;
    }
  }

  const clearedSettings = await confirmTool(user, genericConversation.id, 'delete_company_asset', {
    kind: 'signature',
  }, `phase2-settings-delete-asset-${runId}`);
  assert.equal(clearedSettings.signatureUrl, null);

  const templates = await aiAssistantService.executeTool(user, {
    conversationId: genericConversation.id,
    toolName: 'list_contract_templates',
    input: { includeInactive: false },
  }) as { result: unknown[] };
  assert.equal(Array.isArray(templates.result), true);

  const contractHistory = await aiAssistantService.executeTool(user, {
    conversationId: genericConversation.id,
    toolName: 'get_contract_email_history',
    input: { id: contract.id },
  }) as { result: unknown[] };
  assert.equal(Array.isArray(contractHistory.result), true);

  console.log(JSON.stringify({
    products: 'PASS',
    recurring: 'PASS',
    reminders: 'PASS',
    expenses: 'PASS',
    settings: 'PASS',
    settingsBackgroundRemoval: settingsBackgroundStatus,
    rbac: 'PASS',
    contracts: 'PASS',
    invoiceCreatedFromRecurring: recurringInvoices[0]?.invoiceNumber ?? null,
  }));

  await restoreSettings(originalSettings);
  await cleanup(admin.id, customer.id, contract.id);
}

async function confirmTool(
  user: Parameters<typeof aiAssistantService.executeTool>[0],
  conversationId: string,
  toolName: string,
  input: Record<string, unknown>,
  idempotencyKey: string
) {
  const pending = await aiAssistantService.executeTool(user, {
    conversationId,
    toolName,
    input,
    idempotencyKey,
  }) as { type: string; action: { id: string } };
  assert.equal(pending.type, 'pending_action');
  const confirmed = await aiAssistantService.confirmAction(user, pending.action.id);
  return confirmed.result as Record<string, any>;
}

async function restoreSettings(original: Awaited<ReturnType<typeof settingsRepository.getCompanySettings>>) {
  await prisma.companySettings.upsert({
    where: { id: original.id },
    create: original,
    update: {
      name: original.name,
      address: original.address,
      phone: original.phone,
      email: original.email,
      taxNumber: original.taxNumber,
      logoUrl: original.logoUrl,
      signatureUrl: original.signatureUrl,
      stampUrl: original.stampUrl,
      defaultCurrency: original.defaultCurrency,
      defaultTaxRate: original.defaultTaxRate,
      vatEnabled: original.vatEnabled,
      moroccoVatRate: original.moroccoVatRate,
      paymentTerms: original.paymentTerms,
      bankDetails: original.bankDetails,
    },
  });
}

async function cleanup(adminId: string, customerId: string, contractId: string) {
  await prisma.aiPendingAction.deleteMany({ where: { userId: adminId } });
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: adminId } } });
  await prisma.aiConversation.deleteMany({ where: { userId: adminId } });

  await prisma.contractEmailLog.deleteMany({ where: { contractId } });
  await prisma.contractSignatureLink.deleteMany({ where: { contractId } });
  await prisma.contractAuditLog.deleteMany({ where: { contractId } });
  await prisma.contractTimeEntry.deleteMany({ where: { contractId } });
  await prisma.contractVersion.deleteMany({ where: { contractId } });
  await prisma.contract.deleteMany({ where: { id: contractId } });

  await prisma.reminder.deleteMany({ where: { invoice: { customerId } } });
  await prisma.invoiceEmailLog.deleteMany({ where: { invoice: { customerId } } });
  await prisma.payment.deleteMany({ where: { invoice: { customerId } } });
  await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId } } });
  await prisma.invoice.deleteMany({ where: { customerId } });

  await prisma.recurringExecution.deleteMany({ where: { plan: { customerId } } });
  await prisma.recurringPlanItem.deleteMany({ where: { plan: { customerId } } });
  await prisma.recurringPlan.deleteMany({ where: { customerId } });

  await prisma.expenseEmailLog.deleteMany({ where: { expenseNote: { createdById: adminId } } });
  await prisma.expenseAuditLog.deleteMany({ where: { expenseNote: { createdById: adminId } } });
  await prisma.expenseAIAnalysis.deleteMany({ where: { attachment: { uploadedById: adminId } } });
  await prisma.expenseAttachment.deleteMany({ where: { uploadedById: adminId } });
  await prisma.expenseNote.deleteMany({ where: { createdById: adminId } });
  await prisma.expenseType.deleteMany({ where: { name: { contains: `AI Phase2 Type ${runId}` } } });
  await prisma.expenseCategory.deleteMany({ where: { name: { contains: `AI Phase2 Category ${runId}` } } });

  await prisma.permission.deleteMany({ where: { key: permissionKey } });
  await prisma.product.deleteMany({ where: { name: productName } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV+8AAAAASUVORK5CYII=',
    'base64'
  );
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
