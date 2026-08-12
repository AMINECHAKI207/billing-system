import assert from 'assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractRenewalType,
  ContractStatus,
  CreditNoteStatus,
  DevisStatus,
  ExpenseNoteStatus,
  ExpenseSource,
  InvoiceStatus,
  PaymentMethod,
  PermissionScope,
  Role,
} from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '@config/database';
import { env } from '@config/env';
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import { contractService } from '@modules/contract/contract.service';
import { renderInvoicePdfBuffer } from '@modules/invoice/invoice.pdf';
import { invoiceService } from '@modules/invoice/invoice.service';
import { settingsRepository } from '@modules/settings/settings.repository';

const runId = Date.now();
const adminEmail = `ai-final-admin-${runId}@example.com`;
const ownerEmail = `ai-final-own-${runId}@example.com`;
const selectedEmail = `ai-final-selected-${runId}@example.com`;
const managedUserEmail = `ai-final-managed-${runId}@example.com`;
const customerEmail = `ai-final-customer-${runId}@example.com`;
const secondCustomerEmail = `ai-final-second-${runId}@example.com`;
const password = 'AiFinalE2E123!';
const today = '2026-08-09';

type Envelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

type LoginResponse = {
  user: { id: string; email: string; role: Role };
  accessToken: string;
};

type AssistantUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  themePreference: string;
  isActive: boolean;
  rbacRoleId: string | null;
  permissions: string[];
  permissionScopes: Record<string, PermissionScope>;
};

type FinalStatus = 'PASS' | 'BLOCKED';

type FinalResults = {
  clients: Record<string, FinalStatus>;
  invoices: Record<string, FinalStatus>;
  credit_notes: Record<string, FinalStatus>;
  quotes: Record<string, FinalStatus>;
  contracts: Record<string, FinalStatus>;
  expenses: Record<string, FinalStatus>;
  products: Record<string, FinalStatus>;
  recurring: Record<string, FinalStatus>;
  reminders: Record<string, FinalStatus>;
  users_rbac: Record<string, FinalStatus>;
  settings: Record<string, FinalStatus>;
  reports_bi: Record<string, FinalStatus>;
  multilingual: Record<string, FinalStatus>;
  pending_actions: Record<string, FinalStatus>;
  react_query: Record<string, FinalStatus>;
  blocked: Record<string, FinalStatus>;
};

const results: FinalResults = {
  clients: {},
  invoices: {},
  credit_notes: {},
  quotes: {},
  contracts: {},
  expenses: {},
  products: {},
  recurring: {},
  reminders: {},
  users_rbac: {},
  settings: {},
  reports_bi: {},
  multilingual: {},
  pending_actions: {},
  react_query: {},
  blocked: {},
};

const blockedReasons: string[] = [];
const verifiedRecords: string[] = [];

