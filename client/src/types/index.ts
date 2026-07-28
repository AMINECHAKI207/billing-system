/**
 * Shared TypeScript Types & Interfaces
 *
 * Single source of truth for all data shapes.
 * Both API hooks and components import from here.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'EMPLOYEE';
export type ThemePreference = 'light' | 'dark';

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export type DevisStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'CHECK'
  | 'CREDIT_CARD'
  | 'MOBILE_PAYMENT'
  | 'OTHER';

export type ReminderType = 'BEFORE_DUE' | 'ON_DUE' | 'AFTER_DUE' | 'MANUAL';
export type ReminderStatus = 'SENT' | 'FAILED' | 'PENDING';

export type RecurringFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type RecurringPlanStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
export type RecurringExecutionStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface RecurringPlanItem {
  id: string; planId: string; description: string; unit?: string; quantity: number; unitPrice: number; taxRate: number; sortOrder: number;
}
export interface RecurringExecution {
  id: string; planId: string; invoiceId?: string; scheduledFor: string; status: RecurringExecutionStatus; errorMessage?: string; createdAt: string;
}
export interface RecurringPlan {
  id: string; customerId: string; createdById: string; name: string; frequency: RecurringFrequency; intervalCount: number;
  status: RecurringPlanStatus; startDate: string; endDate?: string; nextRunDate: string; lastRunAt?: string; dueDays: number;
  autoSend: boolean; currency: string; discount: number; notes?: string; terms?: string; createdAt: string; updatedAt: string;
  customer?: Pick<Customer, 'id' | 'name' | 'company' | 'email'>; items: RecurringPlanItem[]; executions?: RecurringExecution[];
  _count?: { invoices: number; executions: number };
}
export interface CreateRecurringPlanForm {
  customerId: string; name: string; frequency: RecurringFrequency; intervalCount: number; startDate: string; endDate?: string | null;
  dueDays: number; autoSend: boolean; currency: string; discount: number; notes?: string; terms?: string;
  items: Array<{ description: string; unit?: string; quantity: number; unitPrice: number; taxRate: number }>;
}


// ─── Entities ─────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  themePreference?: ThemePreference;
  isActive: boolean;
  permissions?: string[];
  rbacRole?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    customers: number;
    invoices: number;
    payments: number;
    reminders: number;
  };
}

export interface CompanySettings {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  logoUrl?: string;
  signatureUrl?: string;
  stampUrl?: string;
  defaultCurrency: string;
  defaultTaxRate: number;
  vatEnabled: boolean;
  moroccoVatRate: number;
  paymentTerms?: string;
  bankDetails?: string;
  updatedAt: string;
}

export interface EmailDeliveryStatus {
  mode: 'local' | 'smtp';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  localOutputDir?: string;
  warning?: string;
}

export interface EmailTestResult {
  to: string;
  delivery: {
    mode: 'local' | 'smtp';
    filePath?: string;
    messageId?: string;
  };
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  taxNumber?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    invoices: number;
  };
  financialSummary?: {
    totalInvoices: number;
    totalInvoiced: number;
    totalPaid: number;
    totalUnpaid: number;
    overdueInvoices: number;
  };
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  unitPrice: number;
  taxRate: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  sortOrder: number;
}

export interface DevisItem {
  id: string;
  devisId: string;
  description: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
  sortOrder: number;
}

export interface Invoice {
  id: string;
  customerId: string;
  createdById: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  customerCountry: string;
  customerCountryCode: string;
  vatOverridden: boolean;
  vatOverrideReason?: string;
  vatOverriddenAt?: string;
  vatOverriddenById?: string;
  discount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  terms?: string;
  currency: string;
  sentAt?: string;
  paidAt?: string;
  isSigned: boolean;
  signedAt?: string;
  signedById?: string;
  signatureUrl?: string;
  stampUrl?: string;
  sourceDevisId?: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer;
  createdBy?: User;
  signedBy?: User;
  items?: InvoiceItem[];
  payments?: Payment[];
  reminders?: Reminder[];
  emailLogs?: InvoiceEmailLog[];
  sourceDevis?: Pick<Devis, 'id' | 'devisNumber' | 'status'>;
}

export interface Devis {
  id: string;
  devisNumber: string;
  companyId: number;
  customerId: string;
  createdById: string;
  status: DevisStatus;
  issueDate: string;
  validUntil: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  customerCountry: string;
  customerCountryCode: string;
  vatOverridden: boolean;
  vatOverrideReason?: string;
  vatOverriddenAt?: string;
  vatOverriddenById?: string;
  discount: number;
  total: number;
  notes?: string;
  terms?: string;
  currency: string;
  sentAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  convertedAt?: string;
  isSigned: boolean;
  signedAt?: string;
  signedById?: string;
  signatureUrl?: string;
  stampUrl?: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer;
  createdBy?: User;
  signedBy?: User;
  items?: DevisItem[];
  generatedInvoice?: Pick<Invoice, 'id' | 'invoiceNumber' | 'status' | 'total' | 'currency'>;
}

export interface InvoiceEmailLog {
  id: string;
  invoiceId: string;
  sentById?: string;
  recipientEmail: string;
  subject: string;
  message: string;
  status: string;
  deliveryMode?: string;
  messageId?: string;
  filePath?: string;
  errorMessage?: string;
  createdAt: string;
  sentBy?: User;
  invoice?: Pick<Invoice, 'id' | 'invoiceNumber'> & {
    customer?: Pick<Customer, 'id' | 'name' | 'company' | 'email'>;
  };
}

export interface Payment {
  id: string;
  invoiceId: string;
  recordedById: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  createdAt: string;
  recordedBy?: User;
  invoice?: Pick<Invoice, 'id' | 'invoiceNumber' | 'currency' | 'status'> & {
    customer?: Pick<Customer, 'id' | 'name' | 'company' | 'email'>;
  };
}

export interface Reminder {
  id: string;
  invoiceId: string;
  sentById: string;
  type: ReminderType;
  recipientEmail: string;
  subject: string;
  body: string;
  status: ReminderStatus;
  sentAt?: string;
  errorMessage?: string;
  createdAt: string;
  invoice?: Pick<Invoice, 'id' | 'invoiceNumber' | 'status' | 'dueDate' | 'balanceDue' | 'currency'> & {
    customer?: Pick<Customer, 'id' | 'name' | 'email' | 'company'>;
  };
  sentBy?: User;
}

// ─── API Shapes ───────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: PaginationMeta;
  errors?: string[];
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface CreateUserForm {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isActive?: boolean;
}

export type UpdateUserForm = Partial<CreateUserForm>;

export type PermissionScope = 'ALL' | 'OWN' | 'SELECTED';

export interface RbacPermission {
  id: string;
  key: string;
  description?: string | null;
  resource: string;
  action: string;
}

export interface RbacRole {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  permissions: Array<{ permission: RbacPermission; scope: PermissionScope }>;
  _count?: { users: number };
}

export interface RbacUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  rbacRole?: { id: string; name: string } | null;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardPeriod = 'this_month' | 'last_3_months' | 'last_6_months' | 'this_year' | 'custom';

export interface DashboardFilters {
  period?: DashboardPeriod;
  dateFrom?: string;
  dateTo?: string;
  months?: 6 | 12;
}

export interface DashboardStats {
  totalInvoices: number;
  totalRevenue: number;
  totalPaid: number;
  totalUnpaid: number;
  totalClients: number;
  paidInvoices: number;
  unpaidInvoices: number;
  overdueInvoices: number;
  overdueAmount: number;
  dueSoonAmount: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  dateRange: {
    from: string;
    to: string;
  };
  monthlyRevenue: MonthlyRevenue[];
  invoiceStatusCounts: Array<{
    status: InvoiceStatus;
    count: number;
    amount: number;
  }>;
  topClients: Array<{
    customer: string;
    revenue: number;
    invoiceCount: number;
  }>;
  recentPayments: Array<{
    id: string;
    amount: number;
    paymentDate: string;
    method: PaymentMethod;
    reference?: string | null;
    invoiceId: string;
    invoiceNumber: string;
    customer: string;
    currency: string;
  }>;
  upcomingDeadlines: Array<{
    id: string;
    invoiceNumber: string;
    customer: string;
    dueDate: string;
    balanceDue: number;
    total: number;
    currency: string;
    status: InvoiceStatus;
  }>;
  unpaidByCustomer?: Array<{
    customer: string;
    unpaid: number;
  }>;
}

export interface MonthlyRevenue {
  month: string;
  revenue: number;
  unpaid: number;
  invoiceCount: number;
}

export interface ReceivablesAgingReport {
  generatedAt: string;
  totalAmount: number;
  totalInvoices: number;
  buckets: Array<{
    key: string;
    label: string;
    amount: number;
    invoiceCount: number;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      customer: string;
      dueDate: string;
      daysLate: number;
      balanceDue: number;
      currency: string;
      status: InvoiceStatus;
    }>;
  }>;
}

export interface TaxSummaryReport {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  totals: {
    invoiceCount: number;
    subtotal: number;
    discount: number;
    taxableBase: number;
    taxAmount: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
  };
  taxRates: Array<{
    taxRate: number;
    invoiceCount: number;
    subtotal: number;
    discount: number;
    taxAmount: number;
    total: number;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    customer: string;
    status: InvoiceStatus;
    subtotal: number;
    discount: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
    currency: string;
  }>;
}

// ─── Forms ────────────────────────────────────────────────────────────────────

export interface InvoiceItemForm {
  description: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface DevisItemForm extends InvoiceItemForm {
  discount: number;
}

export interface CreateInvoiceForm {
  customerId: string;
  status?: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  taxRate: number;
  vatOverrideReason?: string;
  discount: number;
  notes?: string;
  terms?: string;
  currency: string;
  items: InvoiceItemForm[];
}

export interface CreateDevisForm {
  customerId: string;
  status?: DevisStatus;
  issueDate: string;
  validUntil: string;
  taxRate: number;
  vatOverrideReason?: string;
  discount: number;
  notes?: string;
  terms?: string;
  currency: string;
  items: DevisItemForm[];
}

export interface CreateCustomerForm {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  country: string;
  countryCode: string;
  postalCode?: string;
  taxNumber?: string;
}

export type UpdateCustomerForm = Partial<CreateCustomerForm> & {
  isActive?: boolean;
};

export interface CreatePaymentForm {
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
}

export type UpdateCompanySettingsForm = Omit<CompanySettings, 'id' | 'updatedAt'>;

export interface CreateProductForm {
  name: string;
  description?: string;
  unit?: string;
  unitPrice: number;
  taxRate: number;
  isActive?: boolean;
}

export type UpdateProductForm = Partial<CreateProductForm>;

// ─── Query Params ─────────────────────────────────────────────────────────────

export interface InvoiceFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: InvoiceStatus;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DevisFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: DevisStatus;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CustomerFilters {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ProductFilters {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

export interface PaymentFilters {
  page?: number;
  limit?: number;
  search?: string;
  method?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
}

export interface UserFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  isActive?: boolean;
}
