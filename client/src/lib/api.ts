import axios from 'axios';
import type {
  ApiResponse,
  AuditLog,
  AuditLogFilters,
  ChangePasswordForm,
  CompanySettings,
  Customer,
  CustomerFilters,
  CreditNote,
  CreditNoteFilters,
  CreditNoteReason,
  Contract,
  ContractFilters,
  ContractTemplate,
  CreateContractForm,
  CreateCreditNoteForm,
  DashboardFilters,
  DashboardStats,
  EmailDeliveryStatus,
  EmailTestResult,
  Devis,
  DevisFilters,
  CreateInvoiceForm,
  CreateDevisForm,
  CreateCustomerForm,
  CreatePaymentForm,
  CreateProductForm,
  ExpenseAnalytics,
  ExpenseAnalysisSuggestion,
  ExpenseCategory,
  ExpenseEmailLog,
  ExpenseNote,
  ExpenseNoteFilters,
  ExpenseNoteForm,
  ExpenseType,
  CreateUserForm,
  Invoice,
  InvoiceFilters,
  InvoiceEmailLog,
  LoginCredentials,
  Payment,
  PaymentFilters,
  Product,
  ProductFilters,
  ReceivablesAgingReport,
  Reminder,
  ReminderStatus,
  ReminderType,
  TaxSummaryReport,
  ThemePreference,
  User,
  UserFilters,
  UpdateCustomerForm,
  UpdateContractForm,
  UpdateCompanySettingsForm,
  UpdateProductForm,
  UpdateUserForm,
  RbacPermission,
  RbacRole,
  RbacUser,
  RecurringPlan,
  CreateRecurringPlanForm,
  RecurringPlanStatus,
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

const authApi = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export function clearAuthSession() {
  // Tokens are HttpOnly cookies and cannot be read by the frontend.
}

api.interceptors.request.use((config) => {
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const url = String(originalRequest?.url ?? '');

    if (
      status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/refresh') &&
      !url.includes('/auth/logout')
    ) {
      originalRequest._retry = true;

      try {
        await refreshAccessToken();
        return api(originalRequest);
      } catch (refreshError) {
        clearAuthSession();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export async function login(credentials: LoginCredentials): Promise<{
  user: User;
  accessToken: string;
}> {
  const response = await api.post<ApiResponse<{ user: User; accessToken: string }>>(
    '/auth/login',
    credentials
  );

  return response.data.data;
}

export async function getCurrentUser(): Promise<User> {
  const response = await api.get<ApiResponse<{ user: User }>>('/auth/me');
  return response.data.data.user;
}

export async function refreshAccessToken(): Promise<string> {
  const response = await authApi.post<ApiResponse<{ accessToken: string }>>('/auth/refresh');
  const token = response.data.data.accessToken;
  return token;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
  clearAuthSession();
}

export type AiToolRiskLevel = 'READ_ONLY' | 'CONFIRMATION_REQUIRED' | 'REAUTH_REQUIRED';
export type AiActionStatus = 'PENDING' | 'CONFIRMED' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

export type AiToolDefinition = {
  name: string;
  description: string;
  module: string;
  riskLevel: AiToolRiskLevel;
  requiredPermission: string;
};

export type AiStructuredFormOption = {
  value: string;
  label: string;
};

export type AiStructuredFormField = {
  path: string;
  type: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'select' | 'entity' | 'array';
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  entityType?:
    | 'customer'
    | 'contract'
    | 'invoice'
    | 'product'
    | 'expenseCategory'
    | 'expenseType'
    | 'user'
    | 'role'
    | 'permission'
    | 'creditNoteReason';
  minItems?: number;
  value?: unknown;
  displayValue?: string;
  options?: AiStructuredFormOption[];
  itemFields?: Array<{
    path: string;
    type: 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'select' | 'entity';
    label: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    readOnly?: boolean;
    hidden?: boolean;
    entityType?:
      | 'customer'
      | 'contract'
      | 'invoice'
      | 'product'
      | 'expenseCategory'
      | 'expenseType'
      | 'user'
      | 'role'
      | 'permission'
      | 'creditNoteReason';
    options?: AiStructuredFormOption[];
  }>;
};

export type AiStructuredForm = {
  toolName: string;
  title: string;
  description: string;
  submitLabel: string;
  values: Record<string, unknown>;
  missingFields: string[];
  fields: AiStructuredFormField[];
  language: 'fr' | 'en' | 'ar';
};

export type AiPendingAction = {
  id: string;
  toolName: string;
  inputPayload: unknown;
  previewPayload: unknown;
  riskLevel: AiToolRiskLevel;
  requiredPermission: string;
  status: AiActionStatus;
  expiresAt: string;
  resultPayload?: unknown;
  errorPayload?: unknown;
  createdAt: string;
  idempotencyKey?: string;
};

export type AiMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL' | 'SYSTEM';
  content: string;
  metadata?: unknown;
  createdAt: string;
};

export type AiConversation = {
  id: string;
  title?: string | null;
  language: string;
  messages: AiMessage[];
  pendingActions: AiPendingAction[];
  createdAt: string;
  updatedAt: string;
};

export type AiAssistantBriefing = {
  generatedAt?: string;
  pendingApprovals?: number;
  revenue?: Record<string, unknown> | null;
  highestRiskContract?: Record<string, unknown> | null;
  highestRiskCustomer?: Record<string, unknown> | null;
  executiveSummary?: Record<string, unknown> | null;
  priorities?: Array<Record<string, unknown>>;
  insights?: Array<Record<string, unknown>>;
  recentActivity?: Array<Record<string, unknown>>;
  alerts?: Array<Record<string, unknown>>;
  recommendations?: unknown[];
};

export async function getAiAssistantBriefing(): Promise<AiAssistantBriefing> {
  const response = await api.get<ApiResponse<{ briefing: AiAssistantBriefing }>>('/ai-assistant/briefing');
  return response.data.data.briefing;
}

export async function getAiAssistantTools(): Promise<AiToolDefinition[]> {
  const response = await api.get<ApiResponse<{ tools: AiToolDefinition[] }>>('/ai-assistant/tools');
  return response.data.data.tools;
}

export async function createAiConversation(language = 'fr'): Promise<AiConversation> {
  const response = await api.post<ApiResponse<{ conversation: AiConversation }>>('/ai-assistant/conversations', { language });
  return response.data.data.conversation;
}

export async function getAiConversation(conversationId: string): Promise<AiConversation> {
  const response = await api.get<ApiResponse<{ conversation: AiConversation }>>(`/ai-assistant/conversations/${conversationId}`);
  return response.data.data.conversation;
}

export async function getAiConversationHistory(): Promise<AiConversation[]> {
  const response = await api.get<ApiResponse<{ data: AiConversation[] }>>('/ai-assistant/conversations?limit=10');
  return response.data.data.data;
}

export async function archiveAiConversation(conversationId: string): Promise<AiConversation> {
  const response = await api.post<ApiResponse<{ conversation: AiConversation }>>(`/ai-assistant/conversations/${conversationId}/archive`);
  return response.data.data.conversation;
}

export type AiAssistantContext = {
  entityType?: 'contract' | 'invoice' | 'timesheet' | 'client';
  entityId?: string;
  readableReference?: string;
};

export async function sendAiAssistantMessage(conversationId: string, content: string, language = 'fr', context?: AiAssistantContext): Promise<{
  message: AiMessage;
  executionResult: unknown;
}> {
  const response = await api.post<ApiResponse<{ message: AiMessage; executionResult: unknown }>>(
    `/ai-assistant/conversations/${conversationId}/messages`,
    { content, language, context }
  );
  return response.data.data;
}

export async function executeAiTool(input: {
  toolName: string;
  input: Record<string, unknown>;
  conversationId?: string;
  language?: 'fr' | 'en' | 'ar';
  idempotencyKey?: string;
  replaceActionId?: string;
}): Promise<unknown> {
  const response = await api.post<ApiResponse<unknown>>('/ai-assistant/tools/execute', input);
  return response.data.data;
}

export async function confirmAiAction(actionId: string): Promise<{ action: AiPendingAction; result: unknown }> {
  const response = await api.post<ApiResponse<{ action: AiPendingAction; result: unknown }>>(`/ai-assistant/actions/${actionId}/confirm`);
  return response.data.data;
}

export async function cancelAiAction(actionId: string): Promise<{ action: AiPendingAction }> {
  const response = await api.post<ApiResponse<{ action: AiPendingAction }>>(`/ai-assistant/actions/${actionId}/cancel`);
  return response.data.data;
}

export async function changePassword(input: ChangePasswordForm): Promise<void> {
  await api.patch('/auth/password', input);
}

export async function updateThemePreference(themePreference: ThemePreference): Promise<User> {
  const response = await api.patch<ApiResponse<{ user: User }>>('/auth/theme', { themePreference });
  return response.data.data.user;
}

export type UserListResponse = {
  data: User[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type AuditLogListResponse = {
  data: AuditLog[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogListResponse> {
  const response = await api.get<ApiResponse<{ auditLogs: AuditLog[] }>>('/audit-logs', {
    params: filters,
  });
  return {
    data: response.data.data.auditLogs,
    meta: response.data.meta ?? { page: filters.page ?? 1, limit: filters.limit ?? 25, total: 0, totalPages: 0 },
  };
}

export async function exportAuditLogs(filters: AuditLogFilters & { format: 'csv' | 'excel' | 'pdf' }): Promise<void> {
  const response = await api.get<Blob>('/audit-logs/export', {
    params: filters,
    responseType: 'blob',
  });
  const extension = filters.format === 'excel' ? 'xlsx' : filters.format;
  downloadBlob(response.data, `audit-logs-${new Date().toISOString().slice(0, 10)}.${extension}`);
}

export async function getUsers(filters: UserFilters = {}): Promise<UserListResponse> {
  const response = await api.get<ApiResponse<UserListResponse>>('/users', {
    params: filters,
  });
  return response.data.data;
}

export async function createUser(input: CreateUserForm): Promise<User> {
  const response = await api.post<ApiResponse<{ user: User }>>('/users', input);
  return response.data.data.user;
}

export async function updateUser(userId: string, input: UpdateUserForm): Promise<User> {
  const response = await api.put<ApiResponse<{ user: User }>>(`/users/${userId}`, input);
  return response.data.data.user;
}

export async function getRbacRoles(): Promise<RbacRole[]> {
  const response = await api.get<ApiResponse<{ roles: RbacRole[] }>>('/rbac/roles');
  return response.data.data.roles;
}

export async function createRbacRole(input: { name: string; description?: string }): Promise<RbacRole> {
  const response = await api.post<ApiResponse<{ role: RbacRole }>>('/rbac/roles', input);
  return response.data.data.role;
}

export async function updateRbacRole(roleId: string, input: { name?: string; description?: string | null }): Promise<RbacRole> {
  const response = await api.put<ApiResponse<{ role: RbacRole }>>(`/rbac/roles/${roleId}`, input);
  return response.data.data.role;
}

export async function deleteRbacRole(roleId: string): Promise<void> {
  await api.delete(`/rbac/roles/${roleId}`);
}

export async function getRbacPermissions(): Promise<RbacPermission[]> {
  const response = await api.get<ApiResponse<{ permissions: RbacPermission[] }>>('/rbac/permissions');
  return response.data.data.permissions;
}

export async function createRbacPermission(input: {
  key: string;
  description?: string;
  resource?: string;
  action?: string;
}): Promise<RbacPermission> {
  const response = await api.post<ApiResponse<{ permission: RbacPermission }>>('/rbac/permissions', input);
  return response.data.data.permission;
}

export async function assignRbacPermissions(roleId: string, permissions: Array<{ permissionId: string; scope: 'ALL' | 'OWN' | 'SELECTED' }>): Promise<RbacRole> {
  const response = await api.put<ApiResponse<{ role: RbacRole }>>(`/rbac/roles/${roleId}/permissions`, { permissions });
  return response.data.data.role;
}

export async function getRbacUsers(filters: { search?: string; roleId?: string; page?: string; limit?: string } = {}): Promise<{ data: RbacUser[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
  const response = await api.get<ApiResponse<{ data: RbacUser[]; meta: { total: number; page: number; limit: number; totalPages: number } }>>('/rbac/users', { params: filters });
  return response.data.data;
}

export async function assignRbacUserRole(userId: string, roleId: string): Promise<RbacUser> {
  const response = await api.put<ApiResponse<{ user: RbacUser }>>(`/rbac/users/${userId}/role`, { roleId });
  return response.data.data.user;
}


export async function getRbacUserClients(userId: string): Promise<Customer[]> {
  const response = await api.get<ApiResponse<{ clients: Customer[] }>>(`/rbac/users/${userId}/clients`);
  return response.data.data.clients;
}

export async function assignRbacUserClients(userId: string, clientIds: string[]): Promise<Customer[]> {
  const response = await api.put<ApiResponse<{ clients: Customer[] }>>(`/rbac/users/${userId}/clients`, { clientIds });
  return response.data.data.clients;
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const response = await api.get<ApiResponse<{ settings: CompanySettings }>>('/settings/company');
  return response.data.data.settings;
}

export async function updateCompanySettings(
  input: UpdateCompanySettingsForm
): Promise<CompanySettings> {
  const response = await api.put<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company',
    input
  );
  return response.data.data.settings;
}

export async function uploadCompanySignature(file: File): Promise<CompanySettings> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company/signature',
    formData
  );
  return response.data.data.settings;
}

export async function deleteCompanySignature(): Promise<CompanySettings> {
  const response = await api.delete<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company/signature'
  );
  return response.data.data.settings;
}

export async function removeCompanySignatureBackground(): Promise<CompanySettings> {
  const response = await api.post<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company/signature/remove-background'
  );
  return response.data.data.settings;
}

export async function uploadCompanyStamp(file: File): Promise<CompanySettings> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company/stamp',
    formData
  );
  return response.data.data.settings;
}

export async function deleteCompanyStamp(): Promise<CompanySettings> {
  const response = await api.delete<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company/stamp'
  );
  return response.data.data.settings;
}

export async function removeCompanyStampBackground(): Promise<CompanySettings> {
  const response = await api.post<ApiResponse<{ settings: CompanySettings }>>(
    '/settings/company/stamp/remove-background'
  );
  return response.data.data.settings;
}

export async function removeCompanyAssetBackgroundPreview(file: File | Blob): Promise<Blob> {
  const formData = new FormData();
  formData.append('file', file, file instanceof File ? file.name : 'asset.png');

  try {
    const response = await api.post<Blob>('/settings/company/remove-background-preview', formData, {
      responseType: 'blob',
    });
    return response.data;
  } catch (error) {
    throw await normalizeBlobApiError(error);
  }
}

async function normalizeBlobApiError(error: unknown) {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    const text = await error.response.data.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; errors?: string[] };
        if (parsed.message) {
          const normalizedError = new Error(parsed.message);
          Object.assign(normalizedError, {
            response: {
              ...error.response,
              data: parsed,
            },
          });
          return normalizedError;
        }
      } catch {
        return new Error(text);
      }
    }
  }

  return error;
}

