import assert from 'assert/strict';
import { getInvalidationKeysForAiAction } from '../client/src/components/ai-assistant/queryInvalidation.ts';

function includesKey(keys: ReadonlyArray<readonly string[]>, expected: readonly string[]) {
  return keys.some((key) => JSON.stringify(key) === JSON.stringify(expected));
}

const contractWorkflowKeys = getInvalidationKeysForAiAction({ toolName: 'contract_invoice_workflow' });
assert.equal(includesKey(contractWorkflowKeys, ['contracts']), true);
assert.equal(includesKey(contractWorkflowKeys, ['invoices']), true);
assert.equal(includesKey(contractWorkflowKeys, ['payments']), true);
assert.equal(includesKey(contractWorkflowKeys, ['reports']), true);
assert.equal(includesKey(contractWorkflowKeys, ['dashboard']), true);

const expenseKeys = getInvalidationKeysForAiAction({ toolName: 'approve_expense' });
assert.equal(includesKey(expenseKeys, ['expense-notes']), true);
assert.equal(includesKey(expenseKeys, ['expense-kpi']), true);

const settingsKeys = getInvalidationKeysForAiAction({ toolName: 'update_company_settings' });
assert.equal(includesKey(settingsKeys, ['settings', 'company']), true);
assert.equal(includesKey(settingsKeys, ['settings', 'email-status']), true);

const rbacKeys = getInvalidationKeysForAiAction({ toolName: 'assign_user_role' });
assert.equal(includesKey(rbacKeys, ['users']), true);
assert.equal(includesKey(rbacKeys, ['rbac', 'users']), true);
assert.equal(includesKey(rbacKeys, ['auth', 'me']), true);

const recurringKeys = getInvalidationKeysForAiAction({ toolName: 'run_recurring_plan_now' });
assert.equal(includesKey(recurringKeys, ['recurring-plans']), true);
assert.equal(includesKey(recurringKeys, ['invoices']), true);

const productKeys = getInvalidationKeysForAiAction({ toolName: 'create_product' });
assert.equal(includesKey(productKeys, ['products']), true);
assert.equal(includesKey(productKeys, ['catalogue']), true);

const expenseExportKeys = getInvalidationKeysForAiAction({ toolName: 'export_expenses' });
assert.equal(includesKey(expenseExportKeys, ['expense-notes']), true);
assert.equal(includesKey(expenseExportKeys, ['expense-kpi']), true);

const permissionKeys = getInvalidationKeysForAiAction({ toolName: 'create_permission' });
assert.equal(includesKey(permissionKeys, ['rbac', 'permissions']), true);

console.log('AI assistant query invalidation tests passed');
