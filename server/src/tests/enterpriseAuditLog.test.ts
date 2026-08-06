import assert from 'assert/strict';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '@config/database';
import { runWithAuditContext } from '@modules/audit/audit.context';
import { auditService } from '@modules/audit/audit.service';

const runId = randomUUID();
const requestId = `audit-test-${runId}`;
const adminEmail = `audit-admin-${runId}@example.com`;
const customerEmail = `audit-customer-${runId}@example.com`;
const updatedCustomerEmail = `audit-updated-${runId}@example.com`;

async function main() {
  const user = await runWithAuditContext({
    requestId,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
    browser: 'Chrome',
    operatingSystem: 'Windows',
    device: 'Desktop',
    httpMethod: 'POST',
    route: '/api/tests/audit',
  }, async () => prisma.user.create({
    data: {
      name: 'Audit Admin',
      email: adminEmail,
      passwordHash: 'super-secret-password-hash',
      role: Role.ADMIN,
    },
  }));

  await runWithAuditContext({
    requestId,
    userId: user.id,
    userRole: Role.ADMIN,
    permissions: ['audit_logs.view'],
    httpMethod: 'POST',
    route: '/api/customers',
  }, async () => {
    const customer = await prisma.customer.create({
      data: {
        createdById: user.id,
        name: 'Audit Customer',
        email: customerEmail,
        country: 'Morocco',
        countryCode: 'MA',
      },
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { email: updatedCustomerEmail },
    });

    await auditService.logBusinessAction({
      module: 'authentication',
      entity: 'Session',
      entityId: user.id,
      action: 'LOGIN',
      userId: user.id,
      metadata: { email: user.email, authorization: 'Bearer secret-token' },
    });

    const createLog = await waitForAuditLog({ entity: 'Customer', entityId: customer.id, action: 'CREATE' });
    assert.equal(createLog.module, 'clients');
    assert.equal(createLog.userId, user.id);
    assert.equal(createLog.requestId, requestId);

    const updateLog = await waitForAuditLog({ entity: 'Customer', entityId: customer.id, action: 'UPDATE' });
    assert.deepEqual(updateLog.oldValues, { email: customerEmail });
    assert.deepEqual(updateLog.newValues, { email: updatedCustomerEmail });

    const userCreateLog = await waitForAuditLog({ entity: 'User', entityId: user.id, action: 'CREATE' });
    assert.equal((userCreateLog.newValues as Record<string, unknown>).passwordHash, '[REDACTED]');

    const loginLog = await waitForAuditLog({ entity: 'Session', entityId: user.id, action: 'LOGIN' });
    assert.equal((loginLog.metadata as Record<string, unknown>).authorization, '[REDACTED]');

    await assert.rejects(
      () => prisma.auditLog.update({ where: { id: createLog.id }, data: { action: 'TAMPERED' } }),
      /immutable/i
    );
    await assert.rejects(
      () => prisma.auditLog.delete({ where: { id: createLog.id } }),
      /immutable/i
    );

    await prisma.customer.delete({ where: { id: customer.id } });
  });

  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  console.log('Enterprise audit log tests passed');
}

async function waitForAuditLog(where: { entity: string; entityId?: string; action: string }) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const log = await prisma.auditLog.findFirst({
      where: {
        ...where,
        requestId: where.entity === 'User' ? requestId : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (log) return log;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Audit log not found for ${where.entity}.${where.action}`);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