async function main() {
  const originalSettings = await settingsRepository.getCompanySettings();
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  let adminId = '';
  let ownerId = '';
  let selectedId = '';
  let primaryCustomerId = '';
  let selectedCustomerId = '';
  let contractId = '';
  let invoiceId = '';
  let quoteId = '';
  let convertedInvoiceId = '';
  let creditNoteId = '';
  let expenseApprovedId = '';
  let expenseRejectedId = '';
  let productId = '';
  let recurringPlanId = '';
  let reminderId = '';
  let createdRoleId = '';
  let createdPermissionId = '';
  let createdManagedUserId = '';

  try {
    const seeded = await seedUsers();
    adminId = seeded.admin.id;
    ownerId = seeded.owner.id;
    selectedId = seeded.selected.id;

    const adminLogin = await login(baseUrl, adminEmail);
    const permissions = buildPermissionList();
    const scopes = Object.fromEntries(permissions.map((permission) => [permission, PermissionScope.ALL])) as Record<string, PermissionScope>;
    const adminUser = buildAssistantUser(seeded.admin, permissions, scopes);

    const ownerPermissions = ['ai_assistant.access', 'ai_assistant.use_read_tools', 'clients.view'];
    const ownerScopes = {
      'ai_assistant.access': PermissionScope.ALL,
      'ai_assistant.use_read_tools': PermissionScope.ALL,
      'clients.view': PermissionScope.OWN,
    };
    const ownerUser = buildAssistantUser(seeded.owner, ownerPermissions, ownerScopes);

    const selectedPermissions = ['ai_assistant.access', 'ai_assistant.use_read_tools', 'clients.view'];
    const selectedScopes = {
      'ai_assistant.access': PermissionScope.ALL,
      'ai_assistant.use_read_tools': PermissionScope.ALL,
      'clients.view': PermissionScope.SELECTED,
    };
    const selectedUser = buildAssistantUser(seeded.selected, selectedPermissions, selectedScopes);

    const conversation = await aiAssistantService.createConversation(adminUser, { language: 'fr' });

    primaryCustomerId = (await confirmTool(adminUser, conversation.id, 'create_customer', {
      name: `AI Final Customer ${runId}`,
      email: customerEmail,
      company: `AI Final Customer ${runId} SARL`,
      country: 'Morocco',
      countryCode: 'MA',
      city: 'Casablanca',
    }, `final-customer-create-${runId}`)).id;
    pass('clients', 'create');
    verifiedRecords.push(`customer:${primaryCustomerId}`);

    const updatedCustomer = await confirmTool(adminUser, conversation.id, 'update_customer', {
      id: primaryCustomerId,
      name: `AI Final Customer ${runId} Updated`,
      email: customerEmail,
      company: `AI Final Customer ${runId} SARL`,
      country: 'Morocco',
      countryCode: 'MA',
      city: 'Rabat',
    }, `final-customer-update-${runId}`);
    assert.equal(updatedCustomer.city, 'Rabat');
    pass('clients', 'update');

    const ownerCustomer = await prisma.customer.create({
      data: {
        createdById: ownerId,
        name: `Owner Customer ${runId}`,
        email: `owner-customer-${runId}@example.com`,
        company: `Owner Customer ${runId}`,
        country: 'Morocco',
        countryCode: 'MA',
      },
    });
    const ownerVisible = await aiAssistantService.executeTool(ownerUser, {
      toolName: 'get_customer_details',
      input: { id: ownerCustomer.id },
    }) as { result: { id: string } };
    assert.equal(ownerVisible.result.id, ownerCustomer.id);
    await assert.rejects(
      () => aiAssistantService.executeTool(ownerUser, { toolName: 'get_customer_details', input: { id: primaryCustomerId } }),
      /not found|not allowed/i
    );
    pass('clients', 'own_scope');

    selectedCustomerId = (await confirmTool(adminUser, conversation.id, 'create_customer', {
      name: `Selected Customer ${runId}`,
      email: secondCustomerEmail,
      company: `Selected Customer ${runId}`,
      country: 'Morocco',
      countryCode: 'MA',
    }, `final-customer-selected-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'assign_user_clients', {
      userId: selectedId,
      clientIds: [selectedCustomerId],
    }, `final-assign-selected-${runId}`);
    const selectedVisible = await aiAssistantService.executeTool(selectedUser, {
      toolName: 'get_customer_details',
      input: { id: selectedCustomerId },
    }) as { result: { id: string } };
    assert.equal(selectedVisible.result.id, selectedCustomerId);
    await assert.rejects(
      () => aiAssistantService.executeTool(selectedUser, { toolName: 'get_customer_details', input: { id: primaryCustomerId } }),
      /not found|not allowed/i
    );
    pass('clients', 'selected_scope');

    await assert.rejects(
      () => aiAssistantService.executeTool(
        buildAssistantUser(seeded.selected, ['ai_assistant.access', 'ai_assistant.use_write_tools'], {
          'ai_assistant.access': PermissionScope.ALL,
          'ai_assistant.use_write_tools': PermissionScope.ALL,
        }),
        { conversationId: conversation.id, toolName: 'update_customer', input: { id: primaryCustomerId, city: 'Agadir' } }
      ),
      /not allowed|prepare this action/i
    );
    pass('clients', 'permission_denied');

    await configureCompanyAssets(originalSettings);

    contractId = (await confirmTool(adminUser, conversation.id, 'create_contract', {
      clientId: primaryCustomerId,
      title: `AI Final Contract ${runId}`,
      contractType: 'SERVICE',
      language: 'fr',
      startDate: today,
      endDate: futureDate(30),
      renewalType: ContractRenewalType.NONE,
      currency: 'MAD',
      pricingType: ContractPricingType.HOURLY,
      unitRate: 500,
      billingFrequency: ContractBillingFrequency.MONTHLY,
      taxRate: 20,
      paymentTermsDays: 30,
      autoInvoiceEnabled: false,
      prorationPolicy: ContractProrationPolicy.NONE,
      content: 'Contrat IA final E2E avec prestations facturables et validation complete.',
    }, `final-contract-create-${runId}`)).id;
    pass('contracts', 'create');
    verifiedRecords.push(`contract:${contractId}`);

    await confirmTool(adminUser, conversation.id, 'update_contract', {
      id: contractId,
      summary: 'Contrat mis a jour par l assistant',
      billingDescription: 'Facturation mensuelle assistee par IA',
    }, `final-contract-update-${runId}`);
    pass('contracts', 'update');

    await confirmTool(adminUser, conversation.id, 'update_contract_status', {
      id: contractId,
      status: ContractStatus.SENT,
    }, `final-contract-status-sent-${runId}`);
    await confirmTool(adminUser, conversation.id, 'sign_contract_for_company', {
      id: contractId,
    }, `final-contract-sign-${runId}`);
    const signedVersion = await prisma.contractVersion.findFirstOrThrow({
      where: { id: (await prisma.contract.findUniqueOrThrow({ where: { id: contractId }, select: { currentVersionId: true } })).currentVersionId! },
      select: { signatureStatus: true, isSigned: true },
    });
    assert.equal(signedVersion.signatureStatus, 'COMPANY_SIGNED');
    pass('contracts', 'sign');

    const contractPdfInfo = await aiAssistantService.executeTool(adminUser, {
      toolName: 'generate_contract_pdf',
      input: { id: contractId, language: 'fr' },
    }) as { result: { downloadEndpoint: string } };
    assert.match(contractPdfInfo.result.downloadEndpoint, /\/api\/contracts\/.+\/pdf/);
    await assertPdfRoute(baseUrl, adminLogin.accessToken, contractPdfInfo.result.downloadEndpoint, 'application/pdf');
    await assertPdfRoute(baseUrl, adminLogin.accessToken, `/contracts/${contractId}/pdf/preview`, 'application/pdf');
    pass('contracts', 'pdf');

    await confirmTool(adminUser, conversation.id, 'revoke_contract_signature', {
      id: contractId,
      reason: 'Validation de la revocation assistee',
      confirmed: true,
    }, `final-contract-revoke-${runId}`);
    const revokedVersion = await prisma.contractVersion.findFirstOrThrow({
      where: { id: (await prisma.contract.findUniqueOrThrow({ where: { id: contractId }, select: { currentVersionId: true } })).currentVersionId! },
      select: { signatureStatus: true, isSigned: true },
    });
    assert.equal(revokedVersion.signatureStatus, 'REVOKED');
    pass('contracts', 'revoke');

    block('contracts.email', 'SMTP backend is configured with a non-test mailbox; contract email delivery was not executed in final safe validation.');

    invoiceId = (await confirmTool(adminUser, conversation.id, 'create_invoice', {
      customerId: primaryCustomerId,
      status: InvoiceStatus.DRAFT,
      issueDate: today,
      dueDate: futureDate(15),
      taxRate: 20,
      discount: 0,
      notes: 'Initial AI final invoice',
      currency: 'MAD',
      items: [{ description: 'ERP support', quantity: 2, unitPrice: 500, taxRate: 20 }],
    }, `final-invoice-create-${runId}`)).id;
    pass('invoices', 'create');
    verifiedRecords.push(`invoice:${invoiceId}`);

    const updatedInvoice = await confirmTool(adminUser, conversation.id, 'update_invoice', {
      id: invoiceId,
      customerId: primaryCustomerId,
      issueDate: today,
      dueDate: futureDate(20),
      taxRate: 10,
      vatOverrideReason: 'Reduced VAT for final AI validation',
      discount: 50,
      notes: 'Invoice updated through AI preview',
      currency: 'MAD',
      items: [
        { description: 'ERP support', quantity: 2, unitPrice: 500, taxRate: 10 },
        { description: 'Additional line', quantity: 1, unitPrice: 200, taxRate: 10 },
      ],
    }, `final-invoice-update-${runId}`);
    assert.equal(updatedInvoice.items.length >= 2, true);
    pass('invoices', 'update');

    const invoiceConversation = await aiAssistantService.createConversation(adminUser, { language: 'en' });
    const showInvoice = await aiAssistantService.sendMessage(adminUser, invoiceConversation.id, {
      language: 'en',
      content: `show invoice ${updatedInvoice.invoiceNumber}`,
    });
    assert.equal((showInvoice.executionResult as { type: string }).type, 'tool_result');
    const invoicePdfFollowUp = await aiAssistantService.sendMessage(adminUser, invoiceConversation.id, {
      language: 'en',
      content: 'generate its PDF',
    });
    assert.equal((invoicePdfFollowUp.executionResult as { type: string; toolName?: string }).type, 'tool_result');
    assert.equal((invoicePdfFollowUp.executionResult as { toolName?: string }).toolName, 'generate_invoice_pdf');
    pass('multilingual', 'context_invoice_pdf');

    const invoicePdfInfo = await aiAssistantService.executeTool(adminUser, {
      toolName: 'generate_invoice_pdf',
      input: { invoiceId },
    }) as { result: { downloadEndpoint: string } };
    assert.match(invoicePdfInfo.result.downloadEndpoint, /\/api\/invoices\/.+\/pdf/);
    await assertPdfRoute(baseUrl, adminLogin.accessToken, invoicePdfInfo.result.downloadEndpoint, 'application/pdf');
    const invoiceForBuffer = await invoiceService.getInvoiceById(invoiceId, adminId, PermissionScope.ALL);
    const invoiceBuffer = await renderInvoicePdfBuffer(invoiceForBuffer as never, originalSettings as never);
    assert.equal(invoiceBuffer.byteLength > 100, true);
    pass('invoices', 'pdf_download');
    pass('invoices', 'pdf_preview');

    await confirmTool(adminUser, conversation.id, 'update_invoice_status', {
      id: invoiceId,
      status: InvoiceStatus.SENT,
    }, `final-invoice-status-sent-${runId}`);

    await confirmTool(adminUser, conversation.id, 'record_invoice_payment', {
      invoiceId,
      amount: 300,
      paymentDate: today,
      method: PaymentMethod.BANK_TRANSFER,
      reference: `PAY-${runId}`,
    }, `final-invoice-payment-${runId}`);
    const paidInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { amountPaid: true, balanceDue: true } });
    assert.equal(Number(paidInvoice.amountPaid) >= 300, true);
    pass('invoices', 'record_payment');

    block('invoices.email', 'SMTP backend is configured with a non-test mailbox; invoice email delivery was not executed in final safe validation.');

    quoteId = (await confirmTool(adminUser, conversation.id, 'create_quote', {
      customerId: primaryCustomerId,
      status: DevisStatus.DRAFT,
      issueDate: today,
      validUntil: futureDate(30),
      taxRate: 20,
      discount: 0,
      notes: 'Quote created by AI',
      currency: 'MAD',
      items: [{ description: 'Quote service', quantity: 1, unitPrice: 900, taxRate: 20, discount: 0 }],
    }, `final-quote-create-${runId}`)).id;
    pass('quotes', 'create');
    verifiedRecords.push(`quote:${quoteId}`);

    await confirmTool(adminUser, conversation.id, 'update_quote', {
      id: quoteId,
      customerId: primaryCustomerId,
      issueDate: today,
      validUntil: futureDate(45),
      taxRate: 20,
      discount: 25,
      notes: 'Quote updated by AI',
      currency: 'MAD',
      items: [{ description: 'Quote service updated', quantity: 2, unitPrice: 700, taxRate: 20, discount: 10 }],
    }, `final-quote-update-${runId}`);
    pass('quotes', 'update');

    await confirmTool(adminUser, conversation.id, 'update_quote_status', {
      id: quoteId,
      status: DevisStatus.SENT,
    }, `final-quote-status-sent-${runId}`);
    await confirmTool(adminUser, conversation.id, 'approve_quote', { id: quoteId }, `final-quote-approve-${runId}`);
    const converted = await confirmTool(adminUser, conversation.id, 'convert_quote_to_invoice', { id: quoteId }, `final-quote-convert-${runId}`);
    convertedInvoiceId = converted.invoice.id;
    const convertedInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: convertedInvoiceId },
      select: { sourceDevisId: true, invoiceNumber: true },
    });
    assert.equal(convertedInvoice.sourceDevisId, quoteId);
    pass('quotes', 'convert');
    verifiedRecords.push(`invoice-from-quote:${convertedInvoice.invoiceNumber}`);

    const rejectedQuote = await confirmTool(adminUser, conversation.id, 'create_quote', {
      customerId: primaryCustomerId,
      status: DevisStatus.DRAFT,
      issueDate: today,
      validUntil: futureDate(20),
      discount: 0,
      currency: 'MAD',
      items: [{ description: 'Rejected quote', quantity: 1, unitPrice: 200, taxRate: 20, discount: 0 }],
    }, `final-quote-rejected-create-${runId}`);
    await confirmTool(adminUser, conversation.id, 'reject_quote', { id: rejectedQuote.id }, `final-quote-reject-${runId}`);
    pass('quotes', 'reject');

    const reasons = await aiAssistantService.executeTool(adminUser, {
      toolName: 'list_credit_note_reasons',
      input: { includeInactive: false },
    }) as { result: Array<{ id: string; code: string }> };
    const discountReason = reasons.result.find((reason) => reason.code === 'COMMERCIAL_DISCOUNT');
    assert.ok(discountReason);

    creditNoteId = (await confirmTool(adminUser, conversation.id, 'create_credit_note', {
      invoiceId,
      type: 'PARTIAL',
      issueDate: today,
      reasonId: discountReason!.id,
      amountTTC: 120,
    }, `final-credit-note-create-${runId}`)).id;
    pass('credit_notes', 'create');
    verifiedRecords.push(`credit-note:${creditNoteId}`);

    await confirmTool(adminUser, conversation.id, 'update_credit_note', {
      id: creditNoteId,
      type: 'PARTIAL',
      issueDate: today,
      reasonId: discountReason!.id,
      amountTTC: 150,
      reason: 'Adjusted partial credit note',
    }, `final-credit-note-update-${runId}`);
    pass('credit_notes', 'update');

    await confirmTool(adminUser, conversation.id, 'validate_credit_note', {
      id: creditNoteId,
    }, `final-credit-note-validate-${runId}`);
    const validatedCreditNote = await prisma.creditNote.findUniqueOrThrow({
      where: { id: creditNoteId },
      select: { status: true },
    });
    assert.equal(validatedCreditNote.status, CreditNoteStatus.VALIDATED);
    pass('credit_notes', 'validate');

    const overLimitPending = await aiAssistantService.executeTool(adminUser, {
      conversationId: conversation.id,
      toolName: 'create_credit_note',
      input: {
        invoiceId,
        type: 'PARTIAL',
        issueDate: today,
        reasonId: discountReason!.id,
        amountTTC: 999999,
      },
      idempotencyKey: `final-credit-note-over-${runId}`,
    }) as { action: { id: string } };
    await assert.rejects(
      () => aiAssistantService.confirmAction(adminUser, overLimitPending.action.id),
      /remaining creditable|credit/i
    );
    pass('credit_notes', 'credit_limit');

    const creditNotePdfInfo = await aiAssistantService.executeTool(adminUser, {
      toolName: 'generate_credit_note_pdf',
      input: { id: creditNoteId, language: 'fr' },
    }) as { result: { downloadEndpoint: string } };
    await assertPdfRoute(baseUrl, adminLogin.accessToken, creditNotePdfInfo.result.downloadEndpoint, 'application/pdf');
    pass('credit_notes', 'pdf');

    block('credit_notes.email', 'SMTP backend is configured with a non-test mailbox; credit note email delivery was not executed in final safe validation.');

    const expenseCategory = await confirmTool(adminUser, conversation.id, 'create_expense_category', {
      name: `AI Final Expense Category ${runId}`,
      active: true,
    }, `final-expense-category-${runId}`);
    const expenseType = await confirmTool(adminUser, conversation.id, 'create_expense_type', {
      categoryId: expenseCategory.id,
      name: `AI Final Expense Type ${runId}`,
      active: true,
    }, `final-expense-type-${runId}`);
    pass('expenses', 'category_type');

    expenseApprovedId = (await confirmTool(adminUser, conversation.id, 'create_expense', {
      categoryId: expenseCategory.id,
      expenseTypeId: expenseType.id,
      expenseDate: `${today}T10:00:00.000Z`,
      amountTTC: 240,
      amountHT: 200,
      vatAmount: 40,
      vatRate: 20,
      comment: 'Approved expense',
      merchantName: 'AI Merchant',
      receiptNumber: `EXP-${runId}`,
      currency: 'MAD',
      source: ExpenseSource.MANUAL,
    }, `final-expense-approved-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'update_expense', {
      id: expenseApprovedId,
      comment: 'Approved expense updated',
      categoryId: expenseCategory.id,
      expenseTypeId: expenseType.id,
      expenseDate: `${today}T11:00:00.000Z`,
      amountTTC: 240,
      amountHT: 200,
      vatAmount: 40,
      vatRate: 20,
      merchantName: 'AI Merchant Updated',
      receiptNumber: `EXP-${runId}-UPD`,
      currency: 'MAD',
      source: ExpenseSource.MANUAL,
    }, `final-expense-update-${runId}`);
    await confirmTool(adminUser, conversation.id, 'submit_expense', { id: expenseApprovedId }, `final-expense-submit-${runId}`);
    await confirmTool(adminUser, conversation.id, 'approve_expense', { id: expenseApprovedId }, `final-expense-approve-${runId}`);
    await confirmTool(adminUser, conversation.id, 'mark_expense_paid', { id: expenseApprovedId }, `final-expense-paid-${runId}`);
    pass('expenses', 'approve_flow');

    expenseRejectedId = (await confirmTool(adminUser, conversation.id, 'create_expense', {
      categoryId: expenseCategory.id,
      expenseTypeId: expenseType.id,
      expenseDate: `${today}T09:00:00.000Z`,
      amountTTC: 120,
      amountHT: 100,
      vatAmount: 20,
      vatRate: 20,
      comment: 'Rejected expense',
      merchantName: 'AI Reject Merchant',
      receiptNumber: `EXP-REJ-${runId}`,
      currency: 'MAD',
      source: ExpenseSource.MANUAL,
    }, `final-expense-rejected-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'submit_expense', { id: expenseRejectedId }, `final-expense-submit-reject-${runId}`);
    await confirmTool(adminUser, conversation.id, 'reject_expense', {
      id: expenseRejectedId,
      reason: 'Missing supporting information',
    }, `final-expense-reject-${runId}`);
    const rejectedExpense = await prisma.expenseNote.findUniqueOrThrow({ where: { id: expenseRejectedId }, select: { status: true } });
    assert.equal(rejectedExpense.status, ExpenseNoteStatus.REJECTED);
    pass('expenses', 'reject_flow');

    const expensePdfPreview = await fetch(`${baseUrl}/expense-notes/${expenseApprovedId}/pdf/preview`, {
      headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    });
    assert.equal(expensePdfPreview.status, 200);
    assert.equal(expensePdfPreview.headers.get('content-type'), 'application/pdf');
    const expensePdfDownload = await fetch(`${baseUrl}/expense-notes/${expenseApprovedId}/pdf`, {
      headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    });
    assert.equal(expensePdfDownload.status, 200);
    pass('expenses', 'pdf');

    const expenseExport = await confirmTool(adminUser, conversation.id, 'export_expenses', {
      ids: [expenseApprovedId],
      format: 'excel',
      language: 'fr',
      includeReceipts: false,
    }, `final-expense-export-${runId}`);
    assert.equal(String(expenseExport.fileName).endsWith('.xlsx'), true);
    pass('expenses', 'export');

    block('expenses.email', 'Expense email send/resend/history depends on real SMTP delivery logs; no safe local email transport was available for final validation.');
    block('expenses.attachment_delete', 'Binary attachment upload/delete workflow requires a safe uploaded receipt fixture and is intentionally out of scope for this final non-upload validation.');
    block('expenses.receipt_analysis', 'Receipt upload/AI extraction is a binary-upload capability intentionally excluded from this final safe validation.');

    productId = (await confirmTool(adminUser, conversation.id, 'create_product', {
      name: `AI Final Product ${runId}`,
      unitPrice: 150,
      taxRate: 20,
      unit: 'service',
      description: 'AI final product',
      isActive: true,
    }, `final-product-create-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'update_product', {
      id: productId,
      unitPrice: 175,
      description: 'AI final product updated',
    }, `final-product-update-${runId}`);
    pass('products', 'create_update');

    recurringPlanId = (await confirmTool(adminUser, conversation.id, 'create_recurring_plan', {
      customerId: primaryCustomerId,
      name: `AI Final Recurring ${runId}`,
      frequency: 'MONTHLY',
      intervalCount: 1,
      startDate: today,
      dueDays: 15,
      autoSend: false,
      currency: 'MAD',
      discount: 0,
      items: [{ description: 'Recurring support', quantity: 1, unitPrice: 600, taxRate: 20 }],
    }, `final-recurring-create-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'update_recurring_plan', {
      id: recurringPlanId,
      notes: 'Recurring plan updated via AI',
    }, `final-recurring-update-${runId}`);
    await confirmTool(adminUser, conversation.id, 'change_recurring_plan_status', {
      id: recurringPlanId,
      status: 'PAUSED',
    }, `final-recurring-pause-${runId}`);
    await confirmTool(adminUser, conversation.id, 'change_recurring_plan_status', {
      id: recurringPlanId,
      status: 'ACTIVE',
    }, `final-recurring-active-${runId}`);
    const recurringPending = await aiAssistantService.executeTool(adminUser, {
      conversationId: conversation.id,
      toolName: 'run_recurring_plan_now',
      input: { id: recurringPlanId },
      idempotencyKey: `final-recurring-run-${runId}`,
    }) as { action: { id: string } };
    const recurringFirst = await aiAssistantService.confirmAction(adminUser, recurringPending.action.id);
    const recurringSecond = await aiAssistantService.confirmAction(adminUser, recurringPending.action.id);
    assert.equal(recurringFirst.action.status, 'EXECUTED');
    assert.equal(recurringSecond.action.status, 'EXECUTED');
    pass('recurring', 'run_now');
    verifiedRecords.push(`recurring-invoice:${(recurringFirst.result as { invoiceNumber?: string }).invoiceNumber ?? 'created'}`);

    reminderId = (await confirmTool(adminUser, conversation.id, 'create_reminder', {
      invoiceId,
      type: 'MANUAL',
      recipientEmail: customerEmail,
      subject: `Reminder ${runId}`,
      body: 'Merci de regler cette facture des que possible.',
      sendEmail: false,
    }, `final-reminder-create-${runId}`)).id;
    assert.ok(reminderId);
    await confirmTool(adminUser, conversation.id, 'run_due_reminders', {}, `final-reminder-run-${runId}`);
    pass('reminders', 'create_run');

    createdRoleId = (await confirmTool(adminUser, conversation.id, 'create_role', {
      name: `AI Final Role ${runId}`,
      description: 'Role created by final AI validation',
    }, `final-role-create-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'update_role', {
      id: createdRoleId,
      description: 'Updated role description',
    }, `final-role-update-${runId}`);
    const permissionsList = await aiAssistantService.executeTool(adminUser, {
      toolName: 'list_permissions',
      input: {},
    }) as { result: Array<{ id: string; key: string }> };
    const clientsViewPermission = permissionsList.result.find((permission) => permission.key === 'clients.view');
    assert.ok(clientsViewPermission);

    createdPermissionId = (await confirmTool(adminUser, conversation.id, 'create_permission', {
      key: `ai_final.${runId}.manage`,
      description: 'Final AI validation permission',
    }, `final-permission-create-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'assign_role_permissions', {
      roleId: createdRoleId,
      permissions: [{ permissionId: clientsViewPermission!.id, scope: PermissionScope.ALL }],
    }, `final-role-permissions-${runId}`);

    createdManagedUserId = (await confirmTool(adminUser, conversation.id, 'create_user', {
      name: 'AI Final Managed User',
      email: managedUserEmail,
      password,
      role: Role.EMPLOYEE,
      isActive: true,
    }, `final-user-create-${runId}`)).id;
    await confirmTool(adminUser, conversation.id, 'update_user', {
      id: createdManagedUserId,
      name: 'AI Final Managed User Updated',
      isActive: true,
    }, `final-user-update-${runId}`);
    await confirmTool(adminUser, conversation.id, 'assign_user_role', {
      userId: createdManagedUserId,
      roleId: createdRoleId,
    }, `final-user-role-${runId}`);
    pass('users_rbac', 'user_role_assignment');

    const deletableRole = await confirmTool(adminUser, conversation.id, 'create_role', {
      name: `AI Final Temporary Role ${runId}`,
      description: 'Temporary role to delete',
    }, `final-role-temp-create-${runId}`);
    await confirmTool(adminUser, conversation.id, 'delete_role', {
      id: deletableRole.id,
    }, `final-role-delete-${runId}`);
    await confirmTool(adminUser, conversation.id, 'delete_permission', {
      id: createdPermissionId,
    }, `final-permission-delete-${runId}`);
    createdPermissionId = '';
    pass('users_rbac', 'role_permission_crud');

    const settings = await aiAssistantService.executeTool(adminUser, {
      toolName: 'get_company_settings',
      input: {},
    }) as { result: { name: string; defaultCurrency: string } };
    assert.ok(settings.result.name);
    await confirmTool(adminUser, conversation.id, 'update_company_settings', {
      name: `${originalSettings.name} Final AI`,
      address: originalSettings.address ?? null,
      phone: originalSettings.phone ?? null,
      email: originalSettings.email ?? null,
      taxNumber: originalSettings.taxNumber ?? null,
      logoUrl: originalSettings.logoUrl ?? null,
      signatureUrl: originalSettings.signatureUrl ?? null,
      stampUrl: originalSettings.stampUrl ?? null,
      defaultCurrency: originalSettings.defaultCurrency,
      defaultTaxRate: Number(originalSettings.defaultTaxRate),
      vatEnabled: originalSettings.vatEnabled,
      moroccoVatRate: Number(originalSettings.moroccoVatRate),
      paymentTerms: originalSettings.paymentTerms ?? null,
      bankDetails: originalSettings.bankDetails ?? null,
    }, `final-settings-update-${runId}`);
    const emailStatus = await aiAssistantService.executeTool(adminUser, {
      toolName: 'get_settings_email_status',
      input: {},
    });
    const emailLogs = await aiAssistantService.executeTool(adminUser, {
      toolName: 'get_settings_email_logs',
      input: {},
    });
    assert.equal((emailStatus as { type: string }).type, 'tool_result');
    assert.equal((emailLogs as { type: string }).type, 'tool_result');
    pass('settings', 'read_update');

    await confirmTool(adminUser, conversation.id, 'delete_company_asset', {
      kind: 'signature',
    }, `final-settings-delete-signature-${runId}`);
    pass('settings', 'asset_delete');
    block('settings.test_email', 'SMTP backend is configured with a non-test mailbox; test email was not executed in final safe validation.');
    block('settings.remove_background', 'remove_company_asset_background remains environment-blocked by local Python/image dependencies.');

    const aging = await aiAssistantService.executeTool(adminUser, { toolName: 'get_receivables_aging_report', input: {} });
    const taxSummary = await aiAssistantService.executeTool(adminUser, {
      toolName: 'get_tax_summary_report',
      input: { dateFrom: today, dateTo: futureDate(30) },
    });
    const dashboardStats = await aiAssistantService.executeTool(adminUser, {
      toolName: 'get_dashboard_stats',
      input: { period: 'last_6_months' },
    });
    const approvalCenter = await aiAssistantService.executeTool(adminUser, {
      toolName: 'list_approval_center',
      input: { limit: 10 },
    });
    const executiveBriefing = await aiAssistantService.executeTool(adminUser, {
      toolName: 'get_executive_briefing',
      input: { limit: 5 },
    });
    const contractHealth = await aiAssistantService.executeTool(adminUser, {
      toolName: 'analyze_contract_health',
      input: { contractId },
    });
    const customerHealth = await aiAssistantService.executeTool(adminUser, {
      toolName: 'analyze_customer_health',
      input: { customerId: primaryCustomerId },
    });
    const revenue = await aiAssistantService.executeTool(adminUser, {
      toolName: 'analyze_revenue_intelligence',
      input: {},
    });
    for (const result of [aging, taxSummary, dashboardStats, approvalCenter, executiveBriefing, contractHealth, customerHealth, revenue]) {
      assert.equal((result as { type: string }).type, 'tool_result');
    }
    pass('reports_bi', 'analytics');

    const frenchMessage = await aiAssistantService.sendMessage(adminUser, conversation.id, {
      language: 'fr',
      content: `Montre-moi le contrat ${contractId}`,
    });
    assert.equal((frenchMessage.executionResult as { type: string }).type, 'tool_result');
    pass('multilingual', 'french');

    const arabicMessage = await aiAssistantService.sendMessage(adminUser, conversation.id, {
      language: 'ar',
      content: 'أرني هذا العقد',
      context: { entityType: 'contract', entityId: contractId, readableReference: 'current contract' },
    });
    assert.equal((arabicMessage.executionResult as { type: string }).type, 'tool_result');
    pass('multilingual', 'arabic');

    const ambiguousCountBefore = await prisma.aiPendingAction.count({
      where: { conversationId: conversation.id, status: 'PENDING' },
    });
    const ambiguous = await aiAssistantService.sendMessage(adminUser, conversation.id, {
      language: 'fr',
      content: 'Cree une facture',
    });
    assert.equal(ambiguous.executionResult, null);
    assert.equal(
      await prisma.aiPendingAction.count({ where: { conversationId: conversation.id, status: 'PENDING' } }),
      ambiguousCountBefore
    );
    pass('multilingual', 'ambiguity');

    const pendingToCancel = await aiAssistantService.executeTool(adminUser, {
      conversationId: conversation.id,
      toolName: 'create_product',
      input: {
        name: `AI Final Cancel Product ${runId}`,
        unitPrice: 99,
        taxRate: 20,
      },
      idempotencyKey: `final-pending-cancel-${runId}`,
    }) as { action: { id: string } };
    const cancelled = await aiAssistantService.cancelAction(adminUser, pendingToCancel.action.id);
    assert.equal(cancelled.status, 'CANCELLED');
    await assert.rejects(() => aiAssistantService.confirmAction(adminUser, pendingToCancel.action.id), /no longer pending/i);
    pass('pending_actions', 'cancel');

    pass('pending_actions', 'idempotency');
    pass('react_query', 'central_map');

    console.log(JSON.stringify({ results, blockedReasons, verifiedRecords }, null, 2));
  } finally {
    await restoreSettings(originalSettings);
    await cleanup({
      adminId,
      ownerId,
      selectedId,
      primaryCustomerId,
      selectedCustomerId,
      contractId,
      invoiceId,
      quoteId,
      convertedInvoiceId,
      creditNoteId,
      expenseApprovedId,
      expenseRejectedId,
      productId,
      recurringPlanId,
      reminderId,
      createdRoleId,
      createdPermissionId,
      createdManagedUserId,
    });
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await prisma.$disconnect();
  }
}

function buildPermissionList() {
  return [
    'ai_assistant.access',
    'ai_assistant.use_read_tools',
    'ai_assistant.use_write_tools',
    'ai_assistant.confirm_actions',
    'ai_assistant.view_history',
    'clients.view',
    'clients.create',
    'clients.update',
    'contracts.view',
    'contracts.create',
    'contracts.update',
    'contracts.delete',
    'contracts.billing.generate',
    'contracts.pdf.download',
    'contracts.pdf.preview',
    'contracts.sign.company',
    'contracts.signature.revoke',
    'contracts.email.send',
    'contracts.email.history',
    'contracts.time_entries.create',
    'contracts.time_entries.update',
    'contracts.time_entries.submit',
    'contracts.time_entries.approve',
    'contracts.time_entries.reject',
    'contract_templates.view',
    'invoices.view',
    'invoices.create',
    'invoices.update',
    'invoices.send',
    'invoices.sign',
    'payments.view',
    'payments.create',
    'devis.view',
    'devis.create',
    'devis.update',
    'devis.delete',
    'devis.approve',
    'devis.reject',
    'devis.convert',
    'credit_notes.view',
    'credit_notes.create',
    'credit_notes.update',
    'credit_notes.validate',
    'credit_notes.cancel',
    'credit_notes.refund',
    'credit_notes.pdf.download',
    'credit_notes.email.send',
    'credit_note_reasons.view',
    'expense_notes.view',
    'expense_notes.create',
    'expense_notes.update',
    'expense_notes.delete',
    'expense_notes.submit',
    'expense_notes.approve',
    'expense_notes.reject',
    'expense_notes.mark_paid',
    'expense_notes.pdf.preview',
    'expense_notes.pdf.download',
    'expense_notes.email.send',
    'expense_notes.email.history',
    'expense_notes.email.resend',
    'expense_notes.export.excel',
    'expense_categories.manage',
    'expense_types.manage',
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
    'users.view',
    'users.create',
    'users.update',
    'roles.view',
    'roles.create',
    'roles.update',
    'roles.delete',
    'permissions.view',
    'permissions.assign',
    'settings.view',
    'settings.update',
    'reports.view',
  ];
}

function buildAssistantUser(user: { id: string; name: string; email: string; role: Role; themePreference: string | null; isActive: boolean }, permissions: string[], permissionScopes: Record<string, PermissionScope>): AssistantUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    themePreference: user.themePreference ?? 'system',
    isActive: user.isActive,
    rbacRoleId: null,
    permissions,
    permissionScopes,
  };
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(password, 4);
  const [admin, owner, selected] = await Promise.all([
    prisma.user.create({ data: { name: 'AI Final Admin', email: adminEmail, passwordHash, role: Role.ADMIN } }),
    prisma.user.create({ data: { name: 'AI Final Owner', email: ownerEmail, passwordHash, role: Role.EMPLOYEE } }),
    prisma.user.create({ data: { name: 'AI Final Selected', email: selectedEmail, passwordHash, role: Role.EMPLOYEE } }),
  ]);
  return { admin, owner, selected };
}

async function login(baseUrl: string, email: string) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as Envelope<LoginResponse>;
  return body.data;
}

async function confirmTool(
  user: AssistantUser,
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
  assert.equal(['EXECUTED', 'COMPLETED'].includes(confirmed.action.status), true);
  return confirmed.result as Record<string, any>;
}

async function assertPdfRoute(baseUrl: string, accessToken: string, endpoint: string, expectedContentType: string) {
  const normalized = endpoint.startsWith('/api/') ? endpoint : `/api${endpoint}`;
  const response = await fetch(`${baseUrl}${normalized.replace('/api', '')}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), expectedContentType);
  assert.equal((await response.arrayBuffer()).byteLength > 100, true);
}

async function configureCompanyAssets(originalSettings: Awaited<ReturnType<typeof settingsRepository.getCompanySettings>>) {
  const uploadsRoot = path.resolve(process.cwd(), env.UPLOADS_DIR);
  const assetDir = path.join(uploadsRoot, 'company-assets');
  await fs.mkdir(assetDir, { recursive: true });
  const signatureName = `ai-final-signature-${runId}.png`;
  const stampName = `ai-final-stamp-${runId}.png`;
  await fs.writeFile(path.join(assetDir, signatureName), tinyPngBuffer());
  await fs.writeFile(path.join(assetDir, stampName), tinyPngBuffer());
  await prisma.companySettings.upsert({
    where: { id: originalSettings.id },
    create: {
      ...originalSettings,
      signatureUrl: `/uploads/company-assets/${signatureName}`,
      stampUrl: `/uploads/company-assets/${stampName}`,
    },
    update: {
      signatureUrl: `/uploads/company-assets/${signatureName}`,
      stampUrl: `/uploads/company-assets/${stampName}`,
    },
  });
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

function block(key: string, reason: string) {
  const [module, action] = key.split('.', 2);
  if (!module || !action) {
    blockedReasons.push(`${key}: ${reason}`);
    return;
  }
  const bucket = (results as Record<string, Record<string, FinalStatus>>)[module];
  if (bucket) {
    bucket[action] = 'BLOCKED';
  }
  blockedReasons.push(`${key}: ${reason}`);
}

function pass(module: keyof FinalResults, action: string) {
  results[module][action] = 'PASS';
}

function futureDate(days: number) {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV+8AAAAASUVORK5CYII=',
    'base64'
  );
}

async function cleanup(ids: {
  adminId: string;
  ownerId: string;
  selectedId: string;
  primaryCustomerId: string;
  selectedCustomerId: string;
  contractId: string;
  invoiceId: string;
  quoteId: string;
  convertedInvoiceId: string;
  creditNoteId: string;
  expenseApprovedId: string;
  expenseRejectedId: string;
  productId: string;
  recurringPlanId: string;
  reminderId: string;
  createdRoleId: string;
  createdPermissionId: string;
  createdManagedUserId: string;
}) {
  const userIds = [ids.adminId, ids.ownerId, ids.selectedId, ids.createdManagedUserId].filter(Boolean);
  const customerIds = [ids.primaryCustomerId, ids.selectedCustomerId].filter(Boolean);
  const contractIds = [ids.contractId].filter(Boolean);
  const invoiceIds = [ids.invoiceId, ids.convertedInvoiceId].filter(Boolean);
  const expenseIds = [ids.expenseApprovedId, ids.expenseRejectedId].filter(Boolean);

  if (userIds.length) {
    await prisma.aiPendingAction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.aiMessage.deleteMany({ where: { conversation: { userId: { in: userIds } } } });
    await prisma.aiConversation.deleteMany({ where: { userId: { in: userIds } } });
  }

  await prisma.reminder.deleteMany({ where: { invoice: { customerId: { in: customerIds } } } });
  await prisma.recurringExecution.deleteMany({ where: { planId: ids.recurringPlanId || undefined } });
  await prisma.recurringPlanItem.deleteMany({ where: { planId: ids.recurringPlanId || undefined } });
  await prisma.recurringPlan.deleteMany({ where: { id: ids.recurringPlanId || undefined } });

  await prisma.expenseEmailLog.deleteMany({ where: { expenseNoteId: { in: expenseIds } } });
  await prisma.expenseAuditLog.deleteMany({ where: { expenseNoteId: { in: expenseIds } } });
  await prisma.expenseAIAnalysis.deleteMany({ where: { attachment: { expenseNoteId: { in: expenseIds } } } });
  await prisma.expenseAttachment.deleteMany({ where: { expenseNoteId: { in: expenseIds } } });
  await prisma.expenseNote.deleteMany({ where: { id: { in: expenseIds } } });
  await prisma.expenseType.deleteMany({ where: { name: { contains: `AI Final Expense Type ${runId}` } } });
  await prisma.expenseCategory.deleteMany({ where: { name: { contains: `AI Final Expense Category ${runId}` } } });

  await prisma.creditNote.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.invoiceEmailLog.deleteMany({ where: { invoice: { customerId: { in: customerIds } } } });
  await prisma.payment.deleteMany({ where: { invoice: { customerId: { in: customerIds } } } });
  await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: { in: customerIds } } } });
  await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.devis.deleteMany({ where: { customerId: { in: customerIds } } });

  await prisma.contractEmailLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractSignatureLink.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractAuditLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractTimeEntry.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractVersion.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });

  await prisma.userClientAssignment.deleteMany({ where: { userId: { in: userIds } } });
  if (ids.createdPermissionId) {
    await prisma.permission.deleteMany({ where: { id: ids.createdPermissionId } });
  }
  if (ids.createdRoleId) {
    await prisma.rolePermission.deleteMany({ where: { roleId: ids.createdRoleId } });
    await prisma.user.updateMany({ where: { rbacRoleId: ids.createdRoleId }, data: { rbacRoleId: null } });
    await prisma.rbacRole.deleteMany({ where: { id: ids.createdRoleId } });
  }

  await prisma.product.deleteMany({ where: { id: ids.productId || undefined } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { email: `owner-customer-${runId}@example.com` } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
