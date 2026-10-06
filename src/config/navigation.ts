import type { Capability } from '@/domain/permissions';
import type { Dictionary } from '@/i18n';

export type NavKey = keyof Dictionary['nav'];
export type IconName =
  | 'pos' | 'orders' | 'kitchen' | 'dashboard' | 'products' | 'categories' | 'ingredients' | 'recipes' | 'inventory'
  | 'production' | 'suppliers' | 'purchasing' | 'customers' | 'promotions' | 'expenses' | 'cash' | 'reports'
  | 'employees' | 'audit' | 'settings';

export interface NavItem { href: string; label: NavKey; icon: IconName; capability: Capability }
export interface NavGroup { label: NavKey; items: NavItem[] }

/** Single source of truth for the app navigation; each entry is gated by a capability. */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'groupSales',
    items: [
      { href: '/pos', label: 'pos', icon: 'pos', capability: 'sell' },
      { href: '/orders', label: 'orders', icon: 'orders', capability: 'sell' },
      { href: '/kitchen', label: 'kitchen', icon: 'kitchen', capability: 'viewKitchen' },
      { href: '/cash', label: 'cash', icon: 'cash', capability: 'operateCashDrawer' },
      { href: '/customers', label: 'customers', icon: 'customers', capability: 'manageCustomers' },
      { href: '/promotions', label: 'promotions', icon: 'promotions', capability: 'managePromotions' },
    ],
  },
  {
    label: 'groupStock',
    items: [
      { href: '/products', label: 'products', icon: 'products', capability: 'manageCatalog' },
      { href: '/categories', label: 'categories', icon: 'categories', capability: 'manageCatalog' },
      { href: '/ingredients', label: 'ingredients', icon: 'ingredients', capability: 'manageCatalog' },
      { href: '/recipes', label: 'recipes', icon: 'recipes', capability: 'manageRecipes' },
      { href: '/inventory', label: 'inventory', icon: 'inventory', capability: 'recordWaste' },
      { href: '/production', label: 'production', icon: 'production', capability: 'produce' },
      { href: '/suppliers', label: 'suppliers', icon: 'suppliers', capability: 'purchase' },
      { href: '/purchasing', label: 'purchasing', icon: 'purchasing', capability: 'purchase' },
    ],
  },
  {
    label: 'groupFinance',
    items: [
      { href: '/dashboard', label: 'dashboard', icon: 'dashboard', capability: 'viewReports' },
      { href: '/reports', label: 'reports', icon: 'reports', capability: 'viewReports' },
      { href: '/expenses', label: 'expenses', icon: 'expenses', capability: 'recordExpense' },
    ],
  },
  {
    label: 'groupAdmin',
    items: [
      { href: '/employees', label: 'employees', icon: 'employees', capability: 'manageEmployees' },
      { href: '/audit', label: 'audit', icon: 'audit', capability: 'viewAudit' },
      { href: '/settings', label: 'settings', icon: 'settings', capability: 'manageSettings' },
    ],
  },
];