export async function getEmailDeliveryStatus(): Promise<EmailDeliveryStatus> {
  const response = await api.get<ApiResponse<{ emailStatus: EmailDeliveryStatus }>>(
    '/settings/email-status'
  );
  return response.data.data.emailStatus;
}

export async function sendTestEmail(input: { recipientEmail?: string } = {}): Promise<EmailTestResult> {
  const response = await api.post<ApiResponse<EmailTestResult>>('/settings/email-test', input);
  return response.data.data;
}

export async function getRecentEmailLogs(): Promise<InvoiceEmailLog[]> {
  const response = await api.get<ApiResponse<{ emailLogs: InvoiceEmailLog[] }>>(
    '/settings/email-logs'
  );
  return response.data.data.emailLogs;
}

export type CustomerListResponse = {
  data: Customer[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getCustomers(filters: CustomerFilters = {}): Promise<CustomerListResponse> {
  const response = await api.get<ApiResponse<CustomerListResponse>>('/customers', {
    params: filters,
  });

  return response.data.data;
}

export async function getCustomerById(customerId: string): Promise<Customer> {
  const response = await api.get<ApiResponse<{ customer: Customer }>>(`/customers/${customerId}`);
  return response.data.data.customer;
}

export async function createCustomer(input: CreateCustomerForm): Promise<Customer> {
  const response = await api.post<ApiResponse<{ customer: Customer }>>('/customers', input);
  return response.data.data.customer;
}

export async function updateCustomer(
  customerId: string,
  input: UpdateCustomerForm
): Promise<Customer> {
  const response = await api.put<ApiResponse<{ customer: Customer }>>(
    `/customers/${customerId}`,
    input
  );

  return response.data.data.customer;
}

export async function deleteCustomer(customerId: string): Promise<void> {
  await api.delete(`/customers/${customerId}`);
}

export type InvoiceListResponse = {
  data: Invoice[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getInvoices(filters: InvoiceFilters = {}): Promise<InvoiceListResponse> {
  const response = await api.get<ApiResponse<InvoiceListResponse>>('/invoices', {
    params: filters,
  });

  return response.data.data;
}

export async function downloadInvoicesExcel(filters: InvoiceFilters = {}): Promise<void> {
  const response = await api.get<Blob>('/invoices/export/excel', {
    params: filters,
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `invoices-${today}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function getInvoiceDashboard(filters: DashboardFilters = {}): Promise<DashboardStats> {
  const response = await api.get<ApiResponse<{ dashboard: DashboardStats }>>('/invoices/dashboard', {
    params: filters,
  });
  return response.data.data.dashboard;
}

export async function getInvoiceById(invoiceId: string): Promise<Invoice> {
  const response = await api.get<ApiResponse<{ invoice: Invoice }>>(`/invoices/${invoiceId}`);
  return response.data.data.invoice;
}

export async function createInvoice(input: CreateInvoiceForm): Promise<Invoice> {
  const response = await api.post<ApiResponse<{ invoice: Invoice }>>('/invoices', input);
  return response.data.data.invoice;
}

export async function updateInvoice(
  invoiceId: string,
  input: CreateInvoiceForm
): Promise<Invoice> {
  const response = await api.put<ApiResponse<{ invoice: Invoice }>>(`/invoices/${invoiceId}`, input);
  return response.data.data.invoice;
}

export async function updateInvoiceStatus(
  invoiceId: string,
  status: Invoice['status']
): Promise<Invoice> {
  const response = await api.patch<ApiResponse<{ invoice: Invoice }>>(
    `/invoices/${invoiceId}/status`,
    { status }
  );

  return response.data.data.invoice;
}

export async function signInvoice(invoiceId: string): Promise<Invoice> {
  const response = await api.post<ApiResponse<{ invoice: Invoice }>>(`/invoices/${invoiceId}/sign`);
  return response.data.data.invoice;
}

export async function cancelInvoiceSignature(invoiceId: string): Promise<Invoice> {
  const response = await api.delete<ApiResponse<{ invoice: Invoice }>>(`/invoices/${invoiceId}/sign`);
  return response.data.data.invoice;
}

export function getInvoicePdfUrl(invoiceId: string) {
  return `/invoices/${invoiceId}/pdf`;
}

export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<void> {
  const response = await api.get<Blob>(getInvoicePdfUrl(invoiceId), {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${invoiceNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function printInvoicePdf(invoiceId: string): Promise<void> {
  const response = await api.get<Blob>(getInvoicePdfUrl(invoiceId), {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const printWindow = window.open(url, '_blank');

  if (printWindow) {
    printWindow.addEventListener('load', () => printWindow.print(), { once: true });
  }
}

export type DevisListResponse = {
  data: Devis[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getDevis(filters: DevisFilters = {}): Promise<DevisListResponse> {
  const response = await api.get<ApiResponse<DevisListResponse>>('/devis', {
    params: filters,
  });

  return response.data.data;
}

export async function getDevisById(devisId: string): Promise<Devis> {
  const response = await api.get<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}`);
  return response.data.data.devis;
}

export async function createDevis(input: CreateDevisForm): Promise<Devis> {
  const response = await api.post<ApiResponse<{ devis: Devis }>>('/devis', input);
  return response.data.data.devis;
}

export async function updateDevis(devisId: string, input: CreateDevisForm): Promise<Devis> {
  const response = await api.patch<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}`, input);
  return response.data.data.devis;
}

export async function deleteDevis(devisId: string): Promise<void> {
  await api.delete(`/devis/${devisId}`);
}

export async function deleteDraftDevis(): Promise<{ deletedCount: number }> {
  const response = await api.delete<ApiResponse<{ deletedCount: number }>>('/devis/drafts');
  return response.data.data;
}

export async function sendDevis(devisId: string): Promise<Devis> {
  const response = await api.post<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}/send`);
  return response.data.data.devis;
}

export async function approveDevis(devisId: string): Promise<Devis> {
  const response = await api.post<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}/approve`);
  return response.data.data.devis;
}

export async function rejectDevis(devisId: string): Promise<Devis> {
  const response = await api.post<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}/reject`);
  return response.data.data.devis;
}

export async function convertDevisToInvoice(devisId: string): Promise<{ devis: Devis; invoice: Invoice }> {
  const response = await api.post<ApiResponse<{ devis: Devis; invoice: Invoice }>>(`/devis/${devisId}/convert-to-invoice`);
  return response.data.data;
}

export async function signDevis(devisId: string): Promise<Devis> {
  const response = await api.post<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}/sign`);
  return response.data.data.devis;
}

export async function cancelDevisSignature(devisId: string): Promise<Devis> {
  const response = await api.delete<ApiResponse<{ devis: Devis }>>(`/devis/${devisId}/sign`);
  return response.data.data.devis;
}

export function getDevisPdfUrl(devisId: string) {
  return `/devis/${devisId}/pdf`;
}

export async function downloadDevisPdf(devisId: string, devisNumber: string): Promise<void> {
  const response = await api.get<Blob>(getDevisPdfUrl(devisId), {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${devisNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function sendInvoiceEmail(
  invoiceId: string,
  input: {
    recipientEmail?: string;
    subject?: string;
    message?: string;
  } = {}
): Promise<{
  invoice: Invoice;
  email: { to: string; subject: string };
  delivery: { mode: 'smtp' | 'local'; filePath?: string; messageId?: string };
}> {
  const response = await api.post<
    ApiResponse<{
      invoice: Invoice;
      email: { to: string; subject: string };
      delivery: { mode: 'smtp' | 'local'; filePath?: string; messageId?: string };
    }>
  >(`/invoices/${invoiceId}/email`, input);

  return response.data.data;
}

export type CreditNoteListResponse = {
  data: CreditNote[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getCreditNotes(filters: CreditNoteFilters = {}): Promise<CreditNoteListResponse> {
  const response = await api.get<ApiResponse<CreditNoteListResponse>>('/credit-notes', { params: filters });
  const payload = response.data.data;
  const total = 'total' in payload ? Number(payload.total) : payload.data.length;
  const limit = (filters.limit ?? payload.data.length) || 1;
  return {
    data: payload.data,
    meta: payload.meta ?? {
      page: filters.page ?? 1,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getCreditNoteReasons(includeInactive = false): Promise<CreditNoteReason[]> {
  const response = await api.get<ApiResponse<{ reasons: CreditNoteReason[] }>>('/credit-note-reasons', {
    params: includeInactive ? { includeInactive: 'true' } : undefined,
  });
  return response.data.data.reasons;
}

export async function createCreditNoteReason(input: {
  code: string;
  nameFr: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  category: string;
  isActive?: boolean;
  requiresComment?: boolean;
  sortOrder?: number;
}): Promise<CreditNoteReason> {
  const response = await api.post<ApiResponse<{ reason: CreditNoteReason }>>('/credit-note-reasons', input);
  return response.data.data.reason;
}

export async function updateCreditNoteReason(id: string, input: Partial<{
  code: string;
  nameFr: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  category: string;
  isActive: boolean;
  requiresComment: boolean;
  sortOrder: number;
}>): Promise<CreditNoteReason> {
  const response = await api.patch<ApiResponse<{ reason: CreditNoteReason }>>(`/credit-note-reasons/${id}`, input);
  return response.data.data.reason;
}

export async function getCreditNoteById(id: string): Promise<CreditNote> {
  const response = await api.get<ApiResponse<{ creditNote: CreditNote }>>(`/credit-notes/${id}`);
  return response.data.data.creditNote;
}

export async function createCreditNote(input: CreateCreditNoteForm): Promise<CreditNote> {
  const response = await api.post<ApiResponse<{ creditNote: CreditNote }>>('/credit-notes', input);
  return response.data.data.creditNote;
}

export async function updateCreditNote(id: string, input: Omit<CreateCreditNoteForm, 'invoiceId'>): Promise<CreditNote> {
  const response = await api.patch<ApiResponse<{ creditNote: CreditNote }>>(`/credit-notes/${id}`, input);
  return response.data.data.creditNote;
}

export async function deleteCreditNote(id: string): Promise<void> {
  await api.delete(`/credit-notes/${id}`);
}

export async function validateCreditNote(id: string): Promise<CreditNote> {
  const response = await api.post<ApiResponse<{ creditNote: CreditNote }>>(`/credit-notes/${id}/validate`);
  return response.data.data.creditNote;
}

export async function cancelCreditNote(id: string, reason: string): Promise<CreditNote> {
  const response = await api.post<ApiResponse<{ creditNote: CreditNote }>>(`/credit-notes/${id}/cancel`, { reason });
  return response.data.data.creditNote;
}

export async function refundCreditNote(id: string, amount: number, refundDate: string, comment?: string): Promise<CreditNote> {
  const response = await api.post<ApiResponse<{ creditNote: CreditNote }>>(`/credit-notes/${id}/refund`, { amount, refundDate, comment });
  return response.data.data.creditNote;
}

export function getCreditNotePdfUrl(id: string, language = 'fr') {
  return `/credit-notes/${id}/pdf?language=${encodeURIComponent(language)}`;
}

export async function downloadCreditNotePdf(id: string, creditNoteNumber: string, language = 'fr'): Promise<void> {
  const response = await api.get<Blob>(getCreditNotePdfUrl(id, language), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${creditNoteNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function printCreditNotePdf(id: string, language = 'fr'): Promise<void> {
  const response = await api.get<Blob>(getCreditNotePdfUrl(id, language), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const printWindow = window.open(url, '_blank');
  if (printWindow) {
    printWindow.addEventListener('load', () => printWindow.print(), { once: true });
  }
}

export async function sendCreditNoteEmail(
  id: string,
  input: { recipientEmail?: string; subject?: string; message?: string; pdfLanguage?: 'fr' | 'en' | 'ar' } = {}
): Promise<{ email: { to: string; subject: string } }> {
  const response = await api.post<ApiResponse<{ email: { to: string; subject: string } }>>(`/credit-notes/${id}/email`, input);
  return response.data.data;
}

export type ContractListResponse = {
  data: Contract[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
  };
  stats?: Record<string, number>;
};

export async function getContracts(filters: ContractFilters = {}): Promise<ContractListResponse> {
  const response = await api.get<ApiResponse<ContractListResponse>>('/contracts', { params: filters });
  return response.data.data;
}

export async function getContractById(id: string): Promise<Contract> {
  const response = await api.get<ApiResponse<{ contract: Contract }>>(`/contracts/${id}`);
  return response.data.data.contract;
}

export async function getContractTemplates(): Promise<ContractTemplate[]> {
  const response = await api.get<ApiResponse<{ templates: ContractTemplate[] }>>('/contracts/templates');
  return response.data.data.templates;
}

export async function createContract(input: CreateContractForm): Promise<Contract> {
  const response = await api.post<ApiResponse<{ contract: Contract }>>('/contracts', input);
  return response.data.data.contract;
}

export async function updateContract(id: string, input: UpdateContractForm): Promise<Contract> {
  const response = await api.patch<ApiResponse<{ contract: Contract }>>(`/contracts/${id}`, input);
  return response.data.data.contract;
}

export async function deleteContract(id: string): Promise<void> {
  await api.delete(`/contracts/${id}`);
}

export async function sendContract(id: string): Promise<Contract> {
  const response = await api.post<ApiResponse<{ contract: Contract }>>(`/contracts/${id}/send`);
  return response.data.data.contract;
}

export async function signContractForCompany(id: string): Promise<Contract> {
  const response = await api.post<ApiResponse<{ contract: Contract }>>(`/contracts/${id}/sign-company`);
  return response.data.data.contract;
}

export async function revokeContractSignature(id: string, input: {
  reason: string;
  internalNote?: string | null;
  confirmed: true;
}): Promise<Contract> {
  const response = await api.post<ApiResponse<{ contract: Contract }>>(`/contracts/${id}/signature/revoke`, input);
  return response.data.data.contract;
}

export async function cancelContract(id: string): Promise<Contract> {
  const response = await api.post<ApiResponse<{ contract: Contract }>>(`/contracts/${id}/cancel`);
  return response.data.data.contract;
}

export async function terminateContract(id: string): Promise<Contract> {
  const response = await api.post<ApiResponse<{ contract: Contract }>>(`/contracts/${id}/terminate`);
  return response.data.data.contract;
}

export async function updateContractStatus(id: string, status: Contract['status']): Promise<Contract> {
  const response = await api.patch<ApiResponse<{ contract: Contract }>>(`/contracts/${id}/status`, { status });
  return response.data.data.contract;
}

export async function sendContractEmail(id: string, input: {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  message?: string;
  pdfLanguage?: 'fr' | 'en' | 'ar';
  signatureLinkExpiresInDays?: number;
}): Promise<{ contract: Contract; signatureUrl: string }> {
  const response = await api.post<ApiResponse<{ contract: Contract; signatureUrl: string }>>(`/contracts/${id}/email`, input);
  return response.data.data;
}

export function getContractPdfUrl(id: string, language?: string) {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return `/contracts/${id}/pdf${query}`;
}

export function getContractPdfPreviewUrl(id: string, language?: string) {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return `/contracts/${id}/pdf/preview${query}`;
}

export async function downloadContractPdf(id: string, contractNumber: string, language?: string): Promise<void> {
  const response = await api.get<Blob>(getContractPdfUrl(id, language), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${contractNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function previewContractPdf(id: string, language?: string): Promise<void> {
  const response = await api.get<Blob>(getContractPdfPreviewUrl(id, language), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function getContractEmailHistory(id: string): Promise<Contract['emailLogs']> {
  const response = await api.get<ApiResponse<{ emailLogs: NonNullable<Contract['emailLogs']> }>>(`/contracts/${id}/email-history`);
  return response.data.data.emailLogs;
}

export async function createContractTimeEntry(id: string, input: {
  userId?: string;
  workDate: string;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number;
  quantity?: number;
  activityType?: string | null;
  description: string;
  internalNote?: string | null;
  billable?: boolean;
  submit?: boolean;
}): Promise<NonNullable<Contract['timeEntries']>[number]> {
  const response = await api.post<ApiResponse<{ entry: NonNullable<Contract['timeEntries']>[number] }>>(`/contracts/${id}/time-entries`, input);
  return response.data.data.entry;
}

export async function updateContractTimeEntry(id: string, entryId: string, input: {
  workDate?: string;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number;
  quantity?: number;
  activityType?: string | null;
  description?: string;
  internalNote?: string | null;
  billable?: boolean;
}): Promise<NonNullable<Contract['timeEntries']>[number]> {
  const response = await api.patch<ApiResponse<{ entry: NonNullable<Contract['timeEntries']>[number] }>>(`/contracts/${id}/time-entries/${entryId}`, input);
  return response.data.data.entry;
}

export async function submitContractTimeEntry(id: string, entryId: string): Promise<NonNullable<Contract['timeEntries']>[number]> {
  const response = await api.post<ApiResponse<{ entry: NonNullable<Contract['timeEntries']>[number] }>>(`/contracts/${id}/time-entries/${entryId}/submit`);
  return response.data.data.entry;
}

export async function approveContractTimeEntry(id: string, entryId: string): Promise<NonNullable<Contract['timeEntries']>[number]> {
  const response = await api.post<ApiResponse<{ entry: NonNullable<Contract['timeEntries']>[number] }>>(`/contracts/${id}/time-entries/${entryId}/approve`);
  return response.data.data.entry;
}

export async function rejectContractTimeEntry(id: string, entryId: string, reason: string): Promise<NonNullable<Contract['timeEntries']>[number]> {
  const response = await api.post<ApiResponse<{ entry: NonNullable<Contract['timeEntries']>[number] }>>(`/contracts/${id}/time-entries/${entryId}/reject`, { reason });
  return response.data.data.entry;
}

export async function createContractMilestone(id: string, input: {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  amount?: number | null;
  percentage?: number | null;
  sortOrder?: number;
}): Promise<NonNullable<Contract['milestones']>[number]> {
  const response = await api.post<ApiResponse<{ milestone: NonNullable<Contract['milestones']>[number] }>>(`/contracts/${id}/milestones`, input);
  return response.data.data.milestone;
}

export async function approveContractMilestone(id: string, milestoneId: string): Promise<NonNullable<Contract['milestones']>[number]> {
  const response = await api.post<ApiResponse<{ milestone: NonNullable<Contract['milestones']>[number] }>>(`/contracts/${id}/milestones/${milestoneId}/approve`);
  return response.data.data.milestone;
}

export async function createContractBillingScheduleItem(id: string, input: {
  label: string;
  dueDate: string;
  amount: number;
  sortOrder?: number;
}): Promise<NonNullable<Contract['billingScheduleItems']>[number]> {
  const response = await api.post<ApiResponse<{ item: NonNullable<Contract['billingScheduleItems']>[number] }>>(`/contracts/${id}/billing-schedule`, input);
  return response.data.data.item;
}

export async function generateContractInvoice(id: string, input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  milestoneId?: string;
  scheduleItemId?: string;
} = {}): Promise<{ id: string; invoiceNumber: string }> {
  const response = await api.post<ApiResponse<{ invoice: { id: string; invoiceNumber: string } }>>(`/contracts/${id}/generate-invoice`, input);
  return response.data.data.invoice;
}

export async function getPublicContract(token: string): Promise<Contract> {
  const response = await authApi.get<ApiResponse<{ contract: Contract }>>(`/public/contracts/sign/${token}`);
  return response.data.data.contract;
}

export async function signPublicContract(token: string, input: {
  signerName: string;
  signerEmail: string;
  accepted: true;
}): Promise<Contract> {
  const response = await authApi.post<ApiResponse<{ contract: Contract }>>(`/public/contracts/sign/${token}`, input);
  return response.data.data.contract;
}

export async function recordPayment(
  invoiceId: string,
  input: CreatePaymentForm
): Promise<{ payment: Payment; invoice: Invoice }> {
  const response = await api.post<ApiResponse<{ payment: Payment; invoice: Invoice }>>(
    `/invoices/${invoiceId}/payments`,
    input
  );

  return response.data.data;
}

export type PaymentListResponse = {
  data: Payment[];
  summary: {
    totalAmount: number;
  };
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getPayments(filters: PaymentFilters = {}): Promise<PaymentListResponse> {
  const response = await api.get<ApiResponse<PaymentListResponse>>('/payments', {
    params: filters,
  });

  return response.data.data;
}

export async function getReceivablesAgingReport(): Promise<ReceivablesAgingReport> {
  const response = await api.get<ApiResponse<{ report: ReceivablesAgingReport }>>(
    '/reports/receivables-aging'
  );
  return response.data.data.report;
}

export async function getTaxSummaryReport(filters: {
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<TaxSummaryReport> {
  const response = await api.get<ApiResponse<{ report: TaxSummaryReport }>>(
    '/reports/tax-summary',
    { params: filters }
  );
  return response.data.data.report;
}

export async function createReminder(input: {
  invoiceId: string;
  type?: ReminderType;
  recipientEmail?: string;
  subject?: string;
  body?: string;
  sendEmail?: boolean;
}): Promise<Reminder> {
  const response = await api.post<ApiResponse<{ reminder: Reminder }>>('/reminders', input);
  return response.data.data.reminder;
}

export async function runAutomaticReminders(): Promise<{
  created: Reminder[];
  skipped: Array<{ invoiceId: string; invoiceNumber: string; type: ReminderType }>;
  createdCount: number;
  skippedCount: number;
}> {
  const response = await api.post<
    ApiResponse<{
      created: Reminder[];
      skipped: Array<{ invoiceId: string; invoiceNumber: string; type: ReminderType }>;
      createdCount: number;
      skippedCount: number;
    }>
  >('/reminders/run-due');
  return response.data.data;
}

export type ReminderListResponse = {
  data: Reminder[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ProductListResponse = {
  data: Product[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getProducts(filters: ProductFilters = {}): Promise<ProductListResponse> {
  const response = await api.get<ApiResponse<ProductListResponse>>('/products', {
    params: filters,
  });
  return response.data.data;
}

export async function createProduct(input: CreateProductForm): Promise<Product> {
  const response = await api.post<ApiResponse<{ product: Product }>>('/products', input);
  return response.data.data.product;
}

export async function updateProduct(
  productId: string,
  input: UpdateProductForm
): Promise<Product> {
  const response = await api.put<ApiResponse<{ product: Product }>>(`/products/${productId}`, input);
  return response.data.data.product;
}

export async function getReminders(
  filters: {
    page?: number;
    limit?: number;
    invoiceId?: string;
    status?: ReminderStatus;
    type?: ReminderType;
    search?: string;
  } = {}
): Promise<ReminderListResponse> {
  const response = await api.get<ApiResponse<ReminderListResponse>>('/reminders', {
    params: filters,
  });
  return response.data.data;
}


export type RecurringPlanListResponse = {
  data: RecurringPlan[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};
export async function getRecurringPlans(filters: { page?: number; limit?: number; search?: string; status?: RecurringPlanStatus; customerId?: string } = {}): Promise<RecurringPlanListResponse> {
  const response = await api.get<ApiResponse<RecurringPlanListResponse>>('/recurring-plans', { params: filters });
  return response.data.data;
}
export async function createRecurringPlan(input: CreateRecurringPlanForm): Promise<RecurringPlan> {
  const response = await api.post<ApiResponse<{ plan: RecurringPlan }>>('/recurring-plans', input);
  return response.data.data.plan;
}
export async function updateRecurringPlanStatus(planId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED'): Promise<RecurringPlan> {
  const response = await api.patch<ApiResponse<{ plan: RecurringPlan }>>(`/recurring-plans/${planId}/status`, { status });
  return response.data.data.plan;
}
export async function runRecurringPlan(planId: string): Promise<void> {
  await api.post(`/recurring-plans/${planId}/run`);
}

export type ExpenseNoteListResponse = {
  data: ExpenseNote[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export async function getExpenseCategories(active?: boolean): Promise<ExpenseCategory[]> {
  const response = await api.get<ApiResponse<{ categories: ExpenseCategory[] }>>('/expense-notes/categories', {
    params: active === undefined ? undefined : { active },
  });
  return response.data.data.categories;
}

export async function createExpenseCategory(input: { name: string; active?: boolean }): Promise<ExpenseCategory> {
  const response = await api.post<ApiResponse<{ category: ExpenseCategory }>>('/expense-notes/categories', input);
  return response.data.data.category;
}

export async function updateExpenseCategory(id: string, input: { name?: string; active?: boolean }): Promise<ExpenseCategory> {
  const response = await api.patch<ApiResponse<{ category: ExpenseCategory }>>(`/expense-notes/categories/${id}`, input);
  return response.data.data.category;
}

export async function getExpenseTypes(filters: { categoryId?: string; active?: boolean } = {}): Promise<ExpenseType[]> {
  const response = await api.get<ApiResponse<{ types: ExpenseType[] }>>('/expense-notes/types', {
    params: filters,
  });
  return response.data.data.types;
}

export async function createExpenseType(input: { categoryId: string; name: string; active?: boolean }): Promise<ExpenseType> {
  const response = await api.post<ApiResponse<{ type: ExpenseType }>>('/expense-notes/types', input);
  return response.data.data.type;
}

export async function updateExpenseType(id: string, input: { categoryId?: string; name?: string; active?: boolean }): Promise<ExpenseType> {
  const response = await api.patch<ApiResponse<{ type: ExpenseType }>>(`/expense-notes/types/${id}`, input);
  return response.data.data.type;
}

export async function getExpenseNotes(filters: ExpenseNoteFilters = {}): Promise<ExpenseNoteListResponse> {
  const response = await api.get<ApiResponse<ExpenseNoteListResponse>>('/expense-notes', {
    params: filters,
  });
  return response.data.data;
}

export async function getExpenseAnalytics(filters: ExpenseNoteFilters = {}): Promise<ExpenseAnalytics> {
  const response = await api.get<ApiResponse<{ analytics: ExpenseAnalytics }>>('/expense-notes/analytics', {
    params: filters,
  });
  return response.data.data.analytics;
}

export async function createExpenseNote(input: ExpenseNoteForm): Promise<ExpenseNote> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote }>>('/expense-notes', input);
  return response.data.data.expenseNote;
}

export async function updateExpenseNote(id: string, input: Partial<ExpenseNoteForm>): Promise<ExpenseNote> {
  const response = await api.patch<ApiResponse<{ expenseNote: ExpenseNote }>>(`/expense-notes/${id}`, input);
  return response.data.data.expenseNote;
}

export async function deleteExpenseNote(id: string): Promise<void> {
  await api.delete(`/expense-notes/${id}`);
}

export async function submitExpenseNote(id: string): Promise<ExpenseNote> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote }>>(`/expense-notes/${id}/submit`);
  return response.data.data.expenseNote;
}

export async function approveExpenseNote(id: string): Promise<ExpenseNote> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote }>>(`/expense-notes/${id}/approve`);
  return response.data.data.expenseNote;
}

export async function rejectExpenseNote(id: string, reason: string): Promise<ExpenseNote> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote }>>(`/expense-notes/${id}/reject`, { reason });
  return response.data.data.expenseNote;
}

export async function requestExpenseNoteChanges(id: string, reason: string): Promise<ExpenseNote> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote }>>(`/expense-notes/${id}/request-changes`, { reason });
  return response.data.data.expenseNote;
}

export async function markExpenseNotePaid(id: string): Promise<ExpenseNote> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote }>>(`/expense-notes/${id}/mark-paid`);
  return response.data.data.expenseNote;
}

export async function downloadExpenseAttachment(attachmentId: string): Promise<void> {
  const response = await api.get<Blob>(`/expense-notes/attachments/${attachmentId}/download`, {
    responseType: 'blob',
  });
  const blobUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `expense-receipt-${attachmentId}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function deleteExpenseAttachment(attachmentId: string): Promise<void> {
  await api.delete(`/expense-notes/attachments/${attachmentId}`);
}

export function getExpenseNotePdfUrl(id: string, disposition: 'inline' | 'attachment' = 'attachment', language = 'fr') {
  const params = new URLSearchParams({ disposition, language });
  return `/expense-notes/${id}/pdf?${params.toString()}`;
}

export function getExpenseNotePdfPreviewUrl(id: string, language = 'fr') {
  const params = new URLSearchParams({ language });
  return `/expense-notes/${id}/pdf/preview?${params.toString()}`;
}

export async function previewExpenseNotePdf(id: string, language = 'fr'): Promise<void> {
  window.open(`/api${getExpenseNotePdfPreviewUrl(id, language)}`, '_blank', 'noopener,noreferrer');
}

export async function downloadExpenseNotePdf(id: string, reference: string, language = 'fr'): Promise<void> {
  const response = await api.get<Blob>(getExpenseNotePdfUrl(id, 'attachment', language), { responseType: 'blob' });
  downloadBlob(response.data, `${reference}.pdf`);
}

export async function printExpenseNotePdf(id: string, language = 'fr'): Promise<void> {
  const response = await api.get<Blob>(getExpenseNotePdfUrl(id, 'inline', language), { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const printWindow = window.open(url, '_blank');
  if (printWindow) {
    printWindow.addEventListener('load', () => printWindow.print(), { once: true });
  }
}

export async function sendExpenseNoteEmail(
  id: string,
  input: {
    to?: string;
    cc?: string[];
    bcc?: string[];
    subject?: string;
    message?: string;
    pdfLanguage?: 'en' | 'fr' | 'ar';
  }
): Promise<{ expenseNote: ExpenseNote; emailLog: ExpenseEmailLog; delivery: { mode: 'smtp' | 'local'; filePath?: string; messageId?: string } | null }> {
  const response = await api.post<ApiResponse<{ expenseNote: ExpenseNote; emailLog: ExpenseEmailLog; delivery: { mode: 'smtp' | 'local'; filePath?: string; messageId?: string } | null }>>(`/expense-notes/${id}/email`, input);
  return response.data.data;
}

export async function getExpenseNoteEmailHistory(id: string): Promise<ExpenseEmailLog[]> {
  const response = await api.get<ApiResponse<{ emailLogs: ExpenseEmailLog[] }>>(`/expense-notes/${id}/email-history`);
  return response.data.data.emailLogs;
}

export async function resendExpenseNoteEmail(emailLogId: string): Promise<{ emailLog: ExpenseEmailLog }> {
  const response = await api.post<ApiResponse<{ emailLog: ExpenseEmailLog }>>(`/expense-notes/email-logs/${emailLogId}/resend`);
  return response.data.data;
}

export async function exportExpenseNotes(input: {
  ids?: string[];
  filters?: Omit<ExpenseNoteFilters, 'page' | 'limit'>;
  format: 'pdf' | 'zip' | 'excel' | 'csv';
  language?: 'en' | 'fr' | 'ar';
  includeReceipts?: boolean;
}): Promise<void> {
  const response = await api.post<Blob>('/expense-notes/export', input, { responseType: 'blob' });
  const extension = input.format === 'excel' ? 'xlsx' : input.format;
  downloadBlob(response.data, `expense-notes-${new Date().toISOString().slice(0, 10)}.${extension}`);
}

export async function analyzeExpenseReceipt(file: File): Promise<{
  attachment: { id: string; fileUrl: string; originalName: string };
  analysis: { id: string; attempts: number; requiresManualReview: boolean };
  suggestedExpense: ExpenseAnalysisSuggestion;
}> {
  const formData = new FormData();
  formData.append('receipt', file);
  const response = await api.post<ApiResponse<{
    attachment: { id: string; fileUrl: string; originalName: string };
    analysis: { id: string; attempts: number; requiresManualReview: boolean };
    suggestedExpense: ExpenseAnalysisSuggestion;
  }>>('/expense-notes/analyze-receipt', formData);
  return response.data.data;
}

function downloadBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

export type TelegramLinkCodeResponse = {
  code: string;
  expiresAt: string;
  expiresInMinutes: number;
};

export async function generateTelegramLinkCode(): Promise<TelegramLinkCodeResponse> {
  const response = await api.post("/telegram/link-code");

  return response.data.data;
}