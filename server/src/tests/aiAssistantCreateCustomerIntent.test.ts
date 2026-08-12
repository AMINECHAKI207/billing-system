import assert from 'assert/strict';
import { PermissionScope, Role } from '@prisma/client';
import { prisma } from '@config/database';
import { aiAssistantService } from '@modules/ai-assistant/aiAssistant.service';
import type { AssistantUser } from '@modules/ai-assistant/tools/toolTypes';

const runId = Date.now();
const adminEmail = `ai-create-customer-admin-${runId}@example.com`;

async function main() {
  const admin = await prisma.user.create({
    data: {
      name: 'AI Customer Admin',
      email: adminEmail,
      passwordHash: 'not-used',
      role: Role.ADMIN,
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
    ],
    permissionScopes: {
      'ai_assistant.access': PermissionScope.ALL,
      'ai_assistant.use_read_tools': PermissionScope.ALL,
      'ai_assistant.use_write_tools': PermissionScope.ALL,
      'ai_assistant.confirm_actions': PermissionScope.ALL,
      'ai_assistant.view_history': PermissionScope.ALL,
      'clients.view': PermissionScope.ALL,
      'clients.create': PermissionScope.ALL,
    },
  };

  const createdCustomerEmails: string[] = [];

  try {
    const conversation = await aiAssistantService.createConversation(assistantUser, { language: 'fr' });

    const clarificationCases = [
      {
        language: 'en',
        content: 'Create a client called Test AI Client with email testai@example.com',
        expects: [/form|preview/i],
      },
      {
        language: 'en',
        content: 'Create a customer named Test AI Client',
        expects: [/form|preview/i],
      },
      {
        language: 'en',
        content: 'Add a new client Test AI Client',
        expects: [/form|preview/i],
      },
      {
        language: 'fr',
        content: "Crée un client Test AI Client avec l'email testai@example.com",
        expects: [/formulaire|previsualisation/i],
      },
      {
        language: 'fr',
        content: 'Ajoute un nouveau client Test AI Client',
        expects: [/formulaire|previsualisation/i],
      },
      {
        language: 'fr',
        content: 'Sawb lia client smito Test AI Client',
        expects: [/formulaire|previsualisation/i],
      },
      {
        language: 'fr',
        content: 'Zid client jdid Test AI Client',
        expects: [/formulaire|previsualisation/i],
      },
    ] as const;

    for (const testCase of clarificationCases) {
      const reply = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
        language: testCase.language,
        content: testCase.content,
      });

      assert.ok(reply.executionResult, `Expected a structured form for "${testCase.content}"`);
      assert.equal((reply.executionResult as { type?: string }).type, 'structured_form');
      assert.doesNotMatch(reply.message.content, /Je ne suis pas certain de votre intention/i);
      assert.doesNotMatch(reply.message.content, /I am not fully sure about your intent/i);
      for (const matcher of testCase.expects) {
        assert.match(reply.message.content, matcher, `Missing expected clarification hint for "${testCase.content}"`);
      }
    }

    const completeMessage = await aiAssistantService.sendMessage(assistantUser, conversation.id, {
      language: 'en',
      content: 'Create a client called Test AI Client Morocco with email testai-complete@example.com in Morocco',
    });
    assert.ok(completeMessage.executionResult);
    assert.equal((completeMessage.executionResult as { type: string }).type, 'pending_action');

    const pending = completeMessage.executionResult as { type: string; action: { id: string } };
    const confirmed = await aiAssistantService.confirmAction(assistantUser, pending.action.id);
    assert.equal(['EXECUTED', 'COMPLETED'].includes(confirmed.action.status), true);

    const createdCustomer = confirmed.result as Record<string, unknown>;
    assert.equal(typeof createdCustomer.id, 'string');
    assert.equal(createdCustomer.email, 'testai-complete@example.com');
    assert.equal(createdCustomer.countryCode, 'MA');
    createdCustomerEmails.push('testai-complete@example.com');

    const persistedCustomer = await prisma.customer.findFirst({
      where: {
        email: 'testai-complete@example.com',
        createdById: admin.id,
      },
    });
    assert.ok(persistedCustomer);
    assert.equal(persistedCustomer?.name, 'Test AI Client Morocco');
    assert.equal(persistedCustomer?.country, 'Morocco');
    assert.equal(persistedCustomer?.countryCode, 'MA');

    console.log('PASS aiAssistantCreateCustomerIntent.test.ts');
  } finally {
    if (createdCustomerEmails.length > 0) {
      await prisma.customer.deleteMany({
        where: {
          email: { in: createdCustomerEmails },
          createdById: admin.id,
        },
      });
    }
    await prisma.aiPendingAction.deleteMany({ where: { userId: admin.id } });
    const conversationIds = await prisma.aiConversation.findMany({
      where: { userId: admin.id },
      select: { id: true },
    });
    if (conversationIds.length > 0) {
      await prisma.aiMessage.deleteMany({ where: { conversationId: { in: conversationIds.map((item) => item.id) } } });
      await prisma.aiConversation.deleteMany({ where: { id: { in: conversationIds.map((item) => item.id) } } });
    }
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error('FAIL aiAssistantCreateCustomerIntent.test.ts');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
