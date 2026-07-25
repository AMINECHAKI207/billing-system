import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Crop,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FilePlus2,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Menu,
  Moon,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Printer,
  Redo2,
  RefreshCcw,
  RotateCw,
  Trash2,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Stamp,
  Sun,
  Undo2,
  Unlock,
  Upload,
  Users,
  WalletCards,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, getDaysUntilDue } from '@/lib/utils';
import { getInitialTheme, getStoredTheme, isThemePreference, persistTheme } from '@/lib/theme';
import {
  cancelInvoiceSignature,
  changePassword,
  createInvoice,
  createCustomer,
  createProduct,
  createUser,
  createReminder,
  deleteCompanySignature,
  deleteCompanyStamp,
  deleteCustomer,
  downloadInvoicePdf,
  getCompanySettings,
  getCustomers,
  getCustomerById,
  getCurrentUser,
  getEmailDeliveryStatus,
  getInvoiceById,
  getInvoiceDashboard,
  getInvoices,
  getPayments,
  getRecurringPlans,
  getProducts,
  getReceivablesAgingReport,
  getRecentEmailLogs,
  getReminders,
  getTaxSummaryReport,
  getUsers,
  getRbacPermissions,
  getRbacRoles,
  getRbacUsers,
  assignRbacPermissions,
  assignRbacUserRole,
  getRbacUserClients,
  assignRbacUserClients,
  createRbacPermission,
  createRbacRole,
  deleteRbacRole,
  clearAuthSession,
  login,
  logout,
  recordPayment,
  createRecurringPlan,
  updateRecurringPlanStatus,
  runRecurringPlan,
  removeCompanyAssetBackgroundPreview,
  runAutomaticReminders,
  sendInvoiceEmail,
  sendTestEmail,
  signInvoice,
  printInvoicePdf,
  refreshAccessToken,
  updateCustomer,
  updateInvoice,
  updateCompanySettings,
  updateThemePreference,
  updateInvoiceStatus,
  updateProduct,
  updateUser,
  uploadCompanySignature,
  uploadCompanyStamp,
} from '@/lib/api';
import type {
  CompanySettings,
  CreateProductForm,
  CreateUserForm,
  Customer,
  CreateInvoiceForm,
  DashboardPeriod,
  DashboardStats,
  Invoice,
  InvoiceItemForm,
  InvoiceStatus,
  PaymentMethod,
  Reminder,
  ReminderStatus,
  ReminderType,
  RecurringFrequency,
  RecurringPlanStatus,
  ThemePreference,
  UpdateCompanySettingsForm,
  UpdateProductForm,
  UpdateUserForm,
  User,
  UserRole,
} from '@/types';

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
type CompanyAssetKind = 'signature' | 'stamp';
type CompanyAssetDraft = {
  blob: Blob;
  fileName: string;
  previewUrl: string;
};
type ViewKey =
  | 'dashboard'
  | 'clients'
  | 'invoices'
  | 'payments'
  | 'reports'
  | 'reminders'
  | 'products'
  | 'users'
  | 'rbac'
  | 'settings';
type InvoiceSortField = 'createdAt' | 'issueDate' | 'dueDate' | 'total' | 'balanceDue' | 'invoiceNumber';
type CustomerSortField = 'createdAt' | 'name' | 'company' | 'email';
type CustomerStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type ExportTarget = 'invoices' | 'customers' | 'reminders' | 'reports' | 'tax-report';
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

const statusLabels: Record<InvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  SENT: 'Envoyee',
  PAID: 'Payee',
  PARTIALLY_PAID: 'Partielle',
  OVERDUE: 'En retard',
  CANCELLED: 'Annulee',
};

const statusClasses: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  SENT: 'bg-sky-100 text-sky-700 ring-sky-200',
  PAID: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-700 ring-amber-200',
  OVERDUE: 'bg-rose-100 text-rose-700 ring-rose-200',
  CANCELLED: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
};

const statusChartColors: Record<InvoiceStatus, string> = {
  DRAFT: '#64748B',
  SENT: '#2563EB',
  PAID: '#16A34A',
  PARTIALLY_PAID: '#F59E0B',
  OVERDUE: '#DC2626',
  CANCELLED: '#71717A',
};

const dashboardPeriods: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'this_month', label: 'Ce mois' },
  { value: 'last_3_months', label: '3 mois' },
  { value: 'last_6_months', label: '6 mois' },
  { value: 'this_year', label: 'Cette annee' },
  { value: 'custom', label: 'Personnalise' },
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'billing-sidebar-collapsed';
const EMPTY_PERMISSIONS: string[] = [];

const navItems: Array<{ key: ViewKey; label: string; icon: typeof ReceiptText }> = [
  { key: 'dashboard', label: 'Dashboard', icon: ReceiptText },
  { key: 'clients', label: 'Clients', icon: Users },
  { key: 'invoices', label: 'Factures', icon: WalletCards },
  { key: 'payments', label: 'Paiements', icon: CheckCircle2 },
  { key: 'reports', label: 'Rapports', icon: AlertTriangle },
  { key: 'reminders', label: 'Relances', icon: Bell },
  { key: 'products', label: 'Catalogue', icon: ReceiptText },
  { key: 'users', label: 'Utilisateurs', icon: Users },
  { key: 'rbac', label: 'Roles & permissions', icon: ShieldCheck },
  { key: 'settings', label: 'Parametres', icon: Settings },
];

const viewMeta: Record<ViewKey, { title: string; description: string }> = {
  dashboard: {
    title: 'Tableau de bord',
    description: 'Suivi des impayes, paiements et relances clients.',
  },
  clients: {
    title: 'Clients',
    description: 'Contacts de facturation, volume et exposition client.',
  },
  invoices: {
    title: 'Factures',
    description: 'Creation, statut, PDF et paiements.',
  },
  payments: {
    title: 'Paiements',
    description: 'Historique des encaissements et references.',
  },
  reports: {
    title: 'Rapports',
    description: 'Analyse des impayes et vieillissement des creances.',
  },
  reminders: {
    title: 'Relances',
    description: 'Historique des relances et priorites de recouvrement.',
  },
  products: {
    title: 'Catalogue',
    description: 'Prestations et tarifs reutilisables dans les factures.',
  },
  users: {
    title: 'Utilisateurs',
    description: 'Comptes, roles et acces de l equipe.',
  },
  rbac: {
    title: 'Roles & permissions',
    description: 'Gouvernance des acces et permissions de l application.',
  },
  settings: {
    title: 'Parametres',
    description: 'Informations societe utilisees sur les factures PDF.',
  },
};

const viewPaths: Record<ViewKey, string> = {
  dashboard: '/dashboard',
  clients: '/clients',
  invoices: '/invoices',
  payments: '/payments',
  reports: '/reports',
  reminders: '/reminders',
  products: '/catalogue',
  users: '/users',
  rbac: '/rbac',
  settings: '/settings',
};

const pathViews = Object.entries(viewPaths).reduce<Record<string, ViewKey>>(
  (acc, [view, path]) => {
    acc[path] = view as ViewKey;
    return acc;
  },
  {}
);

function getViewFromPath(pathname: string): ViewKey {
  return pathViews[pathname] ?? 'dashboard';
}

