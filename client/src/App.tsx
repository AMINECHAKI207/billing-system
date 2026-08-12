import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Crop, Download, Eraser, Eye, EyeOff, FilePlus2, Loader2, Lock, LogIn, LogOut, Mail, Menu, Moon, Move, PanelLeftClose, PanelLeftOpen, PenLine, Plus, Printer, Redo2, RefreshCcw, RotateCw, Trash2, ReceiptText, Search, Settings, ShieldCheck, Stamp, Sun, Undo2, Unlock, Upload, Users, WalletCards, ZoomIn, ZoomOut, } from 'lucide-react';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { ContractsView } from './components/contracts/ContractsView';
import { CreditNotesView } from './components/credit-notes/CreditNotesView';
import { ExpenseNotesView } from './components/expenses/ExpenseNotesView';
import { AuditLogsView } from './components/audit/AuditLogsView';
import { AiAdminAssistant } from './components/ai-assistant/AiAdminAssistant';
import i18n from './i18n';

const t = i18n.t.bind(i18n);
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, Cell, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { formatCurrency, getDaysUntilDue } from '@/lib/utils';
import { getInitialTheme, getStoredTheme, isThemePreference, persistTheme } from '@/lib/theme';
import { approveDevis, cancelDevisSignature, cancelInvoiceSignature, changePassword, convertDevisToInvoice, createDevis, createInvoice, createCustomer, createProduct, createUser, createReminder, deleteCompanySignature, deleteCompanyStamp, deleteCustomer, deleteDevis, deleteDraftDevis, downloadDevisPdf, downloadInvoicePdf, downloadInvoicesExcel, getCompanySettings, getCustomers, getCustomerById, getCurrentUser, getDevis, getDevisById, getEmailDeliveryStatus, getInvoiceById, getInvoiceDashboard, getInvoices, getPayments, getPublicContract, getRecurringPlans, getProducts, getReceivablesAgingReport, getRecentEmailLogs, getReminders, getTaxSummaryReport, getUsers, getRbacPermissions, getRbacRoles, getRbacUsers, assignRbacPermissions, assignRbacUserRole, getRbacUserClients, assignRbacUserClients, createRbacPermission, createRbacRole, deleteRbacRole, clearAuthSession, login, logout, recordPayment, createRecurringPlan, updateRecurringPlanStatus, runRecurringPlan, removeCompanyAssetBackgroundPreview, rejectDevis, runAutomaticReminders, sendDevis, sendInvoiceEmail, sendTestEmail, signDevis, signInvoice, signPublicContract, printInvoicePdf, refreshAccessToken, updateCustomer, updateDevis, updateInvoice, updateCompanySettings, updateThemePreference, updateInvoiceStatus, updateProduct, updateUser, uploadCompanySignature, uploadCompanyStamp, generateTelegramLinkCode, } from '@/lib/api';
import type { AiAssistantContext } from '@/lib/api';
import type { CompanySettings, CreateDevisForm, CreateProductForm, CreateUserForm, Customer, CreateInvoiceForm, CreditNoteStatus, DashboardPeriod, DashboardStats, Devis, DevisItemForm, DevisStatus, Invoice, InvoiceItemForm, InvoiceStatus, PaymentMethod, Reminder, ReminderStatus, ReminderType, RecurringFrequency, RecurringPlanStatus, ThemePreference, UpdateCompanySettingsForm, UpdateProductForm, UpdateUserForm, User, UserRole, } from '@/types';
type InvoiceSummary = {
    id: string;
    number: string;
    customer: string;
    status: InvoiceStatus;
    issueDate: string;
    dueDate: string;
    total: number;
    paid: number;
};
type CustomerExposure = {
    name: string;
    company: string;
    unpaid: number;
    overdue: number;
};
type InvoiceDraftItem = InvoiceItemForm;
type DevisDraftItem = DevisItemForm;
type CompanyAssetKind = 'signature' | 'stamp';
type CompanyAssetDraft = {
    blob: Blob;
    fileName: string;
    previewUrl: string;
};
type ViewKey = 'dashboard' | 'clients' | 'invoices' | 'devis' | 'credit-notes' | 'contracts' | 'payments' | 'reports' | 'reminders' | 'expenses' | 'products' | 'users' | 'rbac' | 'audit-logs' | 'settings';
type InvoiceSortField = 'createdAt' | 'issueDate' | 'dueDate' | 'total' | 'balanceDue' | 'invoiceNumber';
type DevisSortField = 'createdAt' | 'issueDate' | 'validUntil' | 'total' | 'devisNumber';
type CustomerSortField = 'createdAt' | 'name' | 'company' | 'email';
type CustomerStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type ExportTarget = 'invoices' | 'invoices-excel' | 'customers' | 'reminders' | 'reports' | 'tax-report';
type NotificationItem = {
    key: string;
    title: string;
    description: string;
    tone: 'danger' | 'warning' | 'info';
    view: ViewKey;
    icon: typeof Bell;
};
const EXPORT_PAGE_SIZE = 100;
const AUTO_BACKGROUND_REMOVAL_STORAGE_KEY = 'companyAssetAutoBackgroundRemoval';
const emptyInvoices: InvoiceSummary[] = [];
const emptyCustomerExposure: CustomerExposure[] = [];
const emptyRevenueTrend: NonNullable<DashboardStats['monthlyRevenue']> = [];
const errorMessagePattern = /unable|impossible|failed|error|erreur|cannot|can't|invalid|forbidden|unauthorized|expired|not found|missing|refused|denied|blocked|check|must|do not have permission|does not match/i;
const warningMessagePattern = /warning|attention|verify|check|expired|overdue|confirm|before|cannot|must/i;
const successMessagePattern = /success|saved|created|updated|deleted|signed|cancelled|converted|sent|generated|recorded|completed|prepared|assigned|download|closed|cree|creee|enregistre|modifie|supprime|signe|envoye|termine/i;
const getToastVariantFromMessage = (message: string): 'success' | 'error' | 'warning' | 'info' => {
    if (errorMessagePattern.test(message))
        return 'error';
    if (successMessagePattern.test(message))
        return 'success';
    if (warningMessagePattern.test(message))
        return 'warning';
    return 'info';
};
const statusLabelKeys: Record<InvoiceStatus, string> = {
    DRAFT: 'audit.status.draft',
    SENT: 'audit.status.sent',
    PAID: 'audit.status.paid',
    PARTIALLY_PAID: 'audit.status.partiallyPaid',
    OVERDUE: 'audit.status.overdue',
    CANCELLED: 'audit.status.cancelled',
};
const getStatusLabel = (status: InvoiceStatus) => t(statusLabelKeys[status]);
const devisStatusLabelKeys: Record<DevisStatus, string> = {
    DRAFT: 'devis.status.draft',
    SENT: 'devis.status.sent',
    APPROVED: 'devis.status.approved',
    REJECTED: 'devis.status.rejected',
    EXPIRED: 'devis.status.expired',
    CONVERTED: 'devis.status.converted',
};
const getDevisStatusLabel = (status: DevisStatus) => t(devisStatusLabelKeys[status]);
const statusClasses: Record<InvoiceStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
    SENT: 'bg-sky-100 text-sky-700 ring-sky-200',
    PAID: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    PARTIALLY_PAID: 'bg-amber-100 text-amber-700 ring-amber-200',
    OVERDUE: 'bg-rose-100 text-rose-700 ring-rose-200',
    CANCELLED: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
};
const devisStatusClasses: Record<DevisStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
    SENT: 'bg-sky-100 text-sky-700 ring-sky-200',
    APPROVED: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    REJECTED: 'bg-rose-100 text-rose-700 ring-rose-200',
    EXPIRED: 'bg-amber-100 text-amber-700 ring-amber-200',
    CONVERTED: 'bg-violet-100 text-violet-700 ring-violet-200',
};
const creditNoteStatusClasses: Record<CreditNoteStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
    VALIDATED: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    CANCELLED: 'bg-rose-100 text-rose-700 ring-rose-200',
    REFUNDED: 'bg-violet-100 text-violet-700 ring-violet-200',
};
const statusChartColors: Record<InvoiceStatus, string> = {
    DRAFT: '#64748B',
    SENT: '#2563EB',
    PAID: '#16A34A',
    PARTIALLY_PAID: '#F59E0B',
    OVERDUE: '#DC2626',
    CANCELLED: '#71717A',
};
const dashboardPeriods: Array<{
    value: DashboardPeriod;
    label: string;
}> = [
    { value: 'this_month', label: "app.text0001" },
    { value: 'last_3_months', label: "app.text0002" },
    { value: 'last_6_months', label: "app.text0003" },
    { value: 'this_year', label: "app.text0004" },
    { value: 'custom', label: "app.text0005" },
];
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'billing-sidebar-collapsed';
const EMPTY_PERMISSIONS: string[] = [];
const navItems: Array<{
    key: ViewKey;
    label: string;
    icon: typeof ReceiptText;
}> = [
    { key: 'dashboard', label: "app.text0006", icon: ReceiptText },
    { key: 'clients', label: "app.text0007", icon: Users },
    { key: 'invoices', label: "app.text0008", icon: WalletCards },
    { key: 'devis', label: "devis.nav", icon: ReceiptText },
    { key: 'credit-notes', label: "creditNotes.nav", icon: Undo2 },
    { key: 'contracts', label: "contracts.nav", icon: FilePlus2 },
    { key: 'payments', label: "app.text0009", icon: CheckCircle2 },
    { key: 'reports', label: "app.text0010", icon: AlertTriangle },
    { key: 'reminders', label: "app.text0011", icon: Bell },
    { key: 'expenses', label: "expenses.nav", icon: ReceiptText },
    { key: 'products', label: "app.text0012", icon: ReceiptText },
    { key: 'users', label: "app.text0013", icon: Users },
    { key: 'rbac', label: "app.text0014", icon: ShieldCheck },
    { key: 'audit-logs', label: "auditLogs.nav", icon: ShieldCheck },
    { key: 'settings', label: "app.text0015", icon: Settings },
];
const viewMeta: Record<ViewKey, {
    title: string;
    description: string;
}> = {
    dashboard: {
        title: "app.text0016",
        description: "app.text0017",
    },
    clients: {
        title: "app.text0007",
        description: "app.text0018",
    },
    invoices: {
        title: "app.text0008",
        description: "app.text0019",
    },
    devis: {
        title: "devis.title",
        description: "devis.description",
    },
    'credit-notes': {
        title: "creditNotes.title",
        description: "creditNotes.description",
    },
    contracts: {
        title: "contracts.title",
        description: "contracts.description",
    },
    payments: {
        title: "app.text0009",
        description: "app.text0020",
    },
    reports: {
        title: "app.text0010",
        description: "app.text0021",
    },
    reminders: {
        title: "app.text0011",
        description: "app.text0022",
    },
    expenses: {
        title: "expenses.title",
        description: "expenses.description",
    },
    products: {
        title: "app.text0012",
        description: "app.text0023",
    },
    users: {
        title: "app.text0013",
        description: "app.text0024",
    },
    rbac: {
        title: "app.text0014",
        description: "app.text0025",
    },
    'audit-logs': {
        title: "auditLogs.title",
        description: "auditLogs.description",
    },
    settings: {
        title: "app.text0015",
        description: "app.text0026",
    },
};
const viewPaths: Record<ViewKey, string> = {
    dashboard: '/dashboard',
    clients: '/clients',
    invoices: '/invoices',
    devis: '/devis',
    'credit-notes': '/credit-notes',
    contracts: '/contracts',
    payments: '/payments',
    reports: '/reports',
    reminders: '/reminders',
    expenses: '/expense-notes',
    products: '/catalogue',
    users: '/users',
    rbac: '/rbac',
    'audit-logs': '/audit-logs',
    settings: '/settings',
};
const pathViews = Object.entries(viewPaths).reduce<Record<string, ViewKey>>((acc, [view, path]) => {
    acc[path] = view as ViewKey;
    return acc;
}, {});
function getViewFromPath(pathname: string): ViewKey {
    return pathViews[pathname] ?? 'dashboard';
}
function App() {
    const { t, i18n: reactI18n } = useTranslation();
    const countryOptions = buildCountryOptions(reactI18n.language);
    const queryClient = useQueryClient();
    const confirm = useConfirm();
    const toast = useToast();
    const [activeView, setActiveView] = useState<ViewKey>('dashboard');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
    });
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [themePreference, setThemePreference] = useState<ThemePreference>(getInitialTheme);
    const themePreferenceRef = useRef<ThemePreference>(themePreference);
    const hasHydratedServerThemeRef = useRef(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement | null>(null);
    const notificationMenuRef = useRef<HTMLDivElement | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
    const [invoiceCustomerFilter, setInvoiceCustomerFilter] = useState('');
    const [invoiceDateFrom, setInvoiceDateFrom] = useState('');
    const [invoiceDateTo, setInvoiceDateTo] = useState('');
    const [invoicePage, setInvoicePage] = useState(1);
    const [invoiceSortBy, setInvoiceSortBy] = useState<InvoiceSortField>('createdAt');
    const [invoiceSortOrder, setInvoiceSortOrder] = useState<'asc' | 'desc'>('desc');
    const [devisStatusFilter, setDevisStatusFilter] = useState<DevisStatus | 'ALL'>('ALL');
    const [devisDateFrom, setDevisDateFrom] = useState('');
    const [devisDateTo, setDevisDateTo] = useState('');
    const [devisPage, setDevisPage] = useState(1);
    const [devisSortBy, setDevisSortBy] = useState<DevisSortField>('createdAt');
    const [devisSortOrder, setDevisSortOrder] = useState<'asc' | 'desc'>('desc');
    const [reminderStatusFilter, setReminderStatusFilter] = useState<ReminderStatus | 'ALL'>('ALL');
    const [reminderTypeFilter, setReminderTypeFilter] = useState<ReminderType | 'ALL'>('ALL');
    const [reminderPage, setReminderPage] = useState(1);
    const [paymentPage, setPaymentPage] = useState(1);
    const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentMethod | 'ALL'>('ALL');
    const [paymentDateFrom, setPaymentDateFrom] = useState('');
    const [paymentDateTo, setPaymentDateTo] = useState('');
    const [reportDateFrom, setReportDateFrom] = useState(`${new Date().getFullYear()}-01-01`);
    const [reportDateTo, setReportDateTo] = useState(getToday());
    const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('last_6_months');
    const [dashboardDateFrom, setDashboardDateFrom] = useState('');
    const [dashboardDateTo, setDashboardDateTo] = useState('');
    const [dashboardMonths, setDashboardMonths] = useState<6 | 12>(6);
    const [reminderInvoiceId, setReminderInvoiceId] = useState('');
    const [reminderDraftType, setReminderDraftType] = useState<ReminderType>('MANUAL');
    const [reminderSubject, setReminderSubject] = useState('');
    const [reminderBody, setReminderBody] = useState('');
    const [reminderSendEmail, setReminderSendEmail] = useState(false);
    const [customerPage, setCustomerPage] = useState(1);
    const [customerSortBy, setCustomerSortBy] = useState<CustomerSortField>('createdAt');
    const [customerSortOrder, setCustomerSortOrder] = useState<'asc' | 'desc'>('desc');
    const [customerStatusFilter, setCustomerStatusFilter] = useState<CustomerStatusFilter>('ACTIVE');
    // This is only an in-memory authentication marker. JWTs stay in HttpOnly cookies.
    const [accessToken, setAccessToken] = useState('');
    const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(true);
    const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [loginValidationError, setLoginValidationError] = useState('');
    const actionMessage = '';
    const setActionMessage = useCallback((message: string) => {
        const trimmedMessage = message.trim();
        if (!trimmedMessage)
            return;
        toast[getToastVariantFromMessage(trimmedMessage)](trimmedMessage);
    }, [toast]);
    const [exportingTarget, setExportingTarget] = useState<ExportTarget | ''>('');
    const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
    const [viewInvoiceId, setViewInvoiceId] = useState('');
    const [viewDevisId, setViewDevisId] = useState('');
    const [viewCustomerId, setViewCustomerId] = useState('');
    const [contractAiContext, setContractAiContext] = useState<AiAssistantContext | undefined>();
    const [emailInvoiceId, setEmailInvoiceId] = useState('');
    const [invoiceEmailRecipient, setInvoiceEmailRecipient] = useState('');
    const [invoiceEmailSubject, setInvoiceEmailSubject] = useState('');
    const [invoiceEmailMessage, setInvoiceEmailMessage] = useState('');
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentEntryDate, setPaymentEntryDate] = useState(getToday());
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK_TRANSFER');
    const [paymentReference, setPaymentReference] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerEmail, setCustomerEmail] = useState('');
    const [customerCompany, setCustomerCompany] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [customerCity, setCustomerCity] = useState('');
    const [customerCountryCode, setCustomerCountryCode] = useState('MA');
    const [customerCountrySearch, setCustomerCountrySearch] = useState(getCountryLabel('MA'));
    const [customerAddress, setCustomerAddress] = useState('');
    const [customerTaxNumber, setCustomerTaxNumber] = useState('');
    const [editingCustomerId, setEditingCustomerId] = useState('');
    const [editingInvoiceId, setEditingInvoiceId] = useState('');
    const [editingDevisId, setEditingDevisId] = useState('');
    const [editingProductId, setEditingProductId] = useState('');
    const [productName, setProductName] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [productUnit, setProductUnit] = useState('forfait');
    const [productUnitPrice, setProductUnitPrice] = useState(0);
    const [productTaxRate, setProductTaxRate] = useState(20);
    const [productIsActive, setProductIsActive] = useState(true);
    const [userPage, setUserPage] = useState(1);
    const [userRoleFilter, setUserRoleFilter] = useState<UserRole | 'ALL'>('ALL');
    const [userStatusFilter, setUserStatusFilter] = useState<CustomerStatusFilter>('ALL');
    const [rbacRoleName, setRbacRoleName] = useState('');
    const [rbacRoleDescription, setRbacRoleDescription] = useState('');
    const [selectedRbacRoleId, setSelectedRbacRoleId] = useState('');
    const [rbacPermissionIds, setRbacPermissionIds] = useState<string[]>([]);
    const [rbacPermissionScopes, setRbacPermissionScopes] = useState<Record<string, 'ALL' | 'OWN' | 'SELECTED'>>({});
    const [selectedRbacUserId, setSelectedRbacUserId] = useState('');
    const [rbacAssignedClientIds, setRbacAssignedClientIds] = useState<string[]>([]);
    const [rbacPermissionKey, setRbacPermissionKey] = useState('');
    const [rbacPermissionDescription, setRbacPermissionDescription] = useState('');
    const [rbacUserSearch, setRbacUserSearch] = useState('');
    const [editingUserId, setEditingUserId] = useState('');
    const [userName, setUserName] = useState('');
    const [userEmail, setUserEmail] = useState('');
    const [userPassword, setUserPassword] = useState('');
    const [userRole, setUserRole] = useState<UserRole>('EMPLOYEE');
    const [userIsActive, setUserIsActive] = useState(true);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [telegramLinkCode, setTelegramLinkCode] = useState("");
