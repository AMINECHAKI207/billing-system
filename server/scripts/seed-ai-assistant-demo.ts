import { PermissionScope } from '@prisma/client';
import { prisma } from '@config/database';
import { AI_ASSISTANT_PERMISSION_KEYS } from '@modules/ai-assistant/aiAssistant.permissions';
import {
  demoEmployeeEmail,
  demoManagerEmail,
  demoPassword,
  demoPrefix,
  seedDemoTimesheets,
} from '../src/demo/timesheets-demo.shared';

async function grantAiAssistantPermissions(roleId: string) {
  await prisma.permission.createMany({
    data: AI_ASSISTANT_PERMISSION_KEYS.map((key) => ({
      key,
      resource: 'ai_assistant',
      action: key.replace('ai_assistant.', ''),
      description: `${demoPrefix} AI Assistant permission ${key}`,
    })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany({
    where: { key: { in: AI_ASSISTANT_PERMISSION_KEYS } },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: { scope: PermissionScope.ALL },
      create: { roleId, permissionId: permission.id, scope: PermissionScope.ALL },
    });
  }
}

async function main() {
  const result = await seedDemoTimesheets();
  const managerRoleId = result.manager.rbacRoleId;
  if (!managerRoleId) {
    throw new Error('Demo manager has no RBAC role.');
  }

  await grantAiAssistantPermissions(managerRoleId);

  const readyEntry = result.entries.approved;
  const submittedEntry = result.entries.submitted;

  console.log(`${demoPrefix} AI Assistant demo seed completed.`);
  console.log(`Manager login: ${demoManagerEmail} / ${demoPassword}`);
  console.log(`Employee login: ${demoEmployeeEmail} / ${demoPassword}`);
  console.log(`Contract: ${result.contract.contractNumber} (${result.contract.id})`);
  console.log(`Client: ${result.client.company ?? result.client.name}`);
  console.log('');
  console.log('Use these prompts in the AI Admin Assistant:');
  console.log(`/search_contracts {"query":"${result.contract.contractNumber}","limit":5}`);
  console.log(`/get_contract_details {"contractId":"${result.contract.id}"}`);
  console.log(`/list_timesheets {"contractId":"${result.contract.id}"}`);
  console.log(`/approve_timesheet {"contractId":"${result.contract.id}","timeEntryId":"${submittedEntry.id}"}`);
  console.log(`/prepare_invoice_preview {"contractId":"${result.contract.id}"}`);
  console.log(`/generate_invoice_from_timesheets {"contractId":"${result.contract.id}"}`);
  console.log('');
  console.log('Expected workflow:');
  console.log('1. Read-only prompts execute immediately.');
  console.log('2. Approve and invoice generation create pending actions.');
  console.log('3. Confirm the pending action in the UI before the backend writes anything.');
  console.log(`4. One approved billable time entry is ready for invoicing: ${readyEntry.id}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
