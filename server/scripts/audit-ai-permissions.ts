import { PermissionScope } from '@prisma/client';
import { prisma } from '@config/database';
import { AI_ASSISTANT_PERMISSION_KEYS } from '@modules/ai-assistant/aiAssistant.permissions';
import { aiTools } from '@modules/ai-assistant/tools/contractTools';

type Issue = {
  type: string;
  detail: string;
  repair?: string;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const issues: Issue[] = [];
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true, resource: true } });
  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const toolNames = new Set<string>();

  for (const permissionKey of AI_ASSISTANT_PERMISSION_KEYS) {
    if (!permissionByKey.has(permissionKey)) {
      issues.push({ type: 'MISSING_AI_PERMISSION', detail: permissionKey });
    }
  }

  for (const tool of aiTools) {
    if (toolNames.has(tool.name)) {
      issues.push({ type: 'DUPLICATE_TOOL_NAME', detail: tool.name });
    }
    toolNames.add(tool.name);
    if (!permissionByKey.has(tool.requiredPermission)) {
      issues.push({ type: 'TOOL_PERMISSION_NOT_FOUND', detail: `${tool.name} -> ${tool.requiredPermission}` });
    }
    if (tool.riskLevel !== 'READ_ONLY' && !tool.preview) {
      issues.push({ type: 'WRITE_TOOL_WITHOUT_PREVIEW', detail: tool.name });
    }
  }

  const orphanRolePermissions = await prisma.$queryRaw<Array<{ role_id: string; permission_id: string }>>`
    SELECT rp.role_id, rp.permission_id
    FROM role_permissions rp
    LEFT JOIN roles r ON r.id = rp.role_id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE r.id IS NULL OR p.id IS NULL
  `;
  for (const record of orphanRolePermissions) {
    issues.push({ type: 'ORPHAN_ROLE_PERMISSION', detail: `${record.role_id}:${record.permission_id}` });
  }

  const nullableScopes = await prisma.$queryRaw<Array<{ role_id: string; permission_id: string; permission_key: string }>>`
    SELECT rp.role_id, rp.permission_id, p.key AS permission_key
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.scope IS NULL
  `;
  for (const record of nullableScopes) {
    issues.push({
      type: 'MISSING_SCOPE',
      detail: `${record.role_id}:${record.permission_key}`,
      repair: `Set scope to ${PermissionScope.OWN}`,
    });
  }

  if (apply && nullableScopes.length) {
    await prisma.$executeRaw`
      UPDATE role_permissions
      SET scope = ${PermissionScope.OWN}::"PermissionScope"
      WHERE scope IS NULL
    `;
  }

  const payload = {
    mode: apply ? 'apply' : 'dry-run',
    issueCount: issues.length,
    repaired: apply ? nullableScopes.length : 0,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (issues.some((issue) => issue.type !== 'MISSING_SCOPE') || (!apply && issues.length)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Permission audit failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