const [telegramLinkExpiresAt, setTelegramLinkExpiresAt] = useState("");
   
    const [companyForm, setCompanyForm] = useState<UpdateCompanySettingsForm>({
        name: '',
        address: '',
        phone: '',
        email: '',
        taxNumber: '',
        logoUrl: '',
        signatureUrl: '',
        stampUrl: '',
        defaultCurrency: 'MAD',
        defaultTaxRate: 20,
        vatEnabled: true,
        moroccoVatRate: 20,
        paymentTerms: '',
        bankDetails: '',
    });
    const [companyAssetDrafts, setCompanyAssetDrafts] = useState<Record<CompanyAssetKind, CompanyAssetDraft | null>>({ signature: null, stamp: null });
    const [companyAssetDeletes, setCompanyAssetDeletes] = useState<Record<CompanyAssetKind, boolean>>({
        signature: false,
        stamp: false,
    });
    const [assetEditor, setAssetEditor] = useState<{
        kind: CompanyAssetKind;
        title: string;
        imageUrl: string;
        autoProcess: boolean;
    } | null>(null);
    const [autoBackgroundRemoval, setAutoBackgroundRemoval] = useState(() => {
        return localStorage.getItem(AUTO_BACKGROUND_REMOVAL_STORAGE_KEY) !== 'false';
    });
    const [isInvoiceFormOpen, setIsInvoiceFormOpen] = useState(false);
    const [isDevisFormOpen, setIsDevisFormOpen] = useState(false);
    const [invoiceCustomerId, setInvoiceCustomerId] = useState('');
    const [invoiceStatus, setInvoiceStatus] = useState<Extract<InvoiceStatus, 'DRAFT' | 'SENT'>>('DRAFT');
    const [invoiceIssueDate, setInvoiceIssueDate] = useState(getToday());
    const [invoiceDueDate, setInvoiceDueDate] = useState(getDateAfterDays(30));
    const [invoiceTaxRate, setInvoiceTaxRate] = useState(20);
    const [isVatOverride, setIsVatOverride] = useState(false);
    const [invoiceVatOverrideReason, setInvoiceVatOverrideReason] = useState('');
    const [invoiceDiscount, setInvoiceDiscount] = useState(0);
    const [invoiceNotes, setInvoiceNotes] = useState('');
    const [invoiceTerms, setInvoiceTerms] = useState(t("audit.text0002"));
    const [invoiceItems, setInvoiceItems] = useState<InvoiceDraftItem[]>([
        { description: t("app.text0027"), unit: 'forfait', quantity: 1, unitPrice: 1000, taxRate: 20 },
    ]);
    const [devisCustomerId, setDevisCustomerId] = useState('');
    const [devisStatus, setDevisStatus] = useState<Extract<DevisStatus, 'DRAFT' | 'SENT' | 'APPROVED'>>('DRAFT');
    const [devisIssueDate, setDevisIssueDate] = useState(getToday());
    const [devisValidUntil, setDevisValidUntil] = useState(getDateAfterDays(30));
    const [devisTaxRate, setDevisTaxRate] = useState(20);
    const [devisVatOverrideReason, setDevisVatOverrideReason] = useState('');
    const [devisDiscount, setDevisDiscount] = useState(0);
    const [devisNotes, setDevisNotes] = useState('');
    const [devisTerms, setDevisTerms] = useState(t("audit.text0002"));
    const [devisItems, setDevisItems] = useState<DevisDraftItem[]>([
        { description: t("app.text0027"), unit: 'forfait', quantity: 1, unitPrice: 1000, taxRate: 20, discount: 0 },
    ]);
    const [recurringName, setRecurringName] = useState(t("audit.text0003"));
    const [recurringCustomerId, setRecurringCustomerId] = useState('');
    const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>('MONTHLY');
    const [recurringStartDate, setRecurringStartDate] = useState(getToday());
    const [recurringDueDays, setRecurringDueDays] = useState(30);
    const [recurringDescription, setRecurringDescription] = useState(t("audit.text0004"));
    const [recurringUnitPrice, setRecurringUnitPrice] = useState(2500);
    const [recurringTaxRate, setRecurringTaxRate] = useState(20);
    const [recurringAutoSend, setRecurringAutoSend] = useState(true);
    const [recurringStatusFilter, setRecurringStatusFilter] = useState<RecurringPlanStatus | 'ALL'>('ALL');
    const hasAccessToken = Boolean(accessToken);
    const currentUserQuery = useQuery({
        queryKey: ['auth', 'me'],
        queryFn: getCurrentUser,
        enabled: hasAccessToken,
        retry: false,
    });
    const isSidebarExpanded = isMobileSidebarOpen || !isSidebarCollapsed || isSidebarHovered;
    const loginMutation = useMutation({
        mutationFn: login,
        onSuccess: ({ user }) => {
            setAccessToken('cookie');
            queryClient.setQueryData(['auth', 'me'], user);
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            setPassword('');
            setLoginValidationError('');
            setActionMessage('');
            toast.success(t("audit.text0111"));
            navigateAppTo('/dashboard', true);
        },
        onError: (error) => {
            toast.error(getApiErrorMessage(error, t("audit.text0022")));
        },
    });
    const reminderMutation = useMutation({
        mutationFn: createReminder,
        onSuccess: () => {
            setActionMessage(t("app.text0028"));
            resetReminderDraft();
            queryClient.invalidateQueries({ queryKey: ['reminders'] });
        },
        onError: () => {
            setActionMessage(t("app.text0029"));
        },
    });
    const automaticReminderMutation = useMutation({
        mutationFn: runAutomaticReminders,
        onSuccess: (result) => {
            setActionMessage(t('audit.autoRemindersResult', { created: result.createdCount, skipped: result.skippedCount }));
            queryClient.invalidateQueries({ queryKey: ['reminders'] });
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
        },
        onError: () => {
            setActionMessage(t("app.text0030"));
        },
    });
    const paymentMutation = useMutation({
        mutationFn: (invoice: InvoiceSummary | Invoice) => recordPayment(invoice.id, {
            amount: Number(paymentAmount),
            paymentDate: paymentEntryDate,
            method: paymentMethod,
            reference: paymentReference || undefined,
        }),
        onSuccess: () => {
            setActionMessage(t("app.text0031"));
            setPaymentAmount('');
            setPaymentEntryDate(getToday());
            setPaymentReference('');
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
            queryClient.invalidateQueries({ queryKey: ['payments'] });
            queryClient.invalidateQueries({ queryKey: ['reports'] });
        },
        onError: () => {
            setActionMessage(t("app.text0032"));
        },
    });
    const recurringCreateMutation = useMutation({
        mutationFn: () => createRecurringPlan({
            customerId: recurringCustomerId, name: recurringName, frequency: recurringFrequency, intervalCount: 1,
            startDate: recurringStartDate, dueDays: recurringDueDays, autoSend: recurringAutoSend, currency: 'MAD', discount: 0,
            terms: t('i18nDynamic.paymentDueDays', { count: recurringDueDays }),
            items: [{ description: recurringDescription, unit: t('i18nDynamic.monthUnit'), quantity: 1, unitPrice: recurringUnitPrice, taxRate: recurringTaxRate }],
        }),
        onSuccess: () => {
            setActionMessage(t("app.text0033"));
            queryClient.invalidateQueries({ queryKey: ['recurring-plans'] });
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0005"))),
    });
    const recurringStatusMutation = useMutation({
        mutationFn: ({ id, status }: {
            id: string;
            status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
        }) => updateRecurringPlanStatus(id, status),
        onSuccess: () => { setActionMessage(t("app.text0034")); queryClient.invalidateQueries({ queryKey: ['recurring-plans'] }); },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0006"))),
    });
    const recurringRunMutation = useMutation({
        mutationFn: runRecurringPlan,
        onSuccess: () => {
            setActionMessage(t("app.text0035"));
            queryClient.invalidateQueries({ queryKey: ['recurring-plans'] });
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0007"))),
    });
    const customerMutation = useMutation({
        mutationFn: () => editingCustomerId
            ? updateCustomer(editingCustomerId, {
                name: customerName,
                email: customerEmail,
                company: customerCompany || undefined,
                phone: customerPhone || undefined,
                city: customerCity || undefined,
                country: getCountryName(customerCountryCode),
                countryCode: customerCountryCode,
                address: customerAddress || undefined,
                taxNumber: customerTaxNumber || undefined,
            })
            : createCustomer({
                name: customerName,
                email: customerEmail,
                company: customerCompany || undefined,
                phone: customerPhone || undefined,
                city: customerCity || undefined,
                country: getCountryName(customerCountryCode),
                countryCode: customerCountryCode,
                address: customerAddress || undefined,
                taxNumber: customerTaxNumber || undefined,
            }),
        onSuccess: () => {
            setActionMessage(editingCustomerId ? t("audit.text0008") : t("audit.text0009"));
            resetCustomerForm();
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        },
        onError: () => {
            setActionMessage(t("app.text0036"));
        },
    });
    const customerStatusMutation = useMutation({
        mutationFn: (customer: Customer) => updateCustomer(customer.id, { isActive: !customer.isActive }),
        onSuccess: () => {
            setActionMessage(t("app.text0037"));
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        },
        onError: () => {
            setActionMessage(t("app.text0038"));
        },
    });
    const deleteCustomerMutation = useMutation({
        mutationFn: deleteCustomer,
        onSuccess: () => {
            setActionMessage(t("app.text0039"));
            queryClient.invalidateQueries({ queryKey: ['customers'] });
        },
        onError: () => {
            setActionMessage(t("app.text0040"));
        },
    });
    async function saveCompanySettingsWithAssets() {
        if (companyAssetDeletes.signature && !companyAssetDrafts.signature) {
            await deleteCompanySignature();
        }
        if (companyAssetDeletes.stamp && !companyAssetDrafts.stamp) {
            await deleteCompanyStamp();
        }
        if (companyAssetDrafts.signature) {
            await uploadCompanySignature(new File([companyAssetDrafts.signature.blob], companyAssetDrafts.signature.fileName, {
                type: companyAssetDrafts.signature.blob.type || 'image/png',
            }));
        }
        if (companyAssetDrafts.stamp) {
            await uploadCompanyStamp(new File([companyAssetDrafts.stamp.blob], companyAssetDrafts.stamp.fileName, {
                type: companyAssetDrafts.stamp.blob.type || 'image/png',
            }));
        }
        return updateCompanySettings({
            ...companyForm,
            signatureUrl: undefined,
            stampUrl: undefined,
            logoUrl: companyForm.logoUrl || undefined,
            email: companyForm.email || undefined,
        });
    }
    const cleanupAssetDrafts = useCallback(() => {
        setCompanyAssetDrafts((drafts) => {
            Object.values(drafts).forEach((draft) => {
                if (draft?.previewUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(draft.previewUrl);
                }
            });
            return { signature: null, stamp: null };
        });
    }, []);
    const settingsMutation = useMutation({
        mutationFn: saveCompanySettingsWithAssets,
        onSuccess: (settings) => {
            cleanupAssetDrafts();
            setCompanyAssetDeletes({ signature: false, stamp: false });
            setCompanyForm(mapCompanySettingsToForm(settings));
            setActionMessage(t("app.text0041"));
            queryClient.invalidateQueries({ queryKey: ['settings', 'company'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
        },
        onError: (error) => {
            setActionMessage(getApiErrorMessage(error, t("audit.text0010")));
        },
    });

    const telegramLinkMutation = useMutation({
  mutationFn: generateTelegramLinkCode,

  onSuccess: (result) => {
    setTelegramLinkCode(result.code);
    setTelegramLinkExpiresAt(result.expiresAt);

    toast.success("Telegram linking code generated");
  },

  onError: (error) => {
    toast.error(
      getApiErrorMessage(
        error,
        "Unable to generate Telegram linking code"
      )
    );
  },
});

    const signInvoiceMutation = useMutation({
        mutationFn: signInvoice,
        onSuccess: (invoice) => {
            setActionMessage(t('i18nDynamic.invoiceSigned', { number: invoice.invoiceNumber }));
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', 'detail', invoice.id] });
        },
        onError: () => {
            setActionMessage(t("app.text0042"));
        },
    });
    const cancelInvoiceSignatureMutation = useMutation({
        mutationFn: cancelInvoiceSignature,
        onSuccess: (invoice) => {
            setActionMessage(t('i18nDynamic.invoiceSignatureCancelled', { number: invoice.invoiceNumber }));
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', 'detail', invoice.id] });
        },
        onError: () => {
            setActionMessage(t("app.text0043"));
        },
    });
    const passwordMutation = useMutation({
        mutationFn: () => changePassword({ currentPassword, newPassword }),
        onSuccess: () => {
            setActionMessage(t("app.text0044"));
            setCurrentPassword('');
            setNewPassword('');
            setConfirmNewPassword('');
        },
        onError: () => {
            setActionMessage(t("app.text0045"));
        },
    });
    const testEmailMutation = useMutation({
        mutationFn: () => sendTestEmail(),
        onSuccess: (result) => {
            setActionMessage(result.delivery.mode === 'local'
                ? t('i18nDynamic.testEmailGeneratedLocal', { email: result.to })
                : t('i18nDynamic.testEmailSent', { email: result.to }));
            queryClient.invalidateQueries({ queryKey: ['settings', 'email-status'] });
        },
        onError: () => {
            setActionMessage(t("app.text0046"));
        },
    });
    const productMutation = useMutation({
        mutationFn: () => {
            const payload: CreateProductForm | UpdateProductForm = {
                name: productName,
                description: productDescription || undefined,
                unit: productUnit || undefined,
                unitPrice: productUnitPrice,
                taxRate: productTaxRate,
                isActive: productIsActive,
            };
            return editingProductId
                ? updateProduct(editingProductId, payload)
                : createProduct(payload as CreateProductForm);
        },
        onSuccess: () => {
            setActionMessage(editingProductId ? t("audit.text0011") : t("audit.text0012"));
            resetProductForm();
            queryClient.invalidateQueries({ queryKey: ['products'] });
        },
        onError: () => {
            setActionMessage(t("app.text0047"));
        },
    });
    const userMutation = useMutation({
        mutationFn: () => {
            const payload: CreateUserForm | UpdateUserForm = {
                name: userName,
                email: userEmail,
                role: userRole,
                isActive: userIsActive,
                ...(userPassword ? { password: userPassword } : {}),
            };
            return editingUserId
                ? updateUser(editingUserId, payload)
                : createUser({ ...(payload as CreateUserForm), password: userPassword });
        },
        onSuccess: () => {
            setActionMessage(editingUserId ? t("audit.text0013") : t("audit.text0014"));
            resetUserForm();
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
        onError: () => {
            setActionMessage(t("app.text0048"));
        },
    });
    const rbacRoleMutation = useMutation({
        mutationFn: () => createRbacRole({ name: rbacRoleName, description: rbacRoleDescription || undefined }),
        onSuccess: () => {
            setRbacRoleName('');
            setRbacRoleDescription('');
            queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
            setActionMessage(t("app.text0049"));
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0015"))),
    });
    const rbacPermissionMutation = useMutation({
        mutationFn: () => assignRbacPermissions(selectedRbacRoleId, rbacPermissionIds.map((permissionId) => ({ permissionId, scope: rbacPermissionScopes[permissionId] ?? 'ALL' }))),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
            setActionMessage(t("app.text0050"));
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0016"))),
    });
    const rbacPermissionCreateMutation = useMutation({
        mutationFn: () => {
            const [resource = 'custom', action = 'manage'] = rbacPermissionKey.split('.');
            return createRbacPermission({
                key: rbacPermissionKey,
                description: rbacPermissionDescription || undefined,
                resource,
                action,
            });
        },
        onSuccess: () => {
            setRbacPermissionKey('');
            setRbacPermissionDescription('');
            queryClient.invalidateQueries({ queryKey: ['rbac', 'permissions'] });
            setActionMessage(t("app.text0051"));
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0017"))),
    });
    const rbacUserRoleMutation = useMutation({
        mutationFn: ({ userId, roleId }: {
            userId: string;
            roleId: string;
        }) => assignRbacUserRole(userId, roleId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setActionMessage(t("app.text0052"));
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0018"))),
    });
    const rbacClientAssignmentMutation = useMutation({
        mutationFn: () => assignRbacUserClients(selectedRbacUserId, rbacAssignedClientIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rbac', 'user-clients', selectedRbacUserId] });
            setActionMessage(t("app.text0053"));
        },
        onError: (error) => setActionMessage(getApiErrorMessage(error, t("audit.text0019"))),
    });
    const invoiceMutation = useMutation({
        mutationFn: () => {
            const payload: CreateInvoiceForm = {
                customerId: invoiceCustomerId,
                ...(editingInvoiceId ? {} : { status: invoiceStatus }),
                issueDate: invoiceIssueDate,
                dueDate: invoiceDueDate,
                taxRate: effectiveVatRate,
                ...(isVatOverride ? { vatOverrideReason: invoiceVatOverrideReason } : {}),
                discount: invoiceDiscount,
                notes: invoiceNotes || undefined,
                terms: invoiceTerms || undefined,
                currency: 'MAD',
                items: invoiceItems.map((item) => ({
                    description: item.description,
                    unit: item.unit || undefined,
                    quantity: Number(item.quantity),
                    unitPrice: Number(item.unitPrice),
                    taxRate: Number(item.taxRate),
                })),
            };
            return editingInvoiceId ? updateInvoice(editingInvoiceId, payload) : createInvoice(payload);
        },
        onSuccess: () => {
            setActionMessage(editingInvoiceId ? t("audit.text0020") : t("audit.text0021"));
            setIsInvoiceFormOpen(false);
            resetInvoiceForm();
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
        },
        onError: () => {
            setActionMessage(t("app.text0054"));
        },
    });
    const devisMutation = useMutation({
        mutationFn: () => {
            const payload: CreateDevisForm = {
                customerId: devisCustomerId,
                ...(editingDevisId ? {} : { status: devisStatus }),
                issueDate: devisIssueDate,
                validUntil: devisValidUntil,
                taxRate: effectiveDevisVatRate,
                ...(isVatOverride ? { vatOverrideReason: devisVatOverrideReason } : {}),
                discount: devisDiscount,
                notes: devisNotes || undefined,
                terms: devisTerms || undefined,
                currency: 'MAD',
                items: devisItems.map((item) => ({
                    description: item.description,
                    unit: item.unit || undefined,
                    quantity: Number(item.quantity),
                    unitPrice: Number(item.unitPrice),
                    discount: Number(item.discount),
                    taxRate: Number(item.taxRate),
                })),
            };
            return editingDevisId ? updateDevis(editingDevisId, payload) : createDevis(payload);
        },
        onSuccess: () => {
            setActionMessage(editingDevisId ? t('devis.updated') : t('devis.created'));
            setIsDevisFormOpen(false);
            resetDevisForm();
            queryClient.invalidateQueries({ queryKey: ['devis'] });
        },
        onError: (error) => {
            setActionMessage(getLocalizedDevisErrorMessage(error, t('devis.saveFailed'), t));
        },
    });
    const devisActionMutation = useMutation<Devis | { devis: Devis; invoice: Invoice } | null, unknown, {
        devisId: string;
        action: 'send' | 'approve' | 'reject' | 'delete' | 'convert' | 'sign' | 'cancelSignature';
    }>({
        mutationFn: ({ devisId, action }: {
            devisId: string;
            action: 'send' | 'approve' | 'reject' | 'delete' | 'convert' | 'sign' | 'cancelSignature';
        }) => {
            if (action === 'send')
                return sendDevis(devisId);
            if (action === 'approve')
                return approveDevis(devisId);
            if (action === 'reject')
                return rejectDevis(devisId);
            if (action === 'delete')
                return deleteDevis(devisId).then(() => null);
            if (action === 'sign')
                return signDevis(devisId);
            if (action === 'cancelSignature')
                return cancelDevisSignature(devisId);
            return convertDevisToInvoice(devisId);
        },
        onSuccess: (result, variables) => {
            if (variables.action === 'convert' && result && 'invoice' in result) {
                setActionMessage(t('devis.converted', { number: result.invoice.invoiceNumber }));
                setViewInvoiceId(result.invoice.id);
            }
            else if (variables.action === 'sign') {
                setActionMessage(t('devis.signed'));
            }
            else if (variables.action === 'cancelSignature') {
                setActionMessage(t('devis.signatureCancelled'));
            }
            else if (variables.action === 'delete') {
                setActionMessage(t('devis.deleted'));
                setViewDevisId('');
            }
            else {
                setActionMessage(t('devis.actionDone'));
            }
            queryClient.invalidateQueries({ queryKey: ['devis'] });
            queryClient.invalidateQueries({ queryKey: ['devis', 'detail'] });
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
        },
        onError: (error) => {
            setActionMessage(getLocalizedDevisErrorMessage(error, t('devis.actionFailed'), t));
        },
    });
    const deleteDraftDevisMutation = useMutation({
        mutationFn: deleteDraftDevis,
        onSuccess: (result) => {
            setActionMessage(t('devis.draftsDeleted', { count: result.deletedCount }));
            setViewDevisId('');
            queryClient.invalidateQueries({ queryKey: ['devis'] });
            queryClient.invalidateQueries({ queryKey: ['devis', 'detail'] });
        },
        onError: (error) => {
            setActionMessage(getApiErrorMessage(error, t('devis.deleteDraftsFailed')));
        },
    });
    const invoiceStatusMutation = useMutation({
        mutationFn: ({ invoiceId, status }: {
            invoiceId: string;
            status: InvoiceStatus;
        }) => updateInvoiceStatus(invoiceId, status),
        onSuccess: () => {
            setActionMessage(t("app.text0055"));
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
        },
        onError: () => {
            setActionMessage(t("app.text0056"));
        },
    });
    const invoiceEmailMutation = useMutation({
        mutationFn: () => sendInvoiceEmail(emailInvoiceId, {
            recipientEmail: invoiceEmailRecipient || undefined,
            subject: invoiceEmailSubject || undefined,
            message: invoiceEmailMessage || undefined,
        }),
        onSuccess: (result) => {
            setActionMessage(result.delivery.mode === 'local'
                ? t('i18nDynamic.invoiceEmailGeneratedLocal', { email: result.email.to })
                : t('i18nDynamic.invoiceEmailSent', { email: result.email.to }));
            closeInvoiceEmailModal();
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
        },
        onError: () => {
            setActionMessage(t("app.text0057"));
        },
    });
    const invoiceQuery = useQuery({
        queryKey: [
            'invoices',
            'dashboard-list',
            activeView,
            searchTerm,
            invoiceStatusFilter,
            invoiceCustomerFilter,
            invoiceDateFrom,
            invoiceDateTo,
            invoicePage,
            invoiceSortBy,
            invoiceSortOrder,
        ],
        queryFn: () => getInvoices({
            page: activeView === 'invoices' ? invoicePage : 1,
            limit: activeView === 'invoices' ? 25 : 8,
            search: searchTerm || undefined,
            status: invoiceStatusFilter === 'ALL' ? undefined : invoiceStatusFilter,
            customerId: activeView === 'invoices' ? invoiceCustomerFilter || undefined : undefined,
            dateFrom: activeView === 'invoices' ? invoiceDateFrom || undefined : undefined,
            dateTo: activeView === 'invoices' ? invoiceDateTo || undefined : undefined,
            sortBy: invoiceSortBy,
            sortOrder: invoiceSortOrder,
        }),
        enabled: hasAccessToken,
    });
    const devisQuery = useQuery({
        queryKey: [
            'devis',
            activeView,
            searchTerm,
            devisStatusFilter,
            devisDateFrom,
            devisDateTo,
            devisPage,
            devisSortBy,
            devisSortOrder,
        ],
        queryFn: () => getDevis({
            page: activeView === 'devis' ? devisPage : 1,
            limit: activeView === 'devis' ? 25 : 8,
            search: searchTerm || undefined,
            status: devisStatusFilter === 'ALL' ? undefined : devisStatusFilter,
            dateFrom: activeView === 'devis' ? devisDateFrom || undefined : undefined,
            dateTo: activeView === 'devis' ? devisDateTo || undefined : undefined,
            sortBy: devisSortBy,
            sortOrder: devisSortOrder,
        }),
        enabled: hasAccessToken && (activeView === 'devis' || activeView === 'dashboard'),
    });
    const dashboardQuery = useQuery({
        queryKey: [
            'invoices',
            'dashboard',
            dashboardPeriod,
            dashboardDateFrom,
            dashboardDateTo,
            dashboardMonths,
        ],
        queryFn: () => getInvoiceDashboard({
            period: dashboardPeriod,
            dateFrom: dashboardPeriod === 'custom' ? dashboardDateFrom || undefined : undefined,
            dateTo: dashboardPeriod === 'custom' ? dashboardDateTo || undefined : undefined,
            months: dashboardMonths,
        }),
        enabled: hasAccessToken,
    });
    const customerQuery = useQuery({
        queryKey: [
            'customers',
            'invoice-form',
            activeView,
            searchTerm,
            customerPage,
            customerSortBy,
            customerSortOrder,
            customerStatusFilter,
        ],
        queryFn: () => getCustomers({
            page: activeView === 'clients' ? customerPage : 1,
            limit: activeView === 'clients' ? 15 : 200,
            search: activeView === 'clients' ? searchTerm : undefined,
            isActive: activeView === 'clients'
                ? customerStatusFilter === 'ALL'
                    ? undefined
                    : customerStatusFilter === 'ACTIVE'
                : true,
            sortBy: activeView === 'clients' ? customerSortBy : 'createdAt',
            sortOrder: activeView === 'clients' ? customerSortOrder : 'desc',
        }),
        enabled: hasAccessToken,
    });
    const reminderQuery = useQuery({
        queryKey: ['reminders', searchTerm, reminderStatusFilter, reminderTypeFilter, reminderPage],
        queryFn: () => getReminders({
            page: reminderPage,
            limit: 15,
            status: reminderStatusFilter === 'ALL' ? undefined : reminderStatusFilter,
            type: reminderTypeFilter === 'ALL' ? undefined : reminderTypeFilter,
            search: searchTerm || undefined,
        }),
        enabled: hasAccessToken,
    });
    const paymentQuery = useQuery({
        queryKey: ['payments', searchTerm, paymentMethodFilter, paymentDateFrom, paymentDateTo, paymentPage],
        queryFn: () => getPayments({
            page: paymentPage,
            limit: 20,
            search: searchTerm || undefined,
            method: paymentMethodFilter === 'ALL' ? undefined : paymentMethodFilter,
            dateFrom: paymentDateFrom || undefined,
            dateTo: paymentDateTo || undefined,
        }),
        enabled: hasAccessToken && activeView === 'payments',
    });
    const recurringPlansQuery = useQuery({
        queryKey: ['recurring-plans', recurringStatusFilter],
        queryFn: () => getRecurringPlans({ limit: 50, status: recurringStatusFilter === 'ALL' ? undefined : recurringStatusFilter }),
        enabled: hasAccessToken && activeView === 'payments' && (currentUserQuery.data?.permissions ?? []).includes('recurring.view'),
    });
    const receivablesAgingQuery = useQuery({
        queryKey: ['reports', 'receivables-aging'],
        queryFn: getReceivablesAgingReport,
        enabled: hasAccessToken && activeView === 'reports',
    });
    const taxSummaryQuery = useQuery({
        queryKey: ['reports', 'tax-summary', reportDateFrom, reportDateTo],
        queryFn: () => getTaxSummaryReport({
            dateFrom: reportDateFrom || undefined,
            dateTo: reportDateTo || undefined,
        }),
        enabled: hasAccessToken && activeView === 'reports',
    });
    const productQuery = useQuery({
        queryKey: ['products', activeView],
        queryFn: () => getProducts({
            limit: 100,
            isActive: activeView === 'products' ? undefined : true,
        }),
        enabled: hasAccessToken,
    });
    const userQuery = useQuery({
        queryKey: ['users', searchTerm, userRoleFilter, userStatusFilter, userPage],
        queryFn: () => getUsers({
            page: userPage,
            limit: 15,
            search: searchTerm || undefined,
            role: userRoleFilter === 'ALL' ? undefined : userRoleFilter,
            isActive: userStatusFilter === 'ALL' ? undefined : userStatusFilter === 'ACTIVE',
        }),
        enabled: hasAccessToken && activeView === 'users',
    });
    const rbacRolesQuery = useQuery({
        queryKey: ['rbac', 'roles'],
        queryFn: getRbacRoles,
        enabled: hasAccessToken && activeView === 'rbac',
    });
    const rbacPermissionsQuery = useQuery({
        queryKey: ['rbac', 'permissions'],
        queryFn: getRbacPermissions,
        enabled: hasAccessToken && activeView === 'rbac',
    });
    const rbacUsersQuery = useQuery({
        queryKey: ['rbac', 'users', rbacUserSearch],
        queryFn: () => getRbacUsers({ search: rbacUserSearch || undefined, limit: '50' }),
        enabled: hasAccessToken && activeView === 'rbac',
    });
    const rbacAllClientsQuery = useQuery({
        queryKey: ['rbac', 'all-clients'],
        queryFn: () => getCustomers({ limit: 200 }),
        enabled: hasAccessToken && activeView === 'rbac' && Boolean(selectedRbacUserId),
    });
    const rbacUserClientsQuery = useQuery({
        queryKey: ['rbac', 'user-clients', selectedRbacUserId],
        queryFn: () => getRbacUserClients(selectedRbacUserId),
        enabled: hasAccessToken && activeView === 'rbac' && Boolean(selectedRbacUserId),
    });
    const invoiceDetailQuery = useQuery({
        queryKey: ['invoices', 'detail', viewInvoiceId],
        queryFn: () => getInvoiceById(viewInvoiceId),
        enabled: hasAccessToken && Boolean(viewInvoiceId),
    });
    const devisDetailQuery = useQuery({
        queryKey: ['devis', 'detail', viewDevisId],
        queryFn: () => getDevisById(viewDevisId),
        enabled: hasAccessToken && Boolean(viewDevisId),
    });
    const customerInvoiceQuery = useQuery({
        queryKey: ['customers', 'detail-invoices', viewCustomerId],
        queryFn: () => getInvoices({
            customerId: viewCustomerId,
            limit: 20,
            sortBy: 'createdAt',
            sortOrder: 'desc',
        }),
        enabled: hasAccessToken && Boolean(viewCustomerId),
    });
    const customerDetailQuery = useQuery({
        queryKey: ['customers', 'detail', viewCustomerId],
        queryFn: () => getCustomerById(viewCustomerId),
        enabled: hasAccessToken && Boolean(viewCustomerId),
    });
    const themeMutation = useMutation({
        mutationFn: updateThemePreference,
        onError: () => {
            setActionMessage(t("app.text0058"));
        },
    });
    const companySettingsQuery = useQuery({
        queryKey: ['settings', 'company'],
        queryFn: getCompanySettings,
        enabled: hasAccessToken,
    });
    const emailStatusQuery = useQuery({
        queryKey: ['settings', 'email-status'],
        queryFn: getEmailDeliveryStatus,
        enabled: hasAccessToken &&
            activeView === 'settings' &&
            normalizeRole(currentUserQuery.data?.role) === 'ADMIN',
    });
    const emailLogsQuery = useQuery({
        queryKey: ['settings', 'email-logs'],
        queryFn: getRecentEmailLogs,
        enabled: hasAccessToken &&
            activeView === 'settings' &&
            normalizeRole(currentUserQuery.data?.role) === 'ADMIN',
    });
    const navigateAppTo = (path: string, replace = false) => {
        if (window.location.pathname === path) {
            setCurrentPath(path);
            return;
        }
        if (replace) {
            window.history.replaceState({}, '', path);
        }
        else {
            window.history.pushState({}, '', path);
        }
        setCurrentPath(path);
    };
    useEffect(() => {
        themePreferenceRef.current = themePreference;
        persistTheme(themePreference);
    }, [themePreference]);
    useEffect(() => {
        const handleThemeStorage = (event: StorageEvent) => {
            if (event.key !== 'themePreference' || !isThemePreference(event.newValue))
                return;
            themePreferenceRef.current = event.newValue;
            setThemePreference(event.newValue);
        };
        window.addEventListener('storage', handleThemeStorage);
        return () => window.removeEventListener('storage', handleThemeStorage);
    }, []);
    useEffect(() => {
        const handlePopState = () => {
            setCurrentPath(window.location.pathname);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);
    useEffect(() => {
        let isMounted = true;
        const restoreSession = async () => {
            try {
                await refreshAccessToken();
                if (isMounted) {
                    setAccessToken('cookie');
                }
            }
            catch {
                clearAuthSession();
            }
            finally {
                if (isMounted) {
                    setIsAuthBootstrapping(false);
                }
            }
        };
        restoreSession();
        return () => {
            isMounted = false;
        };
    }, []);
    useEffect(() => {
        if (isAuthBootstrapping)
            return;
        if (currentPath.startsWith('/contracts/sign/'))
            return;
        if (!hasAccessToken) {
            if (currentPath !== '/login') {
                navigateAppTo('/login', true);
            }
            return;
        }
        if (currentPath === '/' || currentPath === '/login') {
            navigateAppTo('/dashboard', true);
            return;
        }
        const view = getViewFromPath(currentPath);
        if (!pathViews[currentPath]) {
            navigateAppTo(viewPaths.dashboard, true);
            return;
        }
        if (activeView !== view) {
            setActiveView(view);
        }
    }, [activeView, currentPath, hasAccessToken, isAuthBootstrapping]);
    useEffect(() => {
        if (hasHydratedServerThemeRef.current)
            return;
        const serverTheme = currentUserQuery.data?.themePreference;
        if (!isThemePreference(serverTheme))
            return;
        hasHydratedServerThemeRef.current = true;
        // A local choice is authoritative. Use the server value only on devices
        // where the user has not selected a theme yet.
        if (getStoredTheme() === null) {
            setThemePreference(serverTheme);
        }
    }, [currentUserQuery.data?.themePreference]);
    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (profileMenuRef.current &&
                !profileMenuRef.current.contains(event.target as Node)) {
                setIsProfileMenuOpen(false);
            }
            if (notificationMenuRef.current &&
                !notificationMenuRef.current.contains(event.target as Node)) {
                setIsNotificationMenuOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsProfileMenuOpen(false);
                setIsNotificationMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);
    useEffect(() => {
        const firstCustomer = customerQuery.data?.data[0];
        if (!invoiceCustomerId && firstCustomer) {
            setInvoiceCustomerId(firstCustomer.id);
        }
        if (!devisCustomerId && firstCustomer) {
            setDevisCustomerId(firstCustomer.id);
        }
        if (!recurringCustomerId && firstCustomer) {
            setRecurringCustomerId(firstCustomer.id);
        }
    }, [customerQuery.data, devisCustomerId, invoiceCustomerId, recurringCustomerId]);
    useEffect(() => {
        if (invoiceDetailQuery.data && !paymentAmount) {
            setPaymentAmount(String(Number(invoiceDetailQuery.data.balanceDue)));
        }
    }, [invoiceDetailQuery.data, paymentAmount]);
    useEffect(() => {
        setInvoicePage(1);
    }, [searchTerm, invoiceStatusFilter, invoiceCustomerFilter, invoiceDateFrom, invoiceDateTo, invoiceSortBy, invoiceSortOrder]);
    useEffect(() => {
        setDevisPage(1);
    }, [searchTerm, devisStatusFilter, devisDateFrom, devisDateTo, devisSortBy, devisSortOrder]);
    useEffect(() => {
        setCustomerPage(1);
    }, [searchTerm, customerSortBy, customerSortOrder, customerStatusFilter]);
    useEffect(() => {
        setReminderPage(1);
    }, [searchTerm, reminderStatusFilter, reminderTypeFilter]);
    useEffect(() => {
        setPaymentPage(1);
    }, [searchTerm, paymentMethodFilter, paymentDateFrom, paymentDateTo]);
    useEffect(() => {
        if (!currentUserQuery.isError)
            return;
        const status = getHttpStatus(currentUserQuery.error);
        if (status === 401) {
            clearAuthSession();
            setAccessToken('');
            setActionMessage(t("app.text0059"));
            queryClient.removeQueries({ queryKey: ['auth'] });
            queryClient.removeQueries({ queryKey: ['invoices'] });
            queryClient.removeQueries({ queryKey: ['devis'] });
            queryClient.removeQueries({ queryKey: ['customers'] });
            queryClient.removeQueries({ queryKey: ['reminders'] });
        }
    }, [currentUserQuery.error, currentUserQuery.isError, queryClient, setActionMessage, t]);
    useEffect(() => {
        if (companySettingsQuery.data &&
            !companyAssetDrafts.signature &&
            !companyAssetDrafts.stamp &&
            !companyAssetDeletes.signature &&
            !companyAssetDeletes.stamp) {
            setCompanyForm(mapCompanySettingsToForm(companySettingsQuery.data));
        }
    }, [companyAssetDeletes, companyAssetDrafts, companySettingsQuery.data]);
    useEffect(() => {
        return () => {
            cleanupAssetDrafts();
        };
    }, [cleanupAssetDrafts]);
    const liveInvoices = invoiceQuery.data?.data.map(mapInvoiceToSummary) ?? [];
    const usingLiveData = Boolean(hasAccessToken);
    const invoices = hasAccessToken ? liveInvoices : emptyInvoices;
    const dashboardStats = dashboardQuery.data;
    const chartRevenue = dashboardStats?.monthlyRevenue?.length
        ? dashboardStats.monthlyRevenue
        : emptyRevenueTrend;
    const dashboardStatusData = dashboardStats?.invoiceStatusCounts
        .filter((item) => ['DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(item.status))
        .map((item) => ({
        ...item,
        label: getStatusLabel(item.status),
    })) ?? [];
    const hasDashboardData = Boolean(dashboardStats && dashboardStats.totalInvoices > 0);
    const customerExposure = usingLiveData
        ? mapDashboardCustomerExposure(dashboardStats)
        : emptyCustomerExposure;
    const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
    const totalUnpaid = dashboardStats?.totalUnpaid ?? totalInvoiced - totalPaid;
    const overdueInvoices = invoices.filter((invoice) => invoice.status === 'OVERDUE');
    const dueSoonInvoices = invoices.filter((invoice) => {
        const days = getDaysUntilDue(invoice.dueDate);
        return days >= 0 && days <= 7 && invoice.total > invoice.paid;
    });
    const payableInvoices = invoices.filter((invoice) => invoice.total > invoice.paid && invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED');
    const selectedInvoice = payableInvoices.find((invoice) => invoice.id === selectedInvoiceId) ?? payableInvoices[0];
    const selectedBalance = selectedInvoice ? selectedInvoice.total - selectedInvoice.paid : 0;
    const activeViewMeta = viewMeta[activeView];
    const selectedCustomer = customerDetailQuery.data ?? customerQuery.data?.data.find((customer) => customer.id === viewCustomerId);
    const aiAssistantContext = useMemo<AiAssistantContext | undefined>(() => {
        if (viewInvoiceId && invoiceDetailQuery.data) {
            return {
                entityType: 'invoice',
                entityId: invoiceDetailQuery.data.id,
                readableReference: `${invoiceDetailQuery.data.invoiceNumber} - ${invoiceDetailQuery.data.customer?.company ?? invoiceDetailQuery.data.customer?.name ?? ''}`.trim(),
            };
        }
        if (viewCustomerId && selectedCustomer) {
            return {
                entityType: 'client',
                entityId: selectedCustomer.id,
                readableReference: selectedCustomer.company ?? selectedCustomer.name,
            };
        }
        return contractAiContext;
    }, [contractAiContext, invoiceDetailQuery.data, selectedCustomer, viewCustomerId, viewInvoiceId]);
    const userPermissions = currentUserQuery.data?.permissions ?? EMPTY_PERMISSIONS;
    const hasPermission = (permission: string) => userPermissions.includes(permission);
    const isAdmin = hasPermission('roles.view') && hasPermission('permissions.assign');
    const selectedInvoiceCustomer = customerQuery.data?.data.find((customer) => customer.id === invoiceCustomerId) ??
        invoiceDetailQuery.data?.customer;
    const selectedDevisCustomer = customerQuery.data?.data.find((customer) => customer.id === devisCustomerId) ??
        devisDetailQuery.data?.customer;
    const automaticVatRate = getAutomaticVatRate(selectedInvoiceCustomer, companySettingsQuery.data);
    const automaticDevisVatRate = getAutomaticVatRate(selectedDevisCustomer, companySettingsQuery.data);
    const effectiveVatRate = isVatOverride ? invoiceTaxRate : automaticVatRate;
    const effectiveDevisVatRate = isVatOverride ? devisTaxRate : automaticDevisVatRate;
    const invoiceTotals = calculateInvoiceTotals(invoiceItems, effectiveVatRate, invoiceDiscount);
    const devisTotals = calculateDevisTotals(devisItems, effectiveDevisVatRate, devisDiscount);
    const visibleNavItems = navItems.filter((item) => {
        if (item.key === 'users')
            return hasPermission('users.view');
        if (item.key === 'rbac')
            return hasPermission('roles.view') || hasPermission('permissions.view');
        if (item.key === 'audit-logs')
            return hasPermission('audit_logs.view');
        if (item.key === 'dashboard')
            return hasPermission('dashboard.view');
        if (item.key === 'clients')
            return hasPermission('clients.view');
        if (item.key === 'invoices')
            return hasPermission('invoices.view');
        if (item.key === 'devis')
            return hasPermission('devis.view');
        if (item.key === 'credit-notes')
            return hasPermission('credit_notes.view');
        if (item.key === 'contracts')
            return hasPermission('contracts.view');
        if (item.key === 'payments')
            return hasPermission('payments.view');
        if (item.key === 'reports')
            return hasPermission('reports.view');
        if (item.key === 'expenses')
            return hasPermission('expense_notes.view');
        if (item.key === 'products')
            return hasPermission('products.view');
        if (item.key === 'reminders')
            return hasPermission('reminders.view');
        return true;
    });
    useEffect(() => {
        if (isVatOverride)
            return;
        setInvoiceTaxRate(automaticVatRate);
        setInvoiceItems((items) => items.map((item) => ({
            ...item,
            taxRate: automaticVatRate,
        })));
    }, [automaticVatRate, isVatOverride]);
    useEffect(() => {
        if (isVatOverride)
            return;
        setDevisTaxRate(automaticDevisVatRate);
        setDevisItems((items) => items.map((item) => ({
            ...item,
            taxRate: automaticDevisVatRate,
        })));
    }, [automaticDevisVatRate, isVatOverride]);
    useEffect(() => {
        const cannotAccessAdminView = (activeView === 'users' && !userPermissions.includes('users.view')) ||
            (activeView === 'rbac' &&
                !userPermissions.includes('roles.view') &&
                !userPermissions.includes('permissions.view')) ||
            (activeView === 'audit-logs' && !userPermissions.includes('audit_logs.view'));
        if (currentUserQuery.data && cannotAccessAdminView) {
            setActiveView('dashboard');
            setActionMessage(t("app.text0060"));
        }
    }, [activeView, currentUserQuery.data, setActionMessage, t, userPermissions]);
    useEffect(() => {
        const role = rbacRolesQuery.data?.find((item) => item.id === selectedRbacRoleId) ?? rbacRolesQuery.data?.[0];
        if (!role)
            return;
        if (role.id !== selectedRbacRoleId)
            setSelectedRbacRoleId(role.id);
        setRbacPermissionIds(role.permissions.map(({ permission }) => permission.id));
        setRbacPermissionScopes(Object.fromEntries(role.permissions.map(({ permission, scope }) => [permission.id, scope ?? 'ALL'])));
    }, [rbacRolesQuery.data, selectedRbacRoleId]);
    useEffect(() => {
        setRbacAssignedClientIds((rbacUserClientsQuery.data ?? []).map((client) => client.id));
    }, [rbacUserClientsQuery.data]);
    const reminders = filterReminders(reminderQuery.data?.data ?? [], searchTerm, reminderTypeFilter);
    const failedReminders = reminders.filter((reminder) => reminder.status === 'FAILED');
    const pendingReminders = reminders.filter((reminder) => reminder.status === 'PENDING');
    const notificationItems = [
        overdueInvoices.length
            ? {
                key: 'overdue',
                title: t('i18nDynamic.overdueInvoiceCount', { count: overdueInvoices.length }),
                description: t('i18nDynamic.amountToCollect', { amount: formatCurrency(totalUnpaid) }),
                tone: 'danger',
                view: 'invoices' as ViewKey,
                icon: AlertTriangle,
            }
            : null,
        dueSoonInvoices.length
            ? {
                key: 'due-soon',
                title: t('audit.dueSoonCount', { count: dueSoonInvoices.length }),
                description: t("app.text0061"),
                tone: 'warning',
                view: 'dashboard' as ViewKey,
                icon: CalendarClock,
            }
            : null,
        failedReminders.length
            ? {
                key: 'failed-reminders',
                title: t('audit.failedReminderCount', { count: failedReminders.length }),
                description: t("app.text0062"),
                tone: 'danger',
                view: 'reminders' as ViewKey,
                icon: Mail,
            }
            : null,
        pendingReminders.length
            ? {
                key: 'pending-reminders',
                title: t('i18nDynamic.pendingReminderCount', { count: pendingReminders.length }),
                description: t("app.text0063"),
                tone: 'info',
                view: 'reminders' as ViewKey,
                icon: Bell,
            }
            : null,
    ].filter((item): item is NotificationItem => Boolean(item));
    const notificationCount = notificationItems.length;
    const payments = paymentQuery.data?.data ?? [];
    const receivablesInvoices = receivablesAgingQuery.data?.buckets.flatMap((bucket) => bucket.invoices.map((invoice) => ({ ...invoice, bucket: bucket.label }))) ?? [];
    const handleLogin = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isValidEmail(email)) {
            setLoginValidationError(t("app.text0064"));
            return;
        }
        if (!password.trim()) {
            setLoginValidationError(t("app.text0065"));
            return;
        }
        setLoginValidationError('');
        loginMutation.mutate({ email, password, rememberMe });
    };
    const handleViewChange = (view: ViewKey) => {
        if (view === 'rbac' && !hasPermission('roles.view') && !hasPermission('permissions.view')) {
            setActiveView('dashboard');
            setActionMessage(t("app.text0060"));
            return;
        }
        const permissionByView: Partial<Record<ViewKey, string>> = {
            dashboard: 'dashboard.view',
            clients: 'clients.view',
            invoices: 'invoices.view',
            devis: 'devis.view',
            'credit-notes': 'credit_notes.view',
            payments: 'payments.view',
            reports: 'reports.view',
            reminders: 'reminders.view',
            expenses: 'expense_notes.view',
            products: 'products.view',
            users: 'users.view',
            'audit-logs': 'audit_logs.view',
            settings: 'settings.view',
        };
        if (permissionByView[view] && !hasPermission(permissionByView[view]!)) {
            setActiveView('dashboard');
            setActionMessage(t("app.text0060"));
            return;
        }
        setActiveView(view);
        setIsMobileSidebarOpen(false);
        navigateAppTo(viewPaths[view]);
        setSearchTerm('');
        if (view !== 'invoices') {
            setInvoiceStatusFilter('ALL');
            setInvoiceDateFrom('');
            setInvoiceDateTo('');
            setInvoicePage(1);
            setInvoiceSortBy('createdAt');
            setInvoiceSortOrder('desc');
        }
        if (view !== 'devis') {
            setDevisStatusFilter('ALL');
            setDevisDateFrom('');
            setDevisDateTo('');
            setDevisPage(1);
            setDevisSortBy('createdAt');
            setDevisSortOrder('desc');
        }
        if (view !== 'reminders') {
            setReminderStatusFilter('ALL');
            setReminderTypeFilter('ALL');
            setReminderPage(1);
        }
        if (view !== 'payments') {
            setPaymentMethodFilter('ALL');
            setPaymentDateFrom('');
            setPaymentDateTo('');
            setPaymentPage(1);
        }
        if (view !== 'clients') {
            resetCustomerForm();
            setCustomerPage(1);
            setCustomerSortBy('createdAt');
            setCustomerSortOrder('desc');
            setCustomerStatusFilter('ACTIVE');
        }
        if (view !== 'users') {
            resetUserForm();
            setUserPage(1);
            setUserRoleFilter('ALL');
            setUserStatusFilter('ALL');
        }
    };
    const handleSidebarToggle = () => {
        setIsSidebarCollapsed((collapsed) => {
            const nextCollapsed = !collapsed;
            localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed));
            return nextCollapsed;
        });
        setIsSidebarHovered(false);
    };
    const handleThemeToggle = () => {
        const nextTheme: ThemePreference = themePreferenceRef.current === 'dark' ? 'light' : 'dark';
        themePreferenceRef.current = nextTheme;
        persistTheme(nextTheme);
        setThemePreference(nextTheme);
        if (hasAccessToken) {
            queryClient.setQueryData<User | undefined>(['auth', 'me'], (currentUser) => currentUser ? { ...currentUser, themePreference: nextTheme } : currentUser);
            themeMutation.mutate(nextTheme);
        }
    };
    const resetInvoiceFilters = () => {
        setSearchTerm('');
        setInvoiceStatusFilter('ALL');
        setInvoiceCustomerFilter('');
        setInvoiceDateFrom('');
        setInvoiceDateTo('');
        setInvoicePage(1);
        setInvoiceSortBy('createdAt');
        setInvoiceSortOrder('desc');
    };
    const resetDevisFilters = () => {
        setSearchTerm('');
        setDevisStatusFilter('ALL');
        setDevisDateFrom('');
        setDevisDateTo('');
        setDevisPage(1);
        setDevisSortBy('createdAt');
        setDevisSortOrder('desc');
    };
    const resetReminderFilters = () => {
        setSearchTerm('');
        setReminderStatusFilter('ALL');
        setReminderTypeFilter('ALL');
        setReminderPage(1);
    };
    const resetPaymentFilters = () => {
        setSearchTerm('');
        setPaymentMethodFilter('ALL');
        setPaymentDateFrom('');
        setPaymentDateTo('');
        setPaymentPage(1);
    };
    const resetCustomerFilters = () => {
        setSearchTerm('');
        setCustomerPage(1);
        setCustomerSortBy('createdAt');
        setCustomerSortOrder('desc');
        setCustomerStatusFilter('ACTIVE');
    };
    const handleLogout = async () => {
        try {
            await logout();
        }
        catch {
            clearAuthSession();
        }
        clearAuthSession();
        setAccessToken('');
        setActiveView('dashboard');
        setActionMessage(t("app.text0066"));
        queryClient.clear();
        navigateAppTo('/login', true);
    };
    const handlePrepareReminder = (invoice: InvoiceSummary) => {
        if (!usingLiveData) {
            setActionMessage(t("app.text0067"));
            return;
        }
        reminderMutation.mutate({
            invoiceId: invoice.id,
            type: invoice.status === 'OVERDUE' ? 'AFTER_DUE' : 'BEFORE_DUE',
            sendEmail: false,
        });
    };
    const handleCreateManualReminder = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!reminderInvoiceId) {
            setActionMessage(t("app.text0068"));
            return;
        }
        reminderMutation.mutate({
            invoiceId: reminderInvoiceId,
            type: reminderDraftType,
            subject: reminderSubject || undefined,
            body: reminderBody || undefined,
            sendEmail: reminderSendEmail,
        });
    };
    const resetReminderDraft = () => {
        setReminderInvoiceId('');
        setReminderDraftType('MANUAL');
        setReminderSubject('');
        setReminderBody('');
        setReminderSendEmail(false);
    };
    const handleRecordPayment = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedInvoice)
            return;
        if (selectedInvoice.status === 'DRAFT' || selectedInvoice.status === 'CANCELLED') {
            setActionMessage(t("app.text0069"));
            return;
        }
        const amount = Number(paymentAmount);
        if (!amount || amount <= 0 || amount > selectedBalance) {
            setActionMessage(t("app.text0070"));
            return;
        }
        if (!isValidPaymentDate(paymentEntryDate)) {
            setActionMessage(t("app.text0071"));
            return;
        }
        if (!usingLiveData) {
            setActionMessage(t("app.text0072"));
            return;
        }
        paymentMutation.mutate(selectedInvoice);
    };
    const handleRecordDetailPayment = (event: FormEvent<HTMLFormElement>, invoice: Invoice) => {
        event.preventDefault();
        if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
            setActionMessage(t("app.text0069"));
            return;
        }
        const amount = Number(paymentAmount);
        const balance = Number(invoice.balanceDue);
        if (!amount || amount <= 0 || amount > balance) {
            setActionMessage(t("app.text0070"));
            return;
        }
        if (!isValidPaymentDate(paymentEntryDate)) {
            setActionMessage(t("app.text0071"));
            return;
        }
        paymentMutation.mutate(invoice);
    };
    const handleDownloadPdf = async (invoice: InvoiceSummary) => {
        if (!usingLiveData) {
            setActionMessage(t("app.text0073"));
            return;
        }
        try {
            await downloadInvoicePdf(invoice.id, invoice.number);
            setActionMessage(t("app.text0074"));
        }
        catch {
            setActionMessage(t("app.text0075"));
        }
    };
    const handleCompanyAssetUpload = (kind: CompanyAssetKind, file?: File) => {
        if (!file)
            return;
        if (!isAdmin) {
            setActionMessage(t("app.text0076"));
            return;
        }
        const allowedTypes = ['image/png', 'image/jpeg'];
        if (!allowedTypes.includes(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) {
            setActionMessage(t("app.text0077"));
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            setActionMessage(t("app.text0078"));
            return;
        }
        const previewUrl = URL.createObjectURL(file);
        setCompanyAssetDrafts((drafts) => {
            const previous = drafts[kind];
            if (previous?.previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(previous.previewUrl);
            }
            return {
                ...drafts,
                [kind]: {
                    blob: file,
                    fileName: file.name,
                    previewUrl,
                },
            };
        });
        setCompanyAssetDeletes((deletes) => ({ ...deletes, [kind]: false }));
        setCompanyForm((form) => ({
            ...form,
            [kind === 'signature' ? 'signatureUrl' : 'stampUrl']: previewUrl,
        }));
        setAssetEditor({
            kind,
            title: kind === 'signature' ? t('audit.editSignature') : t('audit.editStamp'),
            imageUrl: previewUrl,
            autoProcess: autoBackgroundRemoval,
        });
        setActionMessage(autoBackgroundRemoval
            ? t('audit.imageLoadedAuto')
            : t('audit.imageLoadedManual'));
    };
    const handleAutoBackgroundRemovalPreferenceChange = (enabled: boolean) => {
        setAutoBackgroundRemoval(enabled);
        localStorage.setItem(AUTO_BACKGROUND_REMOVAL_STORAGE_KEY, String(enabled));
        setAssetEditor((editor) => (editor ? { ...editor, autoProcess: enabled } : editor));
    };
    const handleRemoveCompanyAssetBackground = (kind: CompanyAssetKind) => {
        if (!isAdmin) {
            setActionMessage(t("app.text0076"));
            return;
        }
        const currentUrl = kind === 'signature' ? companyForm.signatureUrl : companyForm.stampUrl;
        if (!currentUrl) {
            setActionMessage(t("app.text0079"));
            return;
        }
        setAssetEditor({
            kind,
            title: kind === 'signature' ? t('audit.editSignature') : t('audit.editStamp'),
            imageUrl: currentUrl,
            autoProcess: true,
        });
    };
    const handleCompanyAssetDelete = async (kind: CompanyAssetKind) => {
        if (!isAdmin) {
            setActionMessage(t("app.text0080"));
            return;
        }
        const label = kind === 'signature' ? t('audit.signature') : t('audit.stamp');
        if (!(await confirm({
            title: t('audit.confirmDeleteAsset', { asset: label }),
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
            variant: 'danger',
        })))
            return;
        setCompanyAssetDrafts((drafts) => {
            const previous = drafts[kind];
            if (previous?.previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(previous.previewUrl);
            }
            return { ...drafts, [kind]: null };
        });
        setCompanyAssetDeletes((deletes) => ({ ...deletes, [kind]: true }));
        setCompanyForm((form) => ({
            ...form,
            [kind === 'signature' ? 'signatureUrl' : 'stampUrl']: '',
        }));
        setActionMessage(t("app.text0081"));
    };
    const handleConfirmAssetEdit = (kind: CompanyAssetKind, blob: Blob) => {
        const previewUrl = URL.createObjectURL(blob);
        setCompanyAssetDrafts((drafts) => {
            const previous = drafts[kind];
            if (previous?.previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(previous.previewUrl);
            }
            return {
                ...drafts,
                [kind]: {
                    blob,
                    fileName: `${kind}-transparent.png`,
                    previewUrl,
                },
            };
        });
        setCompanyAssetDeletes((deletes) => ({ ...deletes, [kind]: false }));
        setCompanyForm((form) => ({
            ...form,
            [kind === 'signature' ? 'signatureUrl' : 'stampUrl']: previewUrl,
        }));
        setAssetEditor(null);
        setActionMessage(t("app.text0082"));
    };
    const handleSignInvoice = async (invoice: Invoice) => {
        if (!isAdmin) {
            setActionMessage(t("app.text0083"));
            return;
        }
        if (invoice.isSigned) {
            setActionMessage(t("app.text0084"));
            return;
        }
        const settings = companySettingsQuery.data;
        if (!settings?.signatureUrl || !settings?.stampUrl) {
            setActionMessage(t("app.text0085"));
            return;
        }
        if (!(await confirm({
            title: t('i18nDynamic.confirmSignInvoice', { number: invoice.invoiceNumber }),
            confirmText: t("audit.text0121"),
            cancelText: t('common.cancel'),
            variant: 'success',
        }))) {
            return;
        }
        signInvoiceMutation.mutate(invoice.id);
    };
    const handleCancelInvoiceSignature = async (invoice: Invoice) => {
        if (!isAdmin) {
            setActionMessage(t("app.text0086"));
            return;
        }
        if (!invoice.isSigned) {
            setActionMessage(t("app.text0087"));
            return;
        }
        if (!(await confirm({
            title: t('i18nDynamic.confirmCancelInvoiceSignature', { number: invoice.invoiceNumber }),
            confirmText: t("audit.text0119"),
            cancelText: t('common.cancel'),
            variant: 'warning',
        }))) {
            return;
        }
        cancelInvoiceSignatureMutation.mutate(invoice.id);
    };
    const handlePrintInvoicePdf = async (invoice: Invoice) => {
        try {
            await printInvoicePdf(invoice.id);
            setActionMessage(t("app.text0088"));
        }
        catch {
            setActionMessage(t("app.text0089"));
        }
    };
    const fetchAllInvoicesForExport = async () => {
        const firstPage = await getInvoices({
            page: 1,
            limit: EXPORT_PAGE_SIZE,
            search: searchTerm || undefined,
            status: invoiceStatusFilter === 'ALL' ? undefined : invoiceStatusFilter,
            customerId: invoiceCustomerFilter || undefined,
            dateFrom: invoiceDateFrom || undefined,
            dateTo: invoiceDateTo || undefined,
            sortBy: invoiceSortBy,
            sortOrder: invoiceSortOrder,
        });
        const data = [...firstPage.data];
        for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
            const nextPage = await getInvoices({
                page,
                limit: EXPORT_PAGE_SIZE,
                search: searchTerm || undefined,
                status: invoiceStatusFilter === 'ALL' ? undefined : invoiceStatusFilter,
                customerId: invoiceCustomerFilter || undefined,
                dateFrom: invoiceDateFrom || undefined,
                dateTo: invoiceDateTo || undefined,
                sortBy: invoiceSortBy,
                sortOrder: invoiceSortOrder,
            });
            data.push(...nextPage.data);
        }
        return data;
    };
    const fetchAllCustomersForExport = async () => {
        const firstPage = await getCustomers({
            page: 1,
            limit: EXPORT_PAGE_SIZE,
            search: searchTerm || undefined,
            isActive: customerStatusFilter === 'ALL' ? undefined : customerStatusFilter === 'ACTIVE',
            sortBy: customerSortBy,
            sortOrder: customerSortOrder,
        });
        const data = [...firstPage.data];
        for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
            const nextPage = await getCustomers({
                page,
                limit: EXPORT_PAGE_SIZE,
                search: searchTerm || undefined,
                isActive: customerStatusFilter === 'ALL' ? undefined : customerStatusFilter === 'ACTIVE',
                sortBy: customerSortBy,
                sortOrder: customerSortOrder,
            });
            data.push(...nextPage.data);
        }
        return data;
    };
    const fetchAllRemindersForExport = async () => {
        const firstPage = await getReminders({
            page: 1,
            limit: EXPORT_PAGE_SIZE,
            status: reminderStatusFilter === 'ALL' ? undefined : reminderStatusFilter,
            type: reminderTypeFilter === 'ALL' ? undefined : reminderTypeFilter,
            search: searchTerm || undefined,
        });
        const data = [...firstPage.data];
        for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
            const nextPage = await getReminders({
                page,
                limit: EXPORT_PAGE_SIZE,
                status: reminderStatusFilter === 'ALL' ? undefined : reminderStatusFilter,
                type: reminderTypeFilter === 'ALL' ? undefined : reminderTypeFilter,
                search: searchTerm || undefined,
            });
            data.push(...nextPage.data);
        }
        return data;
    };
    const handleExportInvoices = async () => {
        setExportingTarget('invoices');
        try {
            const exportedInvoices = await fetchAllInvoicesForExport();
            if (!exportedInvoices.length) {
                setActionMessage(t("app.text0090"));
                return;
            }
            const rows = exportedInvoices.map((invoice) => ({
                facture: invoice.invoiceNumber,
                client: invoice.customer?.company ?? invoice.customer?.name ?? '',
                statut: getStatusLabel(invoice.status),
                emission: invoice.issueDate,
                echeance: invoice.dueDate,
                total: Number(invoice.total),
                paye: Number(invoice.amountPaid),
                solde: Number(invoice.balanceDue),
            }));
            downloadCsv(t('i18nDynamic.invoicesCsvFileName', { date: getToday() }), rows);
            setActionMessage(t('audit.exportedInvoices', { count: rows.length }));
        }
        catch {
            setActionMessage(t("app.text0091"));
        }
        finally {
            setExportingTarget('');
        }
    };
    const handleExportInvoicesExcel = async () => {
        setExportingTarget('invoices-excel');
        try {
            await downloadInvoicesExcel({
                search: searchTerm || undefined,
                status: invoiceStatusFilter === 'ALL' ? undefined : invoiceStatusFilter,
                customerId: invoiceCustomerFilter || undefined,
                dateFrom: invoiceDateFrom || undefined,
                dateTo: invoiceDateTo || undefined,
                sortBy: invoiceSortBy,
                sortOrder: invoiceSortOrder,
            });
            setActionMessage(t("app.text0420"));
        }
        catch {
            setActionMessage(t("app.text0421"));
        }
        finally {
            setExportingTarget('');
        }
    };
    const handleExportCustomers = async () => {
        setExportingTarget('customers');
        try {
            const exportedCustomers = await fetchAllCustomersForExport();
            if (!exportedCustomers.length) {
                setActionMessage(t("app.text0092"));
                return;
            }
            const rows = exportedCustomers.map((customer) => ({
                nom: customer.name,
                entreprise: customer.company ?? '',
                email: customer.email,
                telephone: customer.phone ?? '',
                ville: customer.city ?? '',
                identifiantFiscal: customer.taxNumber ?? '',
                adresse: customer.address ?? '',
                factures: customer._count?.invoices ?? 0,
            }));
            downloadCsv(t('i18nDynamic.clientsCsvFileName', { date: getToday() }), rows);
            setActionMessage(t('audit.exportedCustomers', { count: rows.length }));
        }
        catch {
            setActionMessage(t("app.text0093"));
        }
        finally {
            setExportingTarget('');
        }
    };
    const handleExportReminders = async () => {
        setExportingTarget('reminders');
        try {
            const exportedReminders = await fetchAllRemindersForExport();
            if (!exportedReminders.length) {
                setActionMessage(t("app.text0094"));
                return;
            }
            const rows = exportedReminders.map((reminder) => ({
                sujet: reminder.subject,
                destinataire: reminder.recipientEmail,
                statut: reminder.status,
                type: reminder.type,
                facture: reminder.invoice?.invoiceNumber ?? '',
                client: reminder.invoice?.customer?.company ?? reminder.invoice?.customer?.name ?? '',
                solde: reminder.invoice ? Number(reminder.invoice.balanceDue) : '',
                date: reminder.sentAt ?? reminder.createdAt,
            }));
            downloadCsv(t('i18nDynamic.remindersCsvFileName', { date: getToday() }), rows);
            setActionMessage(t('audit.exportedReminders', { count: rows.length }));
        }
        catch {
            setActionMessage(t("app.text0095"));
        }
        finally {
            setExportingTarget('');
        }
    };
    const handleExportReceivablesReport = async () => {
        setExportingTarget('reports');
        try {
            const report = receivablesAgingQuery.data ?? (await getReceivablesAgingReport());
            const rows = report.buckets.flatMap((bucket) => bucket.invoices.map((invoice) => ({
                facture: invoice.invoiceNumber,
                client: invoice.customer,
                tranche: bucket.label,
                echeance: invoice.dueDate,
                joursRetard: invoice.daysLate,
                statut: getStatusLabel(invoice.status),
                solde: invoice.balanceDue,
                devise: invoice.currency,
            })));
            if (!rows.length) {
                setActionMessage(t("app.text0096"));
                return;
            }
            downloadCsv(t('i18nDynamic.receivablesCsvFileName', { date: getToday() }), rows);
            setActionMessage(t('audit.exportedReportRows', { count: rows.length }));
        }
        catch {
            setActionMessage(t("app.text0097"));
        }
        finally {
            setExportingTarget('');
        }
    };
    const handleExportTaxReport = async () => {
        setExportingTarget('tax-report');
        try {
            const report = taxSummaryQuery.data ??
                (await getTaxSummaryReport({
                    dateFrom: reportDateFrom || undefined,
                    dateTo: reportDateTo || undefined,
                }));
            const rows = report.invoices.map((invoice) => ({
                facture: invoice.invoiceNumber,
                client: invoice.customer,
                dateEmission: invoice.issueDate,
                statut: getStatusLabel(invoice.status),
                ht: invoice.subtotal,
                remise: invoice.discount,
                tauxTva: invoice.taxRate,
                tva: invoice.taxAmount,
                ttc: invoice.total,
                encaisse: invoice.amountPaid,
                resteDu: invoice.balanceDue,
                devise: invoice.currency,
            }));
            if (!rows.length) {
                setActionMessage(t("app.text0098"));
                return;
            }
            downloadCsv(t('i18nDynamic.taxCsvFileName', {
                from: reportDateFrom || t('i18nDynamic.startDateSlug'),
                to: reportDateTo || getToday(),
            }), rows);
            setActionMessage(t('audit.exportedInvoices', { count: rows.length }));
        }
        catch {
            setActionMessage(t("app.text0099"));
        }
        finally {
            setExportingTarget('');
        }
    };
    const handleCreateCustomer = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!customerName.trim() || !customerEmail.trim()) {
            setActionMessage(t("app.text0100"));
            return;
        }
        if (!customerCountryCode) {
            setActionMessage(t("app.text0101"));
            return;
        }
        if (!hasAccessToken) {
            setActionMessage(t("app.text0102"));
            return;
        }
        customerMutation.mutate();
    };
    const handleCustomerCountryChange = (value: string) => {
        setCustomerCountrySearch(value);
        const option = countryOptions.find((country) => country.label === value);
        setCustomerCountryCode(option?.code ?? '');
    };
    const handleProductSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isAdmin) {
            setActionMessage(t("app.text0103"));
            return;
        }
        if (!productName.trim() || productUnitPrice < 0) {
            setActionMessage(t("app.text0104"));
            return;
        }
        productMutation.mutate();
    };
    const handleUserSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isAdmin) {
            setActionMessage(t("app.text0105"));
            return;
        }
        if (!userName.trim() || !isValidEmail(userEmail)) {
            setActionMessage(t("app.text0106"));
            return;
        }
        if (!editingUserId && userPassword.length < 8) {
            setActionMessage(t("app.text0107"));
            return;
        }
        userMutation.mutate();
    };
    const handleCompanySettingsSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isAdmin) {
            setActionMessage(t("app.text0108"));
            return;
        }
        settingsMutation.mutate();
    };
    const handlePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!currentPassword || newPassword.length < 8) {
            setActionMessage(t("app.text0109"));
            return;
        }
        if (newPassword !== confirmNewPassword) {
            setActionMessage(t("app.text0110"));
            return;
        }
        if (currentPassword === newPassword) {
            setActionMessage(t("app.text0111"));
            return;
        }
        passwordMutation.mutate();
    };
    const handleEditCustomer = (customer: Customer) => {
        setEditingCustomerId(customer.id);
        setCustomerName(customer.name);
        setCustomerEmail(customer.email);
        setCustomerCompany(customer.company ?? '');
        setCustomerPhone(customer.phone ?? '');
        setCustomerCity(customer.city ?? '');
        const countryCode = normalizeCountryCode(customer.countryCode ?? 'MA');
        setCustomerCountryCode(countryCode);
        setCustomerCountrySearch(getCountryLabel(countryCode));
        setCustomerAddress(customer.address ?? '');
        setCustomerTaxNumber(customer.taxNumber ?? '');
    };
    const openInvoiceEmailModal = (invoice: Invoice) => {
        const customerName = invoice.customer?.company ?? invoice.customer?.name ?? t('auditFinal.clientFallback');
        setEmailInvoiceId(invoice.id);
        setInvoiceEmailRecipient(invoice.customer?.email ?? '');
        setInvoiceEmailSubject(t('i18nDynamic.invoiceEmailSubject', { number: invoice.invoiceNumber }));
        setInvoiceEmailMessage([
            t('i18nDynamic.invoiceEmailGreeting', { name: customerName }),
            '',
            t('i18nDynamic.invoiceEmailIntro', { number: invoice.invoiceNumber }),
            t('i18nDynamic.invoiceEmailTotal', { amount: formatCurrency(Number(invoice.total), invoice.currency) }),
            t('i18nDynamic.invoiceEmailBalance', { amount: formatCurrency(Number(invoice.balanceDue), invoice.currency) }),
            t('i18nDynamic.invoiceEmailDueDate', { date: formatShortDate(invoice.dueDate) }),
            '',
            t('i18nDynamic.invoiceEmailClosing'),
        ].join('\n'));
    };
    const closeInvoiceEmailModal = () => {
        setEmailInvoiceId('');
        setInvoiceEmailRecipient('');
        setInvoiceEmailSubject('');
        setInvoiceEmailMessage('');
    };
    const handleSendInvoiceEmail = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!emailInvoiceId)
            return;
        if (!isValidEmail(invoiceEmailRecipient)) {
            setActionMessage(t("app.text0112"));
            return;
        }
        if (invoiceEmailSubject.trim().length < 3 || invoiceEmailMessage.trim().length < 3) {
            setActionMessage(t("app.text0113"));
            return;
        }
        invoiceEmailMutation.mutate();
    };
    const handleDeleteCustomer = async (customer: Customer) => {
        if (!isAdmin) {
            setActionMessage(t("app.text0114"));
            return;
        }
        const invoiceCount = customer._count?.invoices ?? 0;
        if (invoiceCount > 0) {
            setActionMessage(t('audit.customerHasInvoices', { count: invoiceCount }));
            return;
        }
        const label = customer.company ?? customer.name;
        if (!(await confirm({
            title: t('audit.confirmDeleteCustomer', { name: label }),
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
            variant: 'danger',
        }))) {
            return;
        }
        deleteCustomerMutation.mutate(customer.id);
    };
    const handleEditProduct = (product: {
        id: string;
        name: string;
        description?: string;
        unit?: string;
        unitPrice: number;
        taxRate: number;
        isActive: boolean;
    }) => {
        setEditingProductId(product.id);
        setProductName(product.name);
        setProductDescription(product.description ?? '');
        setProductUnit(product.unit ?? '');
        setProductUnitPrice(Number(product.unitPrice));
        setProductTaxRate(Number(product.taxRate));
        setProductIsActive(product.isActive);
        setActionMessage(t('i18nDynamic.editingProduct', { name: product.name }));
    };
    const handleEditUser = (user: User) => {
        setEditingUserId(user.id);
        setUserName(user.name);
        setUserEmail(user.email);
        setUserPassword('');
        setUserRole(normalizeRole(user.role) ?? 'EMPLOYEE');
        setUserIsActive(user.isActive);
        setActionMessage(t('i18nDynamic.editingUser', { name: user.name }));
    };
    const handleToggleUserStatus = (user: User) => {
        if (user.id === currentUserQuery.data?.id && user.isActive) {
            setActionMessage(t("app.text0115"));
            return;
        }
        updateUser(user.id, { isActive: !user.isActive })
            .then(() => {
            setActionMessage(t("app.text0116"));
            queryClient.invalidateQueries({ queryKey: ['users'] });
        })
            .catch(() => setActionMessage(t("app.text0117")));
    };
    const handleCreateInvoiceForCustomer = (customer: Customer) => {
        setInvoiceCustomerId(customer.id);
        setIsInvoiceFormOpen(true);
        setActiveView('invoices');
        setViewCustomerId('');
        setActionMessage(t('i18nDynamic.newInvoiceForCustomer', { name: formatCustomerName(customer) }));
    };
    const resetCustomerForm = () => {
        setEditingCustomerId('');
        setCustomerName('');
        setCustomerEmail('');
        setCustomerCompany('');
        setCustomerPhone('');
        setCustomerCity('');
        setCustomerCountryCode('MA');
        setCustomerCountrySearch(getCountryLabel('MA'));
        setCustomerAddress('');
        setCustomerTaxNumber('');
    };
    const resetProductForm = () => {
        setEditingProductId('');
        setProductName('');
        setProductDescription('');
        setProductUnit('forfait');
        setProductUnitPrice(0);
        setProductTaxRate(20);
        setProductIsActive(true);
    };
    const resetUserForm = () => {
        setEditingUserId('');
        setUserName('');
        setUserEmail('');
        setUserPassword('');
        setUserRole('EMPLOYEE');
        setUserIsActive(true);
    };
    const resetInvoiceForm = () => {
        setEditingInvoiceId('');
        setInvoiceCustomerId(customerQuery.data?.data[0]?.id ?? '');
        setInvoiceStatus('DRAFT');
        setInvoiceIssueDate(getToday());
        setInvoiceDueDate(getDateAfterDays(30));
        setInvoiceTaxRate(automaticVatRate);
        setIsVatOverride(false);
        setInvoiceVatOverrideReason('');
        setInvoiceDiscount(0);
        setInvoiceNotes('');
        setInvoiceTerms(t("audit.text0002"));
        setInvoiceItems([
            { description: t("app.text0027"), unit: 'forfait', quantity: 1, unitPrice: 1000, taxRate: automaticVatRate },
        ]);
    };
    const resetDevisForm = () => {
        setEditingDevisId('');
        setDevisCustomerId(customerQuery.data?.data[0]?.id ?? '');
        setDevisStatus('DRAFT');
        setDevisIssueDate(getToday());
        setDevisValidUntil(getDateAfterDays(30));
        setDevisTaxRate(automaticDevisVatRate);
        setIsVatOverride(false);
        setDevisVatOverrideReason('');
        setDevisDiscount(0);
        setDevisNotes('');
        setDevisTerms(t("audit.text0002"));
        setDevisItems([
            { description: t("app.text0027"), unit: 'forfait', quantity: 1, unitPrice: 1000, taxRate: automaticDevisVatRate, discount: 0 },
        ]);
    };
    const handleOpenInvoiceForm = () => {
        if (!hasAccessToken) {
            setActionMessage(t("app.text0118"));
            return;
        }
        setIsInvoiceFormOpen(true);
    };
    const handleOpenDevisForm = () => {
        if (!hasAccessToken) {
            setActionMessage(t("app.text0118"));
            return;
        }
        setIsDevisFormOpen(true);
        setActiveView('devis');
        navigateAppTo(viewPaths.devis);
    };
    const handleEditInvoice = (invoice: Invoice) => {
        if (invoice.status !== 'DRAFT') {
            setActionMessage(t("app.text0119"));
            return;
        }
        setEditingInvoiceId(invoice.id);
        setInvoiceCustomerId(invoice.customerId);
        setInvoiceStatus('DRAFT');
        setInvoiceIssueDate(invoice.issueDate.slice(0, 10));
        setInvoiceDueDate(invoice.dueDate.slice(0, 10));
        setInvoiceTaxRate(Number(invoice.taxRate));
        setIsVatOverride(Boolean(invoice.vatOverridden));
        setInvoiceVatOverrideReason(invoice.vatOverrideReason ?? '');
        setInvoiceDiscount(Number(invoice.discount));
        setInvoiceNotes(invoice.notes ?? '');
        setInvoiceTerms(invoice.terms ?? '');
        setInvoiceItems((invoice.items ?? []).map((item) => ({
            description: item.description,
            unit: item.unit ?? '',
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate),
        })));
        setIsInvoiceFormOpen(true);
        setActiveView('invoices');
        setViewInvoiceId('');
        setActionMessage(t('i18nDynamic.editingInvoice', { number: invoice.invoiceNumber }));
    };
    const handleEditDevis = (devis: Devis) => {
        if (devis.status !== 'DRAFT') {
            setActionMessage(t('devis.onlyDraftEditable'));
            return;
        }
        setEditingDevisId(devis.id);
        setDevisCustomerId(devis.customerId);
        setDevisStatus('DRAFT');
        setDevisIssueDate(devis.issueDate.slice(0, 10));
        setDevisValidUntil(devis.validUntil.slice(0, 10));
        setDevisTaxRate(Number(devis.taxRate));
        setIsVatOverride(Boolean(devis.vatOverridden));
        setDevisVatOverrideReason(devis.vatOverrideReason ?? '');
        setDevisDiscount(Number(devis.discount));
        setDevisNotes(devis.notes ?? '');
        setDevisTerms(devis.terms ?? '');
        setDevisItems((devis.items ?? []).map((item) => ({
            description: item.description,
            unit: item.unit ?? '',
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            discount: Number(item.discount),
            taxRate: Number(item.taxRate),
        })));
        setIsDevisFormOpen(true);
        setActiveView('devis');
        setViewDevisId('');
        setActionMessage(t('devis.editing', { number: devis.devisNumber }));
    };
    const handleInvoiceItemChange = (index: number, field: keyof InvoiceDraftItem, value: string | number) => {
        setInvoiceItems((items) => items.map((item, itemIndex) => itemIndex === index
            ? {
                ...item,
                [field]: field === 'description' || field === 'unit' ? value : Number(value),
            }
            : item));
    };
    const handleAddInvoiceItem = () => {
        setInvoiceItems((items) => [
            ...items,
            { description: '', unit: 'unite', quantity: 1, unitPrice: 0, taxRate: effectiveVatRate },
        ]);
    };
    const handleRemoveInvoiceItem = (index: number) => {
        setInvoiceItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
    };
    const handleApplyProductToInvoiceItem = (index: number, productId: string) => {
        const product = productQuery.data?.data.find((item) => item.id === productId);
        if (!product)
            return;
        setInvoiceItems((items) => items.map((item, itemIndex) => itemIndex === index
            ? {
                ...item,
                description: product.description || product.name,
                unit: product.unit ?? item.unit,
                unitPrice: Number(product.unitPrice),
                taxRate: effectiveVatRate,
            }
            : item));
    };
    const handleDevisItemChange = (index: number, field: keyof DevisDraftItem, value: string | number) => {
        setDevisItems((items) => items.map((item, itemIndex) => itemIndex === index
            ? {
                ...item,
                [field]: field === 'description' || field === 'unit' ? value : Number(value),
            }
            : item));
    };
    const handleAddDevisItem = () => {
        setDevisItems((items) => [
            ...items,
            { description: '', unit: 'unite', quantity: 1, unitPrice: 0, taxRate: effectiveDevisVatRate, discount: 0 },
        ]);
    };
    const handleRemoveDevisItem = (index: number) => {
        setDevisItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
    };
    const handleApplyProductToDevisItem = (index: number, productId: string) => {
        const product = productQuery.data?.data.find((item) => item.id === productId);
        if (!product)
            return;
        setDevisItems((items) => items.map((item, itemIndex) => itemIndex === index
            ? {
                ...item,
                description: product.description || product.name,
                unit: product.unit ?? item.unit,
                unitPrice: Number(product.unitPrice),
                taxRate: effectiveDevisVatRate,
            }
            : item));
    };
    const handleCreateInvoice = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!invoiceCustomerId) {
            setActionMessage(t("app.text0120"));
            return;
        }
        if (invoiceItems.some((item) => !item.description.trim() || item.quantity <= 0)) {
            setActionMessage(t("app.text0121"));
            return;
        }
        if (isVatOverride && !isAdmin) {
            setActionMessage(t("app.text0122"));
            return;
        }
        if (isVatOverride && !invoiceVatOverrideReason.trim()) {
            setActionMessage(t("app.text0123"));
            return;
        }
        invoiceMutation.mutate();
    };
    const handleCreateDevis = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!devisCustomerId) {
            setActionMessage(t("app.text0120"));
            return;
        }
        if (devisItems.some((item) => !item.description.trim() || item.quantity <= 0 || item.unitPrice < 0 || item.discount < 0)) {
            setActionMessage(t('devis.invalidItems'));
            return;
        }
        if (new Date(devisValidUntil) < new Date(devisIssueDate)) {
            setActionMessage(t('devis.invalidDates'));
            return;
        }
        if (isVatOverride && !isAdmin) {
            setActionMessage(t("app.text0122"));
            return;
        }
        if (isVatOverride && !devisVatOverrideReason.trim()) {
            setActionMessage(t("app.text0123"));
            return;
        }
        devisMutation.mutate();
    };
    const handleDeleteDraftDevis = useCallback(async () => {
        if (await confirm({
            title: t('devis.confirmDeleteDrafts'),
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
            variant: 'danger',
        })) {
            deleteDraftDevisMutation.mutate();
        }
    }, [confirm, deleteDraftDevisMutation, t]);
    const handleConfirmedDevisAction = useCallback(async (devis: Devis, action: 'delete' | 'reject' | 'convert' | 'sign' | 'cancelSignature') => {
        const options = {
            delete: {
                title: t('devis.confirmDelete', { number: devis.devisNumber }),
                confirmText: t('common.delete'),
                variant: 'danger' as const,
            },
            reject: {
                title: t('devis.confirmReject'),
                confirmText: t('devis.reject'),
                variant: 'warning' as const,
            },
            convert: {
                title: t('devis.confirmConvert'),
                confirmText: t('devis.createInvoice'),
                variant: 'success' as const,
            },
            sign: {
                title: t('devis.confirmSign', { number: devis.devisNumber }),
                confirmText: t('devis.sign'),
                variant: 'success' as const,
            },
            cancelSignature: {
                title: t('devis.confirmCancelSignature'),
                confirmText: t('devis.cancelSignature'),
                variant: 'warning' as const,
            },
        }[action];
        if (await confirm({
            ...options,
            cancelText: t('common.cancel'),
        })) {
            devisActionMutation.mutate({ devisId: devis.id, action });
        }
    }, [confirm, devisActionMutation, t]);
    const handleDeleteRbacRole = useCallback(async (role: { id: string; name: string }) => {
        if (await confirm({
            title: t('i18nDynamic.confirmDeleteRole', { name: role.name }),
            confirmText: t('common.delete'),
            cancelText: t('common.cancel'),
            variant: 'danger',
        })) {
            deleteRbacRole(role.id)
                .then(() => queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] }))
                .catch((error) => setActionMessage(getApiErrorMessage(error, t("audit.text0066"))));
        }
    }, [confirm, queryClient, setActionMessage, t]);
    const loginErrorMessage = loginValidationError ||
        (loginMutation.isError
            ? getApiErrorMessage(loginMutation.error, t("audit.text0022"))
            : '');
    if (currentPath.startsWith('/contracts/sign/')) {
        return <PublicContractSignaturePage token={decodeURIComponent(currentPath.replace('/contracts/sign/', ''))}/>;
    }
    if (isAuthBootstrapping || (hasAccessToken && currentUserQuery.isLoading)) {
        return <AuthLoadingScreen themePreference={themePreference}/>;
    }
    if (!hasAccessToken || !currentUserQuery.data) {
        return (<LoginPage email={email} errorMessage={loginErrorMessage} isPending={loginMutation.isPending} onEmailChange={(value) => {
                setEmail(value);
                setLoginValidationError('');
            }} onLogin={handleLogin} onPasswordChange={(value) => {
                setPassword(value);
                setLoginValidationError('');
            }} onRememberMeChange={setRememberMe} onShowPasswordToggle={() => setShowPassword((isVisible) => !isVisible)} onThemeToggle={handleThemeToggle} password={password} rememberMe={rememberMe} showPassword={showPassword} themePreference={themePreference}/>);
    }
    const currentLanguage = reactI18n.resolvedLanguage || reactI18n.language || "en";
    const isRTL = currentLanguage.startsWith("ar");
    return (<main className={`app-shell min-h-screen bg-slate-50 text-slate-950 ${isRTL ? 'app-rtl' : 'app-ltr'} ${isSidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <datalist id="country-options">
        {countryOptions.map((country) => (<option key={country.code} value={country.label}/>))}
      </datalist>
      {isMobileSidebarOpen ? (<button aria-label={t("app.text0124")} className="sidebar-overlay fixed inset-0 z-40 bg-slate-950/55 lg:hidden" onClick={() => setIsMobileSidebarOpen(false)} type="button"/>) : null}

      <aside aria-label={t("app.text0125")} className={`app-sidebar fixed inset-y-0 z-50 flex flex-col border-slate-200 px-3 py-5 lg:z-20 lg:flex ${isRTL ? 'right-0 border-l' : 'left-0 border-r'} ${isMobileSidebarOpen ? 'app-sidebar-mobile-open' : 'app-sidebar-mobile-closed'} ${isSidebarExpanded ? 'app-sidebar-expanded' : 'app-sidebar-collapsed'}`} onMouseEnter={() => {
            if (isSidebarCollapsed)
                setIsSidebarHovered(true);
        }} onMouseLeave={() => setIsSidebarHovered(false)}>
        <div className="brand-lockup flex min-h-10 items-center gap-3 px-2">
          <div className="brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">{t("app.text0126")}</div>
          <div className={`sidebar-label min-w-0 transition-opacity duration-300 ${isSidebarExpanded ? 'opacity-100' : 'pointer-events-none w-0 opacity-0'}`}>
            <p className="brand-name text-sm font-semibold">{t("app.text0127")}</p>
            <p className="brand-subtitle text-xs text-slate-500">{t("app.text0128")}</p>
          </div>
          <button aria-label={isSidebarCollapsed ? t("audit.text0023") : t("audit.text0024")} className={`sidebar-toggle hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary/70 lg:inline-flex ${isRTL ? 'mr-auto' : 'ml-auto'}`} onClick={handleSidebarToggle} title={isSidebarCollapsed ? t("audit.text0023") : t("audit.text0024")} type="button">
            {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4"/> : <PanelLeftClose className="h-4 w-4"/>}
          </button>
        </div>

        <nav aria-label={t("app.text0129")} className="nav-menu mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 text-sm">
          {visibleNavItems.map(({ key, label: labelKey, icon: Icon }) => (<button aria-label={t(labelKey)} className={`nav-item sidebar-nav-item flex h-10 w-full items-center rounded-md font-medium transition ${isRTL ? 'text-right' : 'text-left'} ${isSidebarExpanded ? 'gap-3 px-3' : 'justify-center px-2'} ${activeView === key
                ? 'nav-item-active bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'}`} data-tooltip={t(labelKey)} key={key} onClick={() => handleViewChange(key)} title={t(labelKey)} type="button">
              <Icon className="h-4 w-4 shrink-0"/>
              <span className={`sidebar-label overflow-hidden whitespace-nowrap transition-all duration-300 ${isSidebarExpanded ? 'max-w-40 opacity-100' : 'pointer-events-none max-w-0 opacity-0'}`}>
                {t(labelKey)}
              </span>
            </button>))}
        </nav>

      </aside>

      <section className="app-main">
        <header className="app-header sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur md:px-8">
          <div className="header-row flex min-w-0 items-center gap-2">
              <button aria-label={t("app.text0130")} className="icon-button lg:hidden" onClick={() => setIsMobileSidebarOpen(true)} title={t("app.text0130")} type="button">
                <Menu className="h-4 w-4"/>
              </button>
              <div className="search-shell header-search relative min-w-0 flex-1">
                <Search className={`pointer-events-none absolute top-2.5 h-4 w-4 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`}/>
                <input aria-label={t("audit.searchAria", { section: t(activeViewMeta.title) })} className={`h-9 w-full rounded-md border border-slate-200 bg-white text-sm outline-none ring-primary/20 transition focus:ring-4 ${isRTL ? 'pl-3 pr-9 text-right' : 'pl-9 pr-3'}`} onChange={(event) => setSearchTerm(event.target.value)} placeholder={getSearchPlaceholder(activeView)} type="search" value={searchTerm}/>
              </div>
              <span className="status-pill hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline-flex">
                {hasAccessToken ? t("audit.text0025") : t("audit.text0026")}
              </span>
              {actionMessage ? (<span className="header-message hidden max-w-48 truncate text-xs font-medium text-primary xl:inline">
                  {actionMessage}
                </span>) : null}
              <LanguageSwitcher compact className="h-9 min-w-16 px-2.5"/>
              <button aria-label={themePreference === 'dark' ? t("audit.text0027") : t("audit.text0028")} aria-pressed={themePreference === 'dark'} className="icon-button" onClick={handleThemeToggle} title={themePreference === 'dark' ? t("audit.text0029") : t("audit.text0030")} type="button">
                {themePreference === 'dark' ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
              </button>
              <div className="notification-menu relative shrink-0" ref={notificationMenuRef}>
                <button aria-expanded={isNotificationMenuOpen} aria-haspopup="menu" className="icon-button notification-trigger" onClick={() => {
            setIsNotificationMenuOpen((isOpen) => !isOpen);
            setIsProfileMenuOpen(false);
        }} title={t("app.text0131")} type="button">
                  <Bell className="h-4 w-4"/>
                  {notificationCount ? (<span className="notification-badge">{notificationCount}</span>) : null}
                </button>
                <div className={`notification-dropdown ${isNotificationMenuOpen ? 'notification-dropdown-open' : ''}`}>
                  <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <div className="flex items-center justify-between px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{t("app.text0131")}</p>
                        <p className="text-xs text-slate-500">{t("app.text0132")}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        {notificationCount}
                      </span>
                    </div>
                    <div className="mt-1 max-h-80 overflow-y-auto">
                      {notificationItems.length ? (notificationItems.map((item) => {
            const Icon = item.icon;
            return (<button className={`notification-item notification-item-${item.tone}`} key={item.key} onClick={() => {
                    handleViewChange(item.view);
                    setIsNotificationMenuOpen(false);
                }} type="button">
                              <span className="notification-item-icon">
                                <Icon className="h-4 w-4"/>
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-slate-900">
                                  {item.title}
                                </span>
                                <span className={`mt-0.5 block text-xs text-slate-500 ${isRTL ? 'text-right' : 'text-left'}`}>
                                  {item.description}
                                </span>
                              </span>
                            </button>);
        })) : (<div className="px-3 py-6 text-center">
                          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500"/>
                          <p className="mt-2 text-sm font-semibold text-slate-900">{t("app.text0133")}</p>
                          <p className="mt-1 text-xs text-slate-500">{t("app.text0134")}</p>
                        </div>)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="profile-menu relative shrink-0" ref={profileMenuRef}>
                <button aria-expanded={isProfileMenuOpen} aria-haspopup="menu" className="profile-trigger" onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)} title={t("app.text0135")} type="button">
                  <span className="avatar h-8 w-8 rounded-full">
                    {getInitials(currentUserQuery.data?.name ?? email)}
                  </span>
                  <span className="hidden min-w-0 leading-tight md:block">
                    <span className="block max-w-28 truncate text-xs font-semibold text-slate-900">
                      {currentUserQuery.data?.name ?? t('auditFinal.userFallback')}
                    </span>
                    <span className="block text-[11px] font-medium text-slate-500">
                      {t(`auditFinal.userRole.${currentUserQuery.data?.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE'}`)}
                    </span>
                  </span>
                </button>
                <div className={`profile-dropdown ${isProfileMenuOpen ? 'profile-dropdown-open' : ''}`}>
                  <AuthPanel className="auth-card rounded-2xl border border-slate-200 bg-slate-50 p-3" email={email} hasAccessToken={hasAccessToken} isError={loginMutation.isError} isPending={loginMutation.isPending} onEmailChange={setEmail} onLogin={handleLogin} onLogout={() => {
            handleLogout();
            setIsProfileMenuOpen(false);
        }} onPasswordChange={setPassword} password={password} user={currentUserQuery.data}/>
                </div>
              </div>
              {activeView !== 'expenses' && activeView !== 'credit-notes' ? (<button className="primary-action inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white shadow-sm transition hover:bg-primary/90" onClick={activeView === 'devis' ? handleOpenDevisForm : handleOpenInvoiceForm} type="button">
                <FilePlus2 className="h-4 w-4"/>
                <span className="hidden sm:inline">{activeView === 'devis' ? t('devis.create') : t("app.text0136")}</span>
              </button>) : null}
          </div>
        </header>

        {activeView === 'invoices' ? (<section className="view-filter-bar flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 md:px-8">
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceStatusFilter(event.target.value as InvoiceStatus | 'ALL')} value={invoiceStatusFilter}>
              <option value="ALL">{t("app.text0137")}</option>
              {Object.entries(statusLabelKeys).map(([status, labelKey]) => (<option key={status} value={status}>
                  {t(labelKey)}
                </option>))}
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceCustomerFilter(event.target.value)} value={invoiceCustomerFilter}>
              <option value="">{t("app.text0419")}</option>
              {(customerQuery.data?.data ?? []).map((customer) => (<option key={customer.id} value={customer.id}>
                  {customer.company ?? customer.name}
                </option>))}
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceDateFrom(event.target.value)} title={t("app.text0138")} type="date" value={invoiceDateFrom}/>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceDateTo(event.target.value)} title={t("app.text0139")} type="date" value={invoiceDateTo}/>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceSortBy(event.target.value as InvoiceSortField)} value={invoiceSortBy}>
              <option value="createdAt">{t("app.text0140")}</option>
              <option value="issueDate">{t("app.text0141")}</option>
              <option value="dueDate">{t("app.text0142")}</option>
              <option value="total">{t("app.text0143")}</option>
              <option value="balanceDue">{t("app.text0144")}</option>
              <option value="invoiceNumber">{t("app.text0145")}</option>
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceSortOrder(event.target.value as 'asc' | 'desc')} value={invoiceSortOrder}>
              <option value="desc">{t("app.text0146")}</option>
              <option value="asc">{t("app.text0147")}</option>
            </select>
            <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetInvoiceFilters} type="button">{t("app.text0148")}</button>
          </section>) : null}

        {activeView === 'devis' ? (<section className="view-filter-bar flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 md:px-8">
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisStatusFilter(event.target.value as DevisStatus | 'ALL')} value={devisStatusFilter}>
              <option value="ALL">{t("app.text0137")}</option>
              {Object.entries(devisStatusLabelKeys).map(([status, labelKey]) => (<option key={status} value={status}>
                  {t(labelKey)}
                </option>))}
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisDateFrom(event.target.value)} title={t("app.text0138")} type="date" value={devisDateFrom}/>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisDateTo(event.target.value)} title={t("app.text0139")} type="date" value={devisDateTo}/>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisSortBy(event.target.value as DevisSortField)} value={devisSortBy}>
              <option value="createdAt">{t("app.text0140")}</option>
              <option value="issueDate">{t("app.text0141")}</option>
              <option value="validUntil">{t("devis.validUntil")}</option>
              <option value="total">{t("app.text0143")}</option>
              <option value="devisNumber">{t("devis.number")}</option>
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisSortOrder(event.target.value as 'asc' | 'desc')} value={devisSortOrder}>
              <option value="desc">{t("app.text0146")}</option>
              <option value="asc">{t("app.text0147")}</option>
            </select>
            <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetDevisFilters} type="button">{t("app.text0148")}</button>
          </section>) : null}

        {activeView === 'payments' ? (<section className="view-filter-bar flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 md:px-8">
            <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentMethodFilter(event.target.value as PaymentMethod | 'ALL')} value={paymentMethodFilter}>
              <option value="ALL">{t("app.text0149")}</option>
              <option value="BANK_TRANSFER">{t("app.text0150")}</option>
              <option value="CASH">{t("app.text0151")}</option>
              <option value="CHECK">{t("app.text0152")}</option>
              <option value="CREDIT_CARD">{t("app.text0153")}</option>
              <option value="MOBILE_PAYMENT">{t("app.text0154")}</option>
              <option value="OTHER">{t("app.text0155")}</option>
            </select>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentDateFrom(event.target.value)} title={t("app.text0138")} type="date" value={paymentDateFrom}/>
            <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentDateTo(event.target.value)} title={t("app.text0139")} type="date" value={paymentDateTo}/>
            <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetPaymentFilters} type="button">{t("app.text0148")}</button>
          </section>) : null}

        <nav className="mobile-nav grid grid-cols-2 gap-2 border-b border-slate-200 px-4 py-3 sm:grid-cols-4 lg:hidden">
            {visibleNavItems.map(({ key, label: labelKey, icon: Icon }) => (<button className={`nav-item flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium ${activeView === key ? 'nav-item-active text-white' : 'border border-slate-200 bg-white text-slate-700'}`} key={key} onClick={() => handleViewChange(key)} type="button">
                <Icon className="h-4 w-4"/>
                {t(labelKey)}
              </button>))}
          </nav>

        <div className="app-content space-y-6 px-4 py-5 md:px-8">
          {activeView === 'dashboard' ? (<section className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0156")}</h2>
                    <p className="text-sm text-slate-500">{t("app.text0157")}</p>
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <div className="flex flex-wrap gap-2">
                      {dashboardPeriods.map((period) => (<button className={`h-9 rounded-md px-3 text-sm font-medium transition ${dashboardPeriod === period.value
                    ? 'bg-primary text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`} key={period.value} onClick={() => setDashboardPeriod(period.value)} type="button">
                          {t(period.label)}
                        </button>))}
                    </div>
                    {dashboardPeriod === 'custom' ? (<div className="grid gap-2 sm:grid-cols-2">
                        <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDashboardDateFrom(event.target.value)} type="date" value={dashboardDateFrom}/>
                        <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDashboardDateTo(event.target.value)} type="date" value={dashboardDateTo}/>
                      </div>) : null}
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDashboardMonths(Number(event.target.value) as 6 | 12)} value={dashboardMonths}>
                      <option value={6}>{t("app.text0158")}</option>
                      <option value={12}>{t("app.text0159")}</option>
                    </select>
                  </div>
                </div>
              </div>

              {dashboardQuery.isLoading ? (<DashboardSkeleton />) : dashboardQuery.isError ? (<DashboardError onRetry={() => dashboardQuery.refetch()}/>) : (<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                  <Metric icon={ReceiptText} label={t("audit.text0031")} value={formatCurrency(dashboardStats?.totalRevenue ?? totalInvoiced)} helper={t('i18nDynamic.revenueDeltaPreviousMonth', { delta: formatRevenueDelta(dashboardStats?.revenueThisMonth ?? 0, dashboardStats?.revenueLastMonth ?? 0) })}/>
                  <Metric icon={AlertTriangle} label={t("audit.text0032")} tone="danger" value={formatCurrency(totalUnpaid)} helper={t('i18nDynamic.openInvoiceCount', { count: dashboardStats?.unpaidInvoices ?? 0 })}/>
                  <Metric icon={CheckCircle2} label={t("audit.text0033")} value={String(dashboardStats?.paidInvoices ?? 0)} helper={formatCurrency(dashboardStats?.totalPaid ?? totalPaid)}/>
                  <Metric icon={AlertTriangle} label={t("audit.text0034")} tone="danger" value={String(dashboardStats?.overdueInvoices ?? overdueInvoices.length)} helper={formatCurrency(dashboardStats?.overdueAmount ?? 0)}/>
                  <Metric icon={Users} label={t("audit.text0035")} value={String(dashboardStats?.totalClients ?? 0)} helper={t("audit.text0036")}/>
                  <Metric icon={CalendarClock} label={t("audit.text0037")} tone="warning" value={formatCurrency(dashboardStats?.dueSoonAmount ?? 0)} helper={t("audit.text0038")}/>
                </div>)}
            </section>) : null}

          {isInvoiceFormOpen ? (<section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {editingInvoiceId ? t("audit.text0039") : t("audit.text0040")}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {editingInvoiceId
                ? t("audit.text0041")
                : t("audit.text0042")}
                  </p>
                </div>
                <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setIsInvoiceFormOpen(false)} type="button">{t("app.text0160")}</button>
              </div>

              <form className="mt-5 space-y-5" onSubmit={handleCreateInvoice}>
                <div className="grid gap-3 md:grid-cols-5">
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">{t("app.text0161")}<select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceCustomerId(event.target.value)} value={invoiceCustomerId}>
                      <option value="">{t("app.text0162")}</option>
                      {(customerQuery.data?.data ?? []).map((customer) => (<option key={customer.id} value={customer.id}>
                          {formatCustomerName(customer)}
                        </option>))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">{t("app.text0163")}<select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceStatus(event.target.value as Extract<InvoiceStatus, 'DRAFT' | 'SENT'>)} value={invoiceStatus}>
                      <option value="DRAFT">{t("app.text0164")}</option>
                      <option value="SENT">{t("app.text0165")}</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">{t("app.text0141")}<input className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceIssueDate(event.target.value)} type="date" value={invoiceIssueDate}/>
                  </label>
                  <label className="text-sm font-medium text-slate-700">{t("app.text0142")}<input className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceDueDate(event.target.value)} type="date" value={invoiceDueDate}/>
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-medium">{t("app.text0012")}</th>
                        <th className="px-3 py-3 font-medium">{t("app.text0166")}</th>
                        <th className="px-3 py-3 font-medium">{t("app.text0167")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0168")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0169")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0170")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0143")}</th>
                        <th className="w-12 px-3 py-3"/>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceItems.map((item, index) => (<tr key={index}>
                          <td className="px-3 py-3">
                            <select className="h-9 w-44 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => handleApplyProductToInvoiceItem(index, event.target.value)} value="">
                              <option value="">{t("app.text0171")}</option>
                              {(productQuery.data?.data ?? []).map((product) => (<option key={product.id} value={product.id}>
                                  {product.name}
                                </option>))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => handleInvoiceItemChange(index, 'description', event.target.value)} placeholder={t("app.text0166")} value={item.description}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => handleInvoiceItemChange(index, 'unit', event.target.value)} placeholder={t("app.text0172")} value={item.unit ?? ''}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-24 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0.01" onChange={(event) => handleInvoiceItemChange(index, 'quantity', event.target.value)} step="0.01" type="number" value={item.quantity}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-28 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => handleInvoiceItemChange(index, 'unitPrice', event.target.value)} step="0.01" type="number" value={item.unitPrice}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-20 rounded-md border border-slate-200 bg-slate-50 px-2 text-right text-sm outline-none" disabled min="0" step="0.01" type="number" value={effectiveVatRate}/>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {formatCurrency(calculateItemTotal(item))}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" disabled={invoiceItems.length === 1} onClick={() => handleRemoveInvoiceItem(index)} title={t("app.text0173")} type="button">
                              <Trash2 className="h-4 w-4"/>
                            </button>
                          </td>
                        </tr>))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={handleAddInvoiceItem} type="button">
                    <Plus className="h-4 w-4"/>{t("app.text0174")}</button>

                  <div className="w-full max-w-sm space-y-3">
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-500">{t("app.text0175")}</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {effectiveVatRate}% - {selectedInvoiceCustomer?.countryCode === 'MA' ? 'Maroc' : t("audit.text0043")}
                          </p>
                        </div>
                        {isAdmin ? (<label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                            <input checked={isVatOverride} className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" onChange={(event) => {
                    setIsVatOverride(event.target.checked);
                    if (!event.target.checked) {
                        setInvoiceTaxRate(automaticVatRate);
                        setInvoiceVatOverrideReason('');
                    }
                }} type="checkbox"/>{t("app.text0176")}</label>) : null}
                      </div>
                      {isVatOverride ? (<div className="mt-3 space-y-2">
                          <label className="text-xs font-medium text-slate-600">{t("app.text0177")}<input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => setInvoiceTaxRate(Number(event.target.value))} step="0.01" type="number" value={invoiceTaxRate}/>
                          </label>
                          <textarea className="min-h-16 w-full rounded-md border border-slate-200 p-2 text-xs outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceVatOverrideReason(event.target.value)} placeholder={t("app.text0178")} value={invoiceVatOverrideReason}/>
                        </div>) : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-1">
                      <label className="text-xs font-medium text-slate-600">{t("app.text0179")}<input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => setInvoiceDiscount(Number(event.target.value))} step="0.01" type="number" value={invoiceDiscount}/>
                      </label>
                    </div>
                    <div className="rounded-md bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span>{t("app.text0180")}</span>
                        <span>{formatCurrency(invoiceTotals.subtotal)}</span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span>{t("app.text0181")}{effectiveVatRate}%</span>
                        <span>{formatCurrency(invoiceTotals.taxAmount)}</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
                        <span>{t("app.text0182")}</span>
                        <span>{formatCurrency(invoiceTotals.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <textarea className="min-h-24 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceNotes(event.target.value)} placeholder={t("app.text0183")} value={invoiceNotes}/>
                  <textarea className="min-h-24 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceTerms(event.target.value)} placeholder={t("app.text0184")} value={invoiceTerms}/>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetInvoiceForm} type="button">{t("app.text0148")}</button>
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={invoiceMutation.isPending} type="submit">
                    <FilePlus2 className="h-4 w-4"/>
                    {invoiceMutation.isPending
                ? t('auditFinal.saving')
                : editingInvoiceId
                    ? t('common.save')
                    : t("audit.text0044")}
                  </button>
                </div>
              </form>
            </section>) : null}

          {isDevisFormOpen ? (<section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {editingDevisId ? t('devis.editTitle') : t('devis.create')}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {editingDevisId ? t('devis.editDescription') : t('devis.createDescription')}
                  </p>
                </div>
                <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setIsDevisFormOpen(false)} type="button">{t("app.text0160")}</button>
              </div>

              <form className="mt-5 space-y-5" onSubmit={handleCreateDevis}>
                <div className="grid gap-3 md:grid-cols-5">
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">{t("app.text0161")}<select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisCustomerId(event.target.value)} value={devisCustomerId}>
                      <option value="">{t("app.text0162")}</option>
                      {(customerQuery.data?.data ?? []).map((customer) => (<option key={customer.id} value={customer.id}>
                          {formatCustomerName(customer)}
                        </option>))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">{t("app.text0163")}<select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisStatus(event.target.value as Extract<DevisStatus, 'DRAFT' | 'SENT' | 'APPROVED'>)} value={devisStatus}>
                      <option value="DRAFT">{t("devis.status.draft")}</option>
                      <option value="SENT">{t("devis.status.sent")}</option>
                      <option value="APPROVED">{t("devis.status.approved")}</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">{t("app.text0141")}<input className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisIssueDate(event.target.value)} type="date" value={devisIssueDate}/>
                  </label>
                  <label className="text-sm font-medium text-slate-700">{t("devis.validUntil")}<input className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisValidUntil(event.target.value)} type="date" value={devisValidUntil}/>
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1060px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-medium">{t("app.text0012")}</th>
                        <th className="px-3 py-3 font-medium">{t("app.text0166")}</th>
                        <th className="px-3 py-3 font-medium">{t("app.text0167")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0168")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0169")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("devis.lineDiscount")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0170")}</th>
                        <th className="px-3 py-3 text-right font-medium">{t("app.text0143")}</th>
                        <th className="w-12 px-3 py-3"/>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {devisItems.map((item, index) => (<tr key={index}>
                          <td className="px-3 py-3">
                            <select className="h-9 w-44 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => handleApplyProductToDevisItem(index, event.target.value)} value="">
                              <option value="">{t("app.text0171")}</option>
                              {(productQuery.data?.data ?? []).map((product) => (<option key={product.id} value={product.id}>
                                  {product.name}
                                </option>))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => handleDevisItemChange(index, 'description', event.target.value)} placeholder={t("app.text0166")} value={item.description}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => handleDevisItemChange(index, 'unit', event.target.value)} placeholder={t("app.text0172")} value={item.unit ?? ''}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-24 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0.01" onChange={(event) => handleDevisItemChange(index, 'quantity', event.target.value)} step="0.01" type="number" value={item.quantity}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-28 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => handleDevisItemChange(index, 'unitPrice', event.target.value)} step="0.01" type="number" value={item.unitPrice}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-24 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => handleDevisItemChange(index, 'discount', event.target.value)} step="0.01" type="number" value={item.discount}/>
                          </td>
                          <td className="px-3 py-3">
                            <input className="h-9 w-20 rounded-md border border-slate-200 bg-slate-50 px-2 text-right text-sm outline-none" disabled min="0" step="0.01" type="number" value={effectiveDevisVatRate}/>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {formatCurrency(calculateDevisItemTotal(item, effectiveDevisVatRate))}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" disabled={devisItems.length === 1} onClick={() => handleRemoveDevisItem(index)} title={t("app.text0173")} type="button">
                              <Trash2 className="h-4 w-4"/>
                            </button>
                          </td>
                        </tr>))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={handleAddDevisItem} type="button">
                    <Plus className="h-4 w-4"/>{t("app.text0174")}</button>

                  <div className="w-full max-w-sm space-y-3">
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-500">{t("app.text0175")}</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {effectiveDevisVatRate}% - {selectedDevisCustomer?.countryCode === 'MA' ? 'Maroc' : t("audit.text0043")}
                          </p>
                        </div>
                        {isAdmin ? (<label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                            <input checked={isVatOverride} className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" onChange={(event) => {
                    setIsVatOverride(event.target.checked);
                    if (!event.target.checked) {
                        setDevisTaxRate(automaticDevisVatRate);
                        setDevisVatOverrideReason('');
                    }
                }} type="checkbox"/>{t("app.text0176")}</label>) : null}
                      </div>
                      {isVatOverride ? (<div className="mt-3 space-y-2">
                          <label className="text-xs font-medium text-slate-600">{t("app.text0177")}<input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => setDevisTaxRate(Number(event.target.value))} step="0.01" type="number" value={devisTaxRate}/>
                          </label>
                          <textarea className="min-h-16 w-full rounded-md border border-slate-200 p-2 text-xs outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisVatOverrideReason(event.target.value)} placeholder={t("app.text0178")} value={devisVatOverrideReason}/>
                        </div>) : null}
                    </div>
                    <label className="text-xs font-medium text-slate-600">{t("app.text0179")}<input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4" min="0" onChange={(event) => setDevisDiscount(Number(event.target.value))} step="0.01" type="number" value={devisDiscount}/>
                    </label>
                    <div className="rounded-md bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span>{t("app.text0180")}</span>
                        <span>{formatCurrency(devisTotals.subtotal)}</span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span>{t("app.text0181")}{effectiveDevisVatRate}%</span>
                        <span>{formatCurrency(devisTotals.taxAmount)}</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
                        <span>{t("app.text0182")}</span>
                        <span>{formatCurrency(devisTotals.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <textarea className="min-h-24 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisNotes(event.target.value)} placeholder={t("app.text0183")} value={devisNotes}/>
                  <textarea className="min-h-24 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setDevisTerms(event.target.value)} placeholder={t("app.text0184")} value={devisTerms}/>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetDevisForm} type="button">{t("app.text0148")}</button>
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={devisMutation.isPending} type="submit">
                    <FilePlus2 className="h-4 w-4"/>
                    {devisMutation.isPending ? t('auditFinal.saving') : editingDevisId ? t('common.save') : t('devis.saveDraft')}
                  </button>
                </div>
              </form>
            </section>) : null}

          {activeView === 'dashboard' && dashboardStats && !dashboardQuery.isLoading && !dashboardQuery.isError ? (<section className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
                <DashboardPanel description={t('i18nDynamic.revenueUnpaidMonths', { count: dashboardMonths })} title={t("app.text0185")}>
                  {chartRevenue.length ? (<div className="h-72">
                      <ResponsiveContainer height="100%" width="100%">
                        <LineChart data={chartRevenue} margin={{ bottom: 4, left: 0, right: 12, top: 12 }}>
                          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false}/>
                          <XAxis axisLine={false} dataKey="month" tickLine={false}/>
                          <YAxis axisLine={false} tickFormatter={(value) => `${Number(value) / 1000}k`} tickLine={false}/>
                          <Tooltip formatter={(value) => formatCurrency(Number(value))}/>
                          <Legend />
                          <Line activeDot={{ r: 5 }} dataKey="revenue" name={t('i18nDynamic.revenue')} stroke="#2563EB" strokeWidth={3} type="monotone"/>
                          <Line dataKey="unpaid" name={t("audit.text0032")} stroke="#DC2626" strokeWidth={3} type="monotone"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>) : (<DashboardEmptyState text={t("audit.text0045")}/>)}
                </DashboardPanel>

                <DashboardPanel description={t("audit.text0046")} title={t("app.text0186")}>
                  {hasDashboardData ? (<div className="h-72">
                      <ResponsiveContainer height="100%" width="100%">
                        <PieChart>
                          <Pie data={dashboardStatusData.filter((item) => item.count > 0)} dataKey="count" innerRadius={54} nameKey="label" outerRadius={88} paddingAngle={3}>
                            {dashboardStatusData
                    .filter((item) => item.count > 0)
                    .map((item) => (<Cell fill={statusChartColors[item.status]} key={item.status}/>))}
                          </Pie>
                          <Tooltip formatter={(value, _name, item) => [t('i18nDynamic.invoiceCount', { count: Number(value) }), item.payload.label]}/>
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>) : (<DashboardEmptyState text={t("audit.text0047")}/>)}
                </DashboardPanel>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <DashboardPanel description={t("audit.text0048")} title={t("app.text0187")}>
                  {hasDashboardData ? (<div className="h-72">
                      <ResponsiveContainer height="100%" width="100%">
                        <BarChart data={dashboardStatusData} margin={{ bottom: 4, left: 0, right: 12, top: 12 }}>
                          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false}/>
                          <XAxis axisLine={false} dataKey="label" tickLine={false}/>
                          <YAxis allowDecimals={false} axisLine={false} tickLine={false}/>
                          <Tooltip formatter={(value, name) => name === 'amount'
                    ? [formatCurrency(Number(value)), t('i18nDynamic.amount')]
                    : [t('i18nDynamic.invoiceCount', { count: Number(value) }), t('i18nDynamic.count')] }/>
                          <Bar dataKey="count" name={t('i18nDynamic.count')} radius={[6, 6, 0, 0]}>
                            {dashboardStatusData.map((item) => (<Cell fill={statusChartColors[item.status]} key={item.status}/>))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>) : (<DashboardEmptyState text={t("audit.text0049")}/>)}
                </DashboardPanel>

                <DashboardPanel description={t('auditFinal.topClientsDescription')} title={t("app.text0188")}>
                  {dashboardStats.topClients.length ? (<div className="space-y-3">
                      {dashboardStats.topClients.map((client, index) => (<div className="rounded-md border border-slate-200 p-3" key={client.customer}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">
                                {index + 1}. {client.customer}
                              </p>
                              <p className="text-xs text-slate-500">{client.invoiceCount}{t("app.text0189")}</p>
                            </div>
                            <span className="text-sm font-semibold text-emerald-600">
                              {formatCurrency(client.revenue)}
                            </span>
                          </div>
                        </div>))}
                    </div>) : (<DashboardEmptyState text={t("audit.text0050")}/>)}
                </DashboardPanel>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <DashboardPanel description={t("audit.text0051")} title={t("app.text0190")}>
                  {dashboardStats.recentPayments.length ? (<div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="text-xs uppercase text-slate-500">
                          <tr>
                            <th className="py-2 font-medium">{t("app.text0161")}</th>
                            <th className="py-2 font-medium">{t("app.text0191")}</th>
                            <th className="py-2 font-medium">{t("app.text0192")}</th>
                            <th className="py-2 text-right font-medium">{t("app.text0193")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dashboardStats.recentPayments.map((payment) => (<tr className="hover:bg-slate-50" key={payment.id}>
                              <td className="py-3 text-slate-700">{payment.customer}</td>
                              <td className="py-3 font-medium text-slate-950">{payment.invoiceNumber}</td>
                              <td className="py-3 text-slate-500">{formatShortDate(payment.paymentDate)}</td>
                              <td className="py-3 text-right font-semibold text-emerald-600">
                                {formatCurrency(payment.amount)}
                              </td>
                            </tr>))}
                        </tbody>
                      </table>
                    </div>) : (<DashboardEmptyState text={t("audit.text0052")}/>)}
                </DashboardPanel>

                <DashboardPanel description={t("audit.text0053")} title={t("app.text0194")}>
                  {dashboardStats.upcomingDeadlines.length ? (<div className="space-y-3">
                      {dashboardStats.upcomingDeadlines.map((invoice) => (<button className="w-full rounded-md border border-slate-200 p-3 text-left transition hover:border-primary/40 hover:bg-slate-50" key={invoice.id} onClick={() => setViewInvoiceId(invoice.id)} type="button">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{invoice.customer}</p>
                              <p className="text-xs text-slate-500">
                                {invoice.invoiceNumber} - {formatShortDate(invoice.dueDate)}
                              </p>
                            </div>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                              {getStatusLabel(invoice.status)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-amber-600">
                            {formatCurrency(invoice.balanceDue)}
                          </p>
                        </button>))}
                    </div>) : (<DashboardEmptyState text={t("audit.text0054")}/>)}
                </DashboardPanel>
              </div>
            </section>) : null}

          {activeView === 'devis' ? (<section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{t('devis.listTitle')}</h2>
                  <p className="text-sm text-slate-500">
                    {t('devis.listSummary', {
                        visible: devisQuery.data?.data.length ?? 0,
                        total: devisQuery.data?.meta.total ?? 0,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {hasPermission('devis.delete') ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-200 px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60" disabled={deleteDraftDevisMutation.isPending} onClick={handleDeleteDraftDevis} type="button">
                    <Trash2 className="h-4 w-4"/>{t('devis.deleteDrafts')}
                  </button>) : null}
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90" onClick={handleOpenDevisForm} type="button">
                    <FilePlus2 className="h-4 w-4"/>{t('devis.create')}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">{t('devis.number')}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0161")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0141")}</th>
                      <th className="px-5 py-3 font-medium">{t('devis.validUntil')}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0163")}</th>
                      <th className="px-5 py-3 text-right font-medium">{t("app.text0143")}</th>
                      <th className="px-5 py-3 font-medium">{t('devis.linkedInvoice')}</th>
                      <th className="px-5 py-3 text-right font-medium">{t('devis.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {devisQuery.isLoading ? (<tr><td className="px-5 py-6 text-slate-500" colSpan={8}>{t("app.text0400")}</td></tr>) : null}
                    {(devisQuery.data?.data ?? []).map((devis) => (<tr className="hover:bg-slate-50" key={devis.id}>
                        <td className="px-5 py-4">
                          <button className="font-semibold text-slate-950 transition hover:text-primary" onClick={() => setViewDevisId(devis.id)} type="button">{devis.devisNumber}</button>
                        </td>
                        <td className="px-5 py-4 text-slate-600">{devis.customer?.company ?? devis.customer?.name ?? t('auditFinal.clientFallback')}</td>
                        <td className="px-5 py-4 text-slate-600">{formatShortDate(devis.issueDate)}</td>
                        <td className="px-5 py-4 text-slate-600">{formatShortDate(devis.validUntil)}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${devisStatusClasses[devis.status]}`}>
                            {getDevisStatusLabel(devis.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right font-semibold">{formatCurrency(Number(devis.total), devis.currency)}</td>
                        <td className="px-5 py-4">
                          {devis.generatedInvoice ? (<button className="font-medium text-primary hover:underline" onClick={() => setViewInvoiceId(devis.generatedInvoice!.id)} type="button">
                              {devis.generatedInvoice.invoiceNumber}
                            </button>) : (<span className="text-slate-400">-</span>)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            {devis.status === 'DRAFT' && hasPermission('devis.update') ? (<button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => handleEditDevis(devis)} type="button">{t("app.text0232")}</button>) : null}
                            {devis.status === 'DRAFT' && hasPermission('devis.delete') ? (<button className="h-8 rounded-md border border-rose-200 px-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60" disabled={devisActionMutation.isPending} onClick={() => handleConfirmedDevisAction(devis, 'delete')} type="button">{t('common.delete')}</button>) : null}
                            {devis.status === 'DRAFT' ? (<button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => devisActionMutation.mutate({ devisId: devis.id, action: 'send' })} type="button">{t("app.text0202")}</button>) : null}
                            {devis.status === 'SENT' ? (<button className="h-8 rounded-md border border-emerald-200 px-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50" onClick={() => devisActionMutation.mutate({ devisId: devis.id, action: 'approve' })} type="button">{t('devis.approve')}</button>) : null}
                            {devis.status === 'SENT' || devis.status === 'APPROVED' ? (<button className="h-8 rounded-md border border-rose-200 px-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50" onClick={() => handleConfirmedDevisAction(devis, 'reject')} type="button">{t('devis.reject')}</button>) : null}
                            {(devis.status === 'DRAFT' || devis.status === 'APPROVED') && !devis.isSigned && hasPermission('devis.sign') ? (<button className="h-8 rounded-md border border-emerald-200 px-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60" disabled={devisActionMutation.isPending} onClick={() => handleConfirmedDevisAction(devis, 'sign')} type="button">{t('devis.sign')}</button>) : null}
                            {devis.isSigned && hasPermission('devis.sign') ? (<button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" disabled={devisActionMutation.isPending} onClick={() => handleConfirmedDevisAction(devis, 'cancelSignature')} type="button">{t('devis.cancelSignature')}</button>) : null}
                            {devis.status === 'APPROVED' ? (<button className="h-8 rounded-md bg-primary px-2 text-xs font-medium text-white transition hover:bg-primary/90" onClick={() => handleConfirmedDevisAction(devis, 'convert')} type="button">{t('devis.createInvoice')}</button>) : null}
                            <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => downloadDevisPdf(devis.id, devis.devisNumber)} type="button">{t('i18nDynamic.pdf')}</button>
                          </div>
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              {!devisQuery.isLoading && (devisQuery.data?.data.length ?? 0) === 0 ? (<p className="p-5 text-sm text-slate-500">{t('devis.empty')}</p>) : null}
              {(devisQuery.data?.meta.totalPages ?? 0) > 1 ? (<div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm">
                  <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 disabled:opacity-40" disabled={devisPage <= 1} onClick={() => setDevisPage((page) => Math.max(1, page - 1))} type="button">{t("audit.text0070")}</button>
                  <span className="text-slate-500">{devisPage} / {devisQuery.data?.meta.totalPages}</span>
                  <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 disabled:opacity-40" disabled={devisPage >= (devisQuery.data?.meta.totalPages ?? 1)} onClick={() => setDevisPage((page) => page + 1)} type="button">{t("audit.text0071")}</button>
                </div>) : null}
            </section>) : null}

          {activeView === 'dashboard' || activeView === 'invoices' ? (<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-5">
                <div>
                  <h2 className="text-base font-semibold">{t("app.text0195")}</h2>
                  <p className="text-sm text-slate-500">
                    {t('i18nDynamic.invoiceListSummary', {
                        visible: invoices.length,
                        total: invoiceQuery.data?.meta.total ?? invoices.length,
                    })}
                    {(searchTerm || invoiceStatusFilter !== 'ALL' || invoiceCustomerFilter || invoiceDateFrom || invoiceDateTo)
                ? t('audit.withFilters')
                : ''}
                    .
                  </p>
                </div>
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => {
                if (selectedInvoice) {
                    setSelectedInvoiceId(selectedInvoice.id);
                    setPaymentAmount(String(selectedBalance));
                }
            }} type="button">
                  <Plus className="h-4 w-4"/>{t("app.text0199")}</button>
                {activeView === 'invoices' ? (<button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={exportingTarget === 'invoices'} onClick={handleExportInvoices} type="button">
                    <Download className="h-4 w-4"/>
                    {exportingTarget === 'invoices' ? t('i18nDynamic.exporting') : t('i18nDynamic.export')}
                  </button>) : null}
                {activeView === 'invoices' ? (<button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={exportingTarget === 'invoices-excel'} onClick={handleExportInvoicesExcel} type="button">
                    <Download className="h-4 w-4"/>
                    {exportingTarget === 'invoices-excel' ? t('i18nDynamic.exporting') : t("app.text0418")}
                  </button>) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">{t("app.text0191")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0161")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0142")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0163")}</th>
                      <th className="px-5 py-3 text-right font-medium">{t("app.text0144")}</th>
                      <th className="px-5 py-3 text-right font-medium">{t("app.text0200")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((invoice) => (<tr className="hover:bg-slate-50" key={invoice.id}>
                        <td className="px-5 py-4">
                          <button className="font-medium text-slate-900 transition hover:text-primary" onClick={() => setViewInvoiceId(invoice.id)} type="button">
                            {invoice.number}
                          </button>
                        </td>
                        <td className="px-5 py-4 text-slate-600">{invoice.customer}</td>
                        <td className="px-5 py-4 text-slate-600">
                          {formatDueDate(invoice)}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                            {getStatusLabel(invoice.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="font-semibold">
                            {formatCurrency(invoice.total - invoice.paid)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setViewInvoiceId(invoice.id)} type="button">{t("app.text0201")}</button>
                            {invoice.status === 'DRAFT' ? (<button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" disabled={invoiceStatusMutation.isPending} onClick={() => invoiceStatusMutation.mutate({
                        invoiceId: invoice.id,
                        status: 'SENT',
                    })} type="button">{t("app.text0202")}</button>) : null}
                            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' ? (<button className="h-8 rounded-md border border-rose-200 px-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50" disabled={invoiceStatusMutation.isPending} onClick={() => invoiceStatusMutation.mutate({
                        invoiceId: invoice.id,
                        status: 'CANCELLED',
                    })} type="button">{t("app.text0203")}</button>) : null}
                            <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-primary" onClick={() => handleDownloadPdf(invoice)} title={t("app.text0204")} type="button">
                              <Download className="h-4 w-4"/>
                            </button>
                          </div>
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              {activeView === 'invoices' && invoiceQuery.data?.meta ? (<div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-slate-500">{t("app.text0205")}{invoiceQuery.data.meta.page}{t("app.text0197")}{invoiceQuery.data.meta.totalPages || 1}
                  </p>
                  <div className="flex gap-2">
                    <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={invoiceQuery.data.meta.page <= 1 || invoiceQuery.isFetching} onClick={() => setInvoicePage((page) => Math.max(1, page - 1))} type="button">{t("app.text0206")}</button>
                    <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={invoiceQuery.data.meta.page >= invoiceQuery.data.meta.totalPages ||
                    invoiceQuery.isFetching} onClick={() => setInvoicePage((page) => page + 1)} type="button">{t("app.text0207")}</button>
                  </div>
                </div>) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">{t("app.text0208")}</h2>
              <p className="text-sm text-slate-500">{t("app.text0209")}</p>
              <div className="mt-5 space-y-4">
                {customerExposure.map((customer) => (<div key={customer.company}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{customer.company}</p>
                        <p className="text-xs text-slate-500">{customer.name}</p>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(customer.unpaid)}</p>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(10, (customer.unpaid / totalUnpaid) * 100)}%` }}/>
                    </div>
                    {customer.overdue > 0 ? (<p className="mt-1 text-xs font-medium text-rose-600">
                        {formatCurrency(customer.overdue)}{t("app.text0210")}</p>) : null}
                  </div>))}
              </div>

              <form className="mt-6 border-t border-slate-200 pt-5" onSubmit={handleRecordPayment}>
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">{t("app.text0211")}</h3>
                  <p className="text-xs text-slate-500">{t("app.text0212")}{formatCurrency(selectedBalance)}
                  </p>
                </div>
                <div className="space-y-2">
                  <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setSelectedInvoiceId(event.target.value)} value={selectedInvoice?.id ?? ''}>
                    {payableInvoices.map((invoice) => (<option key={invoice.id} value={invoice.id}>
                        {invoice.number} - {invoice.customer}
                      </option>))}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" max={selectedBalance || undefined} min="0" onChange={(event) => setPaymentAmount(event.target.value)} placeholder={t("app.text0193")} step="0.01" type="number" value={paymentAmount}/>
                    <input className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" max={getToday()} onChange={(event) => setPaymentEntryDate(event.target.value)} title={t("app.text0213")} type="date" value={paymentEntryDate}/>
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} value={paymentMethod}>
                      <option value="BANK_TRANSFER">{t("app.text0150")}</option>
                      <option value="CASH">{t("app.text0151")}</option>
                      <option value="CHECK">{t("app.text0152")}</option>
                      <option value="CREDIT_CARD">{t("app.text0153")}</option>
                      <option value="MOBILE_PAYMENT">{t("app.text0154")}</option>
                      <option value="OTHER">{t("app.text0155")}</option>
                    </select>
                  </div>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentReference(event.target.value)} placeholder={t("app.text0214")} value={paymentReference}/>
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={!selectedInvoice || paymentMutation.isPending} type="submit">
                    <WalletCards className="h-4 w-4"/>
                    {paymentMutation.isPending ? t('auditFinal.saving') : t('common.save')}
                  </button>
                </div>
              </form>

              <form className="mt-6 border-t border-slate-200 pt-5" onSubmit={handleCreateCustomer}>
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">{t("app.text0215")}</h3>
                  <p className="text-xs text-slate-500">{t("app.text0216")}</p>
                </div>
                <div className="space-y-2">
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerName(event.target.value)} placeholder={t("app.text0217")} value={customerName}/>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerEmail(event.target.value)} placeholder={t("app.text0218")} type="email" value={customerEmail}/>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerCompany(event.target.value)} placeholder={t("app.text0219")} value={customerCompany}/>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" list="country-options" onChange={(event) => handleCustomerCountryChange(event.target.value)} placeholder={t("app.text0220")} value={customerCountrySearch}/>
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={customerMutation.isPending} type="submit">
                    <Users className="h-4 w-4"/>
                    {customerMutation.isPending ? 'Ajout...' : t("audit.text0055")}
                  </button>
                </div>
              </form>
            </div>
          </section>) : null}

          {activeView === 'clients' ? (<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0221")}</h2>
                    <p className="text-sm text-slate-500">
                      {t('i18nDynamic.customerListSummary', {
                        visible: customerQuery.data?.data.length ?? 0,
                        total: customerQuery.data?.meta.total ?? 0,
                      })}
                    </p>
                  </div>
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={exportingTarget === 'customers'} onClick={handleExportCustomers} type="button">
                    <Download className="h-4 w-4"/>
                    {exportingTarget === 'customers' ? t('i18nDynamic.exporting') : t('i18nDynamic.export')}
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerSortBy(event.target.value as CustomerSortField)} value={customerSortBy}>
                      <option value="createdAt">{t("app.text0140")}</option>
                      <option value="name">{t("app.text0223")}</option>
                      <option value="company">{t("app.text0224")}</option>
                      <option value="email">{t("app.text0225")}</option>
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerStatusFilter(event.target.value as CustomerStatusFilter)} value={customerStatusFilter}>
                      <option value="ACTIVE">{t("app.text0226")}</option>
                      <option value="INACTIVE">{t("app.text0227")}</option>
                      <option value="ALL">{t("app.text0228")}</option>
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerSortOrder(event.target.value as 'asc' | 'desc')} value={customerSortOrder}>
                      <option value="desc">{t("app.text0146")}</option>
                      <option value="asc">{t("app.text0147")}</option>
                    </select>
                    <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetCustomerFilters} type="button">{t("app.text0148")}</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t("app.text0161")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0229")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0230")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0008")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0200")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(customerQuery.data?.data ?? []).map((customer) => (<tr className="hover:bg-slate-50" key={customer.id}>
                          <td className="px-5 py-4">
                            <p className="font-medium">{customer.company ?? customer.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <p className="text-xs text-slate-500">{customer.name}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${customer.isActive
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                                {customer.isActive ? t('i18nDynamic.active') : t('i18nDynamic.inactive')}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <p>{customer.email}</p>
                            <p className="text-xs text-slate-500">{customer.phone ?? '-'}</p>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            <p>{customer.taxNumber ?? '-'}</p>
                            <p className="text-xs text-slate-500">{customer.city ?? '-'}</p>
                          </td>
                          <td className="px-5 py-4 text-right font-semibold">
                            {customer._count?.invoices ?? 0}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setViewCustomerId(customer.id)} type="button">{t("app.text0231")}</button>
                              <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => handleEditCustomer(customer)} type="button">{t("app.text0232")}</button>
                              <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={customerStatusMutation.isPending} onClick={() => customerStatusMutation.mutate(customer)} type="button">
                                {customer.isActive ? t('i18nDynamic.deactivate') : t('i18nDynamic.activate')}
                              </button>
                              {isAdmin ? (<button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={deleteCustomerMutation.isPending} onClick={() => handleDeleteCustomer(customer)} title={(customer._count?.invoices ?? 0) > 0
                        ? t("audit.text0056")
                        : t('common.delete')} type="button" aria-label={t("app.text0233")}>
                                  <Trash2 className="h-4 w-4"/>
                                </button>) : null}
                            </div>
                          </td>
                        </tr>))}
                    </tbody>
                  </table>
                </div>
                {customerQuery.data?.meta ? (<div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-slate-500">{t("app.text0205")}{customerQuery.data.meta.page}{t("app.text0197")}{customerQuery.data.meta.totalPages || 1}
                    </p>
                    <div className="flex gap-2">
                      <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={customerQuery.data.meta.page <= 1 || customerQuery.isFetching} onClick={() => setCustomerPage((page) => Math.max(1, page - 1))} type="button">{t("app.text0206")}</button>
                      <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={customerQuery.data.meta.page >= customerQuery.data.meta.totalPages ||
                    customerQuery.isFetching} onClick={() => setCustomerPage((page) => page + 1)} type="button">{t("app.text0207")}</button>
                    </div>
                  </div>) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">
                  {editingCustomerId ? t("audit.text0057") : t("audit.text0058")}
                </h2>
                <p className="text-sm text-slate-500">
                  {editingCustomerId ? t("audit.text0059") : t("audit.text0060")}
                </p>
                <form className="mt-5 space-y-2" onSubmit={handleCreateCustomer}>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerName(event.target.value)} placeholder={t("app.text0217")} value={customerName}/>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerEmail(event.target.value)} placeholder={t("app.text0225")} type="email" value={customerEmail}/>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerCompany(event.target.value)} placeholder={t("app.text0224")} value={customerCompany}/>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerPhone(event.target.value)} placeholder={t("app.text0234")} value={customerPhone}/>
                    <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerCity(event.target.value)} placeholder={t("app.text0235")} value={customerCity}/>
                  </div>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" list="country-options" onChange={(event) => handleCustomerCountryChange(event.target.value)} placeholder={t("app.text0220")} value={customerCountrySearch}/>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerTaxNumber(event.target.value)} placeholder={t("app.text0236")} value={customerTaxNumber}/>
                  <textarea className="min-h-20 w-full rounded-md border border-slate-200 bg-white p-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCustomerAddress(event.target.value)} placeholder={t("app.text0237")} value={customerAddress}/>
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={customerMutation.isPending} type="submit">
                    <Users className="h-4 w-4"/>
                    {customerMutation.isPending
                ? t('auditFinal.saving')
                : editingCustomerId
                    ? t('common.save')
                    : t('auditFinal.add')}
                  </button>
                  {editingCustomerId ? (<button className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetCustomerForm} type="button">{t("app.text0203")}</button>) : null}
                </form>
              </div>
            </section>) : null}

          {activeView === 'users' ? (<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0238")}</h2>
                    <p className="text-sm text-slate-500">
                      {t('i18nDynamic.userCount', { count: userQuery.data?.meta.total ?? 0 })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setUserRoleFilter(event.target.value as UserRole | 'ALL')} value={userRoleFilter}>
                      <option value="ALL">{t("app.text0240")}</option>
                      <option value="ADMIN">{t("app.text0241")}</option>
                      <option value="EMPLOYEE">{t("app.text0242")}</option>
                    </select>
                    <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setUserStatusFilter(event.target.value as CustomerStatusFilter)} value={userStatusFilter}>
                      <option value="ALL">{t("app.text0137")}</option>
                      <option value="ACTIVE">{t("app.text0226")}</option>
                      <option value="INACTIVE">{t("app.text0227")}</option>
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t("app.text0243")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0244")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0245")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0163")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0200")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(userQuery.data?.data ?? []).map((user) => {
                const isCurrentUser = user.id === currentUserQuery.data?.id;
                return (<tr className="hover:bg-slate-50" key={user.id}>
                            <td className="px-5 py-4">
                              <p className="font-medium text-slate-900">{user.name}</p>
                              <p className="text-xs text-slate-500">{user.email}</p>
                            </td>
                            <td className="px-5 py-4">
                              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                                {t(`auditFinal.userRole.${user.role === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE'}`)}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-right text-xs text-slate-500">
                              {t('i18nDynamic.invoiceCount', { count: user._count?.invoices ?? 0 })}
                              {' · '}
                              {t('i18nDynamic.paymentCount', { count: user._count?.payments ?? 0 })}
                            </td>
                            <td className="px-5 py-4 text-right">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${user.isActive
                        ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                        : 'bg-zinc-100 text-zinc-700 ring-zinc-200'}`}>
                                {user.isActive ? t('i18nDynamic.active') : t('i18nDynamic.inactive')}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => handleEditUser(user)} type="button">{t("app.text0232")}</button>
                                <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={isCurrentUser && user.isActive} onClick={() => handleToggleUserStatus(user)} type="button">
                                  {user.isActive ? t('i18nDynamic.deactivate') : t('i18nDynamic.activate')}
                                </button>
                              </div>
                            </td>
                          </tr>);
            })}
                    </tbody>
                  </table>
                  {!userQuery.isLoading && userQuery.data?.data.length === 0 ? (<p className="p-5 text-sm text-slate-500">{t("app.text0248")}</p>) : null}
                </div>
                {userQuery.data?.meta && userQuery.data.meta.totalPages > 1 ? (<div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                    <span>{t("app.text0205")}{userQuery.data.meta.page} / {userQuery.data.meta.totalPages}
                    </span>
                    <div className="flex gap-2">
                      <button className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50" disabled={userPage <= 1} onClick={() => setUserPage((page) => Math.max(1, page - 1))} type="button">{t("app.text0206")}</button>
                      <button className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50" disabled={userPage >= userQuery.data.meta.totalPages} onClick={() => setUserPage((page) => page + 1)} type="button">{t("app.text0207")}</button>
                    </div>
                  </div>) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">
                  {editingUserId ? t("audit.text0061") : t("audit.text0062")}
                </h2>
                <p className="text-sm text-slate-500">{t("app.text0249")}</p>
                <form className="mt-5 space-y-3" onSubmit={handleUserSubmit}>
                  <SettingsInput label={t("audit.text0138")} onChange={setUserName} required value={userName}/>
                  <SettingsInput label={t("audit.text0140")} onChange={setUserEmail} required type="email" value={userEmail}/>
                  <SettingsInput label={editingUserId ? t("audit.text0063") : t("audit.text0064")} onChange={setUserPassword} required={!editingUserId} type="password" value={userPassword}/>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">{t("app.text0244")}<select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setUserRole(event.target.value as UserRole)} value={userRole}>
                        <option value="EMPLOYEE">{t("app.text0242")}</option>
                        <option value="ADMIN">{t("app.text0241")}</option>
                      </select>
                    </label>
                    <label className="flex h-16 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                      <input checked={userIsActive} disabled={editingUserId === currentUserQuery.data?.id} onChange={(event) => setUserIsActive(event.target.checked)} type="checkbox"/>{t("app.text0250")}</label>
                  </div>
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={userMutation.isPending} type="submit">
                    <Users className="h-4 w-4"/>
                    {userMutation.isPending
                ? t('auditFinal.saving')
                : editingUserId
                    ? t('common.save')
                    : t('auditFinal.add')}
                  </button>
                  {editingUserId ? (<button className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetUserForm} type="button">{t("app.text0203")}</button>) : null}
                </form>
              </div>
            </section>) : null}

          {activeView === 'rbac' ? (<section className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{t("app.text0251")}</h2>
                      <p className="text-sm text-slate-500">{t("app.text0252")}</p>
                    </div>
                    <ShieldCheck className="h-5 w-5 text-primary"/>
                  </div>
                  <form className="mt-4 space-y-2" onSubmit={(event) => {
                event.preventDefault();
                if (rbacRoleName.trim())
                    rbacRoleMutation.mutate();
            }}>
                    <input aria-label={t("app.text0253")} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4" onChange={(event) => setRbacRoleName(event.target.value)} placeholder={t("app.text0253")} value={rbacRoleName}/>
                    <input aria-label={t("app.text0254")} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4" onChange={(event) => setRbacRoleDescription(event.target.value)} placeholder={t("app.text0255")} value={rbacRoleDescription}/>
                    <button className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={rbacRoleMutation.isPending || !rbacRoleName.trim()} type="submit">
                      {rbacRoleMutation.isPending ? t("auditFinal.saving") : t("audit.text0065")}
                    </button>
                  </form>
                  <div className="mt-5 space-y-2">
                    {(rbacRolesQuery.data ?? []).map((role) => (<div className={`flex items-center justify-between gap-2 rounded-md border p-3 ${selectedRbacRoleId === role.id ? 'border-primary bg-primary/5' : 'border-slate-200'}`} key={role.id}>
                        <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedRbacRoleId(role.id)} type="button">
                          <span className="block truncate text-sm font-semibold">{role.name}</span>
                          <span className="block text-xs text-slate-500">{role._count?.users ?? 0}{t("app.text0256")}</span>
                        </button>
                        {!role.isSystem ? (<button aria-label={t('i18nDynamic.deleteRoleAria', { name: role.name })} className="rounded-md p-2 text-rose-600 hover:bg-rose-50" onClick={() => handleDeleteRbacRole(role)} title={t("app.text0257")} type="button">
                            <Trash2 className="h-4 w-4"/>
                          </button>) : null}
                      </div>))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{t("app.text0258")}</h2>
                      <p className="text-sm text-slate-500">{t("app.text0259")}</p>
                    </div>
                    {hasPermission('permissions.assign') ? (<button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={!selectedRbacRoleId || rbacPermissionMutation.isPending} onClick={() => rbacPermissionMutation.mutate()} type="button">
                        {rbacPermissionMutation.isPending ? t('auditFinal.saving') : t('common.save')}
                      </button>) : (<span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">{t("app.text0260")}</span>)}
                  </div>
                  {hasPermission('permissions.assign') ? (<form className="mt-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]" onSubmit={(event) => {
                    event.preventDefault();
                    if (rbacPermissionKey.trim())
                        rbacPermissionCreateMutation.mutate();
                }}>
                      <input aria-label={t("app.text0261")} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4" onChange={(event) => setRbacPermissionKey(event.target.value)} placeholder={t("app.text0262")} value={rbacPermissionKey}/>
                      <input aria-label={t("app.text0263")} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4" onChange={(event) => setRbacPermissionDescription(event.target.value)} placeholder={t("app.text0255")} value={rbacPermissionDescription}/>
                      <button className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60" disabled={rbacPermissionCreateMutation.isPending || !rbacPermissionKey.trim()} type="submit">
                        {rbacPermissionCreateMutation.isPending ? t('audit.adding') : t('audit.add')}
                      </button>
                    </form>) : null}
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {(rbacPermissionsQuery.data ?? []).map((permission) => (<label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm hover:bg-slate-50" key={permission.id}>
                        <input checked={rbacPermissionIds.includes(permission.id)} disabled={!hasPermission('permissions.assign')} onChange={(event) => setRbacPermissionIds((current) => event.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id))} type="checkbox"/>
                        <span className="min-w-0">
                          <span className="block font-medium">{permission.key}</span>
                          <span className="block text-xs text-slate-500">{permission.description || t('audit.applicationPermission')}</span>
                          {['clients', 'invoices', 'payments'].includes(permission.resource) && rbacPermissionIds.includes(permission.id) ? (<select aria-label={t('auditFinal.permissionScopeAria', { permission: permission.key })} className="mt-2 h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" disabled={!hasPermission('permissions.assign')} onChange={(event) => setRbacPermissionScopes((current) => ({ ...current, [permission.id]: event.target.value as 'ALL' | 'OWN' | 'SELECTED' }))} value={rbacPermissionScopes[permission.id] ?? 'ALL'}>
                              <option value="ALL">{t("app.text0264")}</option>
                              <option value="OWN">{t("app.text0265")}</option>
                              <option value="SELECTED">{t("app.text0266")}</option>
                            </select>) : null}
                        </span>
                      </label>))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0267")}</h2>
                    <p className="text-sm text-slate-500">{t("app.text0268")}</p>
                  </div>
                  <input aria-label={t("app.text0269")} className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 focus:ring-4" onChange={(event) => setRbacUserSearch(event.target.value)} placeholder={t("app.text0270")} value={rbacUserSearch}/>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">{t("app.text0243")}</th><th className="px-3 py-3">{t("app.text0244")}</th><th className="px-3 py-3">{t("app.text0271")}</th><th className="px-3 py-3">{t("app.text0007")}</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {(rbacUsersQuery.data?.data ?? []).map((user) => {
                const role = rbacRolesQuery.data?.find((item) => item.id === user.rbacRole?.id);
                return <tr className="hover:bg-slate-50" key={user.id}>
                          <td className="px-3 py-3"><span className="block font-medium">{user.name}</span><span className="text-xs text-slate-500">{user.email}</span></td>
                          <td className="px-3 py-3"><select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm" onChange={(event) => rbacUserRoleMutation.mutate({ userId: user.id, roleId: event.target.value })} value={user.rbacRole?.id ?? ''}><option value="" disabled>{t("app.text0171")}</option>{(rbacRolesQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                          <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{(role?.permissions ?? []).slice(0, 4).map(({ permission }) => <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600" key={permission.id}>{permission.key}</span>)}{(role?.permissions.length ?? 0) > 4 ? <span className="text-xs text-slate-500">+{(role?.permissions.length ?? 0) - 4}</span> : null}</div></td><td className="px-3 py-3"><button className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium hover:bg-slate-50" onClick={() => setSelectedRbacUserId(user.id)} type="button">{t("app.text0272")}</button></td>
                        </tr>;
            })}
                    </tbody>
                  </table>
                </div>
              </div>


              {selectedRbacUserId ? (<div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">{t("app.text0266")}</h2>
                      <p className="text-sm text-slate-500">{t("app.text0273")}</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="h-9 rounded-md border border-slate-200 px-3 text-sm" onClick={() => setSelectedRbacUserId('')} type="button">{t("app.text0160")}</button>
                      <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={rbacClientAssignmentMutation.isPending} onClick={() => rbacClientAssignmentMutation.mutate()} type="button">{rbacClientAssignmentMutation.isPending ? t('auditFinal.saving') : t('common.save')}</button>
                    </div>
                  </div>
                  <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {(rbacAllClientsQuery.data?.data ?? []).map((client) => (<label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm hover:bg-slate-50" key={client.id}>
                        <input checked={rbacAssignedClientIds.includes(client.id)} onChange={(event) => setRbacAssignedClientIds((current) => event.target.checked ? [...current, client.id] : current.filter((id) => id !== client.id))} type="checkbox"/>
                        <span><span className="block font-medium">{client.name}</span><span className="block text-xs text-slate-500">{client.company || client.email}</span></span>
                      </label>))}
                  </div>
                </div>) : null}
            </section>) : null}

          {activeView === 'settings' ? (<section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{t("app.text0274")}</h2>
                  <p className="text-sm text-slate-500">{t("app.text0275")}</p>
                </div>
                {!isAdmin ? (<span className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{t("app.text0260")}</span>) : null}
              </div>

              <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0276")}</h2>
                    <p className="text-sm text-slate-500">
                      {currentUserQuery.data?.name} · {currentUserQuery.data?.email}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    {t(`auditFinal.userRole.${isAdmin ? 'ADMIN' : 'EMPLOYEE'}`)}
                  </span>
                </div>
                <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handlePasswordSubmit}>
                  <SettingsInput label={t("audit.text0067")} onChange={setCurrentPassword} required type="password" value={currentPassword}/>
                  <SettingsInput label={t("audit.text0068")} onChange={setNewPassword} required type="password" value={newPassword}/>
                  <SettingsInput label={t("audit.confirmation")} onChange={setConfirmNewPassword} required type="password" value={confirmNewPassword}/>
                  <div className="md:col-span-3">
                    <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={passwordMutation.isPending} type="submit">
                      <Settings className="h-4 w-4"/>
                      {passwordMutation.isPending ? t("audit.text0069") : t("audit.text0070")}
                    </button>
                  </div>
                </form>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
  <div className="flex flex-col gap-4">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">
        Telegram Integration
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Connect your ERP account to Telegram to securely access the AI Assistant.
      </p>
    </div>

    {!telegramLinkCode ? (
      <button
        type="button"
        onClick={() => telegramLinkMutation.mutate()}
        disabled={telegramLinkMutation.isPending}
        className="inline-flex w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {telegramLinkMutation.isPending
          ? "Generating..."
          : "Connect Telegram"}
      </button>
    ) : (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Your secure linking code
          </p>

          <p className="mt-1 font-mono text-xl font-bold tracking-wider text-slate-900">
            {telegramLinkCode}
          </p>
        </div>

        <p className="text-xs text-slate-500">
          Valid for 15 minutes.
        </p>

        <div>
          <p className="text-xs text-slate-500">
            Send this command to the Telegram bot:
          </p>

          <code className="mt-1 block rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            /link {telegramLinkCode}
          </code>
        </div>

        <button
          type="button"
          onClick={() =>
            navigator.clipboard.writeText(`/link ${telegramLinkCode}`)
          }
          className="inline-flex w-fit items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Copy command
        </button>

        {telegramLinkExpiresAt && (
          <p className="text-xs text-slate-400">
            Expires at:{" "}
            {new Date(telegramLinkExpiresAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    )}
  </div>
</div>

              {companySettingsQuery.isLoading ? (<p className="text-sm text-slate-500">{t("app.text0277")}</p>) : (<form className="space-y-4" onSubmit={handleCompanySettingsSubmit}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SettingsInput label={t("audit.text0071")} onChange={(value) => setCompanyForm((form) => ({ ...form, name: value }))} required value={companyForm.name}/>
                    <SettingsInput label={t("audit.text0140")} onChange={(value) => setCompanyForm((form) => ({ ...form, email: value }))} type="email" value={companyForm.email ?? ''}/>
                    <SettingsInput label={t("audit.text0141")} onChange={(value) => setCompanyForm((form) => ({ ...form, phone: value }))} value={companyForm.phone ?? ''}/>
                    <SettingsInput label={t("audit.text0072")} onChange={(value) => setCompanyForm((form) => ({ ...form, taxNumber: value }))} value={companyForm.taxNumber ?? ''}/>
                    <SettingsInput label={t("audit.text0073")} onChange={(value) => setCompanyForm((form) => ({ ...form, defaultCurrency: value.toUpperCase() }))} required value={companyForm.defaultCurrency}/>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{t("app.text0181")}</h3>
                        <p className="text-xs text-slate-500">{t("app.text0278")}</p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input checked={companyForm.vatEnabled} className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" disabled={!isAdmin} onChange={(event) => setCompanyForm((form) => ({ ...form, vatEnabled: event.target.checked }))} type="checkbox"/>{t("app.text0279")}</label>
                    </div>
                    <div className="mt-3 max-w-xs">
                      <SettingsInput label={t("audit.text0074")} onChange={(value) => setCompanyForm((form) => ({
                    ...form,
                    defaultTaxRate: Number(value),
                    moroccoVatRate: Number(value),
                }))} type="number" value={String(companyForm.moroccoVatRate)}/>
                    </div>
                  </div>
                  <textarea className="min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCompanyForm((form) => ({ ...form, address: event.target.value }))} placeholder={t("app.text0280")} value={companyForm.address ?? ''}/>
                  <div className="grid gap-3 md:grid-cols-2">
                    <textarea className="min-h-28 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCompanyForm((form) => ({ ...form, paymentTerms: event.target.value }))} placeholder={t("app.text0184")} value={companyForm.paymentTerms ?? ''}/>
                    <textarea className="min-h-28 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setCompanyForm((form) => ({ ...form, bankDetails: event.target.value }))} placeholder={t("app.text0281")} value={companyForm.bankDetails ?? ''}/>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <CompanyAssetCard description={t("audit.text0075")} disabled={!isAdmin} icon={PenLine} imageUrl={companyForm.signatureUrl} isDirty={Boolean(companyAssetDrafts.signature || companyAssetDeletes.signature)} isPending={settingsMutation.isPending} onDelete={() => handleCompanyAssetDelete('signature')} onRemoveBackground={() => handleRemoveCompanyAssetBackground('signature')} onUpload={(file) => handleCompanyAssetUpload('signature', file)} title={t("app.text0282")}/>
                    <CompanyAssetCard description={t("audit.text0076")} disabled={!isAdmin} icon={Stamp} imageUrl={companyForm.stampUrl} isDirty={Boolean(companyAssetDrafts.stamp || companyAssetDeletes.stamp)} isPending={settingsMutation.isPending} onDelete={() => handleCompanyAssetDelete('stamp')} onRemoveBackground={() => handleRemoveCompanyAssetBackground('stamp')} onUpload={(file) => handleCompanyAssetUpload('stamp', file)} title={t("app.text0283")}/>
                  </div>
                  <div className="flex justify-end">
                    <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={settingsMutation.isPending || !isAdmin} type="submit">
                      <CheckCircle2 className="h-4 w-4"/>
                      {settingsMutation.isPending ? t('auditFinal.saving') : t('common.save')}
                    </button>
                  </div>
                </form>)}
              {isAdmin ? (<div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">{t("app.text0284")}</h2>
                      <p className="text-sm text-slate-500">{t("app.text0285")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${emailStatusQuery.data?.mode === 'smtp'
                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    : 'bg-amber-100 text-amber-700 ring-amber-200'}`}>
                        {emailStatusQuery.data?.mode === 'smtp' ? t("audit.text0077") : t("audit.text0078")}
                      </span>
                      <button className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={testEmailMutation.isPending || emailStatusQuery.isLoading} onClick={() => testEmailMutation.mutate()} type="button">
                        <Mail className="h-3.5 w-3.5"/>
                        {testEmailMutation.isPending ? t('i18nDynamic.testing') : t('i18nDynamic.test')}
                      </button>
                    </div>
                  </div>
                  {emailStatusQuery.isLoading ? (<p className="mt-4 text-sm text-slate-500">{t("app.text0286")}</p>) : emailStatusQuery.data ? (<div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                      <InfoLine label={t("audit.text0079")} value={`${emailStatusQuery.data.host}:${emailStatusQuery.data.port}`}/>
                      <InfoLine label={t("audit.sender")} value={`${emailStatusQuery.data.fromName} <${emailStatusQuery.data.fromEmail}>`}/>
                      <InfoLine label={t("audit.user")} value={emailStatusQuery.data.user}/>
                      <InfoLine label={t("audit.secure")} value={emailStatusQuery.data.secure ? t('audit.yes') : t('audit.no')}/>
                      {emailStatusQuery.data.localOutputDir ? (<div className="md:col-span-2">
                          <InfoLine label={t("audit.text0080")} value={emailStatusQuery.data.localOutputDir}/>
                        </div>) : null}
                      {emailStatusQuery.data.warning ? (<p className="md:col-span-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                          {emailStatusQuery.data.warning}
                        </p>) : null}
                    </div>) : (<p className="mt-4 text-sm text-slate-500">{t("app.text0287")}</p>)}
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">{t("app.text0288")}</h3>
                      {emailLogsQuery.isFetching ? (<span className="text-xs text-slate-500">{t("app.text0289")}</span>) : null}
                    </div>
                    <div className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                      {(emailLogsQuery.data ?? []).map((emailLog) => (<button className="grid w-full gap-2 p-3 text-left text-sm transition hover:bg-slate-50 sm:grid-cols-[1fr_auto]" key={emailLog.id} onClick={() => {
                        if (emailLog.invoice?.id)
                            setViewInvoiceId(emailLog.invoice.id);
                    }} type="button">
                          <div>
                            <p className="font-medium text-slate-900">
                              {emailLog.invoice?.invoiceNumber ?? t("audit.text0137")} - {emailLog.recipientEmail}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {emailLog.subject} - {formatShortDate(emailLog.createdAt)}
                            </p>
                          </div>
                          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 sm:justify-self-end ${emailLog.status === 'SENT'
                        ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                        : 'bg-rose-100 text-rose-700 ring-rose-200'}`}>
                            {emailLog.deliveryMode === 'local' ? t('i18nDynamic.localDelivery') : t(`auditFinal.reminderStatus.${emailLog.status}`)}
                          </span>
                        </button>))}
                      {!emailLogsQuery.isLoading && (emailLogsQuery.data?.length ?? 0) === 0 ? (<p className="p-3 text-sm text-slate-500">{t("app.text0290")}</p>) : null}
                    </div>
                  </div>
                </div>) : null}
            </section>) : null}

          {activeView === 'expenses' ? (<ExpenseNotesView getApiErrorMessage={getApiErrorMessage} hasPermission={hasPermission}/>) : null}
          {activeView === 'credit-notes' ? (<CreditNotesView getApiErrorMessage={getApiErrorMessage} hasPermission={hasPermission} onOpenInvoice={setViewInvoiceId}/>) : null}
          {activeView === 'contracts' ? (<ContractsView getApiErrorMessage={getApiErrorMessage} hasPermission={hasPermission} onAiContextChange={setContractAiContext} onOpenInvoice={setViewInvoiceId}/>) : null}
          {activeView === 'audit-logs' ? (<AuditLogsView getApiErrorMessage={getApiErrorMessage}/>) : null}

          {activeView === 'products' ? (<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-base font-semibold">{t("app.text0291")}</h2>
                  <p className="text-sm text-slate-500">
                    {t('i18nDynamic.productCount', { count: productQuery.data?.meta.total ?? 0 })}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t("app.text0294")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0167")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0169")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0181")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0163")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0200")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(productQuery.data?.data ?? []).map((product) => (<tr className="hover:bg-slate-50" key={product.id}>
                          <td className="px-5 py-4">
                            <p className="font-medium text-slate-900">{product.name}</p>
                            <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                              {product.description ?? '-'}
                            </p>
                          </td>
                          <td className="px-5 py-4 text-slate-600">{product.unit ?? '-'}</td>
                          <td className="px-5 py-4 text-right font-semibold">
                            {formatCurrency(Number(product.unitPrice))}
                          </td>
                          <td className="px-5 py-4 text-right text-slate-600">
                            {Number(product.taxRate)}%
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${product.isActive
                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    : 'bg-zinc-100 text-zinc-700 ring-zinc-200'}`}>
                              {product.isActive ? t('i18nDynamic.active') : t('i18nDynamic.inactive')}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => handleEditProduct(product)} type="button">{t("app.text0232")}</button>
                          </td>
                        </tr>))}
                    </tbody>
                  </table>
                  {!productQuery.isLoading && productQuery.data?.data.length === 0 ? (<p className="p-5 text-sm text-slate-500">{t("app.text0295")}</p>) : null}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">
                  {editingProductId ? t("audit.text0081") : t("audit.text0082")}
                </h2>
                <p className="text-sm text-slate-500">{t("app.text0296")}</p>
                {!isAdmin ? (<p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{t("app.text0103")}</p>) : null}
                <form className="mt-5 space-y-3" onSubmit={handleProductSubmit}>
                  <SettingsInput label={t("audit.text0138")} onChange={setProductName} required value={productName}/>
                  <textarea className="min-h-20 w-full rounded-md border border-slate-200 bg-white p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setProductDescription(event.target.value)} placeholder={t("app.text0166")} value={productDescription}/>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SettingsInput label={t("audit.unit")} onChange={setProductUnit} value={productUnit}/>
                    <SettingsInput label={t("audit.text0083")} onChange={(value) => setProductUnitPrice(Number(value))} type="number" value={String(productUnitPrice)}/>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SettingsInput label={t("audit.text0084")} onChange={(value) => setProductTaxRate(Number(value))} type="number" value={String(productTaxRate)}/>
                    <label className="flex h-16 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                      <input checked={productIsActive} onChange={(event) => setProductIsActive(event.target.checked)} type="checkbox"/>{t("app.text0250")}</label>
                  </div>
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={productMutation.isPending || !isAdmin} type="submit">
                    <ReceiptText className="h-4 w-4"/>
                    {productMutation.isPending
                ? t('auditFinal.saving')
                : editingProductId
                    ? t('common.save')
                    : t('auditFinal.add')}
                  </button>
                  {editingProductId ? (<button className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetProductForm} type="button">{t("app.text0203")}</button>) : null}
                </form>
              </div>
            </section>) : null}

          {activeView === 'payments' && hasPermission('recurring.view') ? (<section className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><h2 className="text-base font-semibold">{t("app.text0297")}</h2><p className="text-sm text-slate-500">{t("app.text0298")}</p></div>
                  <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" value={recurringStatusFilter} onChange={(e) => setRecurringStatusFilter(e.target.value as RecurringPlanStatus | 'ALL')}>
                    <option value="ALL">{t("app.text0299")}</option><option value="ACTIVE">{t("app.text0226")}</option><option value="PAUSED">{t("app.text0300")}</option><option value="COMPLETED">{t("app.text0301")}</option><option value="CANCELLED">{t("app.text0302")}</option>
                  </select>
                </div>
                {hasPermission('recurring.create') ? (<form className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); recurringCreateMutation.mutate(); }}>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" required value={recurringName} onChange={(e) => setRecurringName(e.target.value)} placeholder={t("app.text0303")}/>
                    <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" required value={recurringCustomerId} onChange={(e) => setRecurringCustomerId(e.target.value)}>{(customerQuery.data?.data ?? []).map(c => <option key={c.id} value={c.id}>{c.company ?? c.name}</option>)}</select>
                    <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={recurringFrequency} onChange={(e) => setRecurringFrequency(e.target.value as RecurringFrequency)}><option value="WEEKLY">{t("app.text0304")}</option><option value="MONTHLY">{t("app.text0305")}</option><option value="QUARTERLY">{t("app.text0306")}</option><option value="YEARLY">{t("app.text0307")}</option></select>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" type="date" value={recurringStartDate} onChange={(e) => setRecurringStartDate(e.target.value)}/>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" required value={recurringDescription} onChange={(e) => setRecurringDescription(e.target.value)} placeholder={t("app.text0166")}/>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" min="0" type="number" value={recurringUnitPrice} onChange={(e) => setRecurringUnitPrice(Number(e.target.value))} placeholder={t("app.text0193")}/>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" min="0" max="100" type="number" value={recurringTaxRate} onChange={(e) => setRecurringTaxRate(Number(e.target.value))} placeholder={t("app.text0308")}/>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" min="0" type="number" value={recurringDueDays} onChange={(e) => setRecurringDueDays(Number(e.target.value))} placeholder={t("app.text0309")}/>
                    <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><input checked={recurringAutoSend} onChange={(e) => setRecurringAutoSend(e.target.checked)} type="checkbox"/>{t("app.text0310")}</label>
                    <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60 md:col-span-3" disabled={recurringCreateMutation.isPending || !recurringCustomerId} type="submit">{recurringCreateMutation.isPending ? t("auditFinal.creating") : t("audit.text0085")}</button>
                  </form>) : null}
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">{t("app.text0311")}</th><th className="px-5 py-3">{t("app.text0161")}</th><th className="px-5 py-3">{t("app.text0312")}</th><th className="px-5 py-3">{t("app.text0313")}</th><th className="px-5 py-3">{t("app.text0163")}</th><th className="px-5 py-3 text-right">{t("app.text0200")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{(recurringPlansQuery.data?.data ?? []).map(plan => <tr key={plan.id}><td className="px-5 py-4 font-medium">{plan.name}<div className="text-xs font-normal text-slate-500">{plan._count?.invoices ?? 0}{t("app.text0189")}</div></td><td className="px-5 py-4">{plan.customer?.company ?? plan.customer?.name}</td><td className="px-5 py-4">{t(`auditFinal.frequency.${plan.frequency}`)}</td><td className="px-5 py-4">{formatShortDate(plan.nextRunDate)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{t(`auditFinal.recurringStatus.${plan.status}`)}</span></td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2">{hasPermission('recurring.run') && plan.status === 'ACTIVE' ? <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={() => recurringRunMutation.mutate(plan.id)} type="button">{t("app.text0314")}</button> : null}{hasPermission('recurring.update') && plan.status === 'ACTIVE' ? <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={() => recurringStatusMutation.mutate({ id: plan.id, status: 'PAUSED' })} type="button">{t("app.text0315")}</button> : null}{hasPermission('recurring.update') && plan.status === 'PAUSED' ? <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={() => recurringStatusMutation.mutate({ id: plan.id, status: 'ACTIVE' })} type="button">{t("app.text0316")}</button> : null}{hasPermission('recurring.update') && !['CANCELLED', 'COMPLETED'].includes(plan.status) ? <button className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600" onClick={() => recurringStatusMutation.mutate({ id: plan.id, status: 'CANCELLED' })} type="button">{t("app.text0203")}</button> : null}</div></td></tr>)}</tbody></table>
                {!recurringPlansQuery.isLoading && !(recurringPlansQuery.data?.data.length) ? <p className="p-5 text-sm text-slate-500">{t("app.text0317")}</p> : null}
              </div>
            </section>) : null}

          {activeView === 'payments' ? (<section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{t("app.text0318")}</h2>
                  <p className="text-sm text-slate-500">
                    {t('i18nDynamic.paymentListSummary', {
                        visible: payments.length,
                        total: paymentQuery.data?.meta.total ?? 0,
                    })}
                  </p>
                </div>
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{t("app.text0319")}{formatCurrency(paymentQuery.data?.summary.totalAmount ?? 0)}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">{t("app.text0192")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0191")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0161")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0320")}</th>
                      <th className="px-5 py-3 font-medium">{t("app.text0321")}</th>
                      <th className="px-5 py-3 text-right font-medium">{t("app.text0193")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((payment) => (<tr className="hover:bg-slate-50" key={payment.id}>
                        <td className="px-5 py-4 text-slate-600">
                          {formatShortDate(payment.paymentDate)}
                        </td>
                        <td className="px-5 py-4">
                          {payment.invoice ? (<button className="font-medium text-slate-900 transition hover:text-primary" onClick={() => setViewInvoiceId(payment.invoice!.id)} type="button">
                              {payment.invoice.invoiceNumber}
                            </button>) : ('-')}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {payment.invoice?.customer?.company ??
                    payment.invoice?.customer?.name ??
                    '-'}
                        </td>
                        <td className="px-5 py-4 text-slate-600">{t(`auditFinal.paymentMethod.${payment.method}`)}</td>
                        <td className="px-5 py-4 text-slate-500">{payment.reference ?? '-'}</td>
                        <td className="px-5 py-4 text-right font-semibold">
                          {formatCurrency(Number(payment.amount), payment.invoice?.currency ?? 'MAD')}
                        </td>
                      </tr>))}
                  </tbody>
                </table>
                {!paymentQuery.isLoading && payments.length === 0 ? (<p className="p-5 text-sm text-slate-500">{t("app.text0322")}</p>) : null}
              </div>
              {paymentQuery.data?.meta ? (<div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-slate-500">{t("app.text0205")}{paymentQuery.data.meta.page}{t("app.text0197")}{paymentQuery.data.meta.totalPages || 1}
                  </p>
                  <div className="flex gap-2">
                    <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={paymentQuery.data.meta.page <= 1 || paymentQuery.isFetching} onClick={() => setPaymentPage((page) => Math.max(1, page - 1))} type="button">{t("app.text0206")}</button>
                    <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={paymentQuery.data.meta.page >= paymentQuery.data.meta.totalPages ||
                    paymentQuery.isFetching} onClick={() => setPaymentPage((page) => page + 1)} type="button">{t("app.text0207")}</button>
                  </div>
                </div>) : null}
            </section>) : null}

          {activeView === 'reports' ? (<section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Metric helper={t('i18nDynamic.openInvoiceCount', { count: receivablesAgingQuery.data?.totalInvoices ?? 0 })} icon={AlertTriangle} label={t("audit.text0086")} tone="danger" value={formatCurrency(receivablesAgingQuery.data?.totalAmount ?? 0)}/>
                <Metric helper={t("audit.text0087")} icon={CalendarClock} label={t("audit.text0088")} value={receivablesAgingQuery.data ? formatShortDate(receivablesAgingQuery.data.generatedAt) : '-'}/>
                <Metric helper={t("audit.text0089")} icon={ReceiptText} label={t("audit.buckets")} value={String(receivablesAgingQuery.data?.buckets.length ?? 0)}/>
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                {(receivablesAgingQuery.data?.buckets ?? []).map((bucket) => (<div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={bucket.key}>
                    <p className="text-sm font-semibold text-slate-900">{bucket.label}</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">
                      {formatCurrency(bucket.amount)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t('i18nDynamic.invoiceCount', { count: bucket.invoiceCount })}
                    </p>
                  </div>))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0323")}</h2>
                    <p className="text-sm text-slate-500">{t("app.text0324")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReportDateFrom(event.target.value)} title={t("app.text0138")} type="date" value={reportDateFrom}/>
                    <input className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReportDateTo(event.target.value)} title={t("app.text0139")} type="date" value={reportDateTo}/>
                    <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={exportingTarget === 'tax-report' || taxSummaryQuery.isLoading} onClick={handleExportTaxReport} type="button">
                      <Download className="h-4 w-4"/>
                      {exportingTarget === 'tax-report' ? t('i18nDynamic.exporting') : t("audit.text0090")}
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 p-5 md:grid-cols-4">
                  <Metric helper={t('i18nDynamic.invoiceCount', { count: taxSummaryQuery.data?.totals.invoiceCount ?? 0 })} icon={ReceiptText} label={t("audit.text0091")} value={formatCurrency(taxSummaryQuery.data?.totals.subtotal ?? 0)}/>
                  <Metric helper={t("audit.text0092")} icon={AlertTriangle} label={t("audit.text0093")} value={formatCurrency(taxSummaryQuery.data?.totals.taxAmount ?? 0)}/>
                  <Metric helper={t("audit.text0094")} icon={WalletCards} label={t("audit.text0095")} value={formatCurrency(taxSummaryQuery.data?.totals.total ?? 0)}/>
                  <Metric helper={t("audit.text0096")} icon={CheckCircle2} label={t("audit.collected")} value={formatCurrency(taxSummaryQuery.data?.totals.amountPaid ?? 0)}/>
                </div>
                <div className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">{t("app.text0325")}</h3>
                    <div className="mt-3 space-y-3">
                      {(taxSummaryQuery.data?.taxRates ?? []).map((rate) => (<div className="rounded-md bg-white p-3 ring-1 ring-slate-200" key={rate.taxRate}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-slate-900">{rate.taxRate}%</p>
                            <p className="text-xs text-slate-500">
                              {t('i18nDynamic.invoiceCount', { count: rate.invoiceCount })}
                            </p>
                          </div>
                          <p className="mt-2 text-sm text-slate-600">{t("app.text0181")}{formatCurrency(rate.taxAmount)}{t("app.text0326")}{formatCurrency(rate.total)}
                          </p>
                        </div>))}
                      {!taxSummaryQuery.isLoading && !taxSummaryQuery.data?.taxRates.length ? (<p className="text-sm text-slate-500">{t("app.text0327")}</p>) : null}
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">{t("app.text0191")}</th>
                          <th className="px-4 py-3 font-medium">{t("app.text0161")}</th>
                          <th className="px-4 py-3 font-medium">{t("app.text0141")}</th>
                          <th className="px-4 py-3 text-right font-medium">{t("app.text0328")}</th>
                          <th className="px-4 py-3 text-right font-medium">{t("app.text0181")}</th>
                          <th className="px-4 py-3 text-right font-medium">{t("app.text0329")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(taxSummaryQuery.data?.invoices ?? []).slice(0, 8).map((invoice) => (<tr className="hover:bg-slate-50" key={invoice.id}>
                            <td className="px-4 py-3">
                              <button className="font-medium text-slate-900 transition hover:text-primary" onClick={() => setViewInvoiceId(invoice.id)} type="button">
                                {invoice.invoiceNumber}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{invoice.customer}</td>
                            <td className="px-4 py-3 text-slate-600">{formatShortDate(invoice.issueDate)}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(invoice.subtotal, invoice.currency)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-xs text-slate-500">{invoice.taxRate}%</span>{' '}
                              {formatCurrency(invoice.taxAmount, invoice.currency)}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {formatCurrency(invoice.total, invoice.currency)}
                            </td>
                          </tr>))}
                      </tbody>
                    </table>
                    {taxSummaryQuery.isLoading ? (<p className="p-5 text-sm text-slate-500">{t("app.text0330")}</p>) : null}
                    {!taxSummaryQuery.isLoading && taxSummaryQuery.data?.invoices.length === 0 ? (<p className="p-5 text-sm text-slate-500">{t("app.text0331")}</p>) : null}
                    {(taxSummaryQuery.data?.invoices.length ?? 0) > 8 ? (<p className="border-t border-slate-100 p-3 text-xs text-slate-500">{t("app.text0332")}</p>) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{t("app.text0333")}</h2>
                    <p className="text-sm text-slate-500">{t("app.text0334")}</p>
                  </div>
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={exportingTarget === 'reports' || receivablesAgingQuery.isLoading} onClick={handleExportReceivablesReport} type="button">
                    <Download className="h-4 w-4"/>
                    {exportingTarget === 'reports' ? t('i18nDynamic.exporting') : t('i18nDynamic.export')}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">{t("app.text0191")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0161")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0335")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0142")}</th>
                        <th className="px-5 py-3 font-medium">{t("app.text0163")}</th>
                        <th className="px-5 py-3 text-right font-medium">{t("app.text0144")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {receivablesInvoices.map((invoice) => (<tr className="hover:bg-slate-50" key={invoice.id}>
                          <td className="px-5 py-4">
                            <button className="font-medium text-slate-900 transition hover:text-primary" onClick={() => setViewInvoiceId(invoice.id)} type="button">
                              {invoice.invoiceNumber}
                            </button>
                          </td>
                          <td className="px-5 py-4 text-slate-600">{invoice.customer}</td>
                          <td className="px-5 py-4 text-slate-600">{invoice.bucket}</td>
                          <td className="px-5 py-4 text-slate-600">
                            <p>{formatShortDate(invoice.dueDate)}</p>
                            <p className="text-xs text-slate-500">
                              {invoice.daysLate > 0
                    ? t('i18nDynamic.daysLate', { count: invoice.daysLate })
                    : t("audit.text0097")}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                              {getStatusLabel(invoice.status)}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-semibold">
                            {formatCurrency(invoice.balanceDue, invoice.currency)}
                          </td>
                        </tr>))}
                    </tbody>
                  </table>
                  {receivablesAgingQuery.isLoading ? (<p className="p-5 text-sm text-slate-500">{t("app.text0336")}</p>) : null}
                  {!receivablesAgingQuery.isLoading && receivablesInvoices.length === 0 ? (<p className="p-5 text-sm text-slate-500">{t("app.text0337")}</p>) : null}
                </div>
              </div>
            </section>) : null}

          {activeView === 'reminders' ? (<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">{t("app.text0338")}</h2>
                      <p className="text-sm text-slate-500">
                        {t('i18nDynamic.reminderListSummary', {
                            visible: reminders.length,
                            total: reminderQuery.data?.meta.total ?? 0,
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReminderStatusFilter(event.target.value as ReminderStatus | 'ALL')} value={reminderStatusFilter}>
                        <option value="ALL">{t("app.text0137")}</option>
                        <option value="PENDING">{t("app.text0340")}</option>
                        <option value="SENT">{t("app.text0165")}</option>
                        <option value="FAILED">{t("app.text0341")}</option>
                      </select>
                      <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReminderTypeFilter(event.target.value as ReminderType | 'ALL')} value={reminderTypeFilter}>
                        <option value="ALL">{t("app.text0342")}</option>
                        <option value="BEFORE_DUE">{t("app.text0343")}</option>
                        <option value="ON_DUE">{t("app.text0344")}</option>
                        <option value="AFTER_DUE">{t("app.text0345")}</option>
                        <option value="MANUAL">{t("app.text0346")}</option>
                      </select>
                      {isAdmin ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={automaticReminderMutation.isPending} onClick={() => automaticReminderMutation.mutate()} type="button">
                          <CalendarClock className="h-4 w-4"/>
                          {automaticReminderMutation.isPending ? 'Generation...' : t("audit.text0098")}
                        </button>) : null}
                      <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={exportingTarget === 'reminders'} onClick={handleExportReminders} type="button">
                        <Download className="h-4 w-4"/>
                        {exportingTarget === 'reminders' ? t('i18nDynamic.exporting') : t('i18nDynamic.export')}
                      </button>
                      <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={resetReminderFilters} type="button">{t("app.text0148")}</button>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {reminders.map((reminder) => (<ReminderRow key={reminder.id} reminder={reminder}/>))}
                  {reminders.length === 0 ? (<p className="p-5 text-sm text-slate-500">{t("app.text0347")}</p>) : null}
                </div>
                {reminderQuery.data?.meta ? (<div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-slate-500">{t("app.text0205")}{reminderQuery.data.meta.page}{t("app.text0197")}{reminderQuery.data.meta.totalPages || 1}
                    </p>
                    <div className="flex gap-2">
                      <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={reminderQuery.data.meta.page <= 1 || reminderQuery.isFetching} onClick={() => setReminderPage((page) => Math.max(1, page - 1))} type="button">{t("app.text0206")}</button>
                      <button className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={reminderQuery.data.meta.page >= reminderQuery.data.meta.totalPages ||
                    reminderQuery.isFetching} onClick={() => setReminderPage((page) => page + 1)} type="button">{t("app.text0207")}</button>
                    </div>
                  </div>) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">{t("app.text0348")}</h2>
                <p className="text-sm text-slate-500">{t("app.text0349")}</p>
                <form className="mt-5 space-y-2" onSubmit={handleCreateManualReminder}>
                  <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReminderInvoiceId(event.target.value)} value={reminderInvoiceId}>
                    <option value="">{t("app.text0350")}</option>
                    {payableInvoices.map((invoice) => (<option key={invoice.id} value={invoice.id}>
                        {invoice.number} - {invoice.customer}
                      </option>))}
                  </select>
                  <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReminderDraftType(event.target.value as ReminderType)} value={reminderDraftType}>
                    <option value="MANUAL">{t("app.text0346")}</option>
                    <option value="BEFORE_DUE">{t("app.text0343")}</option>
                    <option value="ON_DUE">{t("app.text0344")}</option>
                    <option value="AFTER_DUE">{t("app.text0345")}</option>
                  </select>
                  <input className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReminderSubject(event.target.value)} placeholder={t("app.text0351")} value={reminderSubject}/>
                  <textarea className="min-h-28 w-full rounded-md border border-slate-200 bg-white p-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setReminderBody(event.target.value)} placeholder={t("app.text0352")} value={reminderBody}/>
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input checked={reminderSendEmail} onChange={(event) => setReminderSendEmail(event.target.checked)} type="checkbox"/>{t("app.text0353")}</label>
                  <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={reminderMutation.isPending} type="submit">
                    <Mail className="h-4 w-4"/>
                    {reminderMutation.isPending ? t("auditFinal.creating") : t("audit.text0099")}
                  </button>
                </form>

                <div className="mt-6 border-t border-slate-200 pt-5">
                  <h3 className="text-sm font-semibold">{t("app.text0354")}</h3>
                  <div className="mt-3 space-y-3">
                  {payableInvoices.slice(0, 5).map((invoice) => (<div className="rounded-md border border-slate-200 p-3" key={invoice.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{invoice.customer}</p>
                          <p className="text-xs text-slate-500">{invoice.number}</p>
                        </div>
                        <p className="text-sm font-semibold">{formatCurrency(invoice.total - invoice.paid)}</p>
                      </div>
                      <button className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={reminderMutation.isPending} onClick={() => {
                    setReminderInvoiceId(invoice.id);
                    setReminderDraftType(invoice.status === 'OVERDUE' ? 'AFTER_DUE' : 'BEFORE_DUE');
                }} type="button">
                        <Mail className="h-3.5 w-3.5"/>{t("app.text0355")}</button>
                    </div>))}
                  </div>
                </div>
              </div>
            </section>) : null}
        </div>
      </section>
      {viewDevisId ? (<DevisDetailPanel canDeleteDevis={hasPermission('devis.delete')} canSignDevis={hasPermission('devis.sign')} canUpdateDevis={hasPermission('devis.update')} devis={devisDetailQuery.data} isLoading={devisDetailQuery.isLoading} isActionPending={devisActionMutation.isPending} onApprove={(devis) => devisActionMutation.mutate({ devisId: devis.id, action: 'approve' })} onCancelSignature={(devis) => handleConfirmedDevisAction(devis, 'cancelSignature')} onClose={() => setViewDevisId('')} onConvert={(devis) => handleConfirmedDevisAction(devis, 'convert')} onDelete={(devis) => handleConfirmedDevisAction(devis, 'delete')} onDownload={(devis) => downloadDevisPdf(devis.id, devis.devisNumber)} onEdit={handleEditDevis} onOpenInvoice={(invoiceId) => setViewInvoiceId(invoiceId)} onReject={(devis) => handleConfirmedDevisAction(devis, 'reject')} onSend={(devis) => devisActionMutation.mutate({ devisId: devis.id, action: 'send' })} onSign={(devis) => handleConfirmedDevisAction(devis, 'sign')}/>) : null}
      {viewInvoiceId ? (<InvoiceDetailPanel invoice={invoiceDetailQuery.data} isLoading={invoiceDetailQuery.isLoading} canSignInvoices={isAdmin} companySettings={companySettingsQuery.data} isCancelSignaturePending={cancelInvoiceSignatureMutation.isPending} onClose={() => setViewInvoiceId('')} onCancelSignature={handleCancelInvoiceSignature} onDownload={(invoice) => downloadInvoicePdf(invoice.id, invoice.invoiceNumber)} onEdit={handleEditInvoice} onEmail={openInvoiceEmailModal} onOpenDevis={(devisId) => setViewDevisId(devisId)} onOpenCreditNotes={() => {
                setViewInvoiceId('');
                handleViewChange('credit-notes');
            }} onPaymentSubmit={handleRecordDetailPayment} onPrint={handlePrintInvoicePdf} onStatusChange={(invoice, status) => invoiceStatusMutation.mutate({
                invoiceId: invoice.id,
                status,
            })} onSign={handleSignInvoice} onPrepareReminder={(invoice) => handlePrepareReminder({
                id: invoice.id,
                number: invoice.invoiceNumber,
                customer: invoice.customer?.company ?? invoice.customer?.name ?? t('auditFinal.clientFallback'),
                status: invoice.status,
                issueDate: invoice.issueDate,
                dueDate: invoice.dueDate,
                total: Number(invoice.total),
                paid: Number(invoice.amountPaid),
            })} paymentAmount={paymentAmount} paymentEntryDate={paymentEntryDate} paymentMethod={paymentMethod} paymentReference={paymentReference} setPaymentAmount={setPaymentAmount} setPaymentEntryDate={setPaymentEntryDate} setPaymentMethod={setPaymentMethod} setPaymentReference={setPaymentReference} isPaymentPending={paymentMutation.isPending} isEmailPending={invoiceEmailMutation.isPending} isStatusPending={invoiceStatusMutation.isPending} isSignPending={signInvoiceMutation.isPending}/>) : null}
      {viewCustomerId ? (<CustomerDetailPanel customer={selectedCustomer} invoices={(customerInvoiceQuery.data?.data ?? []).map(mapInvoiceToSummary)} isLoading={customerDetailQuery.isLoading || customerInvoiceQuery.isLoading} onClose={() => setViewCustomerId('')} onCreateInvoice={handleCreateInvoiceForCustomer} onEdit={(customer) => {
                handleEditCustomer(customer);
                setViewCustomerId('');
            }} onOpenInvoice={(invoiceId) => {
                setViewCustomerId('');
                setViewInvoiceId(invoiceId);
            }}/>) : null}
      {assetEditor ? (<AssetEditorModal imageUrl={assetEditor.imageUrl} autoProcess={assetEditor.autoProcess} kind={assetEditor.kind} onCancel={() => setAssetEditor(null)} onAutoProcessChange={handleAutoBackgroundRemovalPreferenceChange} onConfirm={(blob) => handleConfirmAssetEdit(assetEditor.kind, blob)} title={assetEditor.title}/>) : null}
      {emailInvoiceId ? (<div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
          <button aria-label={t("app.text0160")} className="absolute inset-0 h-full w-full cursor-default" onClick={closeInvoiceEmailModal} type="button"/>
          <form className="relative w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl" onSubmit={handleSendInvoiceEmail}>
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-base font-semibold">{t("app.text0356")}</h2>
              <p className="text-sm text-slate-500">{t("app.text0357")}</p>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-medium text-slate-600">{t("app.text0358")}<input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceEmailRecipient(event.target.value)} type="email" value={invoiceEmailRecipient}/>
              </label>
              <label className="block text-xs font-medium text-slate-600">{t("app.text0359")}<input className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceEmailSubject(event.target.value)} value={invoiceEmailSubject}/>
              </label>
              <label className="block text-xs font-medium text-slate-600">{t("app.text0360")}<textarea className="mt-1 min-h-44 w-full rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setInvoiceEmailMessage(event.target.value)} value={invoiceEmailMessage}/>
              </label>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
              <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={closeInvoiceEmailModal} type="button">{t("app.text0203")}</button>
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={invoiceEmailMutation.isPending} type="submit">
                <Mail className="h-4 w-4"/>
                {invoiceEmailMutation.isPending ? t('i18nDynamic.sending') : t('i18nDynamic.send')}
              </button>
            </div>
          </form>
        </div>) : null}
      {hasPermission('ai_assistant.access') ? (<AiAdminAssistant context={aiAssistantContext} getApiErrorMessage={getApiErrorMessage}/>) : null}
    </main>);
}
type EditorTool = 'erase' | 'restore' | 'pan';
type EditorSnapshot = {
    dataUrl: string;
    width: number;
    height: number;
};
function AssetEditorModal({ imageUrl, autoProcess, kind, title, onCancel, onAutoProcessChange, onConfirm, }: {
    imageUrl: string;
    autoProcess: boolean;
    kind: CompanyAssetKind;
    title: string;
    onCancel: () => void;
    onAutoProcessChange: (enabled: boolean) => void;
    onConfirm: (blob: Blob) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const restoreCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const originalImageRef = useRef<HTMLImageElement | null>(null);
    const pointerRef = useRef<{
        x: number;
        y: number;
        panX: number;
        panY: number;
    } | null>(null);
    const autoProcessedSourceRef = useRef('');
    const [isLoading, setIsLoading] = useState(true);
    const [tool, setTool] = useState<EditorTool>('erase');
    const [brushSize, setBrushSize] = useState(26);
    const [zoom, setZoom] = useState(1);
    const [opacity, setOpacity] = useState(100);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [lockRatio, setLockRatio] = useState(true);
    const [dimensions, setDimensions] = useState({
        width: kind === 'signature' ? 600 : 500,
        height: kind === 'signature' ? 250 : 500,
    });
    const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 1, height: 1 });
    const [history, setHistory] = useState<EditorSnapshot[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [message, setMessage] = useState('');
    const recommended = kind === 'signature' ? '600 x 250 px' : '500 x 500 px';
    const pushHistory = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const snapshot = {
            dataUrl: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
        };
        setHistory((items) => [...items.slice(0, historyIndex + 1), snapshot].slice(-30));
        setHistoryIndex((index) => Math.min(index + 1, 29));
    }, [historyIndex]);
    const renderSource = useCallback(async (sourceUrl: string, targetWidth = dimensions.width, targetHeight = dimensions.height) => {
        setIsLoading(true);
        setMessage('');
        try {
            const image = await loadCanvasImage(sourceUrl);
            originalImageRef.current = image;
            const canvas = canvasRef.current;
            const restoreCanvas = restoreCanvasRef.current;
            if (!canvas || !restoreCanvas)
                return;
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            restoreCanvas.width = targetWidth;
            restoreCanvas.height = targetHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const restoreContext = restoreCanvas.getContext('2d', { willReadFrequently: true });
            if (!context || !restoreContext)
                return;
            context.clearRect(0, 0, targetWidth, targetHeight);
            restoreContext.clearRect(0, 0, targetWidth, targetHeight);
            context.drawImage(image, 0, 0, targetWidth, targetHeight);
            restoreContext.drawImage(image, 0, 0, targetWidth, targetHeight);
            setDimensions({ width: targetWidth, height: targetHeight });
            setCropRect({ x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight });
            setHistory([
                {
                    dataUrl: canvas.toDataURL('image/png'),
                    width: canvas.width,
                    height: canvas.height,
                },
            ]);
            setHistoryIndex(0);
        }
        catch {
            setMessage(t("audit.text0100"));
        }
        finally {
            setIsLoading(false);
        }
    }, [dimensions.height, dimensions.width]);
    useEffect(() => {
        void renderSource(imageUrl);
    }, [imageUrl, renderSource]);
    const restoreSnapshot = (snapshot: EditorSnapshot) => {
        const canvas = canvasRef.current;
        const restoreCanvas = restoreCanvasRef.current;
        if (!canvas || !restoreCanvas)
            return;
        const image = new Image();
        image.onload = () => {
            canvas.width = snapshot.width;
            canvas.height = snapshot.height;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context)
                return;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0);
            setDimensions({ width: snapshot.width, height: snapshot.height });
            redrawRestoreCanvas(snapshot.width, snapshot.height);
        };
        image.src = snapshot.dataUrl;
    };
    const redrawRestoreCanvas = (width: number, height: number) => {
        const image = originalImageRef.current;
        const restoreCanvas = restoreCanvasRef.current;
        const context = restoreCanvas?.getContext('2d', { willReadFrequently: true });
        if (!image || !restoreCanvas || !context)
            return;
        restoreCanvas.width = width;
        restoreCanvas.height = height;
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
    };
    const handleAutoRemove = useCallback(async () => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        if (!canvas || !context)
            return;
        setIsLoading(true);
        setMessage(t("audit.text0101"));
        try {
            const sourceBlob = await canvasToPngBlob(canvas);
            const transparentBlob = await removeCompanyAssetBackgroundPreview(new File([sourceBlob], `${kind}-source.png`, { type: 'image/png' }));
            const transparentUrl = URL.createObjectURL(transparentBlob);
            const resultImage = await loadCanvasImage(transparentUrl);
            URL.revokeObjectURL(transparentUrl);
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(resultImage, 0, 0, canvas.width, canvas.height);
            pushHistory();
            setMessage(t("audit.text0102"));
        }
        catch (error) {
            setMessage(getApiErrorMessage(error, t("audit.text0103")));
        }
        finally {
            setIsLoading(false);
        }
    }, [kind, pushHistory]);
    useEffect(() => {
        if (!autoProcess || isLoading || autoProcessedSourceRef.current === imageUrl || historyIndex < 0) {
            return;
        }
        autoProcessedSourceRef.current = imageUrl;
        void handleAutoRemove();
    }, [autoProcess, handleAutoRemove, historyIndex, imageUrl, isLoading]);
    const handleUndo = () => {
        if (historyIndex <= 0)
            return;
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        restoreSnapshot(history[nextIndex]);
    };
    const handleRedo = () => {
        if (historyIndex >= history.length - 1)
            return;
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        restoreSnapshot(history[nextIndex]);
    };
    const handleReset = () => {
        void renderSource(imageUrl);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setMessage(t("audit.text0104"));
    };
    const handleRotate = () => {
        const canvas = canvasRef.current;
        const restoreCanvas = restoreCanvasRef.current;
        if (!canvas || !restoreCanvas)
            return;
        rotateCanvas(canvas);
        rotateCanvas(restoreCanvas);
        setDimensions({ width: canvas.width, height: canvas.height });
        pushHistory();
    };
    const handleResize = (nextWidth: number, nextHeight: number) => {
        const width = clampInt(nextWidth, 20, 2000);
        const height = clampInt(nextHeight, 20, 2000);
        resizeCanvas(canvasRef.current, width, height);
        redrawRestoreCanvas(width, height);
        setDimensions({ width, height });
        pushHistory();
    };
    const handleDimensionChange = (key: 'width' | 'height', value: number) => {
        const cleanValue = clampInt(value, 20, 2000);
        if (!lockRatio) {
            setDimensions((current) => ({ ...current, [key]: cleanValue }));
            return;
        }
        const ratio = dimensions.width / Math.max(1, dimensions.height);
        setDimensions(key === 'width'
            ? { width: cleanValue, height: clampInt(Math.round(cleanValue / ratio), 20, 2000) }
            : { width: clampInt(Math.round(cleanValue * ratio), 20, 2000), height: cleanValue });
    };
    const handleApplyCrop = () => {
        const image = originalImageRef.current;
        const canvas = canvasRef.current;
        const restoreCanvas = restoreCanvasRef.current;
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        const restoreContext = restoreCanvas?.getContext('2d', { willReadFrequently: true });
        if (!image || !canvas || !restoreCanvas || !context || !restoreContext)
            return;
        const cropX = clampInt(cropRect.x, 0, image.naturalWidth - 1);
        const cropY = clampInt(cropRect.y, 0, image.naturalHeight - 1);
        const cropWidth = clampInt(cropRect.width, 1, image.naturalWidth - cropX);
        const cropHeight = clampInt(cropRect.height, 1, image.naturalHeight - cropY);
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        restoreCanvas.width = dimensions.width;
        restoreCanvas.height = dimensions.height;
        context.clearRect(0, 0, canvas.width, canvas.height);
        restoreContext.clearRect(0, 0, restoreCanvas.width, restoreCanvas.height);
        context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        restoreContext.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        pushHistory();
        setMessage(t("audit.text0105"));
    };
    const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas)
            return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * canvas.height,
        };
    };
    const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        if (tool === 'pan') {
            pointerRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
            return;
        }
        drawEditorBrush(getCanvasPoint(event), tool, brushSize);
    };
    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (event.buttons !== 1)
            return;
        if (tool === 'pan' && pointerRef.current) {
            setPan({
                x: pointerRef.current.panX + event.clientX - pointerRef.current.x,
                y: pointerRef.current.panY + event.clientY - pointerRef.current.y,
            });
            return;
        }
        drawEditorBrush(getCanvasPoint(event), tool, brushSize);
    };
    const handlePointerUp = () => {
        pointerRef.current = null;
        if (tool !== 'pan') {
            pushHistory();
        }
    };
    const drawEditorBrush = (point: {
        x: number;
        y: number;
    }, brushTool: EditorTool, size: number) => {
        const canvas = canvasRef.current;
        const restoreCanvas = restoreCanvasRef.current;
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        const restoreContext = restoreCanvas?.getContext('2d', { willReadFrequently: true });
        if (!canvas || !context)
            return;
        context.save();
        context.beginPath();
        context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
        context.clip();
        if (brushTool === 'erase') {
            context.clearRect(point.x - size / 2, point.y - size / 2, size, size);
        }
        else if (restoreContext && restoreCanvas) {
            context.drawImage(restoreCanvas, point.x - size / 2, point.y - size / 2, size, size, point.x - size / 2, point.y - size / 2, size, size);
        }
        context.restore();
    };
    const handleConfirm = async () => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        setIsLoading(true);
        try {
            const blob = await canvasToPngBlobWithOpacity(canvas, opacity / 100);
            onConfirm(blob);
        }
        catch {
            setMessage(t("audit.text0106"));
        }
        finally {
            setIsLoading(false);
        }
    };
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-sm text-slate-500">{t("app.text0361")}{recommended}{t("app.text0362")}{dimensions.width}{t("app.text0363")}{dimensions.height}{t("app.text0364")}</p>
          </div>
          <div className="flex gap-2">
            <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" disabled={isLoading} onClick={onCancel} type="button">{t("app.text0203")}</button>
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={isLoading} onClick={handleConfirm} type="button">
              <CheckCircle2 className="h-4 w-4"/>{t("app.text0365")}</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4 border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
            {message ? (<p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">{message}</p>) : null}
            <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <input checked={autoProcess} className="mt-1 accent-primary" disabled={isLoading} onChange={(event) => onAutoProcessChange(event.target.checked)} type="checkbox"/>
              <span>
                <span className="block font-medium">{t("app.text0366")}</span>
                <span className="block text-xs text-slate-500">{t("app.text0367")}</span>
              </span>
            </label>
            <button className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60" disabled={isLoading} onClick={handleAutoRemove} type="button">
              <Eraser className="h-4 w-4"/>{t("app.text0368")}</button>

            <div className="grid grid-cols-3 gap-2">
              <ToolButton active={tool === 'erase'} icon={Eraser} label={t("audit.text0131")} onClick={() => setTool('erase')}/>
              <ToolButton active={tool === 'restore'} icon={RefreshCcw} label={t("audit.text0132")} onClick={() => setTool('restore')}/>
              <ToolButton active={tool === 'pan'} icon={Move} label={t("audit.text0133")} onClick={() => setTool('pan')}/>
            </div>

            <label className="block text-xs font-medium text-slate-600">{t("app.text0369")}{brushSize}{t("app.text0370")}<input className="mt-2 w-full accent-primary" max={120} min={4} onChange={(event) => setBrushSize(Number(event.target.value))} type="range" value={brushSize}/>
            </label>

            <label className="block text-xs font-medium text-slate-600">{t("app.text0371")}{opacity}%
              <input className="mt-2 w-full accent-primary" max={100} min={5} onChange={(event) => setOpacity(Number(event.target.value))} type="range" value={opacity}/>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleUndo} type="button">
                <Undo2 className="mx-auto h-4 w-4"/>
              </button>
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleRedo} type="button">
                <Redo2 className="mx-auto h-4 w-4"/>
              </button>
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleRotate} type="button">
                <RotateCw className="mx-auto h-4 w-4"/>
              </button>
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleReset} type="button">{t("app.text0372")}</button>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{t("app.text0373")}</p>
                <button className="rounded-md border border-slate-200 p-1" onClick={() => setLockRatio((value) => !value)} type="button">
                  {lockRatio ? <Lock className="h-4 w-4"/> : <Unlock className="h-4 w-4"/>}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t("audit.text0134")} onChange={(value) => handleDimensionChange('width', value)} value={dimensions.width}/>
                <NumberField label={t("audit.text0135")} onChange={(value) => handleDimensionChange('height', value)} value={dimensions.height}/>
              </div>
              <button className="mt-2 h-8 w-full rounded-md border border-slate-200 text-sm font-medium" onClick={() => handleResize(dimensions.width, dimensions.height)} type="button">{t("app.text0374")}</button>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Crop className="h-4 w-4"/>{t("app.text0375")}</p>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t("audit.cropX")} onChange={(value) => setCropRect((rect) => ({ ...rect, x: value }))} value={cropRect.x}/>
                <NumberField label={t("audit.cropY")} onChange={(value) => setCropRect((rect) => ({ ...rect, y: value }))} value={cropRect.y}/>
                <NumberField label={t("audit.cropWidth")} onChange={(value) => setCropRect((rect) => ({ ...rect, width: value }))} value={cropRect.width}/>
                <NumberField label={t("audit.cropHeight")} onChange={(value) => setCropRect((rect) => ({ ...rect, height: value }))} value={cropRect.height}/>
              </div>
              <button className="mt-2 h-8 w-full rounded-md border border-slate-200 text-sm font-medium" onClick={handleApplyCrop} type="button">{t("app.text0376")}</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button className="h-9 rounded-md border border-slate-200" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} type="button">
                <ZoomOut className="mx-auto h-4 w-4"/>
              </button>
              <button className="h-9 rounded-md border border-slate-200" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} type="button">
                <ZoomIn className="mx-auto h-4 w-4"/>
              </button>
            </div>
          </aside>

          <div className="grid gap-4 p-4 xl:grid-cols-2">
            <section>
              <p className="mb-2 text-sm font-semibold">{t("app.text0377")}</p>
              <div className="flex min-h-72 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
                <img alt={t("app.text0377")} className="max-h-[520px] max-w-full object-contain" src={imageUrl}/>
              </div>
            </section>
            <section>
              <p className="mb-2 text-sm font-semibold">{t("app.text0378")}</p>
              <div className="transparent-preview flex min-h-72 items-center justify-center overflow-hidden rounded-lg border border-slate-200 p-3">
                {isLoading ? <p className="text-sm text-slate-500">{t("app.text0379")}</p> : null}
                <canvas className={isLoading ? 'hidden' : 'touch-none rounded-md shadow-sm'} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} ref={canvasRef} style={{
            cursor: tool === 'pan' ? 'grab' : 'crosshair',
            opacity: opacity / 100,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center',
            maxWidth: '100%',
            maxHeight: '520px',
        }}/>
                <canvas className="hidden" ref={restoreCanvasRef}/>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>);
}
function ToolButton({ active, icon: Icon, label, onClick, }: {
    active: boolean;
    icon: typeof Eraser;
    label: string;
    onClick: () => void;
}) {
    return (<button className={`inline-flex h-9 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium ${active
            ? 'border-primary bg-primary text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`} onClick={onClick} type="button">
      <Icon className="h-3.5 w-3.5"/>
      {label}
    </button>);
}
function NumberField({ label, value, onChange, }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (<label className="block text-xs font-medium text-slate-600">
      {label}
      <input className="mt-1 h-8 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 focus:ring-4" min={0} onChange={(event) => onChange(Number(event.target.value))} type="number" value={Number.isFinite(value) ? value : 0}/>
    </label>);
}
type MetricProps = {
    icon: typeof ReceiptText;
    label: string;
    value: string;
    helper: string;
    tone?: 'default' | 'danger' | 'warning';
};
function DashboardSkeleton() {
    return (<div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (<div className="animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={index}>
            <div className="h-4 w-24 rounded bg-slate-200"/>
            <div className="mt-4 h-8 w-32 rounded bg-slate-200"/>
            <div className="mt-5 h-3 w-36 rounded bg-slate-100"/>
          </div>))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-80 animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-full rounded-md bg-slate-100"/>
        </div>
        <div className="h-80 animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-full rounded-md bg-slate-100"/>
        </div>
      </div>
    </div>);
}
function DashboardError({ onRetry }: {
    onRetry: () => void;
}) {
    return (<div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-700">
      <p className="font-semibold">{t("app.text0380")}</p>
      <p className="mt-1 text-sm">{t("app.text0381")}</p>
      <button className="mt-4 h-9 rounded-md bg-rose-600 px-3 text-sm font-medium text-white transition hover:bg-rose-700" onClick={onRetry} type="button">{t("app.text0382")}</button>
    </div>);
}
function DashboardPanel({ children, description, title, }: {
    children: ReactNode;
    description: string;
    title: string;
}) {
    return (<div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </div>);
}
function DashboardEmptyState({ text }: {
    text: string;
}) {
    return (<div className="flex min-h-52 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {text}
    </div>);
}
function Metric({ icon: Icon, label, value, helper, tone = 'default' }: MetricProps) {
    const toneClass = {
        default: 'metric-icon-primary bg-indigo-50 text-primary',
        danger: 'metric-icon-danger bg-rose-50 text-rose-600',
        warning: 'metric-icon-warning bg-amber-50 text-amber-600',
    }[tone];
    return (<article className={`metric-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm metric-${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="metric-label text-sm font-medium text-slate-500">{label}</p>
          <p className="metric-value mt-2 text-2xl font-semibold">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-5 w-5"/>
        </div>
      </div>
      <p className="metric-helper mt-4 text-sm text-slate-500">{helper}</p>
    </article>);
}
type AuthPanelProps = {
    className: string;
    email: string;
    password: string;
    hasAccessToken: boolean;
    isPending: boolean;
    isError: boolean;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onLogin: (event: FormEvent<HTMLFormElement>) => void;
    onLogout: () => void;
    user?: User;
};
type LoginPageProps = {
    email: string;
    password: string;
    rememberMe: boolean;
    showPassword: boolean;
    isPending: boolean;
    errorMessage: string;
    themePreference: ThemePreference;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onRememberMeChange: (value: boolean) => void;
    onShowPasswordToggle: () => void;
    onThemeToggle: () => void;
    onLogin: (event: FormEvent<HTMLFormElement>) => void;
};
function LoginPage({ email, password, rememberMe, showPassword, isPending, errorMessage, themePreference, onEmailChange, onPasswordChange, onRememberMeChange, onShowPasswordToggle, onThemeToggle, onLogin, }: LoginPageProps) {
    const { t } = useTranslation();
    return (<main className="login-shell login-shell--split min-h-screen">
      <section className="login-split-card">
        <aside className="relative order-2 flex min-h-[32rem] flex-col overflow-hidden bg-card p-6 text-card-foreground sm:p-8 lg:order-1 lg:min-h-[43rem] lg:p-10 dark:bg-slate-950 dark:text-white">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-primary/35"/>
          <div className="pointer-events-none absolute -right-36 -top-16 h-96 w-96 rounded-full border border-primary/20"/>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,hsl(var(--primary)/0.16),transparent_34rem)] dark:bg-[radial-gradient(circle_at_0%_0%,hsl(var(--primary)/0.42),transparent_34rem)]"/>

          <div className="login-brand relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-border dark:shadow-primary/30 dark:ring-white/15">{t("app.text0126")}</div>
            <div>
              <p className="text-base font-semibold text-card-foreground dark:text-white">{t("app.text0127")}</p>
              <p className="text-sm font-medium text-muted-foreground dark:text-slate-300">{t("app.text0128")}</p>
            </div>
          </div>

          <div className="relative mt-8 max-w-2xl lg:mt-10">
            <p className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-card-foreground shadow-sm ring-1 ring-border dark:bg-white/10 dark:text-white dark:ring-white/10">
              <ShieldCheck className="h-3.5 w-3.5"/>
              {t("loginShowcase.badge")}
            </p>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-normal text-card-foreground sm:text-5xl dark:text-white">
              {t("loginShowcase.title")}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground dark:text-slate-300">
              {t("loginShowcase.description")}
            </p>
          </div>

          <div className="relative mt-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-muted/70 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20 dark:shadow-primary/25"><ReceiptText className="h-4 w-4"/></span>
              <p className="mt-3 text-xl font-semibold">{t("loginShowcase.metricInvoicesValue")}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground dark:text-slate-300">{t("loginShowcase.metricInvoicesLabel")}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/70 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20 dark:shadow-primary/25"><WalletCards className="h-4 w-4"/></span>
              <p className="mt-3 text-xl font-semibold">{t("loginShowcase.metricPaymentsValue")}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground dark:text-slate-300">{t("loginShowcase.metricPaymentsLabel")}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/70 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20 dark:shadow-primary/25"><Users className="h-4 w-4"/></span>
              <p className="mt-3 text-xl font-semibold">{t("loginShowcase.metricClientsValue")}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground dark:text-slate-300">{t("loginShowcase.metricClientsLabel")}</p>
            </div>
          </div>

          <div className="relative mt-6 hidden rounded-2xl border border-border bg-card/90 p-4 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-slate-950/88 dark:shadow-black/30 sm:block">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-400"/>
              <span className="h-3 w-3 rounded-full bg-amber-300"/>
              <span className="h-3 w-3 rounded-full bg-emerald-400"/>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[9rem_minmax(0,1fr)]">
              <div className="space-y-2 border-border lg:border-r lg:pr-4 dark:border-white/10">
                {[t("loginShowcase.previewOverview"), t("loginShowcase.previewInvoices"), t("loginShowcase.previewClients"), t("loginShowcase.previewPayments"), t("loginShowcase.previewReports"), t("loginShowcase.previewSettings")].map((item, index) => (<div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${index === 0 ? 'bg-primary/15 text-primary ring-1 ring-primary/25 dark:bg-primary/30 dark:text-white dark:ring-primary/30' : 'text-muted-foreground dark:text-slate-400'}`} key={item}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current"/>
                    {item}
                  </div>))}
              </div>
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-base font-semibold text-card-foreground dark:text-white">{t("loginShowcase.previewTitle")}</p>
                    <p className="mt-1 text-xs text-muted-foreground dark:text-slate-400">{t("loginShowcase.previewSubtitle")}</p>
                  </div>
                  <span className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    {t("loginShowcase.previewStatus")}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[t("loginShowcase.previewRevenue"), t("loginShowcase.previewInvoicesTotal"), t("loginShowcase.previewPaymentsTotal")].map((label, index) => (<div className="rounded-xl bg-muted p-3 ring-1 ring-border dark:bg-white/5 dark:ring-white/8" key={label}>
                      <p className="text-[11px] text-muted-foreground dark:text-slate-400">{label}</p>
                      <p className="mt-2 text-sm font-semibold text-card-foreground dark:text-white">{['$84,260', '1,248', '$76,430'][index]}</p>
                    </div>))}
                </div>
                <div className="mt-4 rounded-xl bg-muted/60 p-4 ring-1 ring-border dark:bg-white/[0.03] dark:ring-white/8">
                  <div className="flex h-24 items-end gap-2">
                    {[36, 48, 44, 58, 74, 52, 66, 60, 72, 68, 82, 76, 88].map((height, index) => (<span className="flex-1 rounded-t-md bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.35)]" key={index} style={{ height: `${height}%` }}/>))}
                  </div>
                  <div className="mt-3 flex justify-between text-[10px] font-medium text-muted-foreground">
                    <span>{t("loginShowcase.previewStartDate")}</span>
                    <span>{t("loginShowcase.previewMidDate")}</span>
                    <span>{t("loginShowcase.previewEndDate")}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="order-1 flex flex-col bg-card p-5 text-card-foreground backdrop-blur-xl sm:p-8 lg:order-2 lg:p-10 dark:bg-slate-950 dark:text-white">
          <div className="flex items-center justify-end gap-3">
            <LanguageSwitcher className="h-12 w-40 rounded-xl border-border bg-muted/70 text-sm text-card-foreground shadow-sm transition hover:border-primary/40 dark:border-slate-800 dark:bg-white/[0.04] dark:text-slate-100"/>
            <button aria-label={themePreference === 'dark'
            ? t("audit.text0027")
            : t("audit.text0028")} aria-pressed={themePreference === 'dark'} className="icon-button login-theme-toggle h-12 w-16 rounded-xl border-border bg-muted/70 text-card-foreground shadow-sm transition hover:border-primary/40 dark:border-slate-800 dark:bg-white/[0.04] dark:text-slate-100" onClick={onThemeToggle} title={themePreference === 'dark' ? t('auditFinal.lightMode') : t('auditFinal.darkMode')} type="button">
                  {themePreference === 'dark' ? (<Sun className="h-4 w-4"/>) : (<Moon className="h-4 w-4"/>)}
                </button>
          </div>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border dark:bg-white/5 dark:text-slate-300 dark:ring-white/8">
                <ShieldCheck className="h-3.5 w-3.5"/>
                {t("login.secureWorkspace")}
              </p>
              <h2 className="mt-6 text-4xl font-bold tracking-normal text-card-foreground dark:text-white">{t("loginShowcase.welcomeTitle")}</h2>
              <p className="mt-3 text-base text-muted-foreground dark:text-slate-400">
                {t("login.description")}
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={onLogin}>
              <label className="block">
                <span className="text-sm font-semibold text-card-foreground dark:text-white">{t("login.email")}</span>
                <div className="relative mt-2">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground dark:text-slate-400"/>
                  <input autoComplete="email" className="h-12 w-full rounded-xl border border-input bg-background px-12 text-sm text-foreground outline-none ring-primary/20 transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-4 dark:border-slate-800 dark:bg-white/[0.04] dark:text-slate-100 dark:placeholder:text-slate-500" onChange={(event) => onEmailChange(event.target.value)} placeholder={t("app.text0383")} type="email" value={email}/>
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-card-foreground dark:text-white">{t("login.password")}</span>
                <div className="relative mt-2">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground dark:text-slate-400"/>
                  <input autoComplete="current-password" className="h-12 w-full rounded-xl border border-input bg-background px-12 pr-12 text-sm text-foreground outline-none ring-primary/20 transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-4 dark:border-slate-800 dark:bg-white/[0.04] dark:text-slate-100 dark:placeholder:text-slate-500" onChange={(event) => onPasswordChange(event.target.value)} placeholder={t("app.text0384")} type={showPassword ? 'text' : 'password'} value={password}/>
                  <button className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-white" onClick={onShowPasswordToggle} type="button">
                    {showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="inline-flex items-center gap-2 font-medium text-muted-foreground dark:text-slate-300">
                  <input checked={rememberMe} className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-primary dark:border-slate-700 dark:bg-transparent" onChange={(event) => onRememberMeChange(event.target.checked)} type="checkbox"/>
                  {t("login.rememberMe")}
                </label>
                <a className="font-semibold text-primary transition hover:text-primary/80" href="/forgot-password">{t("app.text0385")}</a>
              </div>

              {errorMessage ? (<div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                  {errorMessage}
                </div>) : null}

              <button className="primary-action inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-70" disabled={isPending} type="submit">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <LogIn className="h-4 w-4"/>}
                {isPending ? t("login.loggingIn") : t("login.login")}
              </button>
            </form>
          </div>
        </section>
        <footer className="order-3 hidden items-center justify-between border-t border-border bg-card px-8 py-4 text-xs text-muted-foreground dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 lg:col-span-2 lg:flex">
          <p>{t("loginShowcase.footerCopyright")}</p>
          <div className="flex items-center gap-8">
            <span>{t("loginShowcase.footerPrivacy")}</span>
            <span>{t("loginShowcase.footerTerms")}</span>
            <span>{t("loginShowcase.footerSupport")}</span>
          </div>
        </footer>
      </section>
    </main>);
}
function AuthLoadingScreen({ themePreference }: {
    themePreference: ThemePreference;
}) {
    return (<main className="login-shell min-h-screen">
      <div className="login-card flex min-h-72 flex-col items-center justify-center text-center">
        <div className="brand-mark flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white">{t("app.text0126")}</div>
        <Loader2 className="mt-6 h-6 w-6 animate-spin text-primary"/>
        <p className="mt-3 text-sm font-semibold text-slate-900">
          {themePreference === 'dark' ? t("audit.text0107") : t("audit.text0108")}
        </p>
      </div>
    </main>);
}
function AuthPanel({ className, email, password, hasAccessToken, isPending, isError, onEmailChange, onPasswordChange, onLogin, onLogout, user, }: AuthPanelProps) {
    return (<div className={className}>
      <p className="text-xs font-semibold uppercase text-slate-500">
        {hasAccessToken ? t("audit.text0109") : t("audit.text0110")}
      </p>
      {hasAccessToken ? (<div className="mt-3 space-y-3">
          <div className="rounded-md bg-white p-2 ring-1 ring-slate-200">
            <p className="truncate text-xs font-semibold text-slate-800">
              {user?.name ?? t("audit.text0111")}
            </p>
            <p className="truncate text-[11px] text-slate-500">{user?.email ?? t('audit.sessionInProgress')}</p>
            {user?.role ? (<span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {t(`auditFinal.userRole.${user.role}`)}
              </span>) : null}
          </div>
          <button className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 transition hover:bg-slate-100" onClick={onLogout} type="button">
            <LogOut className="h-3.5 w-3.5"/>{t("app.text0386")}</button>
        </div>) : (<form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:block lg:space-y-2" onSubmit={onLogin}>
          <input className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => onEmailChange(event.target.value)} placeholder={t("app.text0225")} type="email" value={email}/>
          <input className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => onPasswordChange(event.target.value)} placeholder={t("app.text0387")} type="password" value={password}/>
          <button className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-full" disabled={isPending} type="submit">
            <LogIn className="h-3.5 w-3.5"/>
            {isPending ? t('login.signingIn') : t("audit.text0112")}
          </button>
          {isError ? (<p className="text-xs text-rose-600 sm:col-span-3">{t("app.text0388")}</p>) : null}
        </form>)}
    </div>);
}

