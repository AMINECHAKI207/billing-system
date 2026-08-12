import { env } from './src/config/env';

// Force local email delivery for this run so the "send invoice email" scenario
// exercises the real invoiceService.sendInvoiceEmail() code path (real PDF render,
// real DB email log, real transporter selection) without dispatching a real message
// through the configured Gmail SMTP account. This is the same technique the tracked
// src/tests/invoiceEmailWorkflow.test.ts uses.
env.SMTP_USER = 'demo@example.com';
env.SMTP_PASS = 'replace_with_smtp_password';
env.SMTP_FROM_EMAIL = 'demo@example.com';

import assert from 'assert/strict';
import {
  ContractBillingFrequency,
  ContractPricingType,
  ContractProrationPolicy,
  ContractSignatureStatus,
  ContractStatus,
  ContractTimeEntryStatus,
  DevisStatus,
  InvoiceStatus,
  PermissionScope,
  Role,
} from '@prisma/client';
import { prisma } from './src/config/database';
import { aiAssistantService } from './src/modules/ai-assistant/aiAssistant.service';
import { contractService } from './src/modules/contract/contract.service';
import { devisService } from './src/modules/devis/devis.service';

// Final ERP AI Agent E2E validation.
//
// Every scenario below drives aiAssistantService.executeTool()/confirmAction() —
// the SAME pending-action -> confirm -> execute pipeline the chat UI uses — with an
// explicit toolName so results are deterministic. (Natural-language routing through
// the live LLM classifier is separately covered by test-intent-routing.ts; the live
// model is non-deterministic between runs and is not used here to judge business-
// logic correctness.) No mocks: every write goes through the real business service
// (contractService/invoiceService/devisService) and is verified against the real DB.

const runId = Date.now();
const adminEmail = `e2e-admin-${runId}@example.com`;
const customerEmail = `e2e-client-${runId}@example.com`;

const results: { scenario: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];

