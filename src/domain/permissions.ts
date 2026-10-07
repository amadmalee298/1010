import type { AppRole } from '@/lib/database.types';

/**
 * Role → capability matrix for the UI. The database (RLS + RPC checks) enforces the
 * same rules independently; keep both in sync (see docs/SECURITY.md).
 */
export const ALL_ROLES: readonly AppRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'];
export const FRONT_OF_HOUSE: readonly AppRole[] = ['OWNER', 'MANAGER', 'CASHIER'];
export const MANAGEMENT: readonly AppRole[] = ['OWNER', 'MANAGER'];
export const OWNER_ONLY: readonly AppRole[] = ['OWNER'];

export const CAPABILITIES = {
  sell: FRONT_OF_HOUSE,
  manageCatalog: MANAGEMENT,
  manageRecipes: MANAGEMENT,
  manageIngredientCosts: MANAGEMENT,
  adjustInventory: MANAGEMENT,
  recordWaste: FRONT_OF_HOUSE,
  produce: MANAGEMENT,
  purchase: MANAGEMENT,
  manageCustomers: FRONT_OF_HOUSE,
  managePromotions: MANAGEMENT,
  recordExpense: MANAGEMENT,
  operateCashDrawer: FRONT_OF_HOUSE,
  refund: MANAGEMENT,
  cancelOrder: MANAGEMENT,
  viewReports: MANAGEMENT,
  approveBills: MANAGEMENT,
  postJournals: OWNER_ONLY,
  linkTelegram: FRONT_OF_HOUSE,
  manageEmployees: OWNER_ONLY,
  manageSettings: OWNER_ONLY,
  viewAudit: OWNER_ONLY,
} as const satisfies Record<string, readonly AppRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  return !!role && (CAPABILITIES[capability] as readonly AppRole[]).includes(role);
}

/** Landing page after sign-in. KITCHEN has no screen since the kitchen display was removed. */
export function homePathFor(role: AppRole): string {
  if (role === 'KITCHEN') return '/forbidden';
  if (role === 'CASHIER') return '/pos';
  return '/dashboard';
}
