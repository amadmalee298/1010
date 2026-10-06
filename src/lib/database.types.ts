/**
 * Database types for supabase-js.
 *
 * Mirrors supabase/migrations exactly. When you have a linked Supabase project you
 * can regenerate with:  npx supabase gen types typescript --linked > src/lib/database.types.ts
 * (keep the exported aliases at the bottom of this file).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';
export type ItemType = 'RAW' | 'FINISHED';
export type InventoryMode = 'RECIPE' | 'FINISHED_GOOD' | 'NONE';
export type InventoryTxnType = 'PURCHASE' | 'SALE' | 'PRODUCTION' | 'WASTE' | 'ADJUSTMENT' | 'RETURN';
export type OrderStatus = 'COMPLETED' | 'CANCELLED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type KitchenStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';
export type PaymentMethod = 'CASH' | 'QR' | 'TRANSFER' | 'CARD';
export type DiscountType = 'PERCENT' | 'FIXED';
export type ProductionStatus = 'PLANNED' | 'COMPLETED' | 'CANCELLED';
export type PurchaseStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
export type CashSessionStatus = 'OPEN' | 'CLOSED';
export type CashTxnType = 'OPENING' | 'SALE' | 'REFUND' | 'EXPENSE' | 'WITHDRAWAL' | 'DEPOSIT';
export type PointsReason = 'EARN' | 'REDEEM' | 'ADJUST' | 'REVERSAL';

type Timestamp = string;
type Uuid = string;

/** Table definition helper: R = row, K = keys required on insert. */
type Table<R, K extends keyof R = never> = {
  Row: R;
  Insert: Pick<R, K> & Partial<Omit<R, K>>;
  Update: Partial<R>;
  Relationships: [];
};