async function scenario(name: string, run: () => Promise<string>) {
  try {
    const detail = await run();
    results.push({ scenario: name, status: 'PASS', detail });
    console.log(`[PASS] ${name} - ${detail}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ scenario: name, status: 'FAIL', detail });
    console.log(`[FAIL] ${name} - ${detail}`);
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

async function main() {
  const admin = await prisma.user.create({
    data: { name: 'E2E Admin', email: adminEmail, passwordHash: 'not-used', role: Role.ADMIN },
  });
  // The real app lazily links a legacy Role.ADMIN user to the seeded "ADMIN" RbacRole
  // on their first permission-gated HTTP request (see requirePermission.ts). This
  // script drives services/tools directly (no HTTP layer), so replicate that same
  // link up front — otherwise fine-grained RBAC checks like VAT override would fail
  // even though a real logged-in admin would already have been auto-linked.
  await prisma.user.update({ where: { id: admin.id }, data: { rbacRole: { connect: { name: 'ADMIN' } } } });
  const client = await prisma.customer.create({
    data: {
      createdById: admin.id,
      name: 'E2E Client',
      email: customerEmail,
      company: 'E2E Client SARL',
      country: 'Morocco',
      countryCode: 'MA',
    },
  });

  const permissions = [
    'ai_assistant.access', 'ai_assistant.use_read_tools', 'ai_assistant.use_write_tools',
    'ai_assistant.confirm_actions', 'ai_assistant.view_history', 'clients.view',
    'contracts.view', 'contracts.create', 'contracts.time_entries.create',
    'contracts.time_entries.update', 'contracts.time_entries.submit', 'contracts.time_entries.approve',
    'contracts.billing.generate', 'invoices.view', 'invoices.create', 'invoices.update',
    'invoices.send', 'devis.view', 'devis.create', 'devis.convert',
  ];
  const assistantUser = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    themePreference: admin.themePreference,
    isActive: admin.isActive,
    rbacRoleId: null,
    permissions,
    permissionScopes: Object.fromEntries(permissions.map((p) => [p, PermissionScope.ALL])),
  };

  let invoiceId = '';

  try {
    const contract = await contractService.create(admin, PermissionScope.ALL, {
      clientId: client.id,
      title: `E2E contract ${runId}`,
      contractType: 'SERVICE',
      language: 'en',
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
      content: 'Contract fixture for final AI assistant E2E validation.',
    });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: ContractStatus.ACTIVE } });
    await prisma.contractVersion.update({
      where: { id: contract.currentVersionId! },
      data: { signatureStatus: ContractSignatureStatus.COMPLETED, isSigned: true },
    });

    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'en' });
    const cid = conversation.id;

    // --- 1. Create invoice (manual/ad-hoc, via create_invoice tool) ---
    await scenario('Create invoice', async () => {
      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'create_invoice',
        input: {
          customerId: client.id,
          issueDate: today(),
          dueDate: futureDate(30),
          taxRate: 20,
          discount: 0,
          currency: 'MAD',
          items: [{ description: 'Initial consulting scope', quantity: 10, unitPrice: 500 }],
        },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const invoice = confirmed.result as { id: string; invoiceNumber: string; status: InvoiceStatus; total: unknown };
      assert.ok(invoice.invoiceNumber.startsWith('INV-'));
      assert.equal(invoice.status, InvoiceStatus.DRAFT);
      const dbInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      assert.equal(dbInvoice.customerId, client.id);
      invoiceId = invoice.id;
      return `invoice ${invoice.invoiceNumber} created in DB with status ${invoice.status}, total ${invoice.total}`;
    });

    // --- 2. Modify invoice (due date + notes) ---
    await scenario('Modify invoice', async () => {
      const before = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
      const newDueDate = futureDate(45);
      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'update_invoice',
        input: {
          id: invoiceId,
          customerId: before.customerId,
          issueDate: before.issueDate.toISOString().slice(0, 10),
          dueDate: newDueDate,
          taxRate: Number(before.taxRate),
          discount: Number(before.discount),
          notes: 'Updated via AI assistant E2E validation',
          currency: before.currency,
          items: before.items.map((item) => ({
            description: item.description,
            unit: item.unit ?? undefined,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: item.taxRate != null ? Number(item.taxRate) : undefined,
          })),
        },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      assert.equal(after.dueDate.toISOString().slice(0, 10), newDueDate);
      assert.equal(after.notes, 'Updated via AI assistant E2E validation');
      return `invoice due date changed to ${newDueDate} in DB, notes updated`;
    });

    // --- 3. Add invoice line ---
    await scenario('Add invoice line', async () => {
      const before = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
      const beforeCount = before.items.length;
      const items = [
        ...before.items.map((item) => ({
          description: item.description,
          unit: item.unit ?? undefined,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxRate: item.taxRate != null ? Number(item.taxRate) : undefined,
        })),
        { description: 'Extra support - 2 hours', quantity: 2, unitPrice: 500 },
      ];
      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'update_invoice',
        input: {
          id: invoiceId,
          customerId: before.customerId,
          issueDate: before.issueDate.toISOString().slice(0, 10),
          dueDate: before.dueDate.toISOString().slice(0, 10),
          taxRate: Number(before.taxRate),
          discount: Number(before.discount),
          notes: before.notes ?? undefined,
          currency: before.currency,
          items,
        },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
      assert.equal(after.items.length, beforeCount + 1);
      assert.ok(after.items.some((item) => item.description === 'Extra support - 2 hours'));
      return `invoice line items grew from ${beforeCount} to ${after.items.length} in DB`;
    });

    // --- 4. Change VAT ---
    await scenario('Change VAT', async () => {
      const before = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
      const newTaxRate = 10;
      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'update_invoice',
        input: {
          id: invoiceId,
          customerId: before.customerId,
          issueDate: before.issueDate.toISOString().slice(0, 10),
          dueDate: before.dueDate.toISOString().slice(0, 10),
          taxRate: newTaxRate,
          vatOverrideReason: 'E2E validation VAT change',
          discount: Number(before.discount),
          notes: before.notes ?? undefined,
          currency: before.currency,
          items: before.items.map((item) => ({
            description: item.description,
            unit: item.unit ?? undefined,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: item.taxRate != null ? Number(item.taxRate) : undefined,
          })),
        },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      assert.equal(Number(after.taxRate), newTaxRate);
      return `invoice VAT rate changed to ${Number(after.taxRate)}% in DB (taxAmount ${after.taxAmount})`;
    });

    // --- 5. Generate PDF ---
    await scenario('Generate PDF', async () => {
      const result = await aiAssistantService.executeTool(assistantUser, {
        toolName: 'generate_invoice_pdf',
        input: { invoiceId },
      }) as { type: string; result: { downloadEndpoint: string; invoiceNumber: string } };
      assert.equal(result.type, 'tool_result');
      assert.match(result.result.downloadEndpoint, new RegExp(`/api/invoices/${invoiceId}/pdf`));
      return `PDF download endpoint resolved: ${result.result.downloadEndpoint}`;
    });

    // --- 6. Send email ---
    await scenario('Send email', async () => {
      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'send_invoice_email',
        input: { invoiceId },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const delivery = confirmed.result as { delivery?: { mode: string; filePath?: string } };
      assert.ok(delivery.delivery, 'expected a delivery result from sendInvoiceEmail');
      assert.equal(delivery.delivery!.mode, 'local');
      const emailLog = await prisma.invoiceEmailLog.findFirst({ where: { invoiceId }, orderBy: { createdAt: 'desc' } });
      assert.ok(emailLog, 'expected a real InvoiceEmailLog row');
      return `invoice email delivered via ${delivery.delivery!.mode} fallback, DB email log recorded (status ${emailLog!.status})`;
    });

    // --- 7. Convert quote to invoice ---
    await scenario('Convert quote to invoice', async () => {
      const devis = await devisService.createDevis(admin, PermissionScope.ALL, {
        customerId: client.id,
        issueDate: today(),
        validUntil: futureDate(30),
        taxRate: 20,
        discount: 0,
        currency: 'MAD',
        items: [{ description: 'Proposed engagement', quantity: 1, unitPrice: 12000, discount: 0, taxRate: 20 }],
      } as never);
      await devisService.updateStatus(devis.id, admin.id, PermissionScope.ALL, DevisStatus.SENT);
      await devisService.updateStatus(devis.id, admin.id, PermissionScope.ALL, DevisStatus.APPROVED);

      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'convert_quote_to_invoice',
        input: { id: devis.id },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const result = confirmed.result as { devis: { id: string }; invoice: { id: string; invoiceNumber: string } };
      const convertedDevis = await prisma.devis.findUniqueOrThrow({ where: { id: devis.id } });
      assert.equal(convertedDevis.status, DevisStatus.CONVERTED);
      const createdInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoice.id } });
      assert.equal(createdInvoice.sourceDevisId, devis.id);
      return `quote ${devis.devisNumber} converted to invoice ${result.invoice.invoiceNumber} in DB (devis status ${convertedDevis.status})`;
    });

    // --- 8. Approve timesheet ---
    await scenario('Approve timesheet', async () => {
      const entry = await contractService.createTimeEntry(contract.id, admin, PermissionScope.ALL, {
        workDate: today(),
        startTime: atTime('09:00'),
        endTime: atTime('11:00'),
        breakMinutes: 0,
        activityType: 'Development',
        description: 'E2E timesheet awaiting approval',
        billable: true,
      } as never);
      await contractService.submitTimeEntry(contract.id, entry.id, admin, PermissionScope.ALL);

      const pending = await aiAssistantService.executeTool(assistantUser, {
        conversationId: cid,
        toolName: 'approve_timesheet',
        input: { contractId: contract.id, timeEntryId: entry.id },
      }) as { type: string; action: { id: string } };
      assert.equal(pending.type, 'pending_action');
      const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
      assert.equal(confirmed.action.status, 'EXECUTED');
      const dbEntry = await prisma.contractTimeEntry.findUniqueOrThrow({ where: { id: entry.id } });
      assert.equal(dbEntry.status, ContractTimeEntryStatus.APPROVED);
      return `timesheet ${entry.id} status is ${dbEntry.status} in DB`;
    });

    console.log('\n=== FINAL E2E VALIDATION REPORT ===\n');
    for (const r of results) {
      console.log(`${r.status === 'PASS' ? '✅' : '❌'} ${r.scenario}: ${r.status} - ${r.detail}`);
    }
    const failed = results.filter((r) => r.status === 'FAIL');
    console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    await prisma.aiMessage.deleteMany({ where: { conversation: { userId: admin.id } } });
    await prisma.aiConversation.deleteMany({ where: { userId: admin.id } });
    await prisma.invoiceEmailLog.deleteMany({ where: { invoice: { customerId: client.id } } }).catch(() => undefined);
    await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: client.id } } });
    await prisma.invoice.deleteMany({ where: { customerId: client.id } });
    await prisma.devisItem.deleteMany({ where: { devis: { customerId: client.id } } });
    await prisma.devis.deleteMany({ where: { customerId: client.id } });
    await prisma.contractTimeEntry.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contractVersion.deleteMany({ where: { contract: { clientId: client.id } } });
    await prisma.contract.deleteMany({ where: { clientId: client.id } });
    await prisma.customer.deleteMany({ where: { id: client.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  }
}

main()
  .catch((error) => {
    console.error('FATAL:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