function PublicContractSignaturePage({ token }: { token: string }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [signerName, setSignerName] = useState('');
    const [signerEmail, setSignerEmail] = useState('');
    const [accepted, setAccepted] = useState(false);
    const contractQuery = useQuery({
        queryKey: ['public-contract', token],
        queryFn: () => getPublicContract(token),
        retry: false,
    });
    const signMutation = useMutation({
        mutationFn: () => signPublicContract(token, {
            signerName,
            signerEmail,
            accepted: true,
        }),
        onSuccess: () => toast.success(t('contracts.public.messages.signed')),
        onError: (error) => toast.error(getApiErrorMessage(error, t('contracts.public.messages.failed'))),
    });
    const contract = contractQuery.data;
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!accepted) {
            toast.warning(t('contracts.public.messages.acceptRequired'));
            return;
        }
        signMutation.mutate();
    };
    return (<main className="min-h-screen bg-slate-50 p-4 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-4xl items-center">
        <div className="w-full rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-200 p-5">
            <p className="text-xs font-semibold uppercase text-slate-500">{t('contracts.public.eyebrow')}</p>
            <h1 className="mt-1 text-2xl font-bold">{contract?.contractNumber ?? t('contracts.public.title')}</h1>
            {contract ? <p className="mt-1 text-sm text-slate-500">{contract.client.company ?? contract.client.name}</p> : null}
          </div>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="max-h-[70vh] overflow-y-auto p-5">
              {contractQuery.isLoading ? <p className="text-sm text-slate-500">{t('common.loading')}</p> : null}
              {contractQuery.isError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{t('contracts.public.messages.unavailable')}</p> : null}
              {contract ? (<>
                <h2 className="text-lg font-semibold">{contract.title}</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <DetailChip label={t('contracts.fields.period')} value={`${formatOptionalShortDate(contract.startDate)} - ${formatOptionalShortDate(contract.endDate)}`}/>
                  <DetailChip label={t('contracts.fields.amount')} value={contract.amount == null ? '-' : formatCurrency(Number(contract.amount), contract.currency)}/>
                </div>
                <pre className="mt-5 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{contract.currentVersion?.content ?? '-'}</pre>
              </>) : null}
            </div>
            <form className="border-t border-slate-200 p-5 lg:border-l lg:border-t-0" onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold">{t('contracts.public.signTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('contracts.public.signDescription')}</p>
              <label className="mt-5 block text-sm font-medium text-slate-700">
                {t('contracts.public.signerName')}
                <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" required onChange={(event) => setSignerName(event.target.value)} value={signerName}/>
              </label>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                {t('contracts.public.signerEmail')}
                <input className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" required type="email" onChange={(event) => setSignerEmail(event.target.value)} value={signerEmail}/>
              </label>
              <label className="mt-4 flex gap-3 text-sm text-slate-600">
                <input className="mt-1 h-4 w-4 rounded border-slate-300" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox"/>
                <span>{t('contracts.public.acceptTerms')}</span>
              </label>
              <button className="mt-5 h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={!contract || signMutation.isPending || contract.status === 'ACTIVE'} type="submit">
                {contract?.status === 'ACTIVE' ? t('contracts.public.alreadySigned') : t('contracts.public.sign')}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>);
}