function App() {
  const queryClient = useQueryClient();
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
  const [invoiceDateFrom, setInvoiceDateFrom] = useState('');
  const [invoiceDateTo, setInvoiceDateTo] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceSortBy, setInvoiceSortBy] = useState<InvoiceSortField>('createdAt');
  const [invoiceSortOrder, setInvoiceSortOrder] = useState<'asc' | 'desc'>('desc');
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
  const [actionMessage, setActionMessage] = useState('');
  const [exportingTarget, setExportingTarget] = useState<ExportTarget | ''>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [viewInvoiceId, setViewInvoiceId] = useState('');
  const [viewCustomerId, setViewCustomerId] = useState('');
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
  const [companyAssetDrafts, setCompanyAssetDrafts] = useState<
    Record<CompanyAssetKind, CompanyAssetDraft | null>
  >({ signature: null, stamp: null });
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
  const [invoiceCustomerId, setInvoiceCustomerId] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState<Extract<InvoiceStatus, 'DRAFT' | 'SENT'>>('DRAFT');
  const [invoiceIssueDate, setInvoiceIssueDate] = useState(getToday());
  const [invoiceDueDate, setInvoiceDueDate] = useState(getDateAfterDays(30));
  const [invoiceTaxRate, setInvoiceTaxRate] = useState(20);
  const [isVatOverride, setIsVatOverride] = useState(false);
  const [invoiceVatOverrideReason, setInvoiceVatOverrideReason] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceTerms, setInvoiceTerms] = useState('Paiement a 30 jours.');
  const [invoiceItems, setInvoiceItems] = useState<InvoiceDraftItem[]>([
    { description: 'Prestation de service', unit: 'forfait', quantity: 1, unitPrice: 1000, taxRate: 20 },
  ]);
  const [recurringName, setRecurringName] = useState('Abonnement mensuel');
  const [recurringCustomerId, setRecurringCustomerId] = useState('');
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [recurringStartDate, setRecurringStartDate] = useState(getToday());
  const [recurringDueDays, setRecurringDueDays] = useState(30);
  const [recurringDescription, setRecurringDescription] = useState('Maintenance mensuelle');
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
      navigateAppTo('/dashboard', true);
    },
  });
  const reminderMutation = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      setActionMessage('Relance preparee et enregistree dans l historique.');
      resetReminderDraft();
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: () => {
      setActionMessage('Impossible de preparer la relance pour le moment.');
    },
  });
  const automaticReminderMutation = useMutation({
    mutationFn: runAutomaticReminders,
    onSuccess: (result) => {
      setActionMessage(
        `${result.createdCount} relance${result.createdCount > 1 ? 's' : ''} generee${
          result.createdCount > 1 ? 's' : ''
        }, ${result.skippedCount} deja existante${result.skippedCount > 1 ? 's' : ''}.`
      );
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: () => {
      setActionMessage('Impossible de generer les relances automatiques.');
    },
  });
  const paymentMutation = useMutation({
    mutationFn: (invoice: InvoiceSummary | Invoice) =>
      recordPayment(invoice.id, {
        amount: Number(paymentAmount),
        paymentDate: paymentEntryDate,
        method: paymentMethod,
        reference: paymentReference || undefined,
      }),
    onSuccess: () => {
      setActionMessage('Paiement enregistre et solde facture mis a jour.');
      setPaymentAmount('');
      setPaymentEntryDate(getToday());
      setPaymentReference('');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: () => {
      setActionMessage('Impossible d enregistrer le paiement pour le moment.');
    },
  });
  const recurringCreateMutation = useMutation({
    mutationFn: () => createRecurringPlan({
      customerId: recurringCustomerId, name: recurringName, frequency: recurringFrequency, intervalCount: 1,
      startDate: recurringStartDate, dueDays: recurringDueDays, autoSend: recurringAutoSend, currency: 'MAD', discount: 0,
      terms: `Paiement a ${recurringDueDays} jours.`,
      items: [{ description: recurringDescription, unit: 'mois', quantity: 1, unitPrice: recurringUnitPrice, taxRate: recurringTaxRate }],
    }),
    onSuccess: () => {
      setActionMessage('Plan recurrent cree avec succes.');
      queryClient.invalidateQueries({ queryKey: ['recurring-plans'] });
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible de creer le plan recurrent.')),
  });
  const recurringStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' }) => updateRecurringPlanStatus(id, status),
    onSuccess: () => { setActionMessage('Statut du plan recurrent mis a jour.'); queryClient.invalidateQueries({ queryKey: ['recurring-plans'] }); },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible de modifier le plan recurrent.')),
  });
  const recurringRunMutation = useMutation({
    mutationFn: runRecurringPlan,
    onSuccess: () => {
      setActionMessage('Facture recurrente generee avec succes.');
      queryClient.invalidateQueries({ queryKey: ['recurring-plans'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible d executer le plan recurrent.')),
  });

  const customerMutation = useMutation({
    mutationFn: () =>
      editingCustomerId
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
      setActionMessage(editingCustomerId ? 'Client mis a jour avec succes.' : 'Client ajoute avec succes.');
      resetCustomerForm();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: () => {
      setActionMessage('Impossible d ajouter le client pour le moment.');
    },
  });
  const customerStatusMutation = useMutation({
    mutationFn: (customer: Customer) =>
      updateCustomer(customer.id, { isActive: !customer.isActive }),
    onSuccess: () => {
      setActionMessage('Statut client mis a jour.');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: () => {
      setActionMessage('Impossible de mettre a jour le statut client.');
    },
  });
  const deleteCustomerMutation = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      setActionMessage('Client supprime avec succes.');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: () => {
      setActionMessage('Suppression impossible. Verifiez les droits ou les factures liees.');
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
      await uploadCompanySignature(
        new File([companyAssetDrafts.signature.blob], companyAssetDrafts.signature.fileName, {
          type: companyAssetDrafts.signature.blob.type || 'image/png',
        })
      );
    }

    if (companyAssetDrafts.stamp) {
      await uploadCompanyStamp(
        new File([companyAssetDrafts.stamp.blob], companyAssetDrafts.stamp.fileName, {
          type: companyAssetDrafts.stamp.blob.type || 'image/png',
        })
      );
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
      setActionMessage('Parametres societe mis a jour.');
      queryClient.invalidateQueries({ queryKey: ['settings', 'company'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
    },
    onError: (error) => {
      setActionMessage(
        getApiErrorMessage(error, 'Impossible de mettre a jour les parametres societe.')
      );
    },
  });
  const signInvoiceMutation = useMutation({
    mutationFn: signInvoice,
    onSuccess: (invoice) => {
      setActionMessage(`Facture ${invoice.invoiceNumber} signee et tamponnee.`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'detail', invoice.id] });
    },
    onError: () => {
      setActionMessage('Signature impossible. Verifiez les droits et la configuration signature/tampon.');
    },
  });
  const cancelInvoiceSignatureMutation = useMutation({
    mutationFn: cancelInvoiceSignature,
    onSuccess: (invoice) => {
      setActionMessage(`Signature de la facture ${invoice.invoiceNumber} annulee.`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'detail', invoice.id] });
    },
    onError: () => {
      setActionMessage('Impossible d annuler la signature de cette facture.');
    },
  });
  const passwordMutation = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setActionMessage('Mot de passe mis a jour.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    },
    onError: () => {
      setActionMessage('Impossible de modifier le mot de passe. Verifiez le mot de passe actuel.');
    },
  });
  const testEmailMutation = useMutation({
    mutationFn: () => sendTestEmail(),
    onSuccess: (result) => {
      setActionMessage(
        result.delivery.mode === 'local'
          ? `Email test genere localement pour ${result.to}.`
          : `Email test envoye a ${result.to}.`
      );
      queryClient.invalidateQueries({ queryKey: ['settings', 'email-status'] });
    },
    onError: () => {
      setActionMessage('Impossible d envoyer l email test. Verifiez la configuration SMTP.');
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
      setActionMessage(editingProductId ? 'Prestation mise a jour.' : 'Prestation ajoutee.');
      resetProductForm();
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
      setActionMessage('Impossible d enregistrer cette prestation.');
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
      setActionMessage(editingUserId ? 'Utilisateur mis a jour.' : 'Utilisateur ajoute.');
      resetUserForm();
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: () => {
      setActionMessage('Impossible d enregistrer cet utilisateur.');
    },
  });
  const rbacRoleMutation = useMutation({
    mutationFn: () => createRbacRole({ name: rbacRoleName, description: rbacRoleDescription || undefined }),
    onSuccess: () => {
      setRbacRoleName('');
      setRbacRoleDescription('');
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      setActionMessage('Role cree avec succes.');
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible de creer le role.')),
  });
  const rbacPermissionMutation = useMutation({
    mutationFn: () => assignRbacPermissions(selectedRbacRoleId, rbacPermissionIds.map((permissionId) => ({ permissionId, scope: rbacPermissionScopes[permissionId] ?? 'ALL' }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      setActionMessage('Permissions du role mises a jour.');
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible de modifier les permissions.')),
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
      setActionMessage('Permission creee avec succes.');
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible de creer la permission.')),
  });
  const rbacUserRoleMutation = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) => assignRbacUserRole(userId, roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setActionMessage('Role utilisateur mis a jour.');
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible d attribuer le role.')),
  });
  const rbacClientAssignmentMutation = useMutation({
    mutationFn: () => assignRbacUserClients(selectedRbacUserId, rbacAssignedClientIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'user-clients', selectedRbacUserId] });
      setActionMessage('Clients attribues avec succes.');
    },
    onError: (error) => setActionMessage(getApiErrorMessage(error, 'Impossible de modifier les clients attribues.')),
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
      setActionMessage(editingInvoiceId ? 'Facture mise a jour avec succes.' : 'Facture creee avec succes.');
      setIsInvoiceFormOpen(false);
      resetInvoiceForm();
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: () => {
      setActionMessage('Impossible de creer la facture pour le moment.');
    },
  });
  const invoiceStatusMutation = useMutation({
    mutationFn: ({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) =>
      updateInvoiceStatus(invoiceId, status),
    onSuccess: () => {
      setActionMessage('Statut de facture mis a jour.');
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
    },
    onError: () => {
      setActionMessage('Impossible de modifier le statut de cette facture.');
    },
  });
  const invoiceEmailMutation = useMutation({
    mutationFn: () =>
      sendInvoiceEmail(emailInvoiceId, {
        recipientEmail: invoiceEmailRecipient || undefined,
        subject: invoiceEmailSubject || undefined,
        message: invoiceEmailMessage || undefined,
      }),
    onSuccess: (result) => {
      setActionMessage(
        result.delivery.mode === 'local'
          ? `Email facture genere localement pour ${result.email.to}.`
          : `Facture envoyee a ${result.email.to}.`
      );
      closeInvoiceEmailModal();
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] });
    },
    onError: () => {
      setActionMessage('Impossible d envoyer la facture par email. Verifiez la configuration SMTP.');
    },
  });

  const invoiceQuery = useQuery({
    queryKey: [
      'invoices',
      'dashboard-list',
      activeView,
      searchTerm,
      invoiceStatusFilter,
      invoiceDateFrom,
      invoiceDateTo,
      invoicePage,
      invoiceSortBy,
      invoiceSortOrder,
    ],
    queryFn: () =>
      getInvoices({
        page: activeView === 'invoices' ? invoicePage : 1,
        limit: activeView === 'invoices' ? 25 : 8,
        search: searchTerm || undefined,
        status: invoiceStatusFilter === 'ALL' ? undefined : invoiceStatusFilter,
        dateFrom: activeView === 'invoices' ? invoiceDateFrom || undefined : undefined,
        dateTo: activeView === 'invoices' ? invoiceDateTo || undefined : undefined,
        sortBy: invoiceSortBy,
        sortOrder: invoiceSortOrder,
      }),
    enabled: hasAccessToken,
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
    queryFn: () =>
      getInvoiceDashboard({
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
    queryFn: () =>
      getCustomers({
        page: activeView === 'clients' ? customerPage : 1,
        limit: activeView === 'clients' ? 15 : 50,
        search: activeView === 'clients' ? searchTerm : undefined,
        isActive:
          activeView === 'clients'
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
    queryFn: () =>
      getReminders({
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
    queryFn: () =>
      getPayments({
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
    queryFn: () =>
      getTaxSummaryReport({
        dateFrom: reportDateFrom || undefined,
        dateTo: reportDateTo || undefined,
      }),
    enabled: hasAccessToken && activeView === 'reports',
  });
  const productQuery = useQuery({
    queryKey: ['products', activeView],
    queryFn: () =>
      getProducts({
        limit: 100,
        isActive: activeView === 'products' ? undefined : true,
      }),
    enabled: hasAccessToken,
  });
  const userQuery = useQuery({
    queryKey: ['users', searchTerm, userRoleFilter, userStatusFilter, userPage],
    queryFn: () =>
      getUsers({
        page: userPage,
        limit: 15,
        search: searchTerm || undefined,
        role: userRoleFilter === 'ALL' ? undefined : userRoleFilter,
        isActive:
          userStatusFilter === 'ALL' ? undefined : userStatusFilter === 'ACTIVE',
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
  const customerInvoiceQuery = useQuery({
    queryKey: ['customers', 'detail-invoices', viewCustomerId],
    queryFn: () =>
      getInvoices({
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
      setActionMessage('Theme sauvegarde localement. Synchronisation serveur impossible.');
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
    enabled:
      hasAccessToken &&
      activeView === 'settings' &&
      normalizeRole(currentUserQuery.data?.role) === 'ADMIN',
  });
  const emailLogsQuery = useQuery({
    queryKey: ['settings', 'email-logs'],
    queryFn: getRecentEmailLogs,
    enabled:
      hasAccessToken &&
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
    } else {
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
      if (event.key !== 'themePreference' || !isThemePreference(event.newValue)) return;
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
      } catch {
        clearAuthSession();
      } finally {
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
    if (isAuthBootstrapping) return;

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
    if (hasHydratedServerThemeRef.current) return;

    const serverTheme = currentUserQuery.data?.themePreference;
    if (!isThemePreference(serverTheme)) return;

    hasHydratedServerThemeRef.current = true;
    // A local choice is authoritative. Use the server value only on devices
    // where the user has not selected a theme yet.
    if (getStoredTheme() === null) {
      setThemePreference(serverTheme);
    }
  }, [currentUserQuery.data?.themePreference]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
      if (
        notificationMenuRef.current &&
        !notificationMenuRef.current.contains(event.target as Node)
      ) {
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
    if (!recurringCustomerId && firstCustomer) {
      setRecurringCustomerId(firstCustomer.id);
    }
  }, [customerQuery.data, invoiceCustomerId]);

  useEffect(() => {
    if (invoiceDetailQuery.data && !paymentAmount) {
      setPaymentAmount(String(Number(invoiceDetailQuery.data.balanceDue)));
    }
  }, [invoiceDetailQuery.data, paymentAmount]);

  useEffect(() => {
    setInvoicePage(1);
  }, [searchTerm, invoiceStatusFilter, invoiceDateFrom, invoiceDateTo, invoiceSortBy, invoiceSortOrder]);

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
    if (!currentUserQuery.isError) return;

    const status = getHttpStatus(currentUserQuery.error);
    if (status === 401) {
      clearAuthSession();
      setAccessToken('');
      setActionMessage('Session expiree. Reconnectez-vous.');
      queryClient.removeQueries({ queryKey: ['auth'] });
      queryClient.removeQueries({ queryKey: ['invoices'] });
      queryClient.removeQueries({ queryKey: ['customers'] });
      queryClient.removeQueries({ queryKey: ['reminders'] });
    }
  }, [currentUserQuery.error, currentUserQuery.isError, queryClient]);

  useEffect(() => {
    if (
      companySettingsQuery.data &&
      !companyAssetDrafts.signature &&
      !companyAssetDrafts.stamp &&
      !companyAssetDeletes.signature &&
      !companyAssetDeletes.stamp
    ) {
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
  const dashboardStatusData =
    dashboardStats?.invoiceStatusCounts
      .filter((item) => ['DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(item.status))
      .map((item) => ({
        ...item,
        label: statusLabels[item.status],
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
  const payableInvoices = invoices.filter(
    (invoice) => invoice.total > invoice.paid && invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED'
  );
  const selectedInvoice = payableInvoices.find((invoice) => invoice.id === selectedInvoiceId) ?? payableInvoices[0];
  const selectedBalance = selectedInvoice ? selectedInvoice.total - selectedInvoice.paid : 0;
  const activeViewMeta = viewMeta[activeView];
  const selectedCustomer =
    customerDetailQuery.data ?? customerQuery.data?.data.find((customer) => customer.id === viewCustomerId);
  const userPermissions = currentUserQuery.data?.permissions ?? EMPTY_PERMISSIONS;
  const hasPermission = (permission: string) => userPermissions.includes(permission);
  const isAdmin = hasPermission('roles.view') && hasPermission('permissions.assign');
  const selectedInvoiceCustomer =
    customerQuery.data?.data.find((customer) => customer.id === invoiceCustomerId) ??
    invoiceDetailQuery.data?.customer;
  const automaticVatRate = getAutomaticVatRate(selectedInvoiceCustomer, companySettingsQuery.data);
  const effectiveVatRate = isVatOverride ? invoiceTaxRate : automaticVatRate;
  const invoiceTotals = calculateInvoiceTotals(invoiceItems, effectiveVatRate, invoiceDiscount);
  const visibleNavItems = navItems.filter((item) => {
    if (item.key === 'users') return hasPermission('users.view');
    if (item.key === 'rbac') return hasPermission('roles.view') || hasPermission('permissions.view');
    if (item.key === 'dashboard') return hasPermission('dashboard.view');
    if (item.key === 'clients') return hasPermission('clients.view');
    if (item.key === 'invoices') return hasPermission('invoices.view');
    if (item.key === 'payments') return hasPermission('payments.view');
    if (item.key === 'reports') return hasPermission('reports.view');
    if (item.key === 'products') return hasPermission('products.view');
    if (item.key === 'reminders') return hasPermission('reminders.view');
    return true;
  });
  useEffect(() => {
    if (isVatOverride) return;

    setInvoiceTaxRate(automaticVatRate);
    setInvoiceItems((items) =>
      items.map((item) => ({
        ...item,
        taxRate: automaticVatRate,
      }))
    );
  }, [automaticVatRate, isVatOverride]);
  useEffect(() => {
    const cannotAccessAdminView =
      (activeView === 'users' && !userPermissions.includes('users.view')) ||
      (activeView === 'rbac' &&
        !userPermissions.includes('roles.view') &&
        !userPermissions.includes('permissions.view'));

    if (currentUserQuery.data && cannotAccessAdminView) {
      setActiveView('dashboard');
      setActionMessage('Vous n avez pas la permission d acceder a cette section.');
    }
  }, [activeView, currentUserQuery.data, userPermissions]);

  useEffect(() => {
    const role = rbacRolesQuery.data?.find((item) => item.id === selectedRbacRoleId) ?? rbacRolesQuery.data?.[0];
    if (!role) return;
    if (role.id !== selectedRbacRoleId) setSelectedRbacRoleId(role.id);
    setRbacPermissionIds(role.permissions.map(({ permission }) => permission.id));
    setRbacPermissionScopes(Object.fromEntries(role.permissions.map(({ permission, scope }) => [permission.id, scope ?? 'ALL'])));
  }, [rbacRolesQuery.data, selectedRbacRoleId]);

  useEffect(() => {
    setRbacAssignedClientIds((rbacUserClientsQuery.data ?? []).map((client) => client.id));
  }, [rbacUserClientsQuery.data]);

  const reminders = filterReminders(
    reminderQuery.data?.data ?? [],
    searchTerm,
    reminderTypeFilter
  );
  const failedReminders = reminders.filter((reminder) => reminder.status === 'FAILED');
  const pendingReminders = reminders.filter((reminder) => reminder.status === 'PENDING');
  const notificationItems = [
    overdueInvoices.length
      ? {
          key: 'overdue',
          title: `${overdueInvoices.length} facture${overdueInvoices.length > 1 ? 's' : ''} en retard`,
          description: `${formatCurrency(totalUnpaid)} a recouvrer`,
          tone: 'danger',
          view: 'invoices' as ViewKey,
          icon: AlertTriangle,
        }
      : null,
    dueSoonInvoices.length
      ? {
          key: 'due-soon',
          title: `${dueSoonInvoices.length} echeance${dueSoonInvoices.length > 1 ? 's' : ''} proche${dueSoonInvoices.length > 1 ? 's' : ''}`,
          description: 'Factures a surveiller dans les 7 jours',
          tone: 'warning',
          view: 'dashboard' as ViewKey,
          icon: CalendarClock,
        }
      : null,
    failedReminders.length
      ? {
          key: 'failed-reminders',
          title: `${failedReminders.length} relance${failedReminders.length > 1 ? 's' : ''} echouee${failedReminders.length > 1 ? 's' : ''}`,
          description: 'Verifier les erreurs email ou relancer manuellement',
          tone: 'danger',
          view: 'reminders' as ViewKey,
          icon: Mail,
        }
      : null,
    pendingReminders.length
      ? {
          key: 'pending-reminders',
          title: `${pendingReminders.length} relance${pendingReminders.length > 1 ? 's' : ''} en attente`,
          description: 'Actions de recouvrement a suivre',
          tone: 'info',
          view: 'reminders' as ViewKey,
          icon: Bell,
        }
      : null,
  ].filter((item): item is NotificationItem => Boolean(item));
  const notificationCount = notificationItems.length;
  const payments = paymentQuery.data?.data ?? [];
  const receivablesInvoices =
    receivablesAgingQuery.data?.buckets.flatMap((bucket) =>
      bucket.invoices.map((invoice) => ({ ...invoice, bucket: bucket.label }))
    ) ?? [];

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValidEmail(email)) {
      setLoginValidationError('Please enter a valid email address.');
      return;
    }

    if (!password.trim()) {
      setLoginValidationError('Please enter your password.');
      return;
    }

    setLoginValidationError('');
    loginMutation.mutate({ email, password, rememberMe });
  };

  const handleViewChange = (view: ViewKey) => {
    if (view === 'rbac' && !hasPermission('roles.view') && !hasPermission('permissions.view')) {
      setActiveView('dashboard');
      setActionMessage('Vous n avez pas la permission d acceder a cette section.');
      return;
    }

    const permissionByView: Partial<Record<ViewKey, string>> = {
      dashboard: 'dashboard.view',
      clients: 'clients.view',
      invoices: 'invoices.view',
      payments: 'payments.view',
      reports: 'reports.view',
      reminders: 'reminders.view',
      products: 'products.view',
      users: 'users.view',
      settings: 'settings.view',
    };
    if (permissionByView[view] && !hasPermission(permissionByView[view]!)) {
      setActiveView('dashboard');
      setActionMessage('Vous n avez pas la permission d acceder a cette section.');
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
    const nextTheme: ThemePreference =
      themePreferenceRef.current === 'dark' ? 'light' : 'dark';

    themePreferenceRef.current = nextTheme;
    persistTheme(nextTheme);
    setThemePreference(nextTheme);

    if (hasAccessToken) {
      queryClient.setQueryData<User | undefined>(['auth', 'me'], (currentUser) =>
        currentUser ? { ...currentUser, themePreference: nextTheme } : currentUser
      );
      themeMutation.mutate(nextTheme);
    }
  };

  const resetInvoiceFilters = () => {
    setSearchTerm('');
    setInvoiceStatusFilter('ALL');
    setInvoiceDateFrom('');
    setInvoiceDateTo('');
    setInvoicePage(1);
    setInvoiceSortBy('createdAt');
    setInvoiceSortOrder('desc');
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
    } catch {
      clearAuthSession();
    }

    clearAuthSession();
    setAccessToken('');
    setActiveView('dashboard');
    setActionMessage('Session fermee.');
    queryClient.clear();
    navigateAppTo('/login', true);
  };

  const handlePrepareReminder = (invoice: InvoiceSummary) => {
    if (!usingLiveData) {
      setActionMessage('Connectez-vous pour enregistrer une relance.');
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
      setActionMessage('Selectionnez une facture a relancer.');
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

    if (!selectedInvoice) return;

    if (selectedInvoice.status === 'DRAFT' || selectedInvoice.status === 'CANCELLED') {
      setActionMessage('Envoyez la facture avant d enregistrer un paiement.');
      return;
    }

    const amount = Number(paymentAmount);
    if (!amount || amount <= 0 || amount > selectedBalance) {
      setActionMessage('Le montant du paiement doit etre compris dans le solde restant.');
      return;
    }

    if (!isValidPaymentDate(paymentEntryDate)) {
      setActionMessage('La date de paiement ne peut pas etre vide ou future.');
      return;
    }

    if (!usingLiveData) {
      setActionMessage('Connectez-vous pour enregistrer un paiement.');
      return;
    }

    paymentMutation.mutate(selectedInvoice);
  };

  const handleRecordDetailPayment = (event: FormEvent<HTMLFormElement>, invoice: Invoice) => {
    event.preventDefault();

    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
      setActionMessage('Envoyez la facture avant d enregistrer un paiement.');
      return;
    }

    const amount = Number(paymentAmount);
    const balance = Number(invoice.balanceDue);
    if (!amount || amount <= 0 || amount > balance) {
      setActionMessage('Le montant du paiement doit etre compris dans le solde restant.');
      return;
    }

    if (!isValidPaymentDate(paymentEntryDate)) {
      setActionMessage('La date de paiement ne peut pas etre vide ou future.');
      return;
    }

    paymentMutation.mutate(invoice);
  };

  const handleDownloadPdf = async (invoice: InvoiceSummary) => {
    if (!usingLiveData) {
      setActionMessage('Connectez-vous pour telecharger le PDF.');
      return;
    }

    try {
      await downloadInvoicePdf(invoice.id, invoice.number);
      setActionMessage('PDF de facture telecharge.');
    } catch {
      setActionMessage('Impossible de telecharger le PDF pour le moment.');
    }
  };

  const handleCompanyAssetUpload = (kind: CompanyAssetKind, file?: File) => {
    if (!file) return;

    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut modifier les images societe.');
      return;
    }

    const allowedTypes = ['image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) {
      setActionMessage('Format invalide. Utilisez PNG, JPG ou JPEG.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setActionMessage('Image trop volumineuse. Taille maximale: 2 Mo.');
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
      title: kind === 'signature' ? 'Modifier la signature' : 'Modifier le tampon',
      imageUrl: previewUrl,
      autoProcess: autoBackgroundRemoval,
    });
    setActionMessage(
      autoBackgroundRemoval
        ? 'Image chargee. Suppression du fond IA en cours, confirmez le resultat avant sauvegarde.'
        : 'Image chargee sans suppression automatique. Modifiez-la puis confirmez avant sauvegarde.'
    );
  };

  const handleAutoBackgroundRemovalPreferenceChange = (enabled: boolean) => {
    setAutoBackgroundRemoval(enabled);
    localStorage.setItem(AUTO_BACKGROUND_REMOVAL_STORAGE_KEY, String(enabled));
    setAssetEditor((editor) => (editor ? { ...editor, autoProcess: enabled } : editor));
  };

  const handleRemoveCompanyAssetBackground = (kind: CompanyAssetKind) => {
    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut modifier les images societe.');
      return;
    }

    const currentUrl = kind === 'signature' ? companyForm.signatureUrl : companyForm.stampUrl;
    if (!currentUrl) {
      setActionMessage('Ajoutez d abord une image avant de supprimer le fond.');
      return;
    }

    setAssetEditor({
      kind,
      title: kind === 'signature' ? 'Modifier la signature' : 'Modifier le tampon',
      imageUrl: currentUrl,
      autoProcess: true,
    });
  };

  const handleCompanyAssetDelete = (kind: CompanyAssetKind) => {
    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut supprimer les images societe.');
      return;
    }

    const label = kind === 'signature' ? 'la signature' : 'le tampon';
    if (!window.confirm(`Supprimer ${label} de l entreprise ?`)) return;

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
    setActionMessage('Suppression preparee. Cliquez sur Sauvegarder pour confirmer.');
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
    setActionMessage('Image modifiee. Cliquez sur Sauvegarder pour enregistrer.');
  };

  const handleSignInvoice = (invoice: Invoice) => {
    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut signer une facture.');
      return;
    }

    if (invoice.isSigned) {
      setActionMessage('Cette facture est deja signee.');
      return;
    }

    const settings = companySettingsQuery.data;
    if (!settings?.signatureUrl || !settings?.stampUrl) {
      setActionMessage('Configurez la signature et le tampon avant de signer.');
      return;
    }

    if (!window.confirm(`Signer et tamponner definitivement la facture ${invoice.invoiceNumber} ?`)) {
      return;
    }

    signInvoiceMutation.mutate(invoice.id);
  };

  const handleCancelInvoiceSignature = (invoice: Invoice) => {
    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut annuler une signature.');
      return;
    }

    if (!invoice.isSigned) {
      setActionMessage('Cette facture n est pas signee.');
      return;
    }

    if (!window.confirm(`Annuler la signature et le tampon de la facture ${invoice.invoiceNumber} ?`)) {
      return;
    }

    cancelInvoiceSignatureMutation.mutate(invoice.id);
  };

  const handlePrintInvoicePdf = async (invoice: Invoice) => {
    try {
      await printInvoicePdf(invoice.id);
      setActionMessage('PDF ouvert pour impression.');
    } catch {
      setActionMessage('Impossible d imprimer le PDF pour le moment.');
    }
  };

  const fetchAllInvoicesForExport = async () => {
    const firstPage = await getInvoices({
      page: 1,
      limit: EXPORT_PAGE_SIZE,
      search: searchTerm || undefined,
      status: invoiceStatusFilter === 'ALL' ? undefined : invoiceStatusFilter,
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
      isActive:
        customerStatusFilter === 'ALL' ? undefined : customerStatusFilter === 'ACTIVE',
      sortBy: customerSortBy,
      sortOrder: customerSortOrder,
    });
    const data = [...firstPage.data];

    for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
      const nextPage = await getCustomers({
        page,
        limit: EXPORT_PAGE_SIZE,
        search: searchTerm || undefined,
        isActive:
          customerStatusFilter === 'ALL' ? undefined : customerStatusFilter === 'ACTIVE',
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
        setActionMessage('Aucune facture a exporter.');
        return;
      }

      const rows = exportedInvoices.map((invoice) => ({
        facture: invoice.invoiceNumber,
        client: invoice.customer?.company ?? invoice.customer?.name ?? '',
        statut: statusLabels[invoice.status],
        emission: invoice.issueDate,
        echeance: invoice.dueDate,
        total: Number(invoice.total),
        paye: Number(invoice.amountPaid),
        solde: Number(invoice.balanceDue),
      }));

      downloadCsv(`factures-${getToday()}.csv`, rows);
      setActionMessage(`${rows.length} facture${rows.length > 1 ? 's' : ''} exportee${rows.length > 1 ? 's' : ''}.`);
    } catch {
      setActionMessage('Impossible d exporter les factures pour le moment.');
    } finally {
      setExportingTarget('');
    }
  };

  const handleExportCustomers = async () => {
    setExportingTarget('customers');
    try {
      const exportedCustomers = await fetchAllCustomersForExport();
      if (!exportedCustomers.length) {
        setActionMessage('Aucun client a exporter.');
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

      downloadCsv(`clients-${getToday()}.csv`, rows);
      setActionMessage(`${rows.length} client${rows.length > 1 ? 's' : ''} exporte${rows.length > 1 ? 's' : ''}.`);
    } catch {
      setActionMessage('Impossible d exporter les clients pour le moment.');
    } finally {
      setExportingTarget('');
    }
  };

  const handleExportReminders = async () => {
    setExportingTarget('reminders');
    try {
      const exportedReminders = await fetchAllRemindersForExport();
      if (!exportedReminders.length) {
        setActionMessage('Aucune relance a exporter.');
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

      downloadCsv(`relances-${getToday()}.csv`, rows);
      setActionMessage(`${rows.length} relance${rows.length > 1 ? 's' : ''} exportee${rows.length > 1 ? 's' : ''}.`);
    } catch {
      setActionMessage('Impossible d exporter les relances pour le moment.');
    } finally {
      setExportingTarget('');
    }
  };

  const handleExportReceivablesReport = async () => {
    setExportingTarget('reports');
    try {
      const report = receivablesAgingQuery.data ?? (await getReceivablesAgingReport());
      const rows = report.buckets.flatMap((bucket) =>
        bucket.invoices.map((invoice) => ({
          facture: invoice.invoiceNumber,
          client: invoice.customer,
          tranche: bucket.label,
          echeance: invoice.dueDate,
          joursRetard: invoice.daysLate,
          statut: statusLabels[invoice.status],
          solde: invoice.balanceDue,
          devise: invoice.currency,
        }))
      );

      if (!rows.length) {
        setActionMessage('Aucune creance a exporter.');
        return;
      }

      downloadCsv(`rapport-creances-${getToday()}.csv`, rows);
      setActionMessage(`${rows.length} ligne${rows.length > 1 ? 's' : ''} de rapport exportee${rows.length > 1 ? 's' : ''}.`);
    } catch {
      setActionMessage('Impossible d exporter le rapport pour le moment.');
    } finally {
      setExportingTarget('');
    }
  };

  const handleExportTaxReport = async () => {
    setExportingTarget('tax-report');
    try {
      const report =
        taxSummaryQuery.data ??
        (await getTaxSummaryReport({
          dateFrom: reportDateFrom || undefined,
          dateTo: reportDateTo || undefined,
        }));
      const rows = report.invoices.map((invoice) => ({
        facture: invoice.invoiceNumber,
        client: invoice.customer,
        dateEmission: invoice.issueDate,
        statut: statusLabels[invoice.status],
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
        setActionMessage('Aucune facture a exporter pour cette periode.');
        return;
      }

      downloadCsv(`rapport-tva-${reportDateFrom || 'debut'}-${reportDateTo || getToday()}.csv`, rows);
      setActionMessage(`${rows.length} facture${rows.length > 1 ? 's' : ''} exportee${rows.length > 1 ? 's' : ''}.`);
    } catch {
      setActionMessage('Impossible d exporter le rapport TVA.');
    } finally {
      setExportingTarget('');
    }
  };

  const handleCreateCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!customerName.trim() || !customerEmail.trim()) {
      setActionMessage('Nom et email client sont obligatoires.');
      return;
    }

    if (!customerCountryCode) {
      setActionMessage("Please select the customer's country.");
      return;
    }

    if (!hasAccessToken) {
      setActionMessage('Connectez-vous pour ajouter un client.');
      return;
    }

    customerMutation.mutate();
  };

  const handleCustomerCountryChange = (value: string) => {
    setCustomerCountrySearch(value);
    const option = COUNTRY_OPTIONS.find((country) => country.label === value);
    setCustomerCountryCode(option?.code ?? '');
  };

  const handleProductSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut modifier le catalogue.');
      return;
    }

    if (!productName.trim() || productUnitPrice < 0) {
      setActionMessage('Nom et prix de prestation sont obligatoires.');
      return;
    }

    productMutation.mutate();
  };

  const handleUserSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut gerer les utilisateurs.');
      return;
    }

    if (!userName.trim() || !isValidEmail(userEmail)) {
      setActionMessage('Nom et email utilisateur sont obligatoires.');
      return;
    }

    if (!editingUserId && userPassword.length < 8) {
      setActionMessage('Le mot de passe doit contenir au moins 8 caracteres.');
      return;
    }

    userMutation.mutate();
  };

  const handleCompanySettingsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut modifier les parametres societe.');
      return;
    }

    settingsMutation.mutate();
  };

  const handlePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentPassword || newPassword.length < 8) {
      setActionMessage('Le nouveau mot de passe doit contenir au moins 8 caracteres.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setActionMessage('La confirmation du nouveau mot de passe ne correspond pas.');
      return;
    }

    if (currentPassword === newPassword) {
      setActionMessage('Le nouveau mot de passe doit etre different de l ancien.');
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
    const customerName = invoice.customer?.company ?? invoice.customer?.name ?? 'Client';

    setEmailInvoiceId(invoice.id);
    setInvoiceEmailRecipient(invoice.customer?.email ?? '');
    setInvoiceEmailSubject(`Facture ${invoice.invoiceNumber}`);
    setInvoiceEmailMessage(
      [
        `Bonjour ${customerName},`,
        '',
        `Veuillez trouver ci-joint la facture ${invoice.invoiceNumber}.`,
        `Montant total: ${formatCurrency(Number(invoice.total), invoice.currency)}.`,
        `Reste a payer: ${formatCurrency(Number(invoice.balanceDue), invoice.currency)}.`,
        `Date d'echeance: ${formatShortDate(invoice.dueDate)}.`,
        '',
        'Cordialement,',
      ].join('\n')
    );
  };

  const closeInvoiceEmailModal = () => {
    setEmailInvoiceId('');
    setInvoiceEmailRecipient('');
    setInvoiceEmailSubject('');
    setInvoiceEmailMessage('');
  };

  const handleSendInvoiceEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!emailInvoiceId) return;

    if (!isValidEmail(invoiceEmailRecipient)) {
      setActionMessage('Email destinataire invalide.');
      return;
    }

    if (invoiceEmailSubject.trim().length < 3 || invoiceEmailMessage.trim().length < 3) {
      setActionMessage('Sujet et message email sont obligatoires.');
      return;
    }

    invoiceEmailMutation.mutate();
  };

  const handleDeleteCustomer = (customer: Customer) => {
    if (!isAdmin) {
      setActionMessage('Seul un administrateur peut supprimer un client.');
      return;
    }

    const invoiceCount = customer._count?.invoices ?? 0;
    if (invoiceCount > 0) {
      setActionMessage(
        `Suppression impossible : ce client a ${invoiceCount} facture${invoiceCount > 1 ? 's' : ''} liee${invoiceCount > 1 ? 's' : ''}. Utilisez Desactiver pour le masquer.`
      );
      return;
    }

    const label = customer.company ?? customer.name;
    if (!window.confirm(`Supprimer definitivement le client ${label} ?`)) {
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
    setActionMessage(`Modification de ${product.name}.`);
  };

  const handleEditUser = (user: User) => {
    setEditingUserId(user.id);
    setUserName(user.name);
    setUserEmail(user.email);
    setUserPassword('');
    setUserRole(normalizeRole(user.role) ?? 'EMPLOYEE');
    setUserIsActive(user.isActive);
    setActionMessage(`Modification de ${user.name}.`);
  };

  const handleToggleUserStatus = (user: User) => {
    if (user.id === currentUserQuery.data?.id && user.isActive) {
      setActionMessage('Vous ne pouvez pas desactiver votre propre compte.');
      return;
    }

    updateUser(user.id, { isActive: !user.isActive })
      .then(() => {
        setActionMessage('Statut utilisateur mis a jour.');
        queryClient.invalidateQueries({ queryKey: ['users'] });
      })
      .catch(() => setActionMessage('Impossible de modifier le statut utilisateur.'));
  };

  const handleCreateInvoiceForCustomer = (customer: Customer) => {
    setInvoiceCustomerId(customer.id);
    setIsInvoiceFormOpen(true);
    setActiveView('invoices');
    setViewCustomerId('');
    setActionMessage(`Nouvelle facture pour ${formatCustomerName(customer)}.`);
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
    setInvoiceTerms('Paiement a 30 jours.');
    setInvoiceItems([
      { description: 'Prestation de service', unit: 'forfait', quantity: 1, unitPrice: 1000, taxRate: automaticVatRate },
    ]);
  };

  const handleOpenInvoiceForm = () => {
    if (!hasAccessToken) {
      setActionMessage('Connectez-vous pour creer une facture.');
      return;
    }

    setIsInvoiceFormOpen(true);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    if (invoice.status !== 'DRAFT') {
      setActionMessage('Seules les factures brouillon peuvent etre modifiees.');
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
    setInvoiceItems(
      (invoice.items ?? []).map((item) => ({
        description: item.description,
        unit: item.unit ?? '',
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
      }))
    );
    setIsInvoiceFormOpen(true);
    setActiveView('invoices');
    setViewInvoiceId('');
    setActionMessage(`Modification de ${invoice.invoiceNumber}.`);
  };

  const handleInvoiceItemChange = (
    index: number,
    field: keyof InvoiceDraftItem,
    value: string | number
  ) => {
    setInvoiceItems((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === 'description' || field === 'unit' ? value : Number(value),
            }
          : item
      )
    );
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
    if (!product) return;

    setInvoiceItems((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              description: product.description || product.name,
              unit: product.unit ?? item.unit,
              unitPrice: Number(product.unitPrice),
              taxRate: effectiveVatRate,
            }
          : item
      )
    );
  };

  const handleCreateInvoice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!invoiceCustomerId) {
      setActionMessage('Selectionnez un client avant de creer la facture.');
      return;
    }

    if (invoiceItems.some((item) => !item.description.trim() || item.quantity <= 0)) {
      setActionMessage('Chaque ligne doit avoir une description et une quantite valide.');
      return;
    }

    if (isVatOverride && !isAdmin) {
      setActionMessage('Seul un administrateur peut modifier manuellement la TVA.');
      return;
    }

    if (isVatOverride && !invoiceVatOverrideReason.trim()) {
      setActionMessage('Indiquez une raison pour la modification manuelle de la TVA.');
      return;
    }

    invoiceMutation.mutate();
  };

  const loginErrorMessage =
    loginValidationError ||
    (loginMutation.isError
      ? getApiErrorMessage(loginMutation.error, 'Invalid email or password.')
      : '');

  if (isAuthBootstrapping || (hasAccessToken && currentUserQuery.isLoading)) {
    return <AuthLoadingScreen themePreference={themePreference} />;
  }

  if (!hasAccessToken || !currentUserQuery.data) {
    return (
      <LoginPage
        email={email}
        errorMessage={loginErrorMessage}
        isPending={loginMutation.isPending}
        onEmailChange={(value) => {
          setEmail(value);
          setLoginValidationError('');
        }}
        onLogin={handleLogin}
        onPasswordChange={(value) => {
          setPassword(value);
          setLoginValidationError('');
        }}
        onRememberMeChange={setRememberMe}
        onShowPasswordToggle={() => setShowPassword((isVisible) => !isVisible)}
        onThemeToggle={handleThemeToggle}
        password={password}
        rememberMe={rememberMe}
        showPassword={showPassword}
        themePreference={themePreference}
      />
    );
  }

  return (
    <main className={`app-shell min-h-screen bg-slate-50 text-slate-950 ${isSidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <datalist id="country-options">
        {COUNTRY_OPTIONS.map((country) => (
          <option key={country.code} value={country.label} />
        ))}
      </datalist>
      {isMobileSidebarOpen ? (
        <button
          aria-label="Fermer le menu"
          className="sidebar-overlay fixed inset-0 z-40 bg-slate-950/55 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        aria-label="Navigation principale"
        className={`app-sidebar fixed inset-y-0 left-0 z-50 border-r border-slate-200 px-3 py-5 lg:z-20 lg:block ${
          isMobileSidebarOpen ? 'app-sidebar-mobile-open' : 'app-sidebar-mobile-closed'
        } ${isSidebarExpanded ? 'app-sidebar-expanded' : 'app-sidebar-collapsed'}`}
        onMouseEnter={() => {
          if (isSidebarCollapsed) setIsSidebarHovered(true);
        }}
        onMouseLeave={() => setIsSidebarHovered(false)}
      >
        <div className="brand-lockup flex min-h-10 items-center gap-3 px-2">
          <div className="brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            BS
          </div>
          <div className={`sidebar-label min-w-0 transition-opacity duration-300 ${isSidebarExpanded ? 'opacity-100' : 'pointer-events-none w-0 opacity-0'}`}>
            <p className="brand-name text-sm font-semibold">Billing System</p>
            <p className="brand-subtitle text-xs text-slate-500">Gestion facturation</p>
          </div>
          <button
            aria-label={isSidebarCollapsed ? 'Agrandir la barre laterale' : 'Reduire la barre laterale'}
            className="sidebar-toggle ml-auto hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary/70 lg:inline-flex"
            onClick={handleSidebarToggle}
            title={isSidebarCollapsed ? 'Agrandir la barre laterale' : 'Reduire la barre laterale'}
            type="button"
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav aria-label="Sections de l'application" className="nav-menu mt-8 space-y-1 text-sm">
          {visibleNavItems.map(({ key, label, icon: Icon }) => (
            <button
              aria-label={label}
              className={`nav-item sidebar-nav-item flex h-10 w-full items-center rounded-md text-left font-medium transition ${
                isSidebarExpanded ? 'gap-3 px-3' : 'justify-center px-2'
              } ${
                activeView === key
                  ? 'nav-item-active bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              data-tooltip={label}
              key={key}
              onClick={() => handleViewChange(key)}
              title={label}
              type="button"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={`sidebar-label overflow-hidden whitespace-nowrap transition-all duration-300 ${isSidebarExpanded ? 'max-w-40 opacity-100' : 'pointer-events-none max-w-0 opacity-0'}`}>
                {label}
              </span>
            </button>
          ))}
        </nav>

      </aside>

      <section className="app-main">
        <header className="app-header sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur md:px-8">
          <div className="header-row flex min-w-0 items-center gap-2">
              <button
                aria-label="Ouvrir le menu"
                className="icon-button lg:hidden"
                onClick={() => setIsMobileSidebarOpen(true)}
                title="Ouvrir le menu"
                type="button"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="search-shell header-search relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  aria-label={`Recherche ${activeViewMeta.title}`}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={getSearchPlaceholder(activeView)}
                  type="search"
                  value={searchTerm}
                />
              </div>
              <span className="status-pill hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline-flex">
                {hasAccessToken ? 'API connectee' : 'Connexion requise'}
              </span>
              {actionMessage ? (
                <span className="header-message hidden max-w-48 truncate text-xs font-medium text-primary xl:inline">
                  {actionMessage}
                </span>
              ) : null}
              <button
                aria-label={themePreference === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
                aria-pressed={themePreference === 'dark'}
                className="icon-button"
                onClick={handleThemeToggle}
                title={themePreference === 'dark' ? 'Mode clair' : 'Mode sombre'}
                type="button"
              >
                {themePreference === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <div className="notification-menu relative shrink-0" ref={notificationMenuRef}>
                <button
                  aria-expanded={isNotificationMenuOpen}
                  aria-haspopup="menu"
                  className="icon-button notification-trigger"
                  onClick={() => {
                    setIsNotificationMenuOpen((isOpen) => !isOpen);
                    setIsProfileMenuOpen(false);
                  }}
                  title="Notifications"
                  type="button"
                >
                  <Bell className="h-4 w-4" />
                  {notificationCount ? (
                    <span className="notification-badge">{notificationCount}</span>
                  ) : null}
                </button>
                <div className={`notification-dropdown ${isNotificationMenuOpen ? 'notification-dropdown-open' : ''}`}>
                  <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <div className="flex items-center justify-between px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Notifications</p>
                        <p className="text-xs text-slate-500">
                          Alertes importantes de facturation
                        </p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        {notificationCount}
                      </span>
                    </div>
                    <div className="mt-1 max-h-80 overflow-y-auto">
                      {notificationItems.length ? (
                        notificationItems.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              className={`notification-item notification-item-${item.tone}`}
                              key={item.key}
                              onClick={() => {
                                handleViewChange(item.view);
                                setIsNotificationMenuOpen(false);
                              }}
                              type="button"
                            >
                              <span className="notification-item-icon">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-slate-900">
                                  {item.title}
                                </span>
                                <span className="mt-0.5 block text-left text-xs text-slate-500">
                                  {item.description}
                                </span>
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-6 text-center">
                          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                          <p className="mt-2 text-sm font-semibold text-slate-900">Tout est a jour</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Aucune alerte importante pour le moment.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="profile-menu relative shrink-0" ref={profileMenuRef}>
                <button
                  aria-expanded={isProfileMenuOpen}
                  aria-haspopup="menu"
                  className="profile-trigger"
                  onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
                  title="Profil utilisateur"
                  type="button"
                >
                  <span className="avatar h-8 w-8 rounded-full">
                    {getInitials(currentUserQuery.data?.name ?? email)}
                  </span>
                  <span className="hidden min-w-0 leading-tight md:block">
                    <span className="block max-w-28 truncate text-xs font-semibold text-slate-900">
                      {currentUserQuery.data?.name ?? 'Utilisateur'}
                    </span>
                    <span className="block text-[11px] font-medium text-slate-500">
                      {currentUserQuery.data?.role === 'ADMIN' ? 'Admin' : 'Employe'}
                    </span>
                  </span>
                </button>
                <div className={`profile-dropdown ${isProfileMenuOpen ? 'profile-dropdown-open' : ''}`}>
                  <AuthPanel
                    className="auth-card rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    email={email}
                    hasAccessToken={hasAccessToken}
                    isError={loginMutation.isError}
                    isPending={loginMutation.isPending}
                    onEmailChange={setEmail}
                    onLogin={handleLogin}
                    onLogout={() => {
                      handleLogout();
                      setIsProfileMenuOpen(false);
                    }}
                    onPasswordChange={setPassword}
                    password={password}
                    user={currentUserQuery.data}
                  />
                </div>
              </div>
              <button
                className="primary-action inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white shadow-sm transition hover:bg-primary/90"
                onClick={handleOpenInvoiceForm}
                type="button"
              >
                <FilePlus2 className="h-4 w-4" />
                <span className="hidden sm:inline">Nouvelle facture</span>
              </button>
          </div>
        </header>

        {activeView === 'invoices' ? (
          <section className="view-filter-bar flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 md:px-8">
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) =>
                setInvoiceStatusFilter(event.target.value as InvoiceStatus | 'ALL')
              }
              value={invoiceStatusFilter}
            >
              <option value="ALL">Tous statuts</option>
              {Object.entries(statusLabels).map(([status, label]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setInvoiceDateFrom(event.target.value)}
              title="Date debut"
              type="date"
              value={invoiceDateFrom}
            />
            <input
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setInvoiceDateTo(event.target.value)}
              title="Date fin"
              type="date"
              value={invoiceDateTo}
            />
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setInvoiceSortBy(event.target.value as InvoiceSortField)}
              value={invoiceSortBy}
            >
              <option value="createdAt">Creation</option>
              <option value="issueDate">Emission</option>
              <option value="dueDate">Echeance</option>
              <option value="total">Total</option>
              <option value="balanceDue">Solde</option>
              <option value="invoiceNumber">Numero</option>
            </select>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setInvoiceSortOrder(event.target.value as 'asc' | 'desc')}
              value={invoiceSortOrder}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
            <button
              className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={resetInvoiceFilters}
              type="button"
            >
              Reinitialiser
            </button>
          </section>
        ) : null}

        {activeView === 'payments' ? (
          <section className="view-filter-bar flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 md:px-8">
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setPaymentMethodFilter(event.target.value as PaymentMethod | 'ALL')}
              value={paymentMethodFilter}
            >
              <option value="ALL">Tous modes</option>
              <option value="BANK_TRANSFER">Virement</option>
              <option value="CASH">Especes</option>
              <option value="CHECK">Cheque</option>
              <option value="CREDIT_CARD">Carte</option>
              <option value="MOBILE_PAYMENT">Mobile</option>
              <option value="OTHER">Autre</option>
            </select>
            <input
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setPaymentDateFrom(event.target.value)}
              title="Date debut"
              type="date"
              value={paymentDateFrom}
            />
            <input
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => setPaymentDateTo(event.target.value)}
              title="Date fin"
              type="date"
              value={paymentDateTo}
            />
            <button
              className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={resetPaymentFilters}
              type="button"
            >
              Reinitialiser
            </button>
          </section>
        ) : null}

        <nav className="mobile-nav grid grid-cols-2 gap-2 border-b border-slate-200 px-4 py-3 sm:grid-cols-4 lg:hidden">
            {visibleNavItems.map(({ key, label, icon: Icon }) => (
              <button
                className={`nav-item flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium ${
                  activeView === key ? 'nav-item-active text-white' : 'border border-slate-200 bg-white text-slate-700'
                }`}
                key={key}
                onClick={() => handleViewChange(key)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

        <div className="app-content space-y-6 px-4 py-5 md:px-8">
          {activeView === 'dashboard' ? (
            <section className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Vue financiere dynamique</h2>
                    <p className="text-sm text-slate-500">
                      Donnees calculees en direct depuis PostgreSQL.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <div className="flex flex-wrap gap-2">
                      {dashboardPeriods.map((period) => (
                        <button
                          className={`h-9 rounded-md px-3 text-sm font-medium transition ${
                            dashboardPeriod === period.value
                              ? 'bg-primary text-white shadow-sm'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                          key={period.value}
                          onClick={() => setDashboardPeriod(period.value)}
                          type="button"
                        >
                          {period.label}
                        </button>
                      ))}
                    </div>
                    {dashboardPeriod === 'custom' ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                          onChange={(event) => setDashboardDateFrom(event.target.value)}
                          type="date"
                          value={dashboardDateFrom}
                        />
                        <input
                          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                          onChange={(event) => setDashboardDateTo(event.target.value)}
                          type="date"
                          value={dashboardDateTo}
                        />
                      </div>
                    ) : null}
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setDashboardMonths(Number(event.target.value) as 6 | 12)}
                      value={dashboardMonths}
                    >
                      <option value={6}>Graphique 6 mois</option>
                      <option value={12}>Graphique 12 mois</option>
                    </select>
                  </div>
                </div>
              </div>

              {dashboardQuery.isLoading ? (
                <DashboardSkeleton />
              ) : dashboardQuery.isError ? (
                <DashboardError onRetry={() => dashboardQuery.refetch()} />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                  <Metric
                    icon={ReceiptText}
                    label="Revenu total"
                    value={formatCurrency(dashboardStats?.totalRevenue ?? totalInvoiced)}
                    helper={`${formatRevenueDelta(dashboardStats?.revenueThisMonth ?? 0, dashboardStats?.revenueLastMonth ?? 0)} vs mois precedent`}
                  />
                  <Metric
                    icon={AlertTriangle}
                    label="Impayes"
                    tone="danger"
                    value={formatCurrency(totalUnpaid)}
                    helper={`${dashboardStats?.unpaidInvoices ?? 0} facture(s) ouvertes`}
                  />
                  <Metric
                    icon={CheckCircle2}
                    label="Factures payees"
                    value={String(dashboardStats?.paidInvoices ?? 0)}
                    helper={formatCurrency(dashboardStats?.totalPaid ?? totalPaid)}
                  />
                  <Metric
                    icon={AlertTriangle}
                    label="En retard"
                    tone="danger"
                    value={String(dashboardStats?.overdueInvoices ?? overdueInvoices.length)}
                    helper={formatCurrency(dashboardStats?.overdueAmount ?? 0)}
                  />
                  <Metric
                    icon={Users}
                    label="Clients actifs"
                    value={String(dashboardStats?.totalClients ?? 0)}
                    helper="Avec factures sur la periode"
                  />
                  <Metric
                    icon={CalendarClock}
                    label="Echeances proches"
                    tone="warning"
                    value={formatCurrency(dashboardStats?.dueSoonAmount ?? 0)}
                    helper="Dans les 7 prochains jours"
                  />
                </div>
              )}
            </section>
          ) : null}

          {isInvoiceFormOpen ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {editingInvoiceId ? 'Modifier la facture' : 'Nouvelle facture'}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {editingInvoiceId
                      ? 'Modification autorisee tant que la facture reste brouillon.'
                      : 'Selection client, lignes et conditions.'}
                  </p>
                </div>
                <button
                  className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  onClick={() => setIsInvoiceFormOpen(false)}
                  type="button"
                >
                  Fermer
                </button>
              </div>

              <form className="mt-5 space-y-5" onSubmit={handleCreateInvoice}>
                <div className="grid gap-3 md:grid-cols-5">
                  <label className="text-sm font-medium text-slate-700 md:col-span-2">
                    Client
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setInvoiceCustomerId(event.target.value)}
                      value={invoiceCustomerId}
                    >
                      <option value="">Selectionner un client</option>
                      {(customerQuery.data?.data ?? []).map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {formatCustomerName(customer)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Statut
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) =>
                        setInvoiceStatus(event.target.value as Extract<InvoiceStatus, 'DRAFT' | 'SENT'>)
                      }
                      value={invoiceStatus}
                    >
                      <option value="DRAFT">Brouillon</option>
                      <option value="SENT">Envoyee</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Emission
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setInvoiceIssueDate(event.target.value)}
                      type="date"
                      value={invoiceIssueDate}
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Echeance
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setInvoiceDueDate(event.target.value)}
                      type="date"
                      value={invoiceDueDate}
                    />
                  </label>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-medium">Catalogue</th>
                        <th className="px-3 py-3 font-medium">Description</th>
                        <th className="px-3 py-3 font-medium">Unite</th>
                        <th className="px-3 py-3 text-right font-medium">Qte</th>
                        <th className="px-3 py-3 text-right font-medium">Prix</th>
                        <th className="px-3 py-3 text-right font-medium">Taxe</th>
                        <th className="px-3 py-3 text-right font-medium">Total</th>
                        <th className="w-12 px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceItems.map((item, index) => (
                        <tr key={index}>
                          <td className="px-3 py-3">
                            <select
                              className="h-9 w-44 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                              onChange={(event) => handleApplyProductToInvoiceItem(index, event.target.value)}
                              value=""
                            >
                              <option value="">Choisir</option>
                              {(productQuery.data?.data ?? []).map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <input
                              className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                              onChange={(event) =>
                                handleInvoiceItemChange(index, 'description', event.target.value)
                              }
                              placeholder="Description"
                              value={item.description}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                              onChange={(event) =>
                                handleInvoiceItemChange(index, 'unit', event.target.value)
                              }
                              placeholder="unite"
                              value={item.unit ?? ''}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              className="h-9 w-24 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4"
                              min="0.01"
                              onChange={(event) =>
                                handleInvoiceItemChange(index, 'quantity', event.target.value)
                              }
                              step="0.01"
                              type="number"
                              value={item.quantity}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              className="h-9 w-28 rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4"
                              min="0"
                              onChange={(event) =>
                                handleInvoiceItemChange(index, 'unitPrice', event.target.value)
                              }
                              step="0.01"
                              type="number"
                              value={item.unitPrice}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              className="h-9 w-20 rounded-md border border-slate-200 bg-slate-50 px-2 text-right text-sm outline-none"
                              disabled
                              min="0"
                              step="0.01"
                              type="number"
                              value={effectiveVatRate}
                            />
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {formatCurrency(calculateItemTotal(item))}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                              disabled={invoiceItems.length === 1}
                              onClick={() => handleRemoveInvoiceItem(index)}
                              title="Supprimer la ligne"
                              type="button"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    onClick={handleAddInvoiceItem}
                    type="button"
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter une ligne
                  </button>

                  <div className="w-full max-w-sm space-y-3">
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-500">TVA detectee</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {effectiveVatRate}% - {selectedInvoiceCustomer?.countryCode === 'MA' ? 'Maroc' : 'Hors Maroc'}
                          </p>
                        </div>
                        {isAdmin ? (
                          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                            <input
                              checked={isVatOverride}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                              onChange={(event) => {
                                setIsVatOverride(event.target.checked);
                                if (!event.target.checked) {
                                  setInvoiceTaxRate(automaticVatRate);
                                  setInvoiceVatOverrideReason('');
                                }
                              }}
                              type="checkbox"
                            />
                            Override
                          </label>
                        ) : null}
                      </div>
                      {isVatOverride ? (
                        <div className="mt-3 space-y-2">
                          <label className="text-xs font-medium text-slate-600">
                            Taux TVA manuel %
                            <input
                              className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4"
                              min="0"
                              onChange={(event) => setInvoiceTaxRate(Number(event.target.value))}
                              step="0.01"
                              type="number"
                              value={invoiceTaxRate}
                            />
                          </label>
                          <textarea
                            className="min-h-16 w-full rounded-md border border-slate-200 p-2 text-xs outline-none ring-primary/20 transition focus:ring-4"
                            onChange={(event) => setInvoiceVatOverrideReason(event.target.value)}
                            placeholder="Raison obligatoire de l'override TVA"
                            value={invoiceVatOverrideReason}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-1">
                      <label className="text-xs font-medium text-slate-600">
                        Remise
                        <input
                          className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm outline-none ring-primary/20 transition focus:ring-4"
                          min="0"
                          onChange={(event) => setInvoiceDiscount(Number(event.target.value))}
                          step="0.01"
                          type="number"
                          value={invoiceDiscount}
                        />
                      </label>
                    </div>
                    <div className="rounded-md bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span>Sous-total HT</span>
                        <span>{formatCurrency(invoiceTotals.subtotal)}</span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span>TVA {effectiveVatRate}%</span>
                        <span>{formatCurrency(invoiceTotals.taxAmount)}</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold">
                        <span>Total TTC</span>
                        <span>{formatCurrency(invoiceTotals.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <textarea
                    className="min-h-24 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setInvoiceNotes(event.target.value)}
                    placeholder="Notes internes ou visibles sur la facture"
                    value={invoiceNotes}
                  />
                  <textarea
                    className="min-h-24 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setInvoiceTerms(event.target.value)}
                    placeholder="Conditions de paiement"
                    value={invoiceTerms}
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    onClick={resetInvoiceForm}
                    type="button"
                  >
                    Reinitialiser
                  </button>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={invoiceMutation.isPending}
                    type="submit"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    {invoiceMutation.isPending
                      ? 'Enregistrement...'
                      : editingInvoiceId
                        ? 'Enregistrer'
                        : 'Creer la facture'}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {activeView === 'dashboard' && dashboardStats && !dashboardQuery.isLoading && !dashboardQuery.isError ? (
            <section className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
                <DashboardPanel
                  description={`Revenus et impayes sur ${dashboardMonths} mois.`}
                  title="Evolution mensuelle"
                >
                  {chartRevenue.length ? (
                    <div className="h-72">
                      <ResponsiveContainer height="100%" width="100%">
                        <LineChart data={chartRevenue} margin={{ bottom: 4, left: 0, right: 12, top: 12 }}>
                          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                          <XAxis axisLine={false} dataKey="month" tickLine={false} />
                          <YAxis
                            axisLine={false}
                            tickFormatter={(value) => `${Number(value) / 1000}k`}
                            tickLine={false}
                          />
                          <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                          <Legend />
                          <Line
                            activeDot={{ r: 5 }}
                            dataKey="revenue"
                            name="Revenus"
                            stroke="#2563EB"
                            strokeWidth={3}
                            type="monotone"
                          />
                          <Line
                            dataKey="unpaid"
                            name="Impayes"
                            stroke="#DC2626"
                            strokeWidth={3}
                            type="monotone"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <DashboardEmptyState text="Aucune facture dans cette periode." />
                  )}
                </DashboardPanel>

                <DashboardPanel description="Pourcentage par statut." title="Repartition factures">
                  {hasDashboardData ? (
                    <div className="h-72">
                      <ResponsiveContainer height="100%" width="100%">
                        <PieChart>
                          <Pie
                            data={dashboardStatusData.filter((item) => item.count > 0)}
                            dataKey="count"
                            innerRadius={54}
                            nameKey="label"
                            outerRadius={88}
                            paddingAngle={3}
                          >
                            {dashboardStatusData
                              .filter((item) => item.count > 0)
                              .map((item) => (
                                <Cell fill={statusChartColors[item.status]} key={item.status} />
                              ))}
                          </Pie>
                          <Tooltip formatter={(value, _name, item) => [`${value} facture(s)`, item.payload.label]} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <DashboardEmptyState text="Aucune repartition disponible." />
                  )}
                </DashboardPanel>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <DashboardPanel description="Payees, envoyees, partielles, en retard et brouillons." title="Statuts compares">
                  {hasDashboardData ? (
                    <div className="h-72">
                      <ResponsiveContainer height="100%" width="100%">
                        <BarChart data={dashboardStatusData} margin={{ bottom: 4, left: 0, right: 12, top: 12 }}>
                          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                          <XAxis axisLine={false} dataKey="label" tickLine={false} />
                          <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={(value, name) =>
                              name === 'amount'
                                ? [formatCurrency(Number(value)), 'Montant']
                                : [`${value} facture(s)`, 'Nombre']
                            }
                          />
                          <Bar dataKey="count" name="Nombre" radius={[6, 6, 0, 0]}>
                            {dashboardStatusData.map((item) => (
                              <Cell fill={statusChartColors[item.status]} key={item.status} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <DashboardEmptyState text="Aucune facture a comparer." />
                  )}
                </DashboardPanel>

                <DashboardPanel description="Classement par chiffre d'affaires genere." title="Top 5 clients">
                  {dashboardStats.topClients.length ? (
                    <div className="space-y-3">
                      {dashboardStats.topClients.map((client, index) => (
                        <div className="rounded-md border border-slate-200 p-3" key={client.customer}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">
                                {index + 1}. {client.customer}
                              </p>
                              <p className="text-xs text-slate-500">{client.invoiceCount} facture(s)</p>
                            </div>
                            <span className="text-sm font-semibold text-emerald-600">
                              {formatCurrency(client.revenue)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <DashboardEmptyState text="Aucun client facture sur cette periode." />
                  )}
                </DashboardPanel>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <DashboardPanel description="Derniers encaissements enregistres." title="Paiements recents">
                  {dashboardStats.recentPayments.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="text-xs uppercase text-slate-500">
                          <tr>
                            <th className="py-2 font-medium">Client</th>
                            <th className="py-2 font-medium">Facture</th>
                            <th className="py-2 font-medium">Date</th>
                            <th className="py-2 text-right font-medium">Montant</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dashboardStats.recentPayments.map((payment) => (
                            <tr className="hover:bg-slate-50" key={payment.id}>
                              <td className="py-3 text-slate-700">{payment.customer}</td>
                              <td className="py-3 font-medium text-slate-950">{payment.invoiceNumber}</td>
                              <td className="py-3 text-slate-500">{formatShortDate(payment.paymentDate)}</td>
                              <td className="py-3 text-right font-semibold text-emerald-600">
                                {formatCurrency(payment.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <DashboardEmptyState text="Aucun paiement recent pour ce filtre." />
                  )}
                </DashboardPanel>

                <DashboardPanel description="Factures a encaisser prochainement." title="Echeances a venir">
                  {dashboardStats.upcomingDeadlines.length ? (
                    <div className="space-y-3">
                      {dashboardStats.upcomingDeadlines.map((invoice) => (
                        <button
                          className="w-full rounded-md border border-slate-200 p-3 text-left transition hover:border-primary/40 hover:bg-slate-50"
                          key={invoice.id}
                          onClick={() => setViewInvoiceId(invoice.id)}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-950">{invoice.customer}</p>
                              <p className="text-xs text-slate-500">
                                {invoice.invoiceNumber} - {formatShortDate(invoice.dueDate)}
                              </p>
                            </div>
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}
                            >
                              {statusLabels[invoice.status]}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-amber-600">
                            {formatCurrency(invoice.balanceDue)}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <DashboardEmptyState text="Aucune echeance dans les 7 prochains jours." />
                  )}
                </DashboardPanel>
              </div>
            </section>
          ) : null}

          {activeView === 'dashboard' || activeView === 'invoices' ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-5">
                <div>
                  <h2 className="text-base font-semibold">Factures recentes</h2>
                  <p className="text-sm text-slate-500">
                    {invoices.length} affiche
                    {invoices.length > 1 ? 'es' : 'e'} sur {invoiceQuery.data?.meta.total ?? invoices.length}
                    {' '}resultat{(invoiceQuery.data?.meta.total ?? invoices.length) > 1 ? 's' : ''}
                    {(searchTerm || invoiceStatusFilter !== 'ALL' || invoiceDateFrom || invoiceDateTo)
                      ? ' avec filtres'
                      : ''}
                    .
                  </p>
                </div>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  onClick={() => {
                    if (selectedInvoice) {
                      setSelectedInvoiceId(selectedInvoice.id);
                      setPaymentAmount(String(selectedBalance));
                    }
                  }}
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                  Paiement
                </button>
                {activeView === 'invoices' ? (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={exportingTarget === 'invoices'}
                    onClick={handleExportInvoices}
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    {exportingTarget === 'invoices' ? 'Export...' : 'Export'}
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Facture</th>
                      <th className="px-5 py-3 font-medium">Client</th>
                      <th className="px-5 py-3 font-medium">Echeance</th>
                      <th className="px-5 py-3 font-medium">Statut</th>
                      <th className="px-5 py-3 text-right font-medium">Solde</th>
                      <th className="px-5 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((invoice) => (
                      <tr className="hover:bg-slate-50" key={invoice.id}>
                        <td className="px-5 py-4">
                          <button
                            className="font-medium text-slate-900 transition hover:text-primary"
                            onClick={() => setViewInvoiceId(invoice.id)}
                            type="button"
                          >
                            {invoice.number}
                          </button>
                        </td>
                        <td className="px-5 py-4 text-slate-600">{invoice.customer}</td>
                        <td className="px-5 py-4 text-slate-600">
                          {formatDueDate(invoice)}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}
                          >
                            {statusLabels[invoice.status]}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="font-semibold">
                            {formatCurrency(invoice.total - invoice.paid)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              onClick={() => setViewInvoiceId(invoice.id)}
                              type="button"
                            >
                              Details
                            </button>
                            {invoice.status === 'DRAFT' ? (
                              <button
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                disabled={invoiceStatusMutation.isPending}
                                onClick={() =>
                                  invoiceStatusMutation.mutate({
                                    invoiceId: invoice.id,
                                    status: 'SENT',
                                  })
                                }
                                type="button"
                              >
                                Envoyer
                              </button>
                            ) : null}
                            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' ? (
                              <button
                                className="h-8 rounded-md border border-rose-200 px-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                                disabled={invoiceStatusMutation.isPending}
                                onClick={() =>
                                  invoiceStatusMutation.mutate({
                                    invoiceId: invoice.id,
                                    status: 'CANCELLED',
                                  })
                                }
                                type="button"
                              >
                                Annuler
                              </button>
                            ) : null}
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-primary"
                              onClick={() => handleDownloadPdf(invoice)}
                              title="Telecharger PDF"
                              type="button"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeView === 'invoices' && invoiceQuery.data?.meta ? (
                <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-slate-500">
                    Page {invoiceQuery.data.meta.page} sur {invoiceQuery.data.meta.totalPages || 1}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={invoiceQuery.data.meta.page <= 1 || invoiceQuery.isFetching}
                      onClick={() => setInvoicePage((page) => Math.max(1, page - 1))}
                      type="button"
                    >
                      Precedent
                    </button>
                    <button
                      className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        invoiceQuery.data.meta.page >= invoiceQuery.data.meta.totalPages ||
                        invoiceQuery.isFetching
                      }
                      onClick={() => setInvoicePage((page) => page + 1)}
                      type="button"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">Impayes par client</h2>
              <p className="text-sm text-slate-500">Priorisation du recouvrement.</p>
              <div className="mt-5 space-y-4">
                {customerExposure.map((customer) => (
                  <div key={customer.company}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{customer.company}</p>
                        <p className="text-xs text-slate-500">{customer.name}</p>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(customer.unpaid)}</p>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.max(10, (customer.unpaid / totalUnpaid) * 100)}%` }}
                      />
                    </div>
                    {customer.overdue > 0 ? (
                      <p className="mt-1 text-xs font-medium text-rose-600">
                        {formatCurrency(customer.overdue)} en retard
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <form
                className="mt-6 border-t border-slate-200 pt-5"
                onSubmit={handleRecordPayment}
              >
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">Enregistrer un paiement</h3>
                  <p className="text-xs text-slate-500">
                    Solde selectionne: {formatCurrency(selectedBalance)}
                  </p>
                </div>
                <div className="space-y-2">
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setSelectedInvoiceId(event.target.value)}
                    value={selectedInvoice?.id ?? ''}
                  >
                    {payableInvoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.number} - {invoice.customer}
                      </option>
                    ))}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      max={selectedBalance || undefined}
                      min="0"
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      placeholder="Montant"
                      step="0.01"
                      type="number"
                      value={paymentAmount}
                    />
                    <input
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      max={getToday()}
                      onChange={(event) => setPaymentEntryDate(event.target.value)}
                      title="Date paiement"
                      type="date"
                      value={paymentEntryDate}
                    />
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                      value={paymentMethod}
                    >
                      <option value="BANK_TRANSFER">Virement</option>
                      <option value="CASH">Especes</option>
                      <option value="CHECK">Cheque</option>
                      <option value="CREDIT_CARD">Carte</option>
                      <option value="MOBILE_PAYMENT">Mobile</option>
                      <option value="OTHER">Autre</option>
                    </select>
                  </div>
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setPaymentReference(event.target.value)}
                    placeholder="Reference optionnelle"
                    value={paymentReference}
                  />
                  <button
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!selectedInvoice || paymentMutation.isPending}
                    type="submit"
                  >
                    <WalletCards className="h-4 w-4" />
                    {paymentMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </form>

              <form
                className="mt-6 border-t border-slate-200 pt-5"
                onSubmit={handleCreateCustomer}
              >
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">Ajouter un client</h3>
                  <p className="text-xs text-slate-500">Informations de facturation principales.</p>
                </div>
                <div className="space-y-2">
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Nom du client"
                    value={customerName}
                  />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    placeholder="Email de facturation"
                    type="email"
                    value={customerEmail}
                  />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerCompany(event.target.value)}
                    placeholder="Entreprise optionnelle"
                    value={customerCompany}
                  />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    list="country-options"
                    onChange={(event) => handleCustomerCountryChange(event.target.value)}
                    placeholder="Pays"
                    value={customerCountrySearch}
                  />
                  <button
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={customerMutation.isPending}
                    type="submit"
                  >
                    <Users className="h-4 w-4" />
                    {customerMutation.isPending ? 'Ajout...' : 'Ajouter le client'}
                  </button>
                </div>
              </form>
            </div>
          </section>
          ) : null}

          {activeView === 'clients' ? (
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Portefeuille clients</h2>
                    <p className="text-sm text-slate-500">
                      {(customerQuery.data?.data.length ?? 0)} affiche
                      {(customerQuery.data?.data.length ?? 0) > 1 ? 's' : ''} sur{' '}
                      {customerQuery.data?.meta.total ?? 0} client
                      {(customerQuery.data?.meta.total ?? 0) > 1 ? 's' : ''}.
                    </p>
                  </div>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={exportingTarget === 'customers'}
                    onClick={handleExportCustomers}
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    {exportingTarget === 'customers' ? 'Export...' : 'Export'}
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setCustomerSortBy(event.target.value as CustomerSortField)}
                      value={customerSortBy}
                    >
                      <option value="createdAt">Creation</option>
                      <option value="name">Nom</option>
                      <option value="company">Entreprise</option>
                      <option value="email">Email</option>
                    </select>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setCustomerStatusFilter(event.target.value as CustomerStatusFilter)}
                      value={customerStatusFilter}
                    >
                      <option value="ACTIVE">Actifs</option>
                      <option value="INACTIVE">Inactifs</option>
                      <option value="ALL">Tous</option>
                    </select>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setCustomerSortOrder(event.target.value as 'asc' | 'desc')}
                      value={customerSortOrder}
                    >
                      <option value="desc">Desc</option>
                      <option value="asc">Asc</option>
                    </select>
                    <button
                      className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      onClick={resetCustomerFilters}
                      type="button"
                    >
                      Reinitialiser
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Client</th>
                        <th className="px-5 py-3 font-medium">Contact</th>
                        <th className="px-5 py-3 font-medium">IF / Ville</th>
                        <th className="px-5 py-3 text-right font-medium">Factures</th>
                        <th className="px-5 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(customerQuery.data?.data ?? []).map((customer) => (
                        <tr className="hover:bg-slate-50" key={customer.id}>
                          <td className="px-5 py-4">
                            <p className="font-medium">{customer.company ?? customer.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <p className="text-xs text-slate-500">{customer.name}</p>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                                  customer.isActive
                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                    : 'bg-slate-100 text-slate-600 ring-slate-200'
                                }`}
                              >
                                {customer.isActive ? 'Actif' : 'Inactif'}
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
                              <button
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => setViewCustomerId(customer.id)}
                                type="button"
                              >
                                Voir
                              </button>
                              <button
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => handleEditCustomer(customer)}
                                type="button"
                              >
                                Modifier
                              </button>
                              <button
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={customerStatusMutation.isPending}
                                onClick={() => customerStatusMutation.mutate(customer)}
                                type="button"
                              >
                                {customer.isActive ? 'Desactiver' : 'Activer'}
                              </button>
                              {isAdmin ? (
                                <button
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={deleteCustomerMutation.isPending}
                                  onClick={() => handleDeleteCustomer(customer)}
                                  title={
                                    (customer._count?.invoices ?? 0) > 0
                                      ? 'Ce client a des factures liees'
                                      : 'Supprimer'
                                  }
                                  type="button"
                                  aria-label="Supprimer le client"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {customerQuery.data?.meta ? (
                  <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-slate-500">
                      Page {customerQuery.data.meta.page} sur {customerQuery.data.meta.totalPages || 1}
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={customerQuery.data.meta.page <= 1 || customerQuery.isFetching}
                        onClick={() => setCustomerPage((page) => Math.max(1, page - 1))}
                        type="button"
                      >
                        Precedent
                      </button>
                      <button
                        className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          customerQuery.data.meta.page >= customerQuery.data.meta.totalPages ||
                          customerQuery.isFetching
                        }
                        onClick={() => setCustomerPage((page) => page + 1)}
                        type="button"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">
                  {editingCustomerId ? 'Modifier client' : 'Nouveau client'}
                </h2>
                <p className="text-sm text-slate-500">
                  {editingCustomerId ? 'Mise a jour des informations principales.' : 'Ajout rapide pour facturation.'}
                </p>
                <form className="mt-5 space-y-2" onSubmit={handleCreateCustomer}>
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Nom du client"
                    value={customerName}
                  />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    placeholder="Email"
                    type="email"
                    value={customerEmail}
                  />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerCompany(event.target.value)}
                    placeholder="Entreprise"
                    value={customerCompany}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      placeholder="Telephone"
                      value={customerPhone}
                    />
                    <input
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setCustomerCity(event.target.value)}
                      placeholder="Ville"
                      value={customerCity}
                    />
                  </div>
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    list="country-options"
                    onChange={(event) => handleCustomerCountryChange(event.target.value)}
                    placeholder="Pays"
                    value={customerCountrySearch}
                  />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerTaxNumber(event.target.value)}
                    placeholder="Identifiant fiscal"
                    value={customerTaxNumber}
                  />
                  <textarea
                    className="min-h-20 w-full rounded-md border border-slate-200 bg-white p-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setCustomerAddress(event.target.value)}
                    placeholder="Adresse de facturation"
                    value={customerAddress}
                  />
                  <button
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={customerMutation.isPending}
                    type="submit"
                  >
                    <Users className="h-4 w-4" />
                    {customerMutation.isPending
                      ? 'Enregistrement...'
                      : editingCustomerId
                        ? 'Enregistrer'
                        : 'Ajouter'}
                  </button>
                  {editingCustomerId ? (
                    <button
                      className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      onClick={resetCustomerForm}
                      type="button"
                    >
                      Annuler
                    </button>
                  ) : null}
                </form>
              </div>
            </section>
          ) : null}

          {activeView === 'users' ? (
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Comptes equipe</h2>
                    <p className="text-sm text-slate-500">
                      {userQuery.data?.meta.total ?? 0} utilisateur
                      {(userQuery.data?.meta.total ?? 0) > 1 ? 's' : ''}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setUserRoleFilter(event.target.value as UserRole | 'ALL')}
                      value={userRoleFilter}
                    >
                      <option value="ALL">Tous roles</option>
                      <option value="ADMIN">Admin</option>
                      <option value="EMPLOYEE">Employe</option>
                    </select>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setUserStatusFilter(event.target.value as CustomerStatusFilter)}
                      value={userStatusFilter}
                    >
                      <option value="ALL">Tous statuts</option>
                      <option value="ACTIVE">Actifs</option>
                      <option value="INACTIVE">Inactifs</option>
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Utilisateur</th>
                        <th className="px-5 py-3 font-medium">Role</th>
                        <th className="px-5 py-3 text-right font-medium">Activite</th>
                        <th className="px-5 py-3 text-right font-medium">Statut</th>
                        <th className="px-5 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(userQuery.data?.data ?? []).map((user) => {
                        const isCurrentUser = user.id === currentUserQuery.data?.id;
                        return (
                          <tr className="hover:bg-slate-50" key={user.id}>
                            <td className="px-5 py-4">
                              <p className="font-medium text-slate-900">{user.name}</p>
                              <p className="text-xs text-slate-500">{user.email}</p>
                            </td>
                            <td className="px-5 py-4">
                              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                                {user.role === 'ADMIN' ? 'Admin' : 'Employe'}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-right text-xs text-slate-500">
                              {user._count?.invoices ?? 0} facture
                              {(user._count?.invoices ?? 0) > 1 ? 's' : ''}
                              {' · '}
                              {user._count?.payments ?? 0} paiement
                              {(user._count?.payments ?? 0) > 1 ? 's' : ''}
                            </td>
                            <td className="px-5 py-4 text-right">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                                  user.isActive
                                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                                    : 'bg-zinc-100 text-zinc-700 ring-zinc-200'
                                }`}
                              >
                                {user.isActive ? 'Actif' : 'Inactif'}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                  onClick={() => handleEditUser(user)}
                                  type="button"
                                >
                                  Modifier
                                </button>
                                <button
                                  className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={isCurrentUser && user.isActive}
                                  onClick={() => handleToggleUserStatus(user)}
                                  type="button"
                                >
                                  {user.isActive ? 'Desactiver' : 'Activer'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!userQuery.isLoading && userQuery.data?.data.length === 0 ? (
                    <p className="p-5 text-sm text-slate-500">Aucun utilisateur trouve.</p>
                  ) : null}
                </div>
                {userQuery.data?.meta && userQuery.data.meta.totalPages > 1 ? (
                  <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
                    <span>
                      Page {userQuery.data.meta.page} / {userQuery.data.meta.totalPages}
                    </span>
                    <div className="flex gap-2">
                      <button
                        className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50"
                        disabled={userPage <= 1}
                        onClick={() => setUserPage((page) => Math.max(1, page - 1))}
                        type="button"
                      >
                        Precedent
                      </button>
                      <button
                        className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50"
                        disabled={userPage >= userQuery.data.meta.totalPages}
                        onClick={() => setUserPage((page) => page + 1)}
                        type="button"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">
                  {editingUserId ? 'Modifier utilisateur' : 'Nouvel utilisateur'}
                </h2>
                <p className="text-sm text-slate-500">
                  Creation de compte et attribution du role.
                </p>
                <form className="mt-5 space-y-3" onSubmit={handleUserSubmit}>
                  <SettingsInput
                    label="Nom"
                    onChange={setUserName}
                    required
                    value={userName}
                  />
                  <SettingsInput
                    label="Email"
                    onChange={setUserEmail}
                    required
                    type="email"
                    value={userEmail}
                  />
                  <SettingsInput
                    label={editingUserId ? 'Nouveau mot de passe optionnel' : 'Mot de passe'}
                    onChange={setUserPassword}
                    required={!editingUserId}
                    type="password"
                    value={userPassword}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      Role
                      <select
                        className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                        onChange={(event) => setUserRole(event.target.value as UserRole)}
                        value={userRole}
                      >
                        <option value="EMPLOYEE">Employe</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </label>
                    <label className="flex h-16 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                      <input
                        checked={userIsActive}
                        disabled={editingUserId === currentUserQuery.data?.id}
                        onChange={(event) => setUserIsActive(event.target.checked)}
                        type="checkbox"
                      />
                      Actif
                    </label>
                  </div>
                  <button
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={userMutation.isPending}
                    type="submit"
                  >
                    <Users className="h-4 w-4" />
                    {userMutation.isPending
                      ? 'Enregistrement...'
                      : editingUserId
                        ? 'Enregistrer'
                        : 'Ajouter'}
                  </button>
                  {editingUserId ? (
                    <button
                      className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      onClick={resetUserForm}
                      type="button"
                    >
                      Annuler
                    </button>
                  ) : null}
                </form>
              </div>
            </section>
          ) : null}

          {activeView === 'rbac' ? (
            <section className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Roles</h2>
                      <p className="text-sm text-slate-500">Creez des profils d acces reutilisables.</p>
                    </div>
                    <ShieldCheck className="h-5 w-5 text-primary" />
                  </div>
                  <form
                    className="mt-4 space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (rbacRoleName.trim()) rbacRoleMutation.mutate();
                    }}
                  >
                    <input
                      aria-label="Nom du role"
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                      onChange={(event) => setRbacRoleName(event.target.value)}
                      placeholder="Nom du role"
                      value={rbacRoleName}
                    />
                    <input
                      aria-label="Description du role"
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                      onChange={(event) => setRbacRoleDescription(event.target.value)}
                      placeholder="Description (optionnelle)"
                      value={rbacRoleDescription}
                    />
                    <button
                      className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60"
                      disabled={rbacRoleMutation.isPending || !rbacRoleName.trim()}
                      type="submit"
                    >
                      {rbacRoleMutation.isPending ? 'Creation...' : 'Creer un role'}
                    </button>
                  </form>
                  <div className="mt-5 space-y-2">
                    {(rbacRolesQuery.data ?? []).map((role) => (
                      <div className={`flex items-center justify-between gap-2 rounded-md border p-3 ${selectedRbacRoleId === role.id ? 'border-primary bg-primary/5' : 'border-slate-200'}`} key={role.id}>
                        <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedRbacRoleId(role.id)} type="button">
                          <span className="block truncate text-sm font-semibold">{role.name}</span>
                          <span className="block text-xs text-slate-500">{role._count?.users ?? 0} utilisateur(s)</span>
                        </button>
                        {!role.isSystem ? (
                          <button
                            aria-label={`Supprimer le role ${role.name}`}
                            className="rounded-md p-2 text-rose-600 hover:bg-rose-50"
                            onClick={() => {
                              if (window.confirm(`Supprimer le role ${role.name} ?`)) {
                                deleteRbacRole(role.id).then(() => queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] })).catch((error) => setActionMessage(getApiErrorMessage(error, 'Impossible de supprimer le role.')));
                              }
                            }}
                            title="Supprimer le role"
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Permissions du role</h2>
                      <p className="text-sm text-slate-500">Les changements sont verifies par le backend.</p>
                    </div>
                    {hasPermission('permissions.assign') ? (
                      <button
                        className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60"
                        disabled={!selectedRbacRoleId || rbacPermissionMutation.isPending}
                        onClick={() => rbacPermissionMutation.mutate()}
                        type="button"
                      >
                        {rbacPermissionMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                      </button>
                    ) : (
                      <span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                        Lecture seule
                      </span>
                    )}
                  </div>
                  {hasPermission('permissions.assign') ? (
                    <form
                      className="mt-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (rbacPermissionKey.trim()) rbacPermissionCreateMutation.mutate();
                      }}
                    >
                      <input
                        aria-label="Cle de permission"
                        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                        onChange={(event) => setRbacPermissionKey(event.target.value)}
                        placeholder="ex: invoices.approve"
                        value={rbacPermissionKey}
                      />
                      <input
                        aria-label="Description de permission"
                        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                        onChange={(event) => setRbacPermissionDescription(event.target.value)}
                        placeholder="Description (optionnelle)"
                        value={rbacPermissionDescription}
                      />
                      <button
                        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60"
                        disabled={rbacPermissionCreateMutation.isPending || !rbacPermissionKey.trim()}
                        type="submit"
                      >
                        {rbacPermissionCreateMutation.isPending ? 'Ajout...' : 'Ajouter'}
                      </button>
                    </form>
                  ) : null}
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {(rbacPermissionsQuery.data ?? []).map((permission) => (
                      <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm hover:bg-slate-50" key={permission.id}>
                        <input
                          checked={rbacPermissionIds.includes(permission.id)}
                          disabled={!hasPermission('permissions.assign')}
                          onChange={(event) => setRbacPermissionIds((current) => event.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id))}
                          type="checkbox"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{permission.key}</span>
                          <span className="block text-xs text-slate-500">{permission.description || 'Permission applicative'}</span>
                          {['clients', 'invoices', 'payments'].includes(permission.resource) && rbacPermissionIds.includes(permission.id) ? (
                            <select
                              aria-label={`Scope ${permission.key}`}
                              className="mt-2 h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
                              disabled={!hasPermission('permissions.assign')}
                              onChange={(event) => setRbacPermissionScopes((current) => ({ ...current, [permission.id]: event.target.value as 'ALL' | 'OWN' | 'SELECTED' }))}
                              value={rbacPermissionScopes[permission.id] ?? 'ALL'}
                            >
                              <option value="ALL">Tous les clients</option>
                              <option value="OWN">Clients crees par lui</option>
                              <option value="SELECTED">Clients selectionnes</option>
                            </select>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Attribution aux utilisateurs</h2>
                    <p className="text-sm text-slate-500">Chaque utilisateur herite des permissions de son role.</p>
                  </div>
                  <input
                    aria-label="Rechercher un utilisateur RBAC"
                    className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                    onChange={(event) => setRbacUserSearch(event.target.value)}
                    placeholder="Rechercher un utilisateur"
                    value={rbacUserSearch}
                  />
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Utilisateur</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Permissions</th><th className="px-3 py-3">Clients</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {(rbacUsersQuery.data?.data ?? []).map((user) => {
                        const role = rbacRolesQuery.data?.find((item) => item.id === user.rbacRole?.id);
                        return <tr className="hover:bg-slate-50" key={user.id}>
                          <td className="px-3 py-3"><span className="block font-medium">{user.name}</span><span className="text-xs text-slate-500">{user.email}</span></td>
                          <td className="px-3 py-3"><select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm" onChange={(event) => rbacUserRoleMutation.mutate({ userId: user.id, roleId: event.target.value })} value={user.rbacRole?.id ?? ''}><option value="" disabled>Choisir</option>{(rbacRolesQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                          <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{(role?.permissions ?? []).slice(0, 4).map(({ permission }) => <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600" key={permission.id}>{permission.key}</span>)}{(role?.permissions.length ?? 0) > 4 ? <span className="text-xs text-slate-500">+{(role?.permissions.length ?? 0) - 4}</span> : null}</div></td><td className="px-3 py-3"><button className="h-8 rounded-md border border-slate-200 px-3 text-xs font-medium hover:bg-slate-50" onClick={() => setSelectedRbacUserId(user.id)} type="button">Gerer</button></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>


              {selectedRbacUserId ? (
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Clients selectionnes</h2>
                      <p className="text-sm text-slate-500">Utilises lorsque le scope SELECTED est choisi pour cet utilisateur.</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="h-9 rounded-md border border-slate-200 px-3 text-sm" onClick={() => setSelectedRbacUserId('')} type="button">Fermer</button>
                      <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-60" disabled={rbacClientAssignmentMutation.isPending} onClick={() => rbacClientAssignmentMutation.mutate()} type="button">{rbacClientAssignmentMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}</button>
                    </div>
                  </div>
                  <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {(rbacAllClientsQuery.data?.data ?? []).map((client) => (
                      <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm hover:bg-slate-50" key={client.id}>
                        <input checked={rbacAssignedClientIds.includes(client.id)} onChange={(event) => setRbacAssignedClientIds((current) => event.target.checked ? [...current, client.id] : current.filter((id) => id !== client.id))} type="checkbox" />
                        <span><span className="block font-medium">{client.name}</span><span className="block text-xs text-slate-500">{client.company || client.email}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeView === 'settings' ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Parametres societe</h2>
                  <p className="text-sm text-slate-500">
                    Ces informations apparaissent sur les factures PDF.
                  </p>
                </div>
                {!isAdmin ? (
                  <span className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                    Lecture seule
                  </span>
                ) : null}
              </div>

              <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Mon compte</h2>
                    <p className="text-sm text-slate-500">
                      {currentUserQuery.data?.name} · {currentUserQuery.data?.email}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    {isAdmin ? 'Admin' : 'Employe'}
                  </span>
                </div>
                <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handlePasswordSubmit}>
                  <SettingsInput
                    label="Mot de passe actuel"
                    onChange={setCurrentPassword}
                    required
                    type="password"
                    value={currentPassword}
                  />
                  <SettingsInput
                    label="Nouveau mot de passe"
                    onChange={setNewPassword}
                    required
                    type="password"
                    value={newPassword}
                  />
                  <SettingsInput
                    label="Confirmation"
                    onChange={setConfirmNewPassword}
                    required
                    type="password"
                    value={confirmNewPassword}
                  />
                  <div className="md:col-span-3">
                    <button
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={passwordMutation.isPending}
                      type="submit"
                    >
                      <Settings className="h-4 w-4" />
                      {passwordMutation.isPending ? 'Mise a jour...' : 'Changer le mot de passe'}
                    </button>
                  </div>
                </form>
              </div>

              {companySettingsQuery.isLoading ? (
                <p className="text-sm text-slate-500">Chargement des parametres...</p>
              ) : (
                <form className="space-y-4" onSubmit={handleCompanySettingsSubmit}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SettingsInput
                      label="Nom societe"
                      onChange={(value) => setCompanyForm((form) => ({ ...form, name: value }))}
                      required
                      value={companyForm.name}
                    />
                    <SettingsInput
                      label="Email"
                      onChange={(value) => setCompanyForm((form) => ({ ...form, email: value }))}
                      type="email"
                      value={companyForm.email ?? ''}
                    />
                    <SettingsInput
                      label="Telephone"
                      onChange={(value) => setCompanyForm((form) => ({ ...form, phone: value }))}
                      value={companyForm.phone ?? ''}
                    />
                    <SettingsInput
                      label="Identifiant fiscal"
                      onChange={(value) => setCompanyForm((form) => ({ ...form, taxNumber: value }))}
                      value={companyForm.taxNumber ?? ''}
                    />
                    <SettingsInput
                      label="Devise par defaut"
                      onChange={(value) =>
                        setCompanyForm((form) => ({ ...form, defaultCurrency: value.toUpperCase() }))
                      }
                      required
                      value={companyForm.defaultCurrency}
                    />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">TVA</h3>
                        <p className="text-xs text-slate-500">
                          Maroc: taux configure. Hors Maroc: TVA automatiquement a 0%.
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input
                          checked={companyForm.vatEnabled}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                          disabled={!isAdmin}
                          onChange={(event) =>
                            setCompanyForm((form) => ({ ...form, vatEnabled: event.target.checked }))
                          }
                          type="checkbox"
                        />
                        TVA active
                      </label>
                    </div>
                    <div className="mt-3 max-w-xs">
                      <SettingsInput
                        label="Taux TVA Maroc %"
                        onChange={(value) =>
                          setCompanyForm((form) => ({
                            ...form,
                            defaultTaxRate: Number(value),
                            moroccoVatRate: Number(value),
                          }))
                        }
                        type="number"
                        value={String(companyForm.moroccoVatRate)}
                      />
                    </div>
                  </div>
                  <textarea
                    className="min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) =>
                      setCompanyForm((form) => ({ ...form, address: event.target.value }))
                    }
                    placeholder="Adresse"
                    value={companyForm.address ?? ''}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <textarea
                      className="min-h-28 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) =>
                        setCompanyForm((form) => ({ ...form, paymentTerms: event.target.value }))
                      }
                      placeholder="Conditions de paiement"
                      value={companyForm.paymentTerms ?? ''}
                    />
                    <textarea
                      className="min-h-28 rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) =>
                        setCompanyForm((form) => ({ ...form, bankDetails: event.target.value }))
                      }
                      placeholder="Coordonnees bancaires"
                      value={companyForm.bankDetails ?? ''}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <CompanyAssetCard
                      description="Image utilisee pour signer les factures PDF."
                      disabled={!isAdmin}
                      icon={PenLine}
                      imageUrl={companyForm.signatureUrl}
                      isDirty={Boolean(companyAssetDrafts.signature || companyAssetDeletes.signature)}
                      isPending={settingsMutation.isPending}
                      onDelete={() => handleCompanyAssetDelete('signature')}
                      onRemoveBackground={() => handleRemoveCompanyAssetBackground('signature')}
                      onUpload={(file) => handleCompanyAssetUpload('signature', file)}
                      title="Signature de l'entreprise"
                    />
                    <CompanyAssetCard
                      description="Cachet visuel ajoute aux factures signees."
                      disabled={!isAdmin}
                      icon={Stamp}
                      imageUrl={companyForm.stampUrl}
                      isDirty={Boolean(companyAssetDrafts.stamp || companyAssetDeletes.stamp)}
                      isPending={settingsMutation.isPending}
                      onDelete={() => handleCompanyAssetDelete('stamp')}
                      onRemoveBackground={() => handleRemoveCompanyAssetBackground('stamp')}
                      onUpload={(file) => handleCompanyAssetUpload('stamp', file)}
                      title="Tampon de l'entreprise"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={settingsMutation.isPending || !isAdmin}
                      type="submit"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {settingsMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
                    </button>
                  </div>
                </form>
              )}
              {isAdmin ? (
                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Configuration email</h2>
                      <p className="text-sm text-slate-500">
                        Etat du canal utilise pour factures et relances.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                          emailStatusQuery.data?.mode === 'smtp'
                            ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                            : 'bg-amber-100 text-amber-700 ring-amber-200'
                        }`}
                      >
                        {emailStatusQuery.data?.mode === 'smtp' ? 'SMTP actif' : 'Mode local'}
                      </span>
                      <button
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={testEmailMutation.isPending || emailStatusQuery.isLoading}
                        onClick={() => testEmailMutation.mutate()}
                        type="button"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {testEmailMutation.isPending ? 'Test...' : 'Tester'}
                      </button>
                    </div>
                  </div>
                  {emailStatusQuery.isLoading ? (
                    <p className="mt-4 text-sm text-slate-500">Verification email...</p>
                  ) : emailStatusQuery.data ? (
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                      <InfoLine label="Serveur SMTP" value={`${emailStatusQuery.data.host}:${emailStatusQuery.data.port}`} />
                      <InfoLine label="Expediteur" value={`${emailStatusQuery.data.fromName} <${emailStatusQuery.data.fromEmail}>`} />
                      <InfoLine label="Utilisateur" value={emailStatusQuery.data.user} />
                      <InfoLine label="Securise" value={emailStatusQuery.data.secure ? 'Oui' : 'Non'} />
                      {emailStatusQuery.data.localOutputDir ? (
                        <div className="md:col-span-2">
                          <InfoLine label="Dossier local" value={emailStatusQuery.data.localOutputDir} />
                        </div>
                      ) : null}
                      {emailStatusQuery.data.warning ? (
                        <p className="md:col-span-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                          {emailStatusQuery.data.warning}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">Statut email indisponible.</p>
                  )}
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Derniers emails facture</h3>
                      {emailLogsQuery.isFetching ? (
                        <span className="text-xs text-slate-500">Actualisation...</span>
                      ) : null}
                    </div>
                    <div className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                      {(emailLogsQuery.data ?? []).map((emailLog) => (
                        <button
                          className="grid w-full gap-2 p-3 text-left text-sm transition hover:bg-slate-50 sm:grid-cols-[1fr_auto]"
                          key={emailLog.id}
                          onClick={() => {
                            if (emailLog.invoice?.id) setViewInvoiceId(emailLog.invoice.id);
                          }}
                          type="button"
                        >
                          <div>
                            <p className="font-medium text-slate-900">
                              {emailLog.invoice?.invoiceNumber ?? 'Facture'} - {emailLog.recipientEmail}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {emailLog.subject} - {formatShortDate(emailLog.createdAt)}
                            </p>
                          </div>
                          <span
                            className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 sm:justify-self-end ${
                              emailLog.status === 'SENT'
                                ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                                : 'bg-rose-100 text-rose-700 ring-rose-200'
                            }`}
                          >
                            {emailLog.deliveryMode === 'local' ? 'LOCAL' : emailLog.status}
                          </span>
                        </button>
                      ))}
                      {!emailLogsQuery.isLoading && (emailLogsQuery.data?.length ?? 0) === 0 ? (
                        <p className="p-3 text-sm text-slate-500">Aucun email facture journalise.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeView === 'products' ? (
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-base font-semibold">Prestations</h2>
                  <p className="text-sm text-slate-500">
                    {productQuery.data?.meta.total ?? 0} prestation
                    {(productQuery.data?.meta.total ?? 0) > 1 ? 's' : ''} active
                    {(productQuery.data?.meta.total ?? 0) > 1 ? 's' : ''}.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Prestation</th>
                        <th className="px-5 py-3 font-medium">Unite</th>
                        <th className="px-5 py-3 text-right font-medium">Prix</th>
                        <th className="px-5 py-3 text-right font-medium">TVA</th>
                        <th className="px-5 py-3 text-right font-medium">Statut</th>
                        <th className="px-5 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(productQuery.data?.data ?? []).map((product) => (
                        <tr className="hover:bg-slate-50" key={product.id}>
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
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                                product.isActive
                                  ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                                  : 'bg-zinc-100 text-zinc-700 ring-zinc-200'
                              }`}
                            >
                              {product.isActive ? 'Actif' : 'Inactif'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              className="h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              onClick={() => handleEditProduct(product)}
                              type="button"
                            >
                              Modifier
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!productQuery.isLoading && productQuery.data?.data.length === 0 ? (
                    <p className="p-5 text-sm text-slate-500">Aucune prestation active.</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">
                  {editingProductId ? 'Modifier prestation' : 'Nouvelle prestation'}
                </h2>
                <p className="text-sm text-slate-500">
                  Tarif reutilisable dans les lignes de facture.
                </p>
                {!isAdmin ? (
                  <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-700">
                    Seul un administrateur peut modifier le catalogue.
                  </p>
                ) : null}
                <form className="mt-5 space-y-3" onSubmit={handleProductSubmit}>
                  <SettingsInput
                    label="Nom"
                    onChange={setProductName}
                    required
                    value={productName}
                  />
                  <textarea
                    className="min-h-20 w-full rounded-md border border-slate-200 bg-white p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setProductDescription(event.target.value)}
                    placeholder="Description"
                    value={productDescription}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SettingsInput
                      label="Unite"
                      onChange={setProductUnit}
                      value={productUnit}
                    />
                    <SettingsInput
                      label="Prix unitaire"
                      onChange={(value) => setProductUnitPrice(Number(value))}
                      type="number"
                      value={String(productUnitPrice)}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SettingsInput
                      label="TVA %"
                      onChange={(value) => setProductTaxRate(Number(value))}
                      type="number"
                      value={String(productTaxRate)}
                    />
                    <label className="flex h-16 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                      <input
                        checked={productIsActive}
                        onChange={(event) => setProductIsActive(event.target.checked)}
                        type="checkbox"
                      />
                      Actif
                    </label>
                  </div>
                  <button
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={productMutation.isPending || !isAdmin}
                    type="submit"
                  >
                    <ReceiptText className="h-4 w-4" />
                    {productMutation.isPending
                      ? 'Enregistrement...'
                      : editingProductId
                        ? 'Enregistrer'
                        : 'Ajouter'}
                  </button>
                  {editingProductId ? (
                    <button
                      className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      onClick={resetProductForm}
                      type="button"
                    >
                      Annuler
                    </button>
                  ) : null}
                </form>
              </div>
            </section>
          ) : null}

          {activeView === 'payments' && hasPermission('recurring.view') ? (
            <section className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div><h2 className="text-base font-semibold">Facturation recurrente</h2><p className="text-sm text-slate-500">Generez automatiquement les factures hebdomadaires, mensuelles, trimestrielles ou annuelles.</p></div>
                  <select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" value={recurringStatusFilter} onChange={(e)=>setRecurringStatusFilter(e.target.value as RecurringPlanStatus | 'ALL')}>
                    <option value="ALL">Tous les statuts</option><option value="ACTIVE">Actifs</option><option value="PAUSED">En pause</option><option value="COMPLETED">Termines</option><option value="CANCELLED">Annules</option>
                  </select>
                </div>
                {hasPermission('recurring.create') ? (
                  <form className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3" onSubmit={(e)=>{e.preventDefault(); recurringCreateMutation.mutate();}}>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" required value={recurringName} onChange={(e)=>setRecurringName(e.target.value)} placeholder="Nom du plan" />
                    <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" required value={recurringCustomerId} onChange={(e)=>setRecurringCustomerId(e.target.value)}>{(customerQuery.data?.data ?? []).map(c=><option key={c.id} value={c.id}>{c.company ?? c.name}</option>)}</select>
                    <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={recurringFrequency} onChange={(e)=>setRecurringFrequency(e.target.value as RecurringFrequency)}><option value="WEEKLY">Hebdomadaire</option><option value="MONTHLY">Mensuel</option><option value="QUARTERLY">Trimestriel</option><option value="YEARLY">Annuel</option></select>
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" type="date" value={recurringStartDate} onChange={(e)=>setRecurringStartDate(e.target.value)} />
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" required value={recurringDescription} onChange={(e)=>setRecurringDescription(e.target.value)} placeholder="Description" />
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" min="0" type="number" value={recurringUnitPrice} onChange={(e)=>setRecurringUnitPrice(Number(e.target.value))} placeholder="Montant" />
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" min="0" max="100" type="number" value={recurringTaxRate} onChange={(e)=>setRecurringTaxRate(Number(e.target.value))} placeholder="TVA %" />
                    <input className="h-10 rounded-md border border-slate-200 px-3 text-sm" min="0" type="number" value={recurringDueDays} onChange={(e)=>setRecurringDueDays(Number(e.target.value))} placeholder="Delai paiement" />
                    <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><input checked={recurringAutoSend} onChange={(e)=>setRecurringAutoSend(e.target.checked)} type="checkbox" /> Creer en statut envoye</label>
                    <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-60 md:col-span-3" disabled={recurringCreateMutation.isPending || !recurringCustomerId} type="submit">{recurringCreateMutation.isPending ? 'Creation...' : 'Creer le plan recurrent'}</button>
                  </form>
                ) : null}
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Frequence</th><th className="px-5 py-3">Prochaine execution</th><th className="px-5 py-3">Statut</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{(recurringPlansQuery.data?.data ?? []).map(plan=><tr key={plan.id}><td className="px-5 py-4 font-medium">{plan.name}<div className="text-xs font-normal text-slate-500">{plan._count?.invoices ?? 0} facture(s)</div></td><td className="px-5 py-4">{plan.customer?.company ?? plan.customer?.name}</td><td className="px-5 py-4">{plan.frequency}</td><td className="px-5 py-4">{formatShortDate(plan.nextRunDate)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{plan.status}</span></td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2">{hasPermission('recurring.run') && plan.status === 'ACTIVE' ? <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={()=>recurringRunMutation.mutate(plan.id)} type="button">Executer</button>:null}{hasPermission('recurring.update') && plan.status === 'ACTIVE' ? <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={()=>recurringStatusMutation.mutate({id:plan.id,status:'PAUSED'})} type="button">Pause</button>:null}{hasPermission('recurring.update') && plan.status === 'PAUSED' ? <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={()=>recurringStatusMutation.mutate({id:plan.id,status:'ACTIVE'})} type="button">Reprendre</button>:null}{hasPermission('recurring.update') && !['CANCELLED','COMPLETED'].includes(plan.status) ? <button className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600" onClick={()=>recurringStatusMutation.mutate({id:plan.id,status:'CANCELLED'})} type="button">Annuler</button>:null}</div></td></tr>)}</tbody></table>
                {!recurringPlansQuery.isLoading && !(recurringPlansQuery.data?.data.length) ? <p className="p-5 text-sm text-slate-500">Aucun plan recurrent.</p> : null}
              </div>
            </section>
          ) : null}

          {activeView === 'payments' ? (
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Historique des paiements</h2>
                  <p className="text-sm text-slate-500">
                    {payments.length} affiche{payments.length > 1 ? 's' : ''} sur{' '}
                    {paymentQuery.data?.meta.total ?? 0} paiement
                    {(paymentQuery.data?.meta.total ?? 0) > 1 ? 's' : ''}.
                  </p>
                </div>
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                  Total filtre: {formatCurrency(paymentQuery.data?.summary.totalAmount ?? 0)}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Facture</th>
                      <th className="px-5 py-3 font-medium">Client</th>
                      <th className="px-5 py-3 font-medium">Mode</th>
                      <th className="px-5 py-3 font-medium">Reference</th>
                      <th className="px-5 py-3 text-right font-medium">Montant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((payment) => (
                      <tr className="hover:bg-slate-50" key={payment.id}>
                        <td className="px-5 py-4 text-slate-600">
                          {formatShortDate(payment.paymentDate)}
                        </td>
                        <td className="px-5 py-4">
                          {payment.invoice ? (
                            <button
                              className="font-medium text-slate-900 transition hover:text-primary"
                              onClick={() => setViewInvoiceId(payment.invoice!.id)}
                              type="button"
                            >
                              {payment.invoice.invoiceNumber}
                            </button>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {payment.invoice?.customer?.company ??
                            payment.invoice?.customer?.name ??
                            '-'}
                        </td>
                        <td className="px-5 py-4 text-slate-600">{payment.method}</td>
                        <td className="px-5 py-4 text-slate-500">{payment.reference ?? '-'}</td>
                        <td className="px-5 py-4 text-right font-semibold">
                          {formatCurrency(Number(payment.amount), payment.invoice?.currency ?? 'MAD')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!paymentQuery.isLoading && payments.length === 0 ? (
                  <p className="p-5 text-sm text-slate-500">Aucun paiement ne correspond aux filtres.</p>
                ) : null}
              </div>
              {paymentQuery.data?.meta ? (
                <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-slate-500">
                    Page {paymentQuery.data.meta.page} sur {paymentQuery.data.meta.totalPages || 1}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={paymentQuery.data.meta.page <= 1 || paymentQuery.isFetching}
                      onClick={() => setPaymentPage((page) => Math.max(1, page - 1))}
                      type="button"
                    >
                      Precedent
                    </button>
                    <button
                      className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        paymentQuery.data.meta.page >= paymentQuery.data.meta.totalPages ||
                        paymentQuery.isFetching
                      }
                      onClick={() => setPaymentPage((page) => page + 1)}
                      type="button"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeView === 'reports' ? (
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Metric
                  helper={`${receivablesAgingQuery.data?.totalInvoices ?? 0} facture${
                    (receivablesAgingQuery.data?.totalInvoices ?? 0) > 1 ? 's' : ''
                  } ouverte${(receivablesAgingQuery.data?.totalInvoices ?? 0) > 1 ? 's' : ''}`}
                  icon={AlertTriangle}
                  label="Creances ouvertes"
                  tone="danger"
                  value={formatCurrency(receivablesAgingQuery.data?.totalAmount ?? 0)}
                />
                <Metric
                  helper="Rapport temps reel"
                  icon={CalendarClock}
                  label="Genere le"
                  value={receivablesAgingQuery.data ? formatShortDate(receivablesAgingQuery.data.generatedAt) : '-'}
                />
                <Metric
                  helper="Vieillissement des impayes"
                  icon={ReceiptText}
                  label="Tranches"
                  value={String(receivablesAgingQuery.data?.buckets.length ?? 0)}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                {(receivablesAgingQuery.data?.buckets ?? []).map((bucket) => (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={bucket.key}>
                    <p className="text-sm font-semibold text-slate-900">{bucket.label}</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">
                      {formatCurrency(bucket.amount)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {bucket.invoiceCount} facture{bucket.invoiceCount > 1 ? 's' : ''}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Rapport TVA et revenus</h2>
                    <p className="text-sm text-slate-500">
                      Factures non annulees par date d emission.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setReportDateFrom(event.target.value)}
                      title="Date debut"
                      type="date"
                      value={reportDateFrom}
                    />
                    <input
                      className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                      onChange={(event) => setReportDateTo(event.target.value)}
                      title="Date fin"
                      type="date"
                      value={reportDateTo}
                    />
                    <button
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={exportingTarget === 'tax-report' || taxSummaryQuery.isLoading}
                      onClick={handleExportTaxReport}
                      type="button"
                    >
                      <Download className="h-4 w-4" />
                      {exportingTarget === 'tax-report' ? 'Export...' : 'Export TVA'}
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 p-5 md:grid-cols-4">
                  <Metric
                    helper={`${taxSummaryQuery.data?.totals.invoiceCount ?? 0} facture${
                      (taxSummaryQuery.data?.totals.invoiceCount ?? 0) > 1 ? 's' : ''
                    }`}
                    icon={ReceiptText}
                    label="Total HT"
                    value={formatCurrency(taxSummaryQuery.data?.totals.subtotal ?? 0)}
                  />
                  <Metric
                    helper="Montant TVA facture"
                    icon={AlertTriangle}
                    label="TVA collectee"
                    value={formatCurrency(taxSummaryQuery.data?.totals.taxAmount ?? 0)}
                  />
                  <Metric
                    helper="Montant TTC"
                    icon={WalletCards}
                    label="Total facture"
                    value={formatCurrency(taxSummaryQuery.data?.totals.total ?? 0)}
                  />
                  <Metric
                    helper="Deja encaisse"
                    icon={CheckCircle2}
                    label="Encaisse"
                    value={formatCurrency(taxSummaryQuery.data?.totals.amountPaid ?? 0)}
                  />
                </div>
                <div className="grid gap-4 border-t border-slate-100 p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Ventilation par taux</h3>
                    <div className="mt-3 space-y-3">
                      {(taxSummaryQuery.data?.taxRates ?? []).map((rate) => (
                        <div className="rounded-md bg-white p-3 ring-1 ring-slate-200" key={rate.taxRate}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-slate-900">{rate.taxRate}%</p>
                            <p className="text-xs text-slate-500">
                              {rate.invoiceCount} facture{rate.invoiceCount > 1 ? 's' : ''}
                            </p>
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            TVA {formatCurrency(rate.taxAmount)} · TTC {formatCurrency(rate.total)}
                          </p>
                        </div>
                      ))}
                      {!taxSummaryQuery.isLoading && !taxSummaryQuery.data?.taxRates.length ? (
                        <p className="text-sm text-slate-500">Aucune TVA sur cette periode.</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">Facture</th>
                          <th className="px-4 py-3 font-medium">Client</th>
                          <th className="px-4 py-3 font-medium">Emission</th>
                          <th className="px-4 py-3 text-right font-medium">HT</th>
                          <th className="px-4 py-3 text-right font-medium">TVA</th>
                          <th className="px-4 py-3 text-right font-medium">TTC</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(taxSummaryQuery.data?.invoices ?? []).slice(0, 8).map((invoice) => (
                          <tr className="hover:bg-slate-50" key={invoice.id}>
                            <td className="px-4 py-3">
                              <button
                                className="font-medium text-slate-900 transition hover:text-primary"
                                onClick={() => setViewInvoiceId(invoice.id)}
                                type="button"
                              >
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {taxSummaryQuery.isLoading ? (
                      <p className="p-5 text-sm text-slate-500">Chargement du rapport TVA...</p>
                    ) : null}
                    {!taxSummaryQuery.isLoading && taxSummaryQuery.data?.invoices.length === 0 ? (
                      <p className="p-5 text-sm text-slate-500">Aucune facture sur cette periode.</p>
                    ) : null}
                    {(taxSummaryQuery.data?.invoices.length ?? 0) > 8 ? (
                      <p className="border-t border-slate-100 p-3 text-xs text-slate-500">
                        Les 8 premieres factures sont affichees. Exportez le CSV pour la liste complete.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Factures impayees</h2>
                    <p className="text-sm text-slate-500">
                      Classement par anciennete de retard et solde restant.
                    </p>
                  </div>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={exportingTarget === 'reports' || receivablesAgingQuery.isLoading}
                    onClick={handleExportReceivablesReport}
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    {exportingTarget === 'reports' ? 'Export...' : 'Export'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Facture</th>
                        <th className="px-5 py-3 font-medium">Client</th>
                        <th className="px-5 py-3 font-medium">Tranche</th>
                        <th className="px-5 py-3 font-medium">Echeance</th>
                        <th className="px-5 py-3 font-medium">Statut</th>
                        <th className="px-5 py-3 text-right font-medium">Solde</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {receivablesInvoices.map((invoice) => (
                        <tr className="hover:bg-slate-50" key={invoice.id}>
                          <td className="px-5 py-4">
                            <button
                              className="font-medium text-slate-900 transition hover:text-primary"
                              onClick={() => setViewInvoiceId(invoice.id)}
                              type="button"
                            >
                              {invoice.invoiceNumber}
                            </button>
                          </td>
                          <td className="px-5 py-4 text-slate-600">{invoice.customer}</td>
                          <td className="px-5 py-4 text-slate-600">{invoice.bucket}</td>
                          <td className="px-5 py-4 text-slate-600">
                            <p>{formatShortDate(invoice.dueDate)}</p>
                            <p className="text-xs text-slate-500">
                              {invoice.daysLate > 0
                                ? `${invoice.daysLate} j de retard`
                                : 'Non echue'}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}
                            >
                              {statusLabels[invoice.status]}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-semibold">
                            {formatCurrency(invoice.balanceDue, invoice.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {receivablesAgingQuery.isLoading ? (
                    <p className="p-5 text-sm text-slate-500">Chargement du rapport...</p>
                  ) : null}
                  {!receivablesAgingQuery.isLoading && receivablesInvoices.length === 0 ? (
                    <p className="p-5 text-sm text-slate-500">Aucune facture ouverte a analyser.</p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {activeView === 'reminders' ? (
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">Historique des relances</h2>
                      <p className="text-sm text-slate-500">
                        {reminders.length} affiche
                        {reminders.length > 1 ? 'es' : 'e'} sur {reminderQuery.data?.meta.total ?? 0}
                        {' '}relance{(reminderQuery.data?.meta.total ?? 0) > 1 ? 's' : ''}.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                        onChange={(event) =>
                          setReminderStatusFilter(event.target.value as ReminderStatus | 'ALL')
                        }
                        value={reminderStatusFilter}
                      >
                        <option value="ALL">Tous statuts</option>
                        <option value="PENDING">En attente</option>
                        <option value="SENT">Envoyee</option>
                        <option value="FAILED">Echec</option>
                      </select>
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                        onChange={(event) =>
                          setReminderTypeFilter(event.target.value as ReminderType | 'ALL')
                        }
                        value={reminderTypeFilter}
                      >
                        <option value="ALL">Tous types</option>
                        <option value="BEFORE_DUE">Avant echeance</option>
                        <option value="ON_DUE">A echeance</option>
                        <option value="AFTER_DUE">Apres echeance</option>
                        <option value="MANUAL">Manuelle</option>
                      </select>
                      {isAdmin ? (
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={automaticReminderMutation.isPending}
                          onClick={() => automaticReminderMutation.mutate()}
                          type="button"
                        >
                          <CalendarClock className="h-4 w-4" />
                          {automaticReminderMutation.isPending ? 'Generation...' : 'Generer auto'}
                        </button>
                      ) : null}
                      <button
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={exportingTarget === 'reminders'}
                        onClick={handleExportReminders}
                        type="button"
                      >
                        <Download className="h-4 w-4" />
                        {exportingTarget === 'reminders' ? 'Export...' : 'Export'}
                      </button>
                      <button
                        className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        onClick={resetReminderFilters}
                        type="button"
                      >
                        Reinitialiser
                      </button>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {reminders.map((reminder) => (
                    <ReminderRow key={reminder.id} reminder={reminder} />
                  ))}
                  {reminders.length === 0 ? (
                    <p className="p-5 text-sm text-slate-500">Aucune relance ne correspond aux filtres.</p>
                  ) : null}
                </div>
                {reminderQuery.data?.meta ? (
                  <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-slate-500">
                      Page {reminderQuery.data.meta.page} sur {reminderQuery.data.meta.totalPages || 1}
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={reminderQuery.data.meta.page <= 1 || reminderQuery.isFetching}
                        onClick={() => setReminderPage((page) => Math.max(1, page - 1))}
                        type="button"
                      >
                        Precedent
                      </button>
                      <button
                        className="h-9 rounded-md border border-slate-200 px-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          reminderQuery.data.meta.page >= reminderQuery.data.meta.totalPages ||
                          reminderQuery.isFetching
                        }
                        onClick={() => setReminderPage((page) => page + 1)}
                        type="button"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold">Relance manuelle</h2>
                <p className="text-sm text-slate-500">Composer une relance pour une facture impayee.</p>
                <form className="mt-5 space-y-2" onSubmit={handleCreateManualReminder}>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setReminderInvoiceId(event.target.value)}
                    value={reminderInvoiceId}
                  >
                    <option value="">Selectionner une facture</option>
                    {payableInvoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.number} - {invoice.customer}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setReminderDraftType(event.target.value as ReminderType)}
                    value={reminderDraftType}
                  >
                    <option value="MANUAL">Manuelle</option>
                    <option value="BEFORE_DUE">Avant echeance</option>
                    <option value="ON_DUE">A echeance</option>
                    <option value="AFTER_DUE">Apres echeance</option>
                  </select>
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setReminderSubject(event.target.value)}
                    placeholder="Sujet optionnel"
                    value={reminderSubject}
                  />
                  <textarea
                    className="min-h-28 w-full rounded-md border border-slate-200 bg-white p-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setReminderBody(event.target.value)}
                    placeholder="Message optionnel"
                    value={reminderBody}
                  />
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      checked={reminderSendEmail}
                      onChange={(event) => setReminderSendEmail(event.target.checked)}
                      type="checkbox"
                    />
                    Envoyer par email
                  </label>
                  <button
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={reminderMutation.isPending}
                    type="submit"
                  >
                    <Mail className="h-4 w-4" />
                    {reminderMutation.isPending ? 'Creation...' : 'Creer la relance'}
                  </button>
                </form>

                <div className="mt-6 border-t border-slate-200 pt-5">
                  <h3 className="text-sm font-semibold">Prioritaires</h3>
                  <div className="mt-3 space-y-3">
                  {payableInvoices.slice(0, 5).map((invoice) => (
                    <div className="rounded-md border border-slate-200 p-3" key={invoice.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{invoice.customer}</p>
                          <p className="text-xs text-slate-500">{invoice.number}</p>
                        </div>
                        <p className="text-sm font-semibold">{formatCurrency(invoice.total - invoice.paid)}</p>
                      </div>
                      <button
                        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={reminderMutation.isPending}
                        onClick={() => {
                          setReminderInvoiceId(invoice.id);
                          setReminderDraftType(invoice.status === 'OVERDUE' ? 'AFTER_DUE' : 'BEFORE_DUE');
                        }}
                        type="button"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Utiliser
                      </button>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </section>
      {viewInvoiceId ? (
        <InvoiceDetailPanel
          invoice={invoiceDetailQuery.data}
          isLoading={invoiceDetailQuery.isLoading}
          canSignInvoices={isAdmin}
          companySettings={companySettingsQuery.data}
          isCancelSignaturePending={cancelInvoiceSignatureMutation.isPending}
          onClose={() => setViewInvoiceId('')}
          onCancelSignature={handleCancelInvoiceSignature}
          onDownload={(invoice) => downloadInvoicePdf(invoice.id, invoice.invoiceNumber)}
          onEdit={handleEditInvoice}
          onEmail={openInvoiceEmailModal}
          onPaymentSubmit={handleRecordDetailPayment}
          onPrint={handlePrintInvoicePdf}
          onStatusChange={(invoice, status) =>
            invoiceStatusMutation.mutate({
              invoiceId: invoice.id,
              status,
            })
          }
          onSign={handleSignInvoice}
          onPrepareReminder={(invoice) =>
            handlePrepareReminder({
              id: invoice.id,
              number: invoice.invoiceNumber,
              customer: invoice.customer?.company ?? invoice.customer?.name ?? 'Client',
              status: invoice.status,
              issueDate: invoice.issueDate,
              dueDate: invoice.dueDate,
              total: Number(invoice.total),
              paid: Number(invoice.amountPaid),
            })
          }
          paymentAmount={paymentAmount}
          paymentEntryDate={paymentEntryDate}
          paymentMethod={paymentMethod}
          paymentReference={paymentReference}
          setPaymentAmount={setPaymentAmount}
          setPaymentEntryDate={setPaymentEntryDate}
          setPaymentMethod={setPaymentMethod}
          setPaymentReference={setPaymentReference}
          isPaymentPending={paymentMutation.isPending}
          isEmailPending={invoiceEmailMutation.isPending}
          isStatusPending={invoiceStatusMutation.isPending}
          isSignPending={signInvoiceMutation.isPending}
        />
      ) : null}
      {viewCustomerId ? (
        <CustomerDetailPanel
          customer={selectedCustomer}
          invoices={(customerInvoiceQuery.data?.data ?? []).map(mapInvoiceToSummary)}
          isLoading={customerDetailQuery.isLoading || customerInvoiceQuery.isLoading}
          onClose={() => setViewCustomerId('')}
          onCreateInvoice={handleCreateInvoiceForCustomer}
          onEdit={(customer) => {
            handleEditCustomer(customer);
            setViewCustomerId('');
          }}
          onOpenInvoice={(invoiceId) => {
            setViewCustomerId('');
            setViewInvoiceId(invoiceId);
          }}
        />
      ) : null}
      {assetEditor ? (
        <AssetEditorModal
          imageUrl={assetEditor.imageUrl}
          autoProcess={assetEditor.autoProcess}
          kind={assetEditor.kind}
          onCancel={() => setAssetEditor(null)}
          onAutoProcessChange={handleAutoBackgroundRemovalPreferenceChange}
          onConfirm={(blob) => handleConfirmAssetEdit(assetEditor.kind, blob)}
          title={assetEditor.title}
        />
      ) : null}
      {emailInvoiceId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4">
          <button
            aria-label="Fermer"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={closeInvoiceEmailModal}
            type="button"
          />
          <form
            className="relative w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl"
            onSubmit={handleSendInvoiceEmail}
          >
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-base font-semibold">Envoyer la facture</h2>
              <p className="text-sm text-slate-500">
                Le PDF sera joint automatiquement a cet email.
              </p>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-medium text-slate-600">
                Destinataire
                <input
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                  onChange={(event) => setInvoiceEmailRecipient(event.target.value)}
                  type="email"
                  value={invoiceEmailRecipient}
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Sujet
                <input
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                  onChange={(event) => setInvoiceEmailSubject(event.target.value)}
                  value={invoiceEmailSubject}
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Message
                <textarea
                  className="mt-1 min-h-44 w-full rounded-md border border-slate-200 p-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
                  onChange={(event) => setInvoiceEmailMessage(event.target.value)}
                  value={invoiceEmailMessage}
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
              <button
                className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={closeInvoiceEmailModal}
                type="button"
              >
                Annuler
              </button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={invoiceEmailMutation.isPending}
                type="submit"
              >
                <Mail className="h-4 w-4" />
                {invoiceEmailMutation.isPending ? 'Envoi...' : 'Envoyer'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

type EditorTool = 'erase' | 'restore' | 'pan';

type EditorSnapshot = {
  dataUrl: string;
  width: number;
  height: number;
};

function AssetEditorModal({
  imageUrl,
  autoProcess,
  kind,
  title,
  onCancel,
  onAutoProcessChange,
  onConfirm,
}: {
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
  const pointerRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
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
    if (!canvas) return;

    const snapshot = {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };

    setHistory((items) => [...items.slice(0, historyIndex + 1), snapshot].slice(-30));
    setHistoryIndex((index) => Math.min(index + 1, 29));
  }, [historyIndex]);

  const renderSource = useCallback(
    async (sourceUrl: string, targetWidth = dimensions.width, targetHeight = dimensions.height) => {
      setIsLoading(true);
      setMessage('');
      try {
        const image = await loadCanvasImage(sourceUrl);
        originalImageRef.current = image;

        const canvas = canvasRef.current;
        const restoreCanvas = restoreCanvasRef.current;
        if (!canvas || !restoreCanvas) return;

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        restoreCanvas.width = targetWidth;
        restoreCanvas.height = targetHeight;

        const context = canvas.getContext('2d', { willReadFrequently: true });
        const restoreContext = restoreCanvas.getContext('2d', { willReadFrequently: true });
        if (!context || !restoreContext) return;

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
      } catch {
        setMessage('Impossible de charger cette image.');
      } finally {
        setIsLoading(false);
      }
    },
    [dimensions.height, dimensions.width]
  );

  useEffect(() => {
    void renderSource(imageUrl);
  }, [imageUrl, renderSource]);

  const restoreSnapshot = (snapshot: EditorSnapshot) => {
    const canvas = canvasRef.current;
    const restoreCanvas = restoreCanvasRef.current;
    if (!canvas || !restoreCanvas) return;

    const image = new Image();
    image.onload = () => {
      canvas.width = snapshot.width;
      canvas.height = snapshot.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
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
    if (!image || !restoreCanvas || !context) return;

    restoreCanvas.width = width;
    restoreCanvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
  };

  const handleAutoRemove = useCallback(async () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;

    setIsLoading(true);
    setMessage('Suppression du fond par IA professionnelle en cours...');
    try {
      const sourceBlob = await canvasToPngBlob(canvas);
      const transparentBlob = await removeCompanyAssetBackgroundPreview(
        new File([sourceBlob], `${kind}-source.png`, { type: 'image/png' })
      );
      const transparentUrl = URL.createObjectURL(transparentBlob);
      const resultImage = await loadCanvasImage(transparentUrl);
      URL.revokeObjectURL(transparentUrl);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(resultImage, 0, 0, canvas.width, canvas.height);
      pushHistory();
      setMessage('Fond supprime par IA. Comparez avec l original, corrigez si besoin, puis confirmez.');
    } catch (error) {
      setMessage(getApiErrorMessage(error, 'Impossible de supprimer le fond avec le service IA.'));
    } finally {
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
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    restoreSnapshot(history[nextIndex]);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    restoreSnapshot(history[nextIndex]);
  };

  const handleReset = () => {
    void renderSource(imageUrl);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMessage('Modifications reinitialisees.');
  };

  const handleRotate = () => {
    const canvas = canvasRef.current;
    const restoreCanvas = restoreCanvasRef.current;
    if (!canvas || !restoreCanvas) return;

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
    setDimensions(
      key === 'width'
        ? { width: cleanValue, height: clampInt(Math.round(cleanValue / ratio), 20, 2000) }
        : { width: clampInt(Math.round(cleanValue * ratio), 20, 2000), height: cleanValue }
    );
  };

  const handleApplyCrop = () => {
    const image = originalImageRef.current;
    const canvas = canvasRef.current;
    const restoreCanvas = restoreCanvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    const restoreContext = restoreCanvas?.getContext('2d', { willReadFrequently: true });
    if (!image || !canvas || !restoreCanvas || !context || !restoreContext) return;

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
    setMessage('Recadrage applique.');
  };

  const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

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
    if (event.buttons !== 1) return;

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

  const drawEditorBrush = (
    point: { x: number; y: number },
    brushTool: EditorTool,
    size: number
  ) => {
    const canvas = canvasRef.current;
    const restoreCanvas = restoreCanvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    const restoreContext = restoreCanvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;

    context.save();
    context.beginPath();
    context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    context.clip();

    if (brushTool === 'erase') {
      context.clearRect(point.x - size / 2, point.y - size / 2, size, size);
    } else if (restoreContext && restoreCanvas) {
      context.drawImage(
        restoreCanvas,
        point.x - size / 2,
        point.y - size / 2,
        size,
        size,
        point.x - size / 2,
        point.y - size / 2,
        size,
        size
      );
    }

    context.restore();
  };

  const handleConfirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsLoading(true);
    try {
      const blob = await canvasToPngBlobWithOpacity(canvas, opacity / 100);
      onConfirm(blob);
    } catch {
      setMessage('Impossible de generer le PNG transparent.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-sm text-slate-500">
              Recommande: {recommended}. Dimensions finales: {dimensions.width} x {dimensions.height}px.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              disabled={isLoading}
              onClick={onCancel}
              type="button"
            >
              Annuler
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              onClick={handleConfirm}
              type="button"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirmer
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4 border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
            {message ? (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">{message}</p>
            ) : null}
            <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <input
                checked={autoProcess}
                className="mt-1 accent-primary"
                disabled={isLoading}
                onChange={(event) => onAutoProcessChange(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block font-medium">Supprimer automatiquement le fond</span>
                <span className="block text-xs text-slate-500">
                  Active pour les prochains uploads. Desactive pour garder l image originale.
                </span>
              </span>
            </label>
            <button
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              disabled={isLoading}
              onClick={handleAutoRemove}
              type="button"
            >
              <Eraser className="h-4 w-4" />
              Supprimer le fond IA
            </button>

            <div className="grid grid-cols-3 gap-2">
              <ToolButton active={tool === 'erase'} icon={Eraser} label="Effacer" onClick={() => setTool('erase')} />
              <ToolButton active={tool === 'restore'} icon={RefreshCcw} label="Restaurer" onClick={() => setTool('restore')} />
              <ToolButton active={tool === 'pan'} icon={Move} label="Deplacer" onClick={() => setTool('pan')} />
            </div>

            <label className="block text-xs font-medium text-slate-600">
              Taille pinceau: {brushSize}px
              <input
                className="mt-2 w-full accent-primary"
                max={120}
                min={4}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                type="range"
                value={brushSize}
              />
            </label>

            <label className="block text-xs font-medium text-slate-600">
              Opacite: {opacity}%
              <input
                className="mt-2 w-full accent-primary"
                max={100}
                min={5}
                onChange={(event) => setOpacity(Number(event.target.value))}
                type="range"
                value={opacity}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleUndo} type="button">
                <Undo2 className="mx-auto h-4 w-4" />
              </button>
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleRedo} type="button">
                <Redo2 className="mx-auto h-4 w-4" />
              </button>
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleRotate} type="button">
                <RotateCw className="mx-auto h-4 w-4" />
              </button>
              <button className="h-9 rounded-md border border-slate-200 text-sm" onClick={handleReset} type="button">
                Reset
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Dimensions</p>
                <button
                  className="rounded-md border border-slate-200 p-1"
                  onClick={() => setLockRatio((value) => !value)}
                  type="button"
                >
                  {lockRatio ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Largeur"
                  onChange={(value) => handleDimensionChange('width', value)}
                  value={dimensions.width}
                />
                <NumberField
                  label="Hauteur"
                  onChange={(value) => handleDimensionChange('height', value)}
                  value={dimensions.height}
                />
              </div>
              <button
                className="mt-2 h-8 w-full rounded-md border border-slate-200 text-sm font-medium"
                onClick={() => handleResize(dimensions.width, dimensions.height)}
                type="button"
              >
                Appliquer dimensions
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Crop className="h-4 w-4" />
                Recadrage source
              </p>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" onChange={(value) => setCropRect((rect) => ({ ...rect, x: value }))} value={cropRect.x} />
                <NumberField label="Y" onChange={(value) => setCropRect((rect) => ({ ...rect, y: value }))} value={cropRect.y} />
                <NumberField label="W" onChange={(value) => setCropRect((rect) => ({ ...rect, width: value }))} value={cropRect.width} />
                <NumberField label="H" onChange={(value) => setCropRect((rect) => ({ ...rect, height: value }))} value={cropRect.height} />
              </div>
              <button
                className="mt-2 h-8 w-full rounded-md border border-slate-200 text-sm font-medium"
                onClick={handleApplyCrop}
                type="button"
              >
                Appliquer recadrage
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button className="h-9 rounded-md border border-slate-200" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} type="button">
                <ZoomOut className="mx-auto h-4 w-4" />
              </button>
              <button className="h-9 rounded-md border border-slate-200" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} type="button">
                <ZoomIn className="mx-auto h-4 w-4" />
              </button>
            </div>
          </aside>

          <div className="grid gap-4 p-4 xl:grid-cols-2">
            <section>
              <p className="mb-2 text-sm font-semibold">Original</p>
              <div className="flex min-h-72 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
                <img alt="Original" className="max-h-[520px] max-w-full object-contain" src={imageUrl} />
              </div>
            </section>
            <section>
              <p className="mb-2 text-sm font-semibold">Resultat sur fond transparent</p>
              <div className="transparent-preview flex min-h-72 items-center justify-center overflow-hidden rounded-lg border border-slate-200 p-3">
                {isLoading ? <p className="text-sm text-slate-500">Traitement...</p> : null}
                <canvas
                  className={isLoading ? 'hidden' : 'touch-none rounded-md shadow-sm'}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  ref={canvasRef}
                  style={{
                    cursor: tool === 'pan' ? 'grab' : 'crosshair',
                    opacity: opacity / 100,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center',
                    maxWidth: '100%',
                    maxHeight: '520px',
                  }}
                />
                <canvas className="hidden" ref={restoreCanvasRef} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Eraser;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium ${
        active
          ? 'border-primary bg-primary text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <input
        className="mt-1 h-8 w-full rounded-md border border-slate-200 px-2 text-sm outline-none ring-primary/20 focus:ring-4"
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={Number.isFinite(value) ? value : 0}
      />
    </label>
  );
}

type MetricProps = {
  icon: typeof ReceiptText;
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'danger' | 'warning';
};

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm" key={index}>
            <div className="h-4 w-24 rounded bg-slate-200" />
            <div className="mt-4 h-8 w-32 rounded bg-slate-200" />
            <div className="mt-5 h-3 w-36 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-80 animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-full rounded-md bg-slate-100" />
        </div>
        <div className="h-80 animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-full rounded-md bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-700">
      <p className="font-semibold">Impossible de charger le dashboard.</p>
      <p className="mt-1 text-sm">Verifiez la connexion au backend puis reessayez.</p>
      <button
        className="mt-4 h-9 rounded-md bg-rose-600 px-3 text-sm font-medium text-white transition hover:bg-rose-700"
        onClick={onRetry}
        type="button"
      >
        Reessayer
      </button>
    </div>
  );
}

function DashboardPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

function DashboardEmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-52 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function Metric({ icon: Icon, label, value, helper, tone = 'default' }: MetricProps) {
  const toneClass = {
    default: 'metric-icon-primary bg-indigo-50 text-primary',
    danger: 'metric-icon-danger bg-rose-50 text-rose-600',
    warning: 'metric-icon-warning bg-amber-50 text-amber-600',
  }[tone];

  return (
    <article className={`metric-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm metric-${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="metric-label text-sm font-medium text-slate-500">{label}</p>
          <p className="metric-value mt-2 text-2xl font-semibold">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="metric-helper mt-4 text-sm text-slate-500">{helper}</p>
    </article>
  );
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

function LoginPage({
  email,
  password,
  rememberMe,
  showPassword,
  isPending,
  errorMessage,
  themePreference,
  onEmailChange,
  onPasswordChange,
  onRememberMeChange,
  onShowPasswordToggle,
  onThemeToggle,
  onLogin,
}: LoginPageProps) {
  return (
    <main className="login-shell min-h-screen">
      <button
        aria-label={themePreference === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
        aria-pressed={themePreference === 'dark'}
        className="icon-button login-theme-toggle"
        onClick={onThemeToggle}
        title={themePreference === 'dark' ? 'Light mode' : 'Dark mode'}
        type="button"
      >
        {themePreference === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white">
            BS
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Billing System</p>
            <p className="text-xs font-medium text-slate-500">Gestion facturation</p>
          </div>
        </div>

        <div className="mt-8">
          <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure workspace
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-normal text-slate-950">Sign In</h1>
          <p className="mt-2 text-sm text-slate-500">
            Access your invoices, payments, clients and reports from one protected dashboard.
          </p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={onLogin}>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              autoComplete="email"
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="admin@billingsystem.com"
              type="email"
              value={email}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Password</span>
            <div className="relative mt-2">
              <input
                autoComplete="current-password"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pr-11 text-sm outline-none ring-primary/20 transition focus:ring-4"
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="Enter your password"
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                onClick={onShowPasswordToggle}
                type="button"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="inline-flex items-center gap-2 font-medium text-slate-600">
              <input
                checked={rememberMe}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                onChange={(event) => onRememberMeChange(event.target.checked)}
                type="checkbox"
              />
              Remember me
            </label>
            <a className="font-semibold text-primary transition hover:text-primary/80" href="/forgot-password">
              Forgot Password?
            </a>
          </div>

          {errorMessage ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <button
            className="primary-action inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isPending}
            type="submit"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  );
}

function AuthLoadingScreen({ themePreference }: { themePreference: ThemePreference }) {
  return (
    <main className="login-shell min-h-screen">
      <div className="login-card flex min-h-72 flex-col items-center justify-center text-center">
        <div className="brand-mark flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white">
          BS
        </div>
        <Loader2 className="mt-6 h-6 w-6 animate-spin text-primary" />
        <p className="mt-3 text-sm font-semibold text-slate-900">
          {themePreference === 'dark' ? 'Securing dark workspace...' : 'Securing workspace...'}
        </p>
      </div>
    </main>
  );
}

function AuthPanel({
  className,
  email,
  password,
  hasAccessToken,
  isPending,
  isError,
  onEmailChange,
  onPasswordChange,
  onLogin,
  onLogout,
  user,
}: AuthPanelProps) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase text-slate-500">
        {hasAccessToken ? 'Session active' : 'Connexion API'}
      </p>
      {hasAccessToken ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-md bg-white p-2 ring-1 ring-slate-200">
            <p className="truncate text-xs font-semibold text-slate-800">
              {user?.name ?? 'Utilisateur connecte'}
            </p>
            <p className="truncate text-[11px] text-slate-500">{user?.email ?? 'Session en cours'}</p>
            {user?.role ? (
              <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {user.role}
              </span>
            ) : null}
          </div>
          <button
            className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 transition hover:bg-slate-100"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-3.5 w-3.5" />
            Deconnexion
          </button>
        </div>
      ) : (
        <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:block lg:space-y-2" onSubmit={onLogin}>
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none ring-primary/20 transition focus:ring-4"
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="Email"
            type="email"
            value={email}
          />
          <input
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs outline-none ring-primary/20 transition focus:ring-4"
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Mot de passe"
            type="password"
            value={password}
          />
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-full"
            disabled={isPending}
            type="submit"
          >
            <LogIn className="h-3.5 w-3.5" />
            {isPending ? 'Connexion...' : 'Se connecter'}
          </button>
          {isError ? (
            <p className="text-xs text-rose-600 sm:col-span-3">
              Connexion impossible pour le moment.
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

function ReminderRow({ reminder }: { reminder: Reminder }) {
  const statusClass = {
    SENT: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    FAILED: 'bg-rose-100 text-rose-700 ring-rose-200',
    PENDING: 'bg-amber-100 text-amber-700 ring-amber-200',
  }[reminder.status];

  return (
    <article className="p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{reminder.subject}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass}`}>
              {reminder.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{reminder.recipientEmail}</p>
          {reminder.invoice ? (
            <p className="mt-1 text-xs font-medium text-slate-500">
              {reminder.invoice.invoiceNumber} -{' '}
              {reminder.invoice.customer?.company ?? reminder.invoice.customer?.name ?? 'Client'} -{' '}
              {formatCurrency(Number(reminder.invoice.balanceDue), reminder.invoice.currency)}
            </p>
          ) : null}
          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{reminder.body}</p>
        </div>
        <div className="text-sm text-slate-500 md:text-right">
          <p>{reminder.type}</p>
          <p>{formatShortDate(reminder.sentAt ?? reminder.createdAt)}</p>
        </div>
      </div>
      {reminder.errorMessage ? (
        <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
          {reminder.errorMessage}
        </p>
      ) : null}
    </article>
  );
}

function SettingsInput({
  label,
  onChange,
  required = false,
  type = 'text',
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none ring-primary/20 transition focus:ring-4"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
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

function CustomerDetailPanel({
  customer,
  invoices,
  isLoading,
  onClose,
  onCreateInvoice,
  onEdit,
  onOpenInvoice,
}: CustomerDetailPanelProps) {
  const invoiceCount = customer?.financialSummary?.totalInvoices ?? invoices.length;
  const invoiced =
    customer?.financialSummary?.totalInvoiced ??
    invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const unpaid =
    customer?.financialSummary?.totalUnpaid ??
    invoices.reduce((sum, invoice) => sum + invoice.total - invoice.paid, 0);

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/20">
      <button
        aria-label="Fermer"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Fiche client</p>
            <h2 className="mt-1 text-xl font-semibold">
              {customer ? customer.company ?? customer.name : 'Chargement...'}
            </h2>
          </div>
          <button
            className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Fermer
          </button>
        </div>

        {!customer ? (
          <div className="p-5 text-sm text-slate-500">Chargement du client...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailMetric label="Factures" value={String(invoiceCount)} />
              <DetailMetric label="Facture" value={formatCurrency(invoiced)} />
              <DetailMetric label="Impayes" value={formatCurrency(unpaid)} tone="danger" />
            </div>

            <section className="mt-5 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold">Informations</h3>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <InfoLine label="Nom" value={customer.name} />
                <InfoLine label="Entreprise" value={customer.company} />
                <InfoLine label="Email" value={customer.email} />
                <InfoLine label="Telephone" value={customer.phone} />
                <InfoLine label="Ville" value={customer.city} />
                <InfoLine label="Identifiant fiscal" value={customer.taxNumber} />
                <InfoLine label="Statut" value={customer.isActive ? 'Actif' : 'Inactif'} />
                <InfoLine
                  label="Factures en retard"
                  value={String(customer.financialSummary?.overdueInvoices ?? 0)}
                />
              </div>
              {customer.address ? (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase text-slate-500">Adresse</p>
                  <p className="mt-1 text-sm text-slate-700">{customer.address}</p>
                </div>
              ) : null}
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div>
                  <h3 className="text-sm font-semibold">Factures client</h3>
                  <p className="text-xs text-slate-500">Historique recent lie a ce client.</p>
                </div>
                {isLoading ? <span className="text-xs text-slate-500">Chargement...</span> : null}
              </div>
              <div className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <button
                    className="grid w-full gap-2 p-4 text-left text-sm transition hover:bg-slate-50 sm:grid-cols-[1fr_auto]"
                    key={invoice.id}
                    onClick={() => onOpenInvoice(invoice.id)}
                    type="button"
                  >
                    <div>
                      <p className="font-medium">{invoice.number}</p>
                      <p className="text-xs text-slate-500">{formatDueDate(invoice)}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="font-semibold">{formatCurrency(invoice.total - invoice.paid)}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                        {statusLabels[invoice.status]}
                      </span>
                    </div>
                  </button>
                ))}
                {!isLoading && invoices.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Aucune facture pour ce client.</p>
                ) : null}
              </div>
            </section>
          </div>
        )}

        {customer ? (
          <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
            <button
              className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => onEdit(customer)}
              type="button"
            >
              Modifier
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90"
              onClick={() => onCreateInvoice(customer)}
              type="button"
            >
              <FilePlus2 className="h-4 w-4" />
              Nouvelle facture
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
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

function CompanyAssetCard({
  title,
  description,
  imageUrl,
  icon: Icon,
  disabled,
  isDirty,
  isPending,
  onUpload,
  onRemoveBackground,
  onDelete,
}: CompanyAssetCardProps) {
  const inputId = `${title.toLowerCase().replace(/\s+/g, '-')}-upload`;
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    setHasImageError(false);
  }, [imageUrl]);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
          <p className="mt-1 text-xs text-slate-500">
            PNG, JPG ou JPEG. Maximum 2 Mo. Suppression IA optionnelle dans l editeur.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
            imageUrl
              ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
              : 'bg-slate-100 text-slate-600 ring-slate-200'
          }`}
        >
          {isDirty ? 'Non sauvegardee' : imageUrl ? 'Configuree' : 'Manquante'}
        </span>
      </div>

      <div className="mt-4 flex min-h-28 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white p-3">
        {imageUrl && !hasImageError ? (
          <img
            alt={title}
            className="max-h-24 max-w-full object-contain"
            onError={() => setHasImageError(true)}
            src={imageUrl}
          />
        ) : (
          <p className="text-sm text-slate-500">
            {imageUrl && hasImageError ? 'Apercu indisponible' : 'Aucune image'}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <label
          className={`inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ${
            disabled || isPending ? 'pointer-events-none opacity-60' : ''
          }`}
          htmlFor={inputId}
        >
          <Upload className="h-4 w-4" />
          {isPending ? 'Traitement...' : imageUrl ? 'Remplacer' : 'Uploader'}
        </label>
        <input
          accept="image/png,image/jpeg"
          className="hidden"
          disabled={disabled || isPending}
          id={inputId}
          onChange={(event) => {
            onUpload(event.target.files?.[0]);
            event.target.value = '';
          }}
          type="file"
        />
        {imageUrl ? (
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isPending}
            onClick={onRemoveBackground}
            type="button"
          >
            <Eraser className="h-4 w-4" />
            Supprimer le fond
          </button>
        ) : null}
        {imageUrl ? (
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isPending}
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </button>
        ) : null}
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-slate-700">{value || '-'}</p>
    </div>
  );
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

function InvoiceDetailPanel({
  invoice,
  isLoading,
  canSignInvoices,
  companySettings,
  isCancelSignaturePending,
  isEmailPending,
  isPaymentPending,
  isSignPending,
  isStatusPending,
  onClose,
  onCancelSignature,
  onDownload,
  onEmail,
  onEdit,
  onPaymentSubmit,
  onPrint,
  onPrepareReminder,
  onSign,
  onStatusChange,
  paymentAmount,
  paymentEntryDate,
  paymentMethod,
  paymentReference,
  setPaymentAmount,
  setPaymentEntryDate,
  setPaymentMethod,
  setPaymentReference,
}: InvoiceDetailPanelProps) {
  const balanceDue = invoice ? Number(invoice.balanceDue) : 0;
  const canCollect = Boolean(
    invoice && balanceDue > 0 && invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED'
  );
  const hasCompanySignatureAssets = Boolean(companySettings?.signatureUrl && companySettings?.stampUrl);
  const canSignInvoice = Boolean(
    invoice && canSignInvoices && !invoice.isSigned && hasCompanySignatureAssets
  );

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/20">
      <button
        aria-label="Fermer"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Detail facture</p>
            <h2 className="mt-1 text-xl font-semibold">
              {invoice?.invoiceNumber ?? 'Chargement...'}
            </h2>
          </div>
          <button
            className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Fermer
          </button>
        </div>

        {isLoading || !invoice ? (
          <div className="p-5 text-sm text-slate-500">Chargement de la facture...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailMetric label="Total" value={formatCurrency(Number(invoice.total), invoice.currency)} />
              <DetailMetric label="Paye" value={formatCurrency(Number(invoice.amountPaid), invoice.currency)} />
              <DetailMetric label="Solde" value={formatCurrency(balanceDue, invoice.currency)} tone="danger" />
            </div>

            <section className="mt-5 rounded-lg border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Client</h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {invoice.customer?.company ?? invoice.customer?.name ?? 'Client'}
                  </p>
                  <p className="text-sm text-slate-500">{invoice.customer?.email}</p>
                </div>
                <div className="text-sm text-slate-500 sm:text-right">
                  <p>Emission: {formatShortDate(invoice.issueDate)}</p>
                  <p>Echeance: {formatShortDate(invoice.dueDate)}</p>
                </div>
              </div>
              <span className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClasses[invoice.status]}`}>
                {statusLabels[invoice.status]}
              </span>
              <span
                className={`ml-2 mt-4 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                  invoice.isSigned
                    ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    : 'bg-slate-100 text-slate-600 ring-slate-200'
                }`}
              >
                {invoice.isSigned ? 'Signee' : 'Non signee'}
              </span>
              {invoice.isSigned ? (
                <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-medium">Facture signee et tamponnee electroniquement</p>
                  <p className="mt-1">
                    Signee par: {invoice.signedBy?.name ?? 'Utilisateur'} ·{' '}
                    {invoice.signedAt ? formatShortDate(invoice.signedAt) : 'Date indisponible'}
                  </p>
                  {canSignInvoices ? (
                    <button
                      className="mt-3 inline-flex h-8 w-fit items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isCancelSignaturePending}
                      onClick={() => onCancelSignature(invoice)}
                      type="button"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      {isCancelSignaturePending ? 'Annulation...' : 'Annuler la signature'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!invoice.isSigned && canSignInvoices && !hasCompanySignatureAssets ? (
                <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">
                  Configurez la signature et le tampon dans Parametres societe pour signer cette facture.
                </p>
              ) : null}
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">Lignes facture</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.items ?? []).map((item) => (
                  <div className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_auto]" key={item.id}>
                    <div>
                      <p className="font-medium">{item.description}</p>
                      <p className="text-slate-500">
                        {Number(item.quantity)} {item.unit ?? ''} x{' '}
                        {formatCurrency(Number(item.unitPrice), invoice.currency)}
                      </p>
                    </div>
                    <p className="font-semibold sm:text-right">
                      {formatCurrency(Number(item.total), invoice.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">Paiements</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.payments ?? []).map((payment) => (
                  <div className="flex items-center justify-between gap-3 p-4 text-sm" key={payment.id}>
                    <div>
                      <p className="font-medium">{payment.method}</p>
                      <p className="text-slate-500">{formatShortDate(payment.paymentDate)}</p>
                    </div>
                    <p className="font-semibold">
                      {formatCurrency(Number(payment.amount), invoice.currency)}
                    </p>
                  </div>
                ))}
                {invoice.payments?.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Aucun paiement enregistre.</p>
                ) : null}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">Relances</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.reminders ?? []).map((reminder) => (
                  <div className="p-4 text-sm" key={reminder.id}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{reminder.subject}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {reminder.type} - {formatShortDate(reminder.sentAt ?? reminder.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                          reminder.status === 'SENT'
                            ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                            : reminder.status === 'FAILED'
                              ? 'bg-rose-100 text-rose-700 ring-rose-200'
                              : 'bg-amber-100 text-amber-700 ring-amber-200'
                        }`}
                      >
                        {reminder.status}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-slate-600">{reminder.body}</p>
                    {reminder.errorMessage ? (
                      <p className="mt-2 text-xs text-rose-600">{reminder.errorMessage}</p>
                    ) : null}
                  </div>
                ))}
                {invoice.reminders?.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Aucune relance enregistree.</p>
                ) : null}
              </div>
            </section>

            <section className="mt-5 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold">Emails facture</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {(invoice.emailLogs ?? []).map((emailLog) => (
                  <div className="p-4 text-sm" key={emailLog.id}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{emailLog.subject}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {emailLog.recipientEmail} - {formatShortDate(emailLog.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                          emailLog.status === 'SENT'
                            ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                            : 'bg-rose-100 text-rose-700 ring-rose-200'
                        }`}
                      >
                        {emailLog.deliveryMode === 'local' ? 'LOCAL' : emailLog.status}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-slate-600">{emailLog.message}</p>
                    {emailLog.errorMessage ? (
                      <p className="mt-2 text-xs text-rose-600">{emailLog.errorMessage}</p>
                    ) : null}
                  </div>
                ))}
                {invoice.emailLogs?.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Aucun email de facture enregistre.</p>
                ) : null}
              </div>
            </section>

            {canCollect ? (
              <form
                className="mt-5 rounded-lg border border-slate-200 p-4"
                onSubmit={(event) => onPaymentSubmit(event, invoice)}
              >
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">Ajouter un paiement</h3>
                  <p className="text-xs text-slate-500">
                    Solde restant: {formatCurrency(balanceDue, invoice.currency)}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    max={balanceDue}
                    min="0"
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    placeholder="Montant"
                    step="0.01"
                    type="number"
                    value={paymentAmount}
                  />
                  <input
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    max={getToday()}
                    onChange={(event) => setPaymentEntryDate(event.target.value)}
                    title="Date paiement"
                    type="date"
                    value={paymentEntryDate}
                  />
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                    onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                    value={paymentMethod}
                  >
                    <option value="BANK_TRANSFER">Virement</option>
                    <option value="CASH">Especes</option>
                    <option value="CHECK">Cheque</option>
                    <option value="CREDIT_CARD">Carte</option>
                    <option value="MOBILE_PAYMENT">Mobile</option>
                    <option value="OTHER">Autre</option>
                  </select>
                </div>
                <input
                  className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none ring-primary/20 transition focus:ring-4"
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Reference optionnelle"
                  value={paymentReference}
                />
                <button
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPaymentPending}
                  type="submit"
                >
                  <WalletCards className="h-4 w-4" />
                  {isPaymentPending ? 'Enregistrement...' : 'Enregistrer le paiement'}
                </button>
              </form>
            ) : null}

            {invoice.notes || invoice.terms ? (
              <section className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
                {invoice.terms ? (
                  <>
                    <h3 className="font-semibold">Conditions</h3>
                    <p className="mt-1 text-slate-600">{invoice.terms}</p>
                  </>
                ) : null}
                {invoice.notes ? (
                  <>
                    <h3 className="mt-4 font-semibold">Notes</h3>
                    <p className="mt-1 text-slate-600">{invoice.notes}</p>
                  </>
                ) : null}
              </section>
            ) : null}
          </div>
        )}

        {invoice ? (
          <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:justify-end">
            {invoice.status === 'DRAFT' ? (
              <button
                className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => onEdit(invoice)}
                type="button"
              >
                Modifier
              </button>
            ) : null}
            {invoice.status === 'DRAFT' ? (
              <button
                className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isStatusPending}
                onClick={() => onStatusChange(invoice, 'SENT')}
                type="button"
              >
                Envoyer
              </button>
            ) : null}
            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' ? (
              <button
                className="h-9 rounded-md border border-rose-200 px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isStatusPending}
                onClick={() => onStatusChange(invoice, 'CANCELLED')}
                type="button"
              >
                Annuler
              </button>
            ) : null}
            {canSignInvoice ? (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSignPending}
                onClick={() => onSign(invoice)}
                type="button"
              >
                <Stamp className="h-4 w-4" />
                {isSignPending ? 'Signature...' : 'Signer et tamponner'}
              </button>
            ) : null}
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => onDownload(invoice)}
              type="button"
            >
              <Download className="h-4 w-4" />
              {invoice.isSigned ? 'Telecharger la facture signee' : 'PDF'}
            </button>
            {invoice.isSigned ? (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => onPrint(invoice)}
                type="button"
              >
                <Printer className="h-4 w-4" />
                Imprimer la facture signee
              </button>
            ) : null}
            {invoice.status !== 'CANCELLED' ? (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isEmailPending}
                onClick={() => onEmail(invoice)}
                type="button"
              >
                <Mail className="h-4 w-4" />
                {isEmailPending ? 'Envoi...' : 'Email'}
              </button>
            ) : null}
            {canCollect ? (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
                onClick={() => onPrepareReminder(invoice)}
                type="button"
              >
                <Mail className="h-4 w-4" />
                Relancer
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function DetailMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className={`rounded-lg p-4 ${tone === 'danger' ? 'bg-rose-50' : 'bg-slate-50'}`}>
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === 'danger' ? 'text-rose-700' : 'text-slate-950'}`}>
        {value}
      </p>
    </div>
  );
}

function formatDueDate(invoice: InvoiceSummary) {
  if (invoice.status === 'PAID') return 'Reglee';
  if (invoice.status === 'CANCELLED') return 'Annulee';

  const days = getDaysUntilDue(invoice.dueDate);
  if (days < 0) return `${Math.abs(days)} j de retard`;
  if (days === 0) return "Aujourd'hui";
  return `Dans ${days} j`;
}

function formatRevenueDelta(current: number, previous: number) {
  if (previous === 0 && current > 0) return 'Nouveau revenu';
  if (previous === 0) return 'Stable';

  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return 'Stable';

  return `${percent > 0 ? '+' : ''}${percent}%`;
}

function mapInvoiceToSummary(invoice: Invoice): InvoiceSummary {
  return {
    id: invoice.id,
    number: invoice.invoiceNumber,
    customer: invoice.customer?.company ?? invoice.customer?.name ?? 'Client',
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: Number(invoice.total),
    paid: Number(invoice.amountPaid),
  };
}

function mapDashboardCustomerExposure(stats?: DashboardStats): CustomerExposure[] {
  if (!stats?.unpaidByCustomer?.length) return [];

  return stats.unpaidByCustomer.map((item) => ({
    name: 'Solde client',
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

function filterReminders(
  reminders: Reminder[],
  searchTerm: string,
  typeFilter: ReminderType | 'ALL'
) {
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
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  );
  const taxAmount = items.reduce((sum, item) => {
    const lineSubtotal = Number(item.quantity) * Number(item.unitPrice);
    return sum + lineSubtotal * (Number(item.taxRate) / 100);
  }, 0);
  const total = Math.max(0, subtotal + taxAmount - Number(discount));

  return { subtotal, taxAmount, total };
}

function getAutomaticVatRate(customer?: Customer, settings?: CompanySettings) {
  const countryCode = normalizeCountryCode(customer?.countryCode ?? '');
  if (!settings?.vatEnabled) return 0;
  if (countryCode === 'MA') return Number(settings.moroccoVatRate ?? settings.defaultTaxRate ?? 20);
  return 0;
}

function normalizeCountryCode(countryCode: string) {
  const normalized = countryCode.trim().toUpperCase();
  return normalized === 'UK' ? 'GB' : normalized;
}

function getCountryLabel(countryCode: string) {
  const normalized = normalizeCountryCode(countryCode);
  return COUNTRY_OPTIONS.find((country) => country.code === normalized)?.label ?? normalized;
}

function getCountryName(countryCode: string) {
  const normalized = normalizeCountryCode(countryCode);
  return COUNTRY_OPTIONS.find((country) => country.code === normalized)?.name ?? normalized;
}

function buildCountryOptions() {
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
  } catch {
    codes = fallbackCodes;
  }
  const displayNames = new Intl.DisplayNames(['fr'], { type: 'region' });

  return Array.from(new Set(codes.map(normalizeCountryCode)))
    .map((code) => ({
      code,
      name: displayNames.of(code) ?? code,
      label: `${displayNames.of(code) ?? code} (${code})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

const COUNTRY_OPTIONS = buildCountryOptions();

function formatCustomerName(customer: Customer) {
  return customer.company ? `${customer.company} - ${customer.name}` : customer.name;
}

function getSearchPlaceholder(view: ViewKey) {
  if (view === 'clients') return 'Rechercher un client';
  if (view === 'payments') return 'Rechercher un paiement';
  if (view === 'reports') return 'Rechercher un rapport';
  if (view === 'reminders') return 'Rechercher une relance';
  if (view === 'products') return 'Rechercher une prestation';
  if (view === 'users') return 'Rechercher un utilisateur';
  return 'Rechercher une facture';
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
  if (!context) throw new Error('Canvas export failed');

  context.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.globalAlpha = cleanOpacity;
  context.drawImage(canvas, 0, 0);

  return canvasToPngBlob(exportCanvas);
}

function resizeCanvas(canvas: HTMLCanvasElement | null, width: number, height: number) {
  if (!canvas) return;

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
  if (!context) return;

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(copy, -copy.width / 2, -copy.height / 2);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getHttpStatus(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response
  ) {
    return Number(error.response.status);
  }

  return undefined;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'message' in error.response.data &&
    typeof error.response.data.message === 'string'
  ) {
    return error.response.data.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
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
  if (!date) return false;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed <= new Date(`${getToday()}T23:59:59`);
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat('fr-MA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

function downloadCsv(fileName: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;

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