export type RoleRow = { id: Uuid; code: AppRole; name_th: string; name_en: string; created_at: Timestamp };
export type UserRow = { id: Uuid; email: string | null; created_at: Timestamp };
export type EmployeeRow = {
  id: Uuid; user_id: Uuid | null; role_id: Uuid; display_name: string; phone: string | null;
  is_active: boolean; created_at: Timestamp; updated_at: Timestamp;
};
export type SettingRow = { id: Uuid; key: string; value: Json; updated_at: Timestamp };
export type CategoryRow = {
  id: Uuid; name_th: string; name_en: string | null; sort_order: number; is_active: boolean;
  created_at: Timestamp; updated_at: Timestamp;
};
export type ProductRow = {
  id: Uuid; category_id: Uuid | null; sku: string | null; name_th: string; name_en: string | null;
  description: string | null; price: number; image_path: string | null; inventory_mode: InventoryMode;
  sort_order: number; is_active: boolean; created_at: Timestamp; updated_at: Timestamp;
};
export type IngredientCategoryRow = { id: Uuid; name_th: string; name_en: string | null; created_at: Timestamp };
export type IngredientRow = {
  id: Uuid; category_id: Uuid | null; sku: string | null; name_th: string; name_en: string | null; unit: string;
  item_type: ItemType; product_id: Uuid | null; stock_qty: number; avg_cost: number; reorder_level: number;
  allow_negative: boolean; is_active: boolean; created_at: Timestamp; updated_at: Timestamp;
};
export type RecipeRow = {
  id: Uuid; product_id: Uuid; name: string; version: number; yield_quantity: number; yield_unit: string;
  units_per_sale: number; is_active: boolean; note: string | null; created_at: Timestamp; updated_at: Timestamp;
};
export type RecipeItemRow = { id: Uuid; recipe_id: Uuid; ingredient_id: Uuid; quantity: number; note: string | null };
export type SupplierRow = {
  id: Uuid; name: string; contact_name: string | null; phone: string | null; email: string | null;
  tax_id: string | null; address: string | null; note: string | null; is_active: boolean;
  created_at: Timestamp; updated_at: Timestamp;
};
export type PurchaseOrderRow = {
  id: Uuid; po_number: string; supplier_id: Uuid; status: PurchaseStatus; order_date: string;
  expected_date: string | null; received_at: Timestamp | null; subtotal: number; note: string | null;
  created_by: Uuid | null; created_at: Timestamp; updated_at: Timestamp;
};
export type PurchaseItemRow = {
  id: Uuid; purchase_order_id: Uuid; ingredient_id: Uuid; quantity: number; unit_cost: number;
  received_quantity: number; line_total: number;
};
export type InventoryTransactionRow = {
  id: Uuid; ingredient_id: Uuid; transaction_type: InventoryTxnType; quantity: number; unit_cost: number;
  total_cost: number; balance_after: number | null; reference_type: string | null; reference_id: Uuid | null;
  note: string | null; user_id: Uuid | null; created_at: Timestamp;
};
export type WasteRow = {
  id: Uuid; ingredient_id: Uuid; quantity: number; unit_cost: number; total_cost: number; reason: string;
  inventory_transaction_id: Uuid | null; created_by: Uuid | null; created_at: Timestamp;
};
export type ProductionRow = {
  id: Uuid; production_number: string; recipe_id: Uuid; product_id: Uuid; finished_item_id: Uuid;
  batches: number; yield_per_batch: number; planned_output: number; actual_output: number | null;
  status: ProductionStatus; total_cost: number | null; unit_cost: number | null; note: string | null;
  created_by: Uuid | null; completed_by: Uuid | null; created_at: Timestamp; completed_at: Timestamp | null;
};
export type ProductionItemRow = {
  id: Uuid; production_id: Uuid; ingredient_id: Uuid; required_quantity: number;
  unit_cost: number | null; total_cost: number | null;
};
export type CustomerRow = {
  id: Uuid; phone: string | null; name: string; email: string | null; birthday: string | null;
  points_balance: number; total_spent: number; visit_count: number; note: string | null;
  created_at: Timestamp; updated_at: Timestamp;
};
export type PromotionRow = {
  id: Uuid; code: string | null; name: string; discount_type: DiscountType; value: number;
  min_subtotal: number; max_discount: number | null; members_only: boolean; starts_at: Timestamp | null;
  ends_at: Timestamp | null; is_active: boolean; created_at: Timestamp; updated_at: Timestamp;
};
export type CashSessionRow = {
  id: Uuid; status: CashSessionStatus; opening_cash: number; expected_cash: number | null;
  actual_cash: number | null; variance: number | null; opened_by: Uuid; closed_by: Uuid | null;
  opened_at: Timestamp; closed_at: Timestamp | null; note: string | null;
};
export type CashTransactionRow = {
  id: Uuid; cash_session_id: Uuid; transaction_type: CashTxnType; amount: number; reference_type: string | null;
  reference_id: Uuid | null; note: string | null; user_id: Uuid | null; created_at: Timestamp;
};
export type OrderRow = {
  id: Uuid; order_number: string; queue_number: number; business_date: string; status: OrderStatus;
  kitchen_status: KitchenStatus; order_type: OrderType; table_label: string | null; customer_id: Uuid | null;
  promotion_id: Uuid | null; cash_session_id: Uuid | null; subtotal: number; promotion_discount: number;
  manual_discount: number; points_redeemed: number; points_discount: number; vat_amount: number; total: number;
  refunded_total: number; cogs_total: number; points_earned: number; note: string | null;
  cancel_reason: string | null; created_by: Uuid | null; cancelled_by: Uuid | null; created_at: Timestamp;
  completed_at: Timestamp; cancelled_at: Timestamp | null;
};
export type OrderItemRow = {
  id: Uuid; order_id: Uuid; product_id: Uuid | null; product_name: string; quantity: number; unit_price: number;
  line_total: number; unit_cost: number; cogs_total: number; refunded_quantity: number; note: string | null;
};
export type PaymentRow = {
  id: Uuid; order_id: Uuid; method: PaymentMethod; amount: number; tendered: number | null;
  change_amount: number; reference: string | null; created_at: Timestamp;
};
export type RefundRow = {
  id: Uuid; refund_number: string; order_id: Uuid; amount: number; method: PaymentMethod; reason: string;
  restock: boolean; items: Json; cogs_reversed: number; cash_session_id: Uuid | null; created_by: Uuid | null;
  created_at: Timestamp;
};
export type CustomerPointsRow = {
  id: Uuid; customer_id: Uuid; change: number; balance_after: number; reason: PointsReason;
  order_id: Uuid | null; note: string | null; user_id: Uuid | null; created_at: Timestamp;
};
export type ExpenseRow = {
  id: Uuid; expense_date: string; category: string; description: string; amount: number;
  payment_method: PaymentMethod; supplier_id: Uuid | null; cash_session_id: Uuid | null;
  receipt_path: string | null; created_by: Uuid | null; created_at: Timestamp;
};
export type AuditLogRow = {
  id: Uuid; user_id: Uuid | null; action: string; entity: string; entity_id: Uuid | null;
  old_value: Json | null; new_value: Json | null; created_at: Timestamp;
};

