import assert from 'assert/strict';
import { PermissionScope, Role } from '@prisma/client';
import { prisma } from '@config/database';
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import { creditNoteService } from '@modules/credit-note/creditNote.service';
import { devisService } from '@modules/devis/devis.service';
import { expenseService } from '@modules/expense/expense.service';
import { invoiceService } from '@modules/invoice/invoice.service';
import { productService } from '@modules/product/product.service';
import { rbacService } from '@modules/rbac/rbac.service';
import { recurringService } from '@modules/recurring/recurring.service';
import type { AssistantUser } from '@modules/ai-assistant/tools/toolTypes';

const runId = Date.now();
const adminEmail = `ai-forms-extended-admin-${runId}@example.com`;
const employeeEmail = `ai-forms-extended-employee-${runId}@example.com`;
const customerEmail = `ai-forms-extended-customer-${runId}@example.com`;

function buildScopes(permissions: string[]) {
  return Object.fromEntries(permissions.map((permission) => [permission, PermissionScope.ALL])) as Record<string, PermissionScope>;
}

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'AI Extended Forms Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
    },
  });

  const employee = await prisma.user.create({
    data: {
      name: 'AI Extended Employee',
      email: employeeEmail,
      passwordHash: 'not-used',
      role: Role.EMPLOYEE,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'Extended AI Client',
      company: 'Extended AI Client',
      email: customerEmail,
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const permissions = [
    'ai_assistant.access',
    'ai_assistant.use_read_tools',
    'ai_assistant.use_write_tools',
    'ai_assistant.confirm_actions',
    'ai_assistant.view_history',
    'clients.view',
    'clients.create',
    'contracts.view',
    'invoices.view',
    'invoices.create',
    'invoices.update',
    'payments.create',
    'devis.view',
    'devis.create',
    'devis.update',
    'credit_notes.create',
    'credit_note_reasons.view',
    'expense_notes.view',
    'expense_notes.create',
    'expense_categories.manage',
    'expense_types.manage',
    'products.view',
    'products.create',
    'products.update',
    'recurring.view',
    'recurring.create',
    'recurring.update',
    'reminders.create',
    'users.view',
    'users.create',
    'users.update',
    'roles.view',
    'roles.create',
    'roles.update',
    'permissions.view',
    'permissions.assign',
  ];

  const assistantUser: AssistantUser = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    themePreference: admin.themePreference,
    isActive: admin.isActive,
    rbacRoleId: null,
    permissions,
    permissionScopes: buildScopes(permissions),
  };

  const createdEntityIds = {
    invoiceId: '' as string | null,
    quoteId: '' as string | null,
    creditNoteId: '' as string | null,
    paymentId: '' as string | null,
    expenseId: '' as string | null,
    seedProductId: '' as string | null,
    createdProductId: '' as string | null,
    seedRecurringPlanId: '' as string | null,
    createdRecurringPlanId: '' as string | null,
    createdRoleId: '' as string | null,
    createdPermissionId: '' as string | null,
    expenseCategoryId: '' as string | null,
    expenseTypeId: '' as string | null,
  };

  try {
    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'fr' });

    const invoice = await invoiceService.createInvoice(assistantUser, PermissionScope.ALL, {
      customerId: customer.id,
      status: 'SENT',
      issueDate: '2026-08-09',
      dueDate: '2026-08-20',
      currency: 'MAD',
      discount: 0,
      items: [{ description: 'Initial invoice line', quantity: 1, unitPrice: 800, taxRate: 20 }],
    });
    createdEntityIds.invoiceId = invoice.id;

    const quote = await devisService.createDevis(assistantUser, PermissionScope.ALL, {
      customerId: customer.id,
      issueDate: '2026-08-09',
      validUntil: '2026-08-31',
      currency: 'MAD',
      discount: 0,
      items: [{ description: 'Initial quote line', quantity: 1, unitPrice: 600, taxRate: 20, discount: 0 }],
    });
    createdEntityIds.quoteId = quote.id;

    const expenseCategory = await expenseService.createCategory({ name: `AI Category ${runId}`, active: true });
    createdEntityIds.expenseCategoryId = expenseCategory.id;
    const expenseType = await expenseService.createType({ categoryId: expenseCategory.id, name: `AI Type ${runId}`, active: true });
    createdEntityIds.expenseTypeId = expenseType.id;

    const seedProduct = await productService.createProduct({
      name: `AI Product ${runId}`,
      description: 'Seed product',
      unit: 'unit',
      unitPrice: 120,
      taxRate: 20,
      isActive: true,
    });
    createdEntityIds.seedProductId = seedProduct.id;

    const recurring = await recurringService.create(assistantUser, PermissionScope.ALL, {
      customerId: customer.id,
      name: `AI Recurring ${runId}`,
      frequency: 'MONTHLY',
      intervalCount: 1,
      startDate: '2026-08-09',
      dueDays: 30,
      autoSend: false,
      currency: 'MAD',
      discount: 0,
      items: [{ description: 'Recurring line', quantity: 1, unitPrice: 300, taxRate: 20 }],
    });
    createdEntityIds.seedRecurringPlanId = recurring.id;

    const customRole = await rbacService.createRole({
      name: `AI_ROLE_${runId}`,
      description: 'Extended form role',
    });
    createdEntityIds.createdRoleId = customRole.id;

    const customPermission = await rbacService.createPermission({
      key: `ai_forms_${runId}.manage`,
      description: 'Extended form permission',
    });
    createdEntityIds.createdPermissionId = customPermission.id;

    const reason = (await creditNoteService.getReasons(false))[0];
    assert.ok(reason, 'Expected at least one credit note reason');

    const structuredCases: Array<{ toolName: string; input: Record<string, unknown> }> = [
      { toolName: 'update_invoice', input: { id: invoice.id } },
      { toolName: 'record_invoice_payment', input: { invoiceId: invoice.id } },
      { toolName: 'update_quote', input: { id: quote.id } },
      { toolName: 'create_credit_note', input: { invoiceId: invoice.id } },
      { toolName: 'create_expense', input: {} },
      { toolName: 'create_product', input: {} },
      { toolName: 'update_product', input: { id: seedProduct.id } },
      { toolName: 'create_recurring_plan', input: { customerId: customer.id } },
      { toolName: 'update_recurring_plan', input: { id: recurring.id } },
      { toolName: 'create_reminder', input: { invoiceId: invoice.id } },
      { toolName: 'create_user', input: {} },
      { toolName: 'update_user', input: { id: employee.id } },
      { toolName: 'create_role', input: {} },
      { toolName: 'update_role', input: { id: customRole.id } },
      { toolName: 'create_permission', input: {} },
      { toolName: 'assign_role_permissions', input: { roleId: customRole.id } },
      { toolName: 'assign_user_role', input: { userId: employee.id } },
      { toolName: 'assign_user_clients', input: { userId: employee.id } },
      { toolName: 'create_expense_category', input: {} },
      { toolName: 'update_expense_category', input: { id: expenseCategory.id } },
      { toolName: 'create_expense_type', input: { categoryId: expenseCategory.id } },
      { toolName: 'update_expense_type', input: { id: expenseType.id } },
    ];

    for (const testCase of structuredCases) {
      const result = await aiAssistantService.executeTool(assistantUser, {
        conversationId: conversation.id,
        language: 'fr',
        toolName: testCase.toolName,
        input: testCase.input,
      }) as { type: string; form?: { toolName?: string } };

      assert.equal(result.type, 'structured_form', `${testCase.toolName} should request a structured form`);
      assert.equal(result.form?.toolName, testCase.toolName, `${testCase.toolName} should expose its own form`);
    }

    const paymentPending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'record_invoice_payment',
      input: {
        invoiceId: invoice.id,
        amount: 250,
        paymentDate: '2026-08-09',
        method: 'BANK_TRANSFER',
        reference: `PAY-${runId}`,
      },
    }) as { type: string; action?: { id: string } };
    assert.equal(paymentPending.type, 'pending_action');
    const paymentResult = await aiAssistantService.confirmAction(assistantUser, paymentPending.action!.id);
    assert.equal(paymentResult.action.status, 'EXECUTED');
    const payment = await prisma.payment.findFirst({ where: { invoiceId: invoice.id, reference: `PAY-${runId}` } });
    assert.ok(payment);
    createdEntityIds.paymentId = payment!.id;

    const expensePending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_expense',
      input: {
        categoryId: expenseCategory.id,
        expenseTypeId: expenseType.id,
        expenseDate: '2026-08-09',
        amountTTC: 300,
        amountHT: 250,
        vatAmount: 50,
        vatRate: 20,
        currency: 'MAD',
        merchantName: 'AI Merchant',
        comment: 'Taxi airport',
        source: 'MANUAL',
      },
    }) as { type: string; action?: { id: string } };
    assert.equal(expensePending.type, 'pending_action');
    const expenseResult = await aiAssistantService.confirmAction(assistantUser, expensePending.action!.id);
    assert.equal(expenseResult.action.status, 'EXECUTED');
    createdEntityIds.expenseId = String((expenseResult.result as Record<string, unknown>).id);
    assert.ok(await prisma.expenseNote.findUnique({ where: { id: createdEntityIds.expenseId! } }));

    const productPending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_product',
      input: {
        name: `AI Product New ${runId}`,
        unitPrice: 99,
        taxRate: 20,
        isActive: true,
      },
    }) as { type: string; action?: { id: string } };
    assert.equal(productPending.type, 'pending_action');
    const productResult = await aiAssistantService.confirmAction(assistantUser, productPending.action!.id);
    assert.equal(productResult.action.status, 'EXECUTED');
    createdEntityIds.createdProductId = String((productResult.result as Record<string, unknown>).id);
    assert.ok(await prisma.product.findUnique({ where: { id: createdEntityIds.createdProductId! } }));

    const recurringPending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_recurring_plan',
      input: {
        customerId: customer.id,
        name: `AI Recurring New ${runId}`,
        frequency: 'MONTHLY',
        intervalCount: 1,
        startDate: '2026-08-09',
        dueDays: 15,
        autoSend: false,
        currency: 'MAD',
        discount: 0,
        items: [{ description: 'Retainer', quantity: 1, unitPrice: 700, taxRate: 20 }],
      },
    }) as { type: string; action?: { id: string } };
    assert.equal(recurringPending.type, 'pending_action');
    const recurringResult = await aiAssistantService.confirmAction(assistantUser, recurringPending.action!.id);
    assert.equal(recurringResult.action.status, 'EXECUTED');
    createdEntityIds.createdRecurringPlanId = String((recurringResult.result as Record<string, unknown>).id);
    assert.ok(await prisma.recurringPlan.findUnique({ where: { id: createdEntityIds.createdRecurringPlanId! } }));

    const creditPending = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_credit_note',
      input: {
        invoiceId: invoice.id,
        type: 'PARTIAL',
        issueDate: '2026-08-09',
        reasonId: reason.id,
        reason: 'Structured credit note explanation',
        amountTTC: 120,
      },
    }) as { type: string; action?: { id: string } };
    assert.equal(creditPending.type, 'pending_action');
    const creditResult = await aiAssistantService.confirmAction(assistantUser, creditPending.action!.id);
    assert.equal(creditResult.action.status, 'EXECUTED');
    createdEntityIds.creditNoteId = String((creditResult.result as Record<string, unknown>).id);
    assert.ok(await prisma.creditNote.findUnique({ where: { id: createdEntityIds.creditNoteId! } }));

    const invalidFieldError = await aiAssistantService.executeTool(assistantUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_product',
      input: {
        name: `Invalid Product ${runId}`,
        unitPrice: 50,
        taxRate: 20,
        hackField: 'forbidden',
      } as Record<string, unknown>,
    }).then(() => null).catch((error) => error as Error);
    assert.ok(invalidFieldError, 'Unexpected fields should be rejected');

    const deniedUser: AssistantUser = {
      ...assistantUser,
      permissions: ['ai_assistant.access', 'ai_assistant.use_read_tools', 'ai_assistant.use_write_tools'],
      permissionScopes: buildScopes(['ai_assistant.access', 'ai_assistant.use_read_tools', 'ai_assistant.use_write_tools']),
    };

    const deniedError = await aiAssistantService.executeTool(deniedUser, {
      conversationId: conversation.id,
      language: 'fr',
      toolName: 'create_product',
      input: {
        name: 'Denied Product',
        unitPrice: 10,
        taxRate: 20,
      },
    }).then(() => null).catch((error) => error as Error);
    assert.ok(deniedError, 'RBAC denial should be enforced');

    console.log('PASS aiAssistantStructuredFormsExtended.test.ts');
  } finally {
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    const conversations = await prisma.aiConversation.findMany({ where: { userId: admin.id }, select: { id: true } });
    if (conversations.length > 0) {
      const ids = conversations.map((item) => item.id);
      await prisma.aiMessage.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.aiConversation.deleteMany({ where: { id: { in: ids } } });
    }
    if (createdEntityIds.creditNoteId) await prisma.creditNote.delete({ where: { id: createdEntityIds.creditNoteId } }).catch(() => undefined);
    if (createdEntityIds.paymentId) await prisma.payment.delete({ where: { id: createdEntityIds.paymentId } }).catch(() => undefined);
    if (createdEntityIds.expenseId) await prisma.expenseNote.delete({ where: { id: createdEntityIds.expenseId } }).catch(() => undefined);
    if (createdEntityIds.createdRecurringPlanId) await prisma.recurringPlan.delete({ where: { id: createdEntityIds.createdRecurringPlanId } }).catch(() => undefined);
    if (createdEntityIds.seedRecurringPlanId) await prisma.recurringPlan.delete({ where: { id: createdEntityIds.seedRecurringPlanId } }).catch(() => undefined);
    if (createdEntityIds.createdProductId) await prisma.product.delete({ where: { id: createdEntityIds.createdProductId } }).catch(() => undefined);
    if (createdEntityIds.seedProductId) await prisma.product.delete({ where: { id: createdEntityIds.seedProductId } }).catch(() => undefined);
    if (createdEntityIds.quoteId) await prisma.devis.delete({ where: { id: createdEntityIds.quoteId } }).catch(() => undefined);
    if (createdEntityIds.invoiceId) await prisma.invoice.delete({ where: { id: createdEntityIds.invoiceId } }).catch(() => undefined);
    if (createdEntityIds.expenseTypeId) await prisma.expenseType.delete({ where: { id: createdEntityIds.expenseTypeId } }).catch(() => undefined);
    if (createdEntityIds.expenseCategoryId) await prisma.expenseCategory.delete({ where: { id: createdEntityIds.expenseCategoryId } }).catch(() => undefined);
    if (createdEntityIds.createdPermissionId) await prisma.permission.delete({ where: { id: createdEntityIds.createdPermissionId } }).catch(() => undefined);
    if (createdEntityIds.createdRoleId) await prisma.rbacRole.delete({ where: { id: createdEntityIds.createdRoleId } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: customer.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: employee.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error('FAIL aiAssistantStructuredFormsExtended.test.ts');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
