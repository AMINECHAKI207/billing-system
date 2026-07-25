import { requirePermission } from './requirePermission';

/**
 * Backwards-compatible name for integrations migrating to RBAC.
 * Arguments are permission keys, never role names.
 */
export const authorize = (...permissions: string[]) => requirePermission(...permissions);