/** Function signature helper. */
type Fn<A, R> = { Args: A; Returns: R };

export interface Database {
  public: {
    Tables: {
      roles: Table<RoleRow, 'code' | 'name_th' | 'name_en'>;
      users: Table<UserRow, 'id'>;
      employees: Table<EmployeeRow, 'role_id' | 'display_name'>;
      settings: Table<SettingRow, 'key' | 'value'>;
      categories: Table<CategoryRow, 'name_th'>;
      products: Table<ProductRow, 'name_th' | 'price'>;
      ingredient_categories: Table<IngredientCategoryRow, 'name_th'>;
      ingredients: Table<IngredientRow, 'name_th' | 'unit'>;
      recipes: Table<RecipeRow, 'product_id' | 'name' | 'yield_quantity'>;
      recipe_items: Table<RecipeItemRow, 'recipe_id' | 'ingredient_id' | 'quantity'>;
      suppliers: Table<SupplierRow, 'name'>;
      purchase_orders: Table<PurchaseOrderRow, 'po_number' | 'supplier_id'>;
      purchase_items: Table<PurchaseItemRow, 'purchase_order_id' | 'ingredient_id' | 'quantity' | 'unit_cost'>;
      inventory_transactions: Table<InventoryTransactionRow, 'ingredient_id' | 'transaction_type' | 'quantity'>;
      waste: Table<WasteRow, 'ingredient_id' | 'quantity' | 'reason'>;
      production: Table<ProductionRow, 'production_number' | 'recipe_id' | 'product_id' | 'finished_item_id' | 'batches' | 'yield_per_batch' | 'planned_output'>;
      production_items: Table<ProductionItemRow, 'production_id' | 'ingredient_id' | 'required_quantity'>;
      customers: Table<CustomerRow, 'name'>;
      promotions: Table<PromotionRow, 'name' | 'discount_type' | 'value'>;
      cash_sessions: Table<CashSessionRow, 'opening_cash' | 'opened_by'>;
      cash_transactions: Table<CashTransactionRow, 'cash_session_id' | 'transaction_type' | 'amount'>;
      orders: Table<OrderRow, 'order_number' | 'queue_number' | 'business_date' | 'subtotal' | 'total'>;
      order_items: Table<OrderItemRow, 'order_id' | 'product_name' | 'quantity' | 'unit_price' | 'line_total'>;
      payments: Table<PaymentRow, 'order_id' | 'method' | 'amount'>;
      refunds: Table<RefundRow, 'refund_number' | 'order_id' | 'amount' | 'method' | 'reason'>;
      customer_points: Table<CustomerPointsRow, 'customer_id' | 'change' | 'balance_after' | 'reason'>;
      expenses: Table<ExpenseRow, 'expense_date' | 'category' | 'description' | 'amount'>;
      audit_logs: Table<AuditLogRow, 'action' | 'entity'>;
    };
    Views: Record<string, never>;
    Functions: {
      current_app_role: Fn<Record<string, never>, AppRole | null>;
      has_role: Fn<{ allowed: AppRole[] }, boolean>;
      is_staff: Fn<Record<string, never>, boolean>;
      claim_first_owner: Fn<{ p_display_name?: string }, string>;
    };
    Enums: {
      app_role: AppRole;
      item_type: ItemType;
      inventory_mode: InventoryMode;
      inventory_txn_type: InventoryTxnType;
      order_status: OrderStatus;
      order_type: OrderType;
      kitchen_status: KitchenStatus;
      payment_method: PaymentMethod;
      discount_type: DiscountType;
      production_status: ProductionStatus;
      purchase_status: PurchaseStatus;
      cash_session_status: CashSessionStatus;
      cash_txn_type: CashTxnType;
      points_reason: PointsReason;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