function DetailChip({ label, value }: { label: string; value: string }) {
    return (<div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>);
}

function formatOptionalShortDate(date?: string | null) {
    return date ? formatShortDate(date) : '-';
}
function ReminderRow({ reminder }: {
    reminder: Reminder;
}) {
    const statusClass = {
        SENT: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
        FAILED: 'bg-rose-100 text-rose-700 ring-rose-200',
        PENDING: 'bg-amber-100 text-amber-700 ring-amber-200',
    }[reminder.status];
    return (<article className="p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{reminder.subject}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass}`}>
              {t(`auditFinal.reminderStatus.${reminder.status}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{reminder.recipientEmail}</p>
          {reminder.invoice ? (<p className="mt-1 text-xs font-medium text-slate-500">
              {reminder.invoice.invoiceNumber} -{' '}
              {reminder.invoice.customer?.company ?? reminder.invoice.customer?.name ?? t('auditFinal.clientFallback')} -{' '}
              {formatCurrency(Number(reminder.invoice.balanceDue), reminder.invoice.currency)}
            </p>) : null}
          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{reminder.body}</p>
        </div>
        <div className="text-sm text-slate-500 md:text-right">
          <p>{t(`auditFinal.reminderType.${reminder.type}`)}</p>
          <p>{formatShortDate(reminder.sentAt ?? reminder.createdAt)}</p>
        </div>
      </div>
      {reminder.errorMessage ? (<p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
          {reminder.errorMessage}
        </p>) : null}
    </article>);
}
function SettingsInput({ label, onChange, required = false, type = 'text', value, }: {
    label: string;
    onChange: (value: string) => void;
    required?: boolean;
    type?: string;
    value: string;
}) {
    return (<label className="text-sm font-medium text-slate-700">
      {label}
      <input className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => onChange(event.target.value)} required={required} type={type} value={value}/>
    </label>);
}
type CustomerDetailPanelProps = {
    customer?: Customer;
    invoices: InvoiceSummary[];
    isLoading: boolean;
    onClose: () => void;
    onCreateInvoice: (customer: Customer) => void;
    onEdit: (customer: Customer) => void;
    onOpenInvoice: (invoiceId: string) => void;
};
function CustomerDetailPanel({ customer, invoices, isLoading, onClose, onCreateInvoice, onEdit, onOpenInvoice, }: CustomerDetailPanelProps) {
    const invoiceCount = customer?.financialSummary?.totalInvoices ?? invoices.length;
    const invoiced = customer?.financialSummary?.totalInvoiced ??
        invoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const unpaid = customer?.financialSummary?.totalUnpaid ??
        invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paid, 0);
    return (<div className="fixed inset-0 z-30 bg-slate-950/20">
      <button aria-label={t("app.text0160")} className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} type="button"/>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">{t("app.text0389")}</p>
            <h2 className="mt-1 text-xl font-semibold">
              {customer ? customer.company ?? customer.name : t('common.loading')}
            </h2>
          </div>
          <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">{t("app.text0160")}</button>
        </div>

        {!customer ? (<div className="p-5 text-sm text-slate-500">{t("app.text0390")}</div>) : (<div className="flex-1 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailMetric label={t("audit.text0136")} value={String(invoiceCount)}/>
              <DetailMetric label={t("audit.text0137")} value={formatCurrency(invoiced)}/>
              <DetailMetric label={t("audit.text0032")} value={formatCurrency(unpaid)} tone="danger"/>
            </div>

            <section className="mt-5 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold">{t("app.text0391")}</h3>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <InfoLine label={t("audit.text0138")} value={customer.name}/>
                <InfoLine label={t("audit.text0139")} value={customer.company}/>
                <InfoLine label={t("audit.text0140")} value={customer.email}/>
                <InfoLine label={t("audit.text0141")} value={customer.phone}/>
                <InfoLine label={t("audit.text0142")} value={customer.city}/>
                <InfoLine label={t("audit.text0072")} value={customer.taxNumber}/>
                <InfoLine label={t("audit.text0143")} value={customer.isActive ? t('i18nDynamic.active') : t('i18nDynamic.inactive')}/>
                <InfoLine label={t("audit.text0113")} value={String(customer.financialSummary?.overdueInvoices ?? 0)}/>
              </div>
              {customer.address ? (<div className="mt-3">
                  <p className="text-xs font-medium uppercase text-slate-500">{t("app.text0280")}</p>
                  <p className="mt-1 text-sm text-slate-700">{customer.address}</p>
                </div>) : null}
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-semibold">{t("app.text0392")}</h3>
                  <p className="text-xs text-slate-500">{t("app.text0393")}</p>
                </div>
                {isLoading ? <span className="text-xs text-slate-500">{t("app.text0394")}</span> : null}
              </div>
              <div className="divide-y divide-slate-100">
                {invoices.map((invoice) => (<button className="grid w-full gap-2 p-4 text-left text-sm transition hover:bg-slate-50 sm:grid-cols-[1fr_auto]" key={invoice.id} onClick={() => onOpenInvoice(invoice.id)} type="button">
                    <div>
                      <p className="font-medium">{invoice.number}</p>
                      <p className="text-xs text-slate-500">{formatDueDate(invoice)}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="font-semibold">{formatCurrency(invoice.total - invoice.paid)}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                        {getStatusLabel(invoice.status)}
                      </span>
                    </div>
                  </button>))}
                {!isLoading && invoices.length === 0 ? (<p className="p-4 text-sm text-slate-500">{t("app.text0395")}</p>) : null}
              </div>
            </section>
          </div>)}

        {customer ? (<div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
            <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onEdit(customer)} type="button">{t("app.text0232")}</button>
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90" onClick={() => onCreateInvoice(customer)} type="button">
              <FilePlus2 className="h-4 w-4"/>{t("app.text0136")}</button>
          </div>) : null}
      </aside>
    </div>);
}
type CompanyAssetCardProps = {
    title: string;
    description: string;
    imageUrl?: string | null;
    icon: typeof PenLine;
    disabled: boolean;
    isDirty: boolean;
    isPending: boolean;
    onUpload: (file?: File) => void;
    onRemoveBackground: () => void;
    onDelete: () => void;
};
function CompanyAssetCard({ title, description, imageUrl, icon: Icon, disabled, isDirty, isPending, onUpload, onRemoveBackground, onDelete, }: CompanyAssetCardProps) {
    const inputId = `${title.toLowerCase().replace(/\s+/g, '-')}-upload`;
    const [hasImageError, setHasImageError] = useState(false);
    useEffect(() => {
        setHasImageError(false);
    }, [imageUrl]);
    return (<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-slate-600"/>
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
          <p className="mt-1 text-xs text-slate-500">{t("app.text0396")}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${imageUrl
            ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
            : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
          {isDirty ? t("audit.text0114") : imageUrl ? 'Configuree' : 'Manquante'}
        </span>
      </div>

      <div className="mt-4 flex min-h-28 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-3">
        {imageUrl && !hasImageError ? (<img alt={title} className="max-h-24 max-w-full object-contain" onError={() => setHasImageError(true)} src={imageUrl}/>) : (<p className="text-sm text-slate-500">
            {imageUrl && hasImageError ? t("audit.text0115") : t("audit.text0116")}
          </p>)}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <label className={`inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ${disabled || isPending ? 'pointer-events-none opacity-60' : ''}`} htmlFor={inputId}>
          <Upload className="h-4 w-4"/>
          {isPending ? t('i18nDynamic.processing') : imageUrl ? t('i18nDynamic.replace') : t('i18nDynamic.upload')}
        </label>
        <input accept="image/png,image/jpeg" className="hidden" disabled={disabled || isPending} id={inputId} onChange={(event) => {
            onUpload(event.target.files?.[0]);
            event.target.value = '';
        }} type="file"/>
        {imageUrl ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled || isPending} onClick={onRemoveBackground} type="button">
            <Eraser className="h-4 w-4"/>{t("app.text0397")}</button>) : null}
        {imageUrl ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled || isPending} onClick={onDelete} type="button">
            <Trash2 className="h-4 w-4"/>{t("app.text0398")}</button>) : null}
      </div>
    </div>);
}
function InfoLine({ label, value }: {
    label: string;
    value?: string | null;
}) {
    return (<div>
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-slate-700">{value || '-'}</p>
    </div>);
}
type InvoiceDetailPanelProps = {
    invoice?: Invoice;
    isLoading: boolean;
    canSignInvoices: boolean;
    companySettings?: CompanySettings;
    isCancelSignaturePending: boolean;
    isEmailPending: boolean;
    isPaymentPending: boolean;
    isSignPending: boolean;
    isStatusPending: boolean;
    onClose: () => void;
    onCancelSignature: (invoice: Invoice) => void;
    onDownload: (invoice: Invoice) => void;
    onEmail: (invoice: Invoice) => void;
    onEdit: (invoice: Invoice) => void;
    onOpenDevis: (devisId: string) => void;
    onOpenCreditNotes: () => void;
    onPaymentSubmit: (event: FormEvent<HTMLFormElement>, invoice: Invoice) => void;
    onPrint: (invoice: Invoice) => void;
    onPrepareReminder: (invoice: Invoice) => void;
    onSign: (invoice: Invoice) => void;
    onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
    paymentAmount: string;
    paymentEntryDate: string;
    paymentMethod: PaymentMethod;
    paymentReference: string;
    setPaymentAmount: (value: string) => void;
    setPaymentEntryDate: (value: string) => void;
    setPaymentMethod: (value: PaymentMethod) => void;
    setPaymentReference: (value: string) => void;
};
type DevisDetailPanelProps = {
    canDeleteDevis: boolean;
    canSignDevis: boolean;
    canUpdateDevis: boolean;
    devis?: Devis;
    isLoading: boolean;
    isActionPending: boolean;
    onApprove: (devis: Devis) => void;
    onCancelSignature: (devis: Devis) => void;
    onClose: () => void;
    onConvert: (devis: Devis) => void;
    onDelete: (devis: Devis) => void;
    onDownload: (devis: Devis) => void;
    onEdit: (devis: Devis) => void;
    onOpenInvoice: (invoiceId: string) => void;
    onReject: (devis: Devis) => void;
    onSend: (devis: Devis) => void;
    onSign: (devis: Devis) => void;
};
function DevisDetailPanel({ canDeleteDevis, canSignDevis, canUpdateDevis, devis, isLoading, isActionPending, onApprove, onCancelSignature, onClose, onConvert, onDelete, onDownload, onEdit, onOpenInvoice, onReject, onSend, onSign, }: DevisDetailPanelProps) {
    const canSign = Boolean(devis && canSignDevis && !devis.isSigned && (devis.status === 'DRAFT' || devis.status === 'APPROVED' || devis.status === 'CONVERTED'));
    const canCancelSignature = Boolean(devis && canSignDevis && devis.isSigned);
    return (<aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">{t('devis.quote')}</p>
          <h2 className="text-xl font-semibold text-slate-950">{devis?.devisNumber ?? t('common.loading')}</h2>
        </div>
        <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">{t("app.text0160")}</button>
      </div>
      {isLoading || !devis ? (<div className="p-5 text-sm text-slate-500">{t("app.text0400")}</div>) : (<div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <DetailMetric label={t("app.text0143")} value={formatCurrency(Number(devis.total), devis.currency)}/>
            <DetailMetric label={t("app.text0180")} value={formatCurrency(Number(devis.subtotal), devis.currency)}/>
            <DetailMetric label={t("app.text0170")} value={`${Number(devis.taxRate)}%`}/>
          </div>
          <section className="mt-5 rounded-lg border border-slate-200 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  {devis.customer?.company ?? devis.customer?.name ?? t('auditFinal.clientFallback')}
                </p>
                <p className="text-sm text-slate-500">{devis.customer?.email}</p>
                <p className="mt-2 text-xs text-slate-500">{t("app.text0401")}{formatShortDate(devis.issueDate)}</p>
                <p className="text-xs text-slate-500">{t('devis.validUntil')}: {formatShortDate(devis.validUntil)}</p>
              </div>
              <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${devisStatusClasses[devis.status]}`}>
                {getDevisStatusLabel(devis.status)}
              </span>
            </div>
            {devis.generatedInvoice ? (<button className="mt-4 text-sm font-medium text-primary hover:underline" onClick={() => onOpenInvoice(devis.generatedInvoice!.id)} type="button">
                {t('devis.linkedInvoice')}: {devis.generatedInvoice.invoiceNumber}
              </button>) : null}
            {devis.isSigned ? (<div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                <p className="font-medium">{t('devis.signedStatus')}</p>
                <p className="mt-1">{t('devis.signedBy', { user: devis.signedBy?.name ?? t('auditFinal.userFallback'), date: devis.signedAt ? formatShortDate(devis.signedAt) : t("audit.text0118") })}</p>
              </div>) : null}
          </section>
          <section className="mt-5 rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold">{t('devis.items')}</h3>
            </div>
            {(devis.items ?? []).map((item) => (<div className="grid gap-2 border-b border-slate-100 p-4 text-sm last:border-b-0 sm:grid-cols-[1fr_auto]" key={item.id}>
                <div>
                  <p className="font-medium text-slate-950">{item.description}</p>
                  <p className="text-xs text-slate-500">
                    {Number(item.quantity)} {item.unit ?? ''} x {formatCurrency(Number(item.unitPrice), devis.currency)}
                    {Number(item.discount) > 0 ? ` - ${formatCurrency(Number(item.discount), devis.currency)}` : ''}
                  </p>
                </div>
                <p className="font-semibold">{formatCurrency(Number(item.lineTotal), devis.currency)}</p>
              </div>))}
          </section>
          <section className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
            <div className="flex justify-between">
              <span>{t("app.text0180")}</span>
              <span>{formatCurrency(Number(devis.subtotal), devis.currency)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>{t("app.text0181")}{Number(devis.taxRate)}%</span>
              <span>{formatCurrency(Number(devis.taxAmount), devis.currency)}</span>
            </div>
            {Number(devis.discount) > 0 ? (<div className="mt-1 flex justify-between">
                <span>{t("app.text0179")}</span>
                <span>-{formatCurrency(Number(devis.discount), devis.currency)}</span>
              </div>) : null}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <span>{t("app.text0182")}</span>
              <span>{formatCurrency(Number(devis.total), devis.currency)}</span>
            </div>
          </section>
          {devis.notes || devis.terms ? (<section className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
              {devis.terms ? (<>
                  <p className="font-semibold">{t("app.text0184")}</p>
                  <p className="mt-1 text-slate-600">{devis.terms}</p>
                </>) : null}
              {devis.notes ? (<>
                  <p className="mt-3 font-semibold">{t("app.text0183")}</p>
                  <p className="mt-1 text-slate-600">{devis.notes}</p>
                </>) : null}
            </section>) : null}
        </div>)}
      {devis ? (<div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
          {devis.status === 'DRAFT' && canUpdateDevis ? (<button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onEdit(devis)} type="button">{t("app.text0232")}</button>) : null}
          {devis.status === 'DRAFT' && canDeleteDevis ? (<button className="h-9 rounded-md border border-rose-200 px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60" disabled={isActionPending} onClick={() => onDelete(devis)} type="button">{t('common.delete')}</button>) : null}
          {devis.status === 'DRAFT' ? (<button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" disabled={isActionPending} onClick={() => onSend(devis)} type="button">{t("app.text0202")}</button>) : null}
          {devis.status === 'SENT' ? (<button className="h-9 rounded-md border border-emerald-200 px-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60" disabled={isActionPending} onClick={() => onApprove(devis)} type="button">{t('devis.approve')}</button>) : null}
          {devis.status === 'SENT' || devis.status === 'APPROVED' ? (<button className="h-9 rounded-md border border-rose-200 px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60" disabled={isActionPending} onClick={() => onReject(devis)} type="button">{t('devis.reject')}</button>) : null}
          {devis.status === 'APPROVED' ? (<button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-60" disabled={isActionPending} onClick={() => onConvert(devis)} type="button">{t('devis.createInvoice')}</button>) : null}
          {canSign ? (<button className="h-9 rounded-md border border-emerald-200 px-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60" disabled={isActionPending} onClick={() => onSign(devis)} type="button">{t('devis.sign')}</button>) : null}
          {canCancelSignature ? (<button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" disabled={isActionPending} onClick={() => onCancelSignature(devis)} type="button">{t('devis.cancelSignature')}</button>) : null}
          <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onDownload(devis)} type="button">{t('i18nDynamic.pdf')}</button>
        </div>) : null}
    </aside>);
}
function InvoiceDetailPanel({ invoice, isLoading, canSignInvoices, companySettings, isCancelSignaturePending, isEmailPending, isPaymentPending, isSignPending, isStatusPending, onClose, onCancelSignature, onDownload, onEmail, onEdit, onOpenDevis, onOpenCreditNotes, onPaymentSubmit, onPrint, onPrepareReminder, onSign, onStatusChange, paymentAmount, paymentEntryDate, paymentMethod, paymentReference, setPaymentAmount, setPaymentEntryDate, setPaymentMethod, setPaymentReference, }: InvoiceDetailPanelProps) {
    const balanceDue = invoice ? Number(invoice.balanceDue) : 0;
    const canCollect = Boolean(invoice && balanceDue > 0 && invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED');
    const hasCompanySignatureAssets = Boolean(companySettings?.signatureUrl && companySettings?.stampUrl);
    const canSignInvoice = Boolean(invoice && canSignInvoices && !invoice.isSigned && hasCompanySignatureAssets);
    return (<div className="fixed inset-0 z-30 bg-slate-950/20">
      <button aria-label={t("app.text0160")} className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} type="button"/>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">{t("app.text0399")}</p>
            <h2 className="mt-1 text-xl font-semibold">
              {invoice?.invoiceNumber ?? t('common.loading')}
            </h2>
          </div>
          <button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">{t("app.text0160")}</button>
        </div>

        {isLoading || !invoice ? (<div className="p-5 text-sm text-slate-500">{t("app.text0400")}</div>) : (<div className="flex-1 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailMetric label={t("audit.text0144")} value={formatCurrency(Number(invoice.total), invoice.currency)}/>
              <DetailMetric label={t("audit.text0145")} value={formatCurrency(Number(invoice.amountPaid), invoice.currency)}/>
              <DetailMetric label={t("audit.text0146")} value={formatCurrency(balanceDue, invoice.currency)} tone="danger"/>
            </div>

            <section className="mt-5 rounded-lg border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t("app.text0161")}</h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {invoice.customer?.company ?? invoice.customer?.name ?? t('auditFinal.clientFallback')}
                  </p>
                  <p className="text-sm text-slate-500">{invoice.customer?.email}</p>
                </div>
                <div className="text-sm text-slate-500 sm:text-right">
                  <p>{t("app.text0401")}{formatShortDate(invoice.issueDate)}</p>
                  <p>{t("app.text0402")}{formatShortDate(invoice.dueDate)}</p>
                </div>
              </div>
              <span className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                {getStatusLabel(invoice.status)}
              </span>
              <span className={`ml-2 mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${invoice.isSigned
                ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                {invoice.isSigned ? t('i18nDynamic.signed') : t("audit.text0117")}
              </span>
              {invoice.sourceDevis ? (<button className="mt-3 block text-sm font-medium text-primary hover:underline" onClick={() => onOpenDevis(invoice.sourceDevis!.id)} type="button">
                  {t('devis.sourceQuote')}: {invoice.sourceDevis.devisNumber}
                </button>) : null}
              {invoice.creditSummary && invoice.creditSummary.creditStatus !== 'NONE' ? (<div className="mt-4 rounded-md border border-violet-100 bg-violet-50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-violet-900">{t('creditNotes.invoiceSummary.title')}</p>
                      <p className="mt-1 text-xs text-violet-700">{t('creditNotes.invoiceSummary.description')}</p>
                    </div>
                    <button className="text-sm font-medium text-violet-700 hover:underline" onClick={onOpenCreditNotes} type="button">
                      {t('creditNotes.openModule')}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-md bg-white/70 p-2">
                      <p className="font-medium uppercase text-violet-600">{t('creditNotes.invoiceSummary.original')}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">{formatCurrency(invoice.creditSummary.originalTotal, invoice.currency)}</p>
                    </div>
                    <div className="rounded-md bg-white/70 p-2">
                      <p className="font-medium uppercase text-violet-600">{t('creditNotes.invoiceSummary.credited')}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">{formatCurrency(invoice.creditSummary.creditedTotal, invoice.currency)}</p>
                    </div>
                    <div className="rounded-md bg-white/70 p-2">
                      <p className="font-medium uppercase text-violet-600">{t('creditNotes.invoiceSummary.net')}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">{formatCurrency(invoice.creditSummary.netTotal, invoice.currency)}</p>
                    </div>
                  </div>
                </div>) : null}
              {invoice.creditNotes?.length ? (<div className="mt-4 rounded-md border border-slate-200">
                  <div className="border-b border-slate-200 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-950">{t('creditNotes.linkedTitle')}</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {invoice.creditNotes.map((creditNote) => (<div className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between" key={creditNote.id}>
                        <div>
                          <p className="font-medium text-slate-900">{creditNote.creditNoteNumber}</p>
                          <p className="text-xs text-slate-500">{formatShortDate(creditNote.issueDate)}</p>
                        </div>
                        <div className="flex items-center gap-2 sm:justify-end">
                          <span className="font-semibold text-slate-900">{formatCurrency(Number(creditNote.total), creditNote.currency)}</span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${creditNoteStatusClasses[creditNote.status]}`}>
                            {t(`creditNotes.status.${creditNote.status}`)}
                          </span>
                        </div>
                      </div>))}
                  </div>
                </div>) : null}
              {invoice.isSigned ? (<div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-medium">{t("app.text0403")}</p>
                  <p className="mt-1">{t("app.text0404")}{invoice.signedBy?.name ?? t('auditFinal.userFallback')} ·{' '}
                    {invoice.signedAt ? formatShortDate(invoice.signedAt) : t("audit.text0118")}
                  </p>
                  {canSignInvoices ? (<button className="mt-3 inline-flex h-8 w-fit items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={isCancelSignaturePending} onClick={() => onCancelSignature(invoice)} type="button">
                      <Undo2 className="h-3.5 w-3.5"/>
                      {isCancelSignaturePending ? t('i18nDynamic.cancelling') : t("audit.text0119")}
                    </button>) : null}
                </div>) : null}
              {!invoice.isSigned && canSignInvoices && !hasCompanySignatureAssets ? (<p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{t("app.text0405")}</p>) : null}
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">{t("app.text0406")}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.items ?? []).map((item) => (<div className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_auto]" key={item.id}>
                    <div>
                      <p className="font-medium">{item.description}</p>
                      <p className="text-slate-500">
                        {Number(item.quantity)} {item.unit ?? ''}{t("app.text0363")}{' '}
                        {formatCurrency(Number(item.unitPrice), invoice.currency)}
                      </p>
                    </div>
                    <p className="font-semibold sm:text-right">
                      {formatCurrency(Number(item.total), invoice.currency)}
                    </p>
                  </div>))}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">{t("app.text0009")}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.payments ?? []).map((payment) => (<div className="flex items-center justify-between gap-3 p-4 text-sm" key={payment.id}>
                    <div>
                      <p className="font-medium">{t(`auditFinal.paymentMethod.${payment.method}`)}</p>
                      <p className="text-slate-500">{formatShortDate(payment.paymentDate)}</p>
                    </div>
                    <p className="font-semibold">
                      {formatCurrency(Number(payment.amount), invoice.currency)}
                    </p>
                  </div>))}
                {invoice.payments?.length === 0 ? (<p className="p-4 text-sm text-slate-500">{t("app.text0407")}</p>) : null}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">{t("app.text0011")}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.reminders ?? []).map((reminder) => (<div className="p-4 text-sm" key={reminder.id}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{reminder.subject}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {t(`auditFinal.reminderType.${reminder.type}`)} - {formatShortDate(reminder.sentAt ?? reminder.createdAt)}
                        </p>
                      </div>
                      <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${reminder.status === 'SENT'
                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    : reminder.status === 'FAILED'
                        ? 'bg-rose-100 text-rose-700 ring-rose-200'
                        : 'bg-amber-100 text-amber-700 ring-amber-200'}`}>
                        {t(`auditFinal.reminderStatus.${reminder.status}`)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-slate-600">{reminder.body}</p>
                    {reminder.errorMessage ? (<p className="mt-2 text-xs text-rose-600">{reminder.errorMessage}</p>) : null}
                  </div>))}
                {invoice.reminders?.length === 0 ? (<p className="p-4 text-sm text-slate-500">{t("app.text0408")}</p>) : null}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">{t("app.text0409")}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.emailLogs ?? []).map((emailLog) => (<div className="p-4 text-sm" key={emailLog.id}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{emailLog.subject}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {emailLog.recipientEmail} - {formatShortDate(emailLog.createdAt)}
                        </p>
                      </div>
                      <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${emailLog.status === 'SENT'
                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    : 'bg-rose-100 text-rose-700 ring-rose-200'}`}>
                        {emailLog.deliveryMode === 'local' ? t('i18nDynamic.localDelivery') : t(`auditFinal.reminderStatus.${emailLog.status}`)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-slate-600">{emailLog.message}</p>
                    {emailLog.errorMessage ? (<p className="mt-2 text-xs text-rose-600">{emailLog.errorMessage}</p>) : null}
                  </div>))}
                {invoice.emailLogs?.length === 0 ? (<p className="p-4 text-sm text-slate-500">{t("app.text0410")}</p>) : null}
              </div>
            </section>

            {canCollect ? (<form className="mt-5 rounded-lg border border-slate-200 p-4" onSubmit={(event) => onPaymentSubmit(event, invoice)}>
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">{t("app.text0411")}</h3>
                  <p className="text-xs text-slate-500">{t("app.text0412")}{formatCurrency(balanceDue, invoice.currency)}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" max={balanceDue} min="0" onChange={(event) => setPaymentAmount(event.target.value)} placeholder={t("app.text0193")} step="0.01" type="number" value={paymentAmount}/>
                  <input className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" max={getToday()} onChange={(event) => setPaymentEntryDate(event.target.value)} title={t("app.text0213")} type="date" value={paymentEntryDate}/>
                  <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} value={paymentMethod}>
                    <option value="BANK_TRANSFER">{t("app.text0150")}</option>
                    <option value="CASH">{t("app.text0151")}</option>
                    <option value="CHECK">{t("app.text0152")}</option>
                    <option value="CREDIT_CARD">{t("app.text0153")}</option>
                    <option value="MOBILE_PAYMENT">{t("app.text0154")}</option>
                    <option value="OTHER">{t("app.text0155")}</option>
                  </select>
                </div>
                <input className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4" onChange={(event) => setPaymentReference(event.target.value)} placeholder={t("app.text0214")} value={paymentReference}/>
                <button className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={isPaymentPending} type="submit">
                  <WalletCards className="h-4 w-4"/>
                  {isPaymentPending ? t('auditFinal.saving') : t("audit.text0120")}
                </button>
              </form>) : null}

            {invoice.notes || invoice.terms ? (<section className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
                {invoice.terms ? (<>
                    <h3 className="font-semibold">{t("app.text0413")}</h3>
                    <p className="mt-1 text-slate-600">{invoice.terms}</p>
                  </>) : null}
                {invoice.notes ? (<>
                    <h3 className="mt-4 font-semibold">{t("app.text0414")}</h3>
                    <p className="mt-1 text-slate-600">{invoice.notes}</p>
                  </>) : null}
              </section>) : null}
          </div>)}

        {invoice ? (<div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
            {invoice.status === 'DRAFT' ? (<button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onEdit(invoice)} type="button">{t("app.text0232")}</button>) : null}
            {invoice.status === 'DRAFT' ? (<button className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={isStatusPending} onClick={() => onStatusChange(invoice, 'SENT')} type="button">{t("app.text0202")}</button>) : null}
            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' ? (<button className="h-9 rounded-md border border-rose-200 px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={isStatusPending} onClick={() => onStatusChange(invoice, 'CANCELLED')} type="button">{t("app.text0203")}</button>) : null}
            {canSignInvoice ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60" disabled={isSignPending} onClick={() => onSign(invoice)} type="button">
                <Stamp className="h-4 w-4"/>
                {isSignPending ? t('i18nDynamic.signing') : t("audit.text0121")}
              </button>) : null}
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onDownload(invoice)} type="button">
              <Download className="h-4 w-4"/>
              {invoice.isSigned ? t("audit.text0122") : t('i18nDynamic.pdf')}
            </button>
            {invoice.isSigned ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => onPrint(invoice)} type="button">
                <Printer className="h-4 w-4"/>{t("app.text0415")}</button>) : null}
            {invoice.status !== 'CANCELLED' ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={isEmailPending} onClick={() => onEmail(invoice)} type="button">
                <Mail className="h-4 w-4"/>
                {isEmailPending ? t('i18nDynamic.sending') : t("audit.text0140")}
              </button>) : null}
            {canCollect ? (<button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800" onClick={() => onPrepareReminder(invoice)} type="button">
                <Mail className="h-4 w-4"/>{t("app.text0416")}</button>) : null}
          </div>) : null}
      </aside>
    </div>);
}
function DetailMetric({ label, value, tone = 'default', }: {
    label: string;
    value: string;
    tone?: 'default' | 'danger';
}) {
    return (<div className={`rounded-lg p-4 ${tone === 'danger' ? 'bg-rose-50' : 'bg-slate-50'}`}>
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === 'danger' ? 'text-rose-700' : 'text-slate-950'}`}>
        {value}
      </p>
    </div>);
}
function formatDueDate(invoice: InvoiceSummary) {
    if (invoice.status === 'PAID')
        return t('i18nDynamic.settled');
    if (invoice.status === 'CANCELLED')
        return t('audit.status.cancelled');
    const days = getDaysUntilDue(invoice.dueDate);
    if (days < 0)
        return t('i18nDynamic.daysLate', { count: Math.abs(days) });
    if (days === 0)
        return t('i18nDynamic.today');
    return t('i18nDynamic.inDays', { count: days });
}
function formatRevenueDelta(current: number, previous: number) {
    if (previous === 0 && current > 0)
        return t("audit.text0123");
    if (previous === 0)
        return t('i18nDynamic.stable');
    const percent = Math.round(((current - previous) / previous) * 100);
    if (percent === 0)
        return t('i18nDynamic.stable');
    return `${percent > 0 ? '+' : ''}${percent}%`;
}
function mapInvoiceToSummary(invoice: Invoice): InvoiceSummary {
    return {
        id: invoice.id,
        number: invoice.invoiceNumber,
        customer: invoice.customer?.company ?? invoice.customer?.name ?? t('auditFinal.clientFallback'),
        status: invoice.status,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: Number(invoice.total),
        paid: Number(invoice.amountPaid),
    };
}
function mapDashboardCustomerExposure(stats?: DashboardStats): CustomerExposure[] {
    if (!stats?.unpaidByCustomer?.length)
        return [];
    return stats.unpaidByCustomer.map((item) => ({
        name: t("app.text0417"),
        company: item.customer,
        unpaid: item.unpaid,
        overdue: 0,
    }));
}
function mapCompanySettingsToForm(settings: CompanySettings): UpdateCompanySettingsForm {
    return {
        name: settings.name,
        address: settings.address ?? '',
        phone: settings.phone ?? '',
        email: settings.email ?? '',
        taxNumber: settings.taxNumber ?? '',
        logoUrl: settings.logoUrl ?? '',
        signatureUrl: settings.signatureUrl ?? '',
        stampUrl: settings.stampUrl ?? '',
        defaultCurrency: settings.defaultCurrency,
        defaultTaxRate: Number(settings.defaultTaxRate),
        vatEnabled: settings.vatEnabled ?? true,
        moroccoVatRate: Number(settings.moroccoVatRate ?? settings.defaultTaxRate ?? 20),
        paymentTerms: settings.paymentTerms ?? '',
        bankDetails: settings.bankDetails ?? '',
    };
}
function filterReminders(reminders: Reminder[], searchTerm: string, typeFilter: ReminderType | 'ALL') {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return reminders.filter((reminder) => {
        const matchesType = typeFilter === 'ALL' || reminder.type === typeFilter;
        const searchable = [
            reminder.subject,
            reminder.recipientEmail,
            reminder.body,
            reminder.invoice?.invoiceNumber,
            reminder.invoice?.customer?.name,
            reminder.invoice?.customer?.company,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return matchesType && (!normalizedSearch || searchable.includes(normalizedSearch));
    });
}
function calculateItemTotal(item: InvoiceDraftItem) {
    const subtotal = Number(item.quantity) * Number(item.unitPrice);
    return subtotal + subtotal * (Number(item.taxRate) / 100);
}
function calculateInvoiceTotals(items: InvoiceDraftItem[], _taxRate: number, discount: number) {
    const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
    const taxAmount = items.reduce((sum, item) => {
        const lineSubtotal = Number(item.quantity) * Number(item.unitPrice);
        return sum + lineSubtotal * (Number(item.taxRate) / 100);
    }, 0);
    const total = Math.max(0, subtotal + taxAmount - Number(discount));
    return { subtotal, taxAmount, total };
}
function calculateDevisItemTotal(item: DevisDraftItem, taxRate: number) {
    const lineBase = Math.max(0, Number(item.quantity) * Number(item.unitPrice) - Number(item.discount));
    const taxAmount = lineBase * (taxRate / 100);
    return lineBase + taxAmount;
}
function calculateDevisTotals(items: DevisDraftItem[], taxRate: number, discount: number) {
    const subtotal = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) * Number(item.unitPrice) - Number(item.discount)), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = Math.max(0, subtotal + taxAmount - discount);
    return { subtotal, taxAmount, total };
}
function getAutomaticVatRate(customer?: Customer, settings?: CompanySettings) {
    const countryCode = normalizeCountryCode(customer?.countryCode ?? '');
    if (!settings?.vatEnabled)
        return 0;
    if (countryCode === 'MA')
        return Number(settings.moroccoVatRate ?? settings.defaultTaxRate ?? 20);
    return 0;
}
function normalizeCountryCode(countryCode: string) {
    const normalized = countryCode.trim().toUpperCase();
    return normalized === 'UK' ? 'GB' : normalized;
}
function getCountryLabel(countryCode: string) {
    const normalized = normalizeCountryCode(countryCode);
    return buildCountryOptions(i18n.language).find((country) => country.code === normalized)?.label ?? normalized;
}
function getCountryName(countryCode: string) {
    const normalized = normalizeCountryCode(countryCode);
    return buildCountryOptions(i18n.language).find((country) => country.code === normalized)?.name ?? normalized;
}
function buildCountryOptions(language = i18n.language) {
    const fallbackCodes = [
        'MA',
        'FR',
        'ES',
        'US',
        'GB',
        'IT',
        'DE',
        'PT',
        'BE',
        'NL',
        'CA',
        'AE',
        'SA',
        'DZ',
        'TN',
        'EG',
    ];
    const supportedValuesOf = (Intl as typeof Intl & {
        supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf;
    let codes = fallbackCodes;
    try {
        codes = supportedValuesOf?.('region') ?? fallbackCodes;
    }
    catch {
        codes = fallbackCodes;
    }
    const locale = language.startsWith('ar') ? 'ar' : language.startsWith('en') ? 'en' : 'fr';
    const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
    return Array.from(new Set(codes.map(normalizeCountryCode)))
        .map((code) => ({
        code,
        name: displayNames.of(code) ?? code,
        label: `${displayNames.of(code) ?? code} (${code})`,
    }))
        .sort((a, b) => a.label.localeCompare(b.label, locale));
}
function formatCustomerName(customer: Customer) {
    return customer.company ? `${customer.company} - ${customer.name}` : customer.name;
}
function getSearchPlaceholder(view: ViewKey) {
    if (view === 'clients')
        return t("audit.text0124");
    if (view === 'payments')
        return t("audit.text0125");
    if (view === 'reports')
        return t("audit.text0126");
    if (view === 'reminders')
        return t("audit.text0127");
    if (view === 'products')
        return t("audit.text0128");
    if (view === 'users')
        return t("audit.text0129");
    return t("audit.text0130");
}
function loadCanvasImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = source;
    });
}
function canvasToPngBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }
            reject(new Error('Canvas export failed'));
        }, 'image/png');
    });
}
async function canvasToPngBlobWithOpacity(canvas: HTMLCanvasElement, opacity: number) {
    const cleanOpacity = Math.max(0.05, Math.min(1, opacity));
    if (cleanOpacity >= 0.999) {
        return canvasToPngBlob(canvas);
    }
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const context = exportCanvas.getContext('2d', { willReadFrequently: true });
    if (!context)
        throw new Error('Canvas export failed');
    context.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.globalAlpha = cleanOpacity;
    context.drawImage(canvas, 0, 0);
    return canvasToPngBlob(exportCanvas);
}
function resizeCanvas(canvas: HTMLCanvasElement | null, width: number, height: number) {
    if (!canvas)
        return;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { willReadFrequently: true })?.drawImage(copy, 0, 0, width, height);
}
function rotateCanvas(canvas: HTMLCanvasElement) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    canvas.width = copy.height;
    canvas.height = copy.width;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context)
        return;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(copy, -copy.width / 2, -copy.height / 2);
}
function clampInt(value: number, min: number, max: number) {
    if (!Number.isFinite(value))
        return min;
    return Math.max(min, Math.min(max, Math.round(value)));
}
function getHttpStatus(error: unknown) {
    if (typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response !== null &&
        'status' in error.response) {
        return Number(error.response.status);
    }
    return undefined;
}
function getApiErrorMessage(error: unknown, fallback: string) {
    const message = (typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response !== null &&
        'data' in error.response &&
        typeof error.response.data === 'object' &&
        error.response.data !== null &&
        'message' in error.response.data &&
        typeof error.response.data.message === 'string')
        ? error.response.data.message
        : error instanceof Error && error.message
            ? error.message
            : fallback;
    const translations: Record<string, string> = {
        'Only active or sent contracts can be invoiced': t('aiAssistant.errors.contractNotInvoiceable'),
        'Contract signature workflow is incomplete': t('aiAssistant.errors.contractSignatureIncomplete'),
    };
    return translations[message] ?? message;
}
function getLocalizedDevisErrorMessage(error: unknown, fallback: string, translate: (key: string) => string) {
    const message = getApiErrorMessage(error, fallback);
    const translations: Record<string, string> = {
        'Only draft quotes can be edited': translate('devis.onlyDraftEditable'),
        'Only draft quotes can be deleted': translate('devis.onlyDraftDeletable'),
        'Only draft, approved or converted quotes can be signed': translate('devis.onlyAllowedStatusesSignable'),
        'This quote is already signed': translate('devis.alreadySigned'),
        'This quote is not signed': translate('devis.notSigned'),
        'An approved quote already exists for this customer and catalog': translate('devis.approvedDuplicateCatalog'),
    };
    return translations[message] ?? message;
}
function normalizeRole(role: string | undefined) {
    const normalized = String(role ?? '').trim().toUpperCase();
    return normalized === 'ADMIN' || normalized === 'EMPLOYEE' ? normalized : undefined;
}
function getInitials(value: string) {
    return value
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('');
}
function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
function isValidPaymentDate(date: string) {
    if (!date)
        return false;
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime()))
        return false;
    return parsed <= new Date(`${getToday()}T23:59:59`);
}
function formatShortDate(date: string) {
    return new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar' : i18n.language.startsWith('en') ? 'en' : 'fr-MA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date(date));
}
function downloadCsv(fileName: string, rows: Array<Record<string, string | number>>) {
    if (!rows.length)
        return;
    const headers = Object.keys(rows[0]);
    const csv = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
function escapeCsvCell(value: string | number | undefined) {
    const cell = String(value ?? '');
    if (/[",\n]/.test(cell)) {
        return `"${cell.replaceAll('"', '""')}"`;
    }
    return cell;
}
function getToday() {
    return new Date().toISOString().slice(0, 10);
}
function getDateAfterDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}
export default App;
