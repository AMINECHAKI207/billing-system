export type AiQueryKey = readonly string[];

type InvalidationContext = {
  toolName?: string | null;
};

const SHARED_BUSINESS_KEYS: AiQueryKey[] = [
  ['dashboard'],
  ['reports'],
  ['ai-assistant'],
];

const TOOL_INVALIDATION_MAP: Record<string, AiQueryKey[]> = {
  create_customer: [['customers'], ['clients']],
  update_customer: [['customers'], ['clients']],
  delete_customer: [['customers'], ['clients']],

  create_contract: [['contracts']],
  update_contract: [['contracts'], ['contracts', 'detail']],
  delete_draft_contract: [['contracts']],
  update_contract_status: [['contracts'], ['contracts', 'detail']],
  sign_contract_for_company: [['contracts'], ['contracts', 'detail']],
  revoke_contract_signature: [['contracts'], ['contracts', 'detail']],
  send_contract_email: [['contracts'], ['contracts', 'detail']],

  create_timesheet: [['contracts'], ['contracts', 'detail']],
  update_draft_timesheet: [['contracts'], ['contracts', 'detail']],
  submit_timesheet: [['contracts'], ['contracts', 'detail']],
  approve_timesheet: [['contracts'], ['contracts', 'detail']],
  reject_timesheet: [['contracts'], ['contracts', 'detail']],
  generate_invoice_from_timesheets: [['contracts'], ['contracts', 'detail'], ['invoices'], ['invoices', 'detail'], ['payments']],
  contract_invoice_workflow: [['contracts'], ['contracts', 'detail'], ['invoices'], ['invoices', 'detail'], ['payments']],

  create_invoice: [['invoices'], ['invoices', 'detail'], ['payments']],
  update_invoice: [['invoices'], ['invoices', 'detail']],
  update_invoice_status: [['invoices'], ['invoices', 'detail']],
  sign_invoice: [['invoices'], ['invoices', 'detail']],
  cancel_invoice_signature: [['invoices'], ['invoices', 'detail']],
  send_invoice_email: [['invoices'], ['invoices', 'detail']],
  record_invoice_payment: [['invoices'], ['invoices', 'detail'], ['payments']],

  search_payments: [['payments']],

  create_quote: [['devis'], ['devis', 'detail']],
  update_quote: [['devis'], ['devis', 'detail']],
  delete_quote: [['devis']],
  update_quote_status: [['devis'], ['devis', 'detail']],
  approve_quote: [['devis'], ['devis', 'detail']],
  reject_quote: [['devis'], ['devis', 'detail']],
  convert_quote_to_invoice: [['devis'], ['devis', 'detail'], ['invoices'], ['invoices', 'detail']],

  create_credit_note: [['credit-notes']],
  update_credit_note: [['credit-notes']],
  delete_credit_note: [['credit-notes']],
  validate_credit_note: [['credit-notes']],
  cancel_credit_note: [['credit-notes']],
  refund_credit_note: [['credit-notes']],
  send_credit_note_email: [['credit-notes']],

  create_expense: [['expense-notes'], ['expense-kpi']],
  update_expense: [['expense-notes'], ['expense-kpi']],
  delete_expense: [['expense-notes'], ['expense-kpi']],
  submit_expense: [['expense-notes'], ['expense-kpi']],
  approve_expense: [['expense-notes'], ['expense-kpi']],
  reject_expense: [['expense-notes'], ['expense-kpi']],
  mark_expense_paid: [['expense-notes'], ['expense-kpi']],
  send_expense_email: [['expense-notes'], ['expense-kpi']],
  create_expense_category: [['expense-notes'], ['expense-categories'], ['expense-types'], ['expense-kpi']],
  update_expense_category: [['expense-notes'], ['expense-categories'], ['expense-types'], ['expense-kpi']],
  create_expense_type: [['expense-notes'], ['expense-types'], ['expense-kpi']],
  update_expense_type: [['expense-notes'], ['expense-types'], ['expense-kpi']],
  resend_expense_email: [['expense-notes'], ['expense-kpi']],
  export_expenses: [['expense-notes'], ['expense-kpi']],
  delete_expense_attachment: [['expense-notes'], ['expense-kpi']],

  create_product: [['products'], ['catalogue']],
  update_product: [['products'], ['catalogue']],

  create_user: [['users'], ['rbac', 'users']],
  update_user: [['users'], ['rbac', 'users'], ['auth', 'me']],
  create_role: [['rbac', 'roles']],
  update_role: [['rbac', 'roles']],
  delete_role: [['rbac', 'roles']],
  create_permission: [['rbac', 'permissions']],
  delete_permission: [['rbac', 'permissions']],
  assign_role_permissions: [['rbac', 'roles'], ['rbac', 'permissions']],
  assign_user_role: [['rbac', 'users'], ['users'], ['auth', 'me']],
  assign_user_clients: [['rbac', 'user-clients'], ['rbac', 'users'], ['users']],

  update_company_settings: [['settings', 'company'], ['settings', 'email-status'], ['settings', 'email-logs'], ['invoices', 'detail']],
  delete_company_asset: [['settings', 'company'], ['invoices', 'detail'], ['contracts', 'detail']],
  remove_company_asset_background: [['settings', 'company'], ['invoices', 'detail'], ['contracts', 'detail']],
  send_test_email: [['settings', 'email-status'], ['settings', 'email-logs']],

  create_recurring_plan: [['recurring-plans']],
  update_recurring_plan: [['recurring-plans']],
  change_recurring_plan_status: [['recurring-plans']],
  run_recurring_plan_now: [['recurring-plans'], ['invoices']],

  create_reminder: [['reminders']],
  run_due_reminders: [['reminders'], ['invoices']],
};

function dedupe(keys: AiQueryKey[]): AiQueryKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const token = JSON.stringify(key);
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

export function getInvalidationKeysForAiAction(context: InvalidationContext): AiQueryKey[] {
  const toolKeys = context.toolName ? (TOOL_INVALIDATION_MAP[context.toolName] ?? []) : [];
  return dedupe([...toolKeys, ...SHARED_BUSINESS_KEYS]);
}
