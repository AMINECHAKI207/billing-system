import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { logger } from '@config/logger';
import { getAuditContext, type AuditContext } from './audit.context';
import {
  actionForOperation,
  diffRecords,
  extractEntityId,
  moduleForModel,
  sanitizeAuditObject,
} from './audit.utils';

type Delegate = {
  findUnique?: (args: unknown) => Promise<unknown>;
  findFirst?: (args: unknown) => Promise<unknown>;
};

const SKIPPED_MODELS = new Set([
  'AuditLog',
  'ContractAuditLog',
  'ExpenseAuditLog',
  'CreditNoteAuditLog',
  'CreditNoteEmailLog',
  'ContractEmailLog',
  'ExpenseEmailLog',
]);

export function createAuditExtension(baseClient: PrismaClient) {
  return Prisma.defineExtension({
    name: 'enterpriseAudit',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const context = getAuditContext();
          const result = await query(args);
          if (model && !SKIPPED_MODELS.has(model)) {
            queueAuditLog(baseClient, model, 'CREATE', undefined, result, args, context);
          }
          return result;
        },
        async update({ model, args, query }) {
          const context = getAuditContext();
          const previous = model && !SKIPPED_MODELS.has(model) ? await findPrevious(baseClient, model, args) : undefined;
          const result = await query(args);
          if (model && !SKIPPED_MODELS.has(model)) {
            queueAuditLog(baseClient, model, 'UPDATE', previous, result, args, context);
          }
          return result;
        },
        async delete({ model, args, query }) {
          const context = getAuditContext();
          const previous = model && !SKIPPED_MODELS.has(model) ? await findPrevious(baseClient, model, args) : undefined;
          const result = await query(args);
          if (model && !SKIPPED_MODELS.has(model)) {
            queueAuditLog(baseClient, model, 'DELETE', previous, undefined, args, context);
          }
          return result;
        },
        async upsert({ model, args, query }) {
          const context = getAuditContext();
          const previous = model && !SKIPPED_MODELS.has(model) ? await findPrevious(baseClient, model, args) : undefined;
          const result = await query(args);
          if (model && !SKIPPED_MODELS.has(model)) {
            queueAuditLog(baseClient, model, actionForOperation('upsert', previous), previous, result, args, context);
          }
          return result;
        },
      },
    },
  });
}

async function findPrevious(baseClient: PrismaClient, model: string, args: unknown) {
  const delegate = delegateForModel(baseClient, model);
  const where = args && typeof args === 'object' && 'where' in args ? (args as { where?: unknown }).where : undefined;
  if (!delegate?.findUnique || !where) return undefined;
  try {
    return await delegate.findUnique({ where });
  } catch {
    return delegate.findFirst ? delegate.findFirst({ where }) : undefined;
  }
}

function queueAuditLog(
  baseClient: PrismaClient,
  model: string,
  action: string,
  previous: unknown,
  result: unknown,
  args: unknown,
  context: AuditContext | undefined
) {
  const diff = action === 'UPDATE'
    ? diffRecords(previous, result)
    : {
        oldValues: previous ? sanitizeAuditObject(previous) : undefined,
        newValues: result ? sanitizeAuditObject(result) : undefined,
      };

  if (action === 'UPDATE' && !diff.oldValues && !diff.newValues) return;

  const metadata = sanitizeAuditObject({
    userRole: context?.userRole,
    permissions: context?.permissions,
    permissionScopes: context?.permissionScopes,
  });

  void baseClient.auditLog.create({
    data: {
      userId: context?.userId,
      module: moduleForModel(model),
      entity: model,
      entityId: extractEntityId(result ?? previous, args),
      action,
      oldValues: diff.oldValues,
      newValues: diff.newValues,
      metadata,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      browser: context?.browser,
      operatingSystem: context?.operatingSystem,
      device: context?.device,
      requestId: context?.requestId,
      sessionId: context?.sessionId,
      httpMethod: context?.httpMethod,
      route: context?.route,
      statusCode: context?.statusCode,
      success: context?.success ?? true,
      executionTime: context?.executionTime,
    },
  }).catch((error: unknown) => {
    logger.warn('Audit log write failed', { error: error instanceof Error ? error.message : String(error), model, action });
  });
}

function delegateForModel(baseClient: PrismaClient, model: string): Delegate | undefined {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  const delegate = (baseClient as unknown as Record<string, Delegate | undefined>)[key];
  return delegate;
}
