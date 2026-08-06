import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { mergeAuditContext, runWithAuditContext } from '@modules/audit/audit.context';
import { userAgentDetails } from '@modules/audit/audit.utils';

export const auditContext = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = Date.now();
  const userAgent = req.headers['user-agent'];
  const userAgentValue = Array.isArray(userAgent) ? userAgent.join(' ') : userAgent;
  const details = userAgentDetails(userAgentValue);
  const sessionCookie = req.cookies?.refreshToken ?? req.cookies?.accessToken;
  const sessionId = typeof sessionCookie === 'string' && sessionCookie
    ? createSessionFingerprint(sessionCookie)
    : undefined;

  runWithAuditContext({
    ipAddress: req.ip,
    userAgent: userAgentValue,
    browser: details.browser,
    operatingSystem: details.operatingSystem,
    device: details.device,
    requestId: String(res.locals.requestId ?? req.header('x-request-id') ?? randomUUID()),
    sessionId,
    httpMethod: req.method,
    route: req.originalUrl,
    startedAt,
  }, () => {
    res.on('finish', () => {
      mergeAuditContext({
        statusCode: res.statusCode,
        success: res.statusCode < 400,
        executionTime: Date.now() - startedAt,
      });
    });
    next();
  });
};

export function attachAuditUser(req: Request): void {
  if (!req.user) return;
  mergeAuditContext({
    userId: req.user.id,
    userRole: req.user.role,
    permissions: req.user.permissions,
    permissionScopes: req.user.permissionScopes,
  });
}

function createSessionFingerprint(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return `s_${Math.abs(hash).toString(36)}`;
}
