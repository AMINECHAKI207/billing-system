import axios from 'axios';
import type {
  ApiResponse,
  ChangePasswordForm,
  CompanySettings,
  Customer,
  CustomerFilters,
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
