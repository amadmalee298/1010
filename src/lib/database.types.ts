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
  is_active: boolean; created_at: Timestamp; updated_at: Timestamp; legal_name: string | null;
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
  completed_at: Timestamp; cancelled_at: Timestamp | null; client_ref: Uuid | null; payment_summary: Json;
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
  voided_at: Timestamp | null; void_reason: string | null;
};
export type BillStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type BillSubmissionRow = {
  id: Uuid; submission_number: string; source: 'TELEGRAM' | 'APP'; telegram_update_id: number | null;
  telegram_chat_id: number | null; submitted_by: Uuid | null; submitter_name: string; has_receipt: boolean;
  photo_path: string | null; photo_url: string | null; message_text: string | null; extraction: Json | null;
  extraction_error: string | null; vendor: string | null; bill_date: string | null; total: number | null;
  status: BillStatus; reviewed_by: Uuid | null; reviewed_at: Timestamp | null; review_note: string | null;
  approved_lines: Json | null; expense_id: Uuid | null; substitute_number: string | null; substitute_url: string | null;
  created_at: Timestamp; updated_at: Timestamp; paid_method: PaymentMethod | null; paid_from_drawer: boolean | null;
  approver_name: string | null; payer_signature: string | null; approver_signature: string | null;
  payer_name: string | null; voided_at: Timestamp | null; void_reason: string | null; voided_by: Uuid | null;
};
export type AttachmentKind = 'SLIP' | 'EVIDENCE' | 'OTHER';
export type BillAttachmentRow = { id: Uuid; bill_id: Uuid; kind: AttachmentKind; path: string; drive_url: string | null; uploaded_by: Uuid | null; created_at: Timestamp };
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type AccountRow = { code: string; name_th: string; name_en: string; account_type: AccountType; is_cash: boolean; cash_flow: 'OPERATING' | 'INVESTING' | 'FINANCING'; sort_order: number };
export type JournalEntryRow = { id: Uuid; entry_number: string; entry_date: string; memo: string; is_opening: boolean; reverses: Uuid | null; created_by: Uuid | null; created_at: Timestamp };
export type JournalLineRow = { id: Uuid; entry_id: Uuid; account_code: string; debit: number; credit: number; note: string | null };
export type TrialBalanceRow = { account_code: string; name_th: string; name_en: string; account_type: AccountType; debit: number; credit: number; balance: number };
export type TelegramAccountRow = {
  id: Uuid; telegram_user_id: number; employee_id: Uuid; chat_id: number; username: string | null; linked_at: Timestamp;
};
export type AuditLogRow = {
  id: Uuid; user_id: Uuid | null; action: string; entity: string; entity_id: Uuid | null;
  old_value: Json | null; new_value: Json | null; created_at: Timestamp;
};

export type RecipeItemCostRow = {
  id: Uuid; recipe_id: Uuid; ingredient_id: Uuid; ingredient_name: string; unit: string; quantity: number;
  unit_cost: number; line_cost: number;
};
export type RecipeCostRow = {
  recipe_id: Uuid; product_id: Uuid; product_name: string; name: string; version: number; is_active: boolean;
  yield_quantity: number; yield_unit: string; units_per_sale: number; price: number; net_price: number;
  ingredient_count: number; recipe_cost: number; cost_per_yield: number; cost_per_selling_unit: number;
  gross_profit: number; gross_margin: number | null;
};
export type ProductCostRow = {
  product_id: Uuid; name_th: string; category_id: Uuid | null; price: number; inventory_mode: InventoryMode;
  is_active: boolean; net_price: number; unit_cost: number | null; recipe_id: Uuid | null;
  finished_item_id: Uuid | null; finished_stock: number | null;
};

export type StockLevelRow = {
  id: Uuid; name_th: string; name_en: string | null; sku: string | null; unit: string; item_type: ItemType;
  category_id: Uuid | null; product_id: Uuid | null; stock_qty: number; avg_cost: number; reorder_level: number;
  is_active: boolean; stock_value: number; is_low: boolean;
};
export type InventoryReconciliationRow = {
  ingredient_id: Uuid; name_th: string; unit: string; stock_qty: number; ledger_qty: number; difference: number;
};
export type KitchenQueueRow = {
  id: Uuid; order_number: string; queue_number: number; order_type: OrderType; table_label: string | null;
  kitchen_status: KitchenStatus; note: string | null; created_at: Timestamp;
  items: { name: string; quantity: number; note: string | null }[];
};

export type CashSessionSummaryRow = {
  id: Uuid; status: CashSessionStatus; opened_at: Timestamp; closed_at: Timestamp | null; opening_cash: number;
  actual_cash: number | null; variance: number | null; opened_by: Uuid; closed_by: Uuid | null; note: string | null;
  cash_sales: number; cash_refunds: number; cash_expenses: number; withdrawals: number; deposits: number;
  expected_cash: number; total_sales: number; order_count: number; opened_by_name: string | null; closed_by_name: string | null;
};
export type ProductionRequirementRow = {
  ingredient_id: Uuid; name_th: string; unit: string; required_quantity: number; stock_qty: number; shortage: number; unit_cost: number;
};

export type ProductReportRow = {
  product_id: Uuid | null; product_name: string; category_name: string | null; quantity: number; net_sales: number;
  cogs: number; gross_profit: number; gross_margin: number | null; share_of_sales: number | null;
};
export type InventoryReportRow = {
  ingredient_id: Uuid; name_th: string; unit: string; item_type: ItemType; purchased: number; produced: number; sold: number;
  consumed_in_production: number; wasted: number; adjusted: number; returned: number; stock_qty: number; stock_value: number;
};
export type PurchaseReportRow = { supplier_id: Uuid; supplier_name: string; orders: number; received_value: number };
export type ProductionReportRow = {
  product_id: Uuid; product_name: string; runs: number; planned_output: number; actual_output: number; total_cost: number;
  avg_unit_cost: number | null; yield_rate: number | null;
};
export type ExpenseReportRow = { category: string; entries: number; amount: number };
export type EmployeeSalesRow = { user_id: Uuid | null; employee_name: string; orders: number; net_sales: number; avg_ticket: number; refunds: number };

type View<R> = { Row: R; Relationships: [] };

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
      bill_submissions: Table<BillSubmissionRow, 'submission_number' | 'source' | 'submitter_name' | 'has_receipt'>;
      telegram_accounts: Table<TelegramAccountRow, 'telegram_user_id' | 'employee_id' | 'chat_id'>;
      accounts: Table<AccountRow, 'code' | 'name_th' | 'name_en' | 'account_type'>;
      journal_entries: Table<JournalEntryRow, 'entry_number' | 'entry_date' | 'memo'>;
      journal_lines: Table<JournalLineRow, 'entry_id' | 'account_code'>;
      bill_attachments: Table<BillAttachmentRow, 'bill_id' | 'kind' | 'path'>;
      employee_signatures: Table<{ employee_id: Uuid; image: string; updated_at: Timestamp }, 'employee_id' | 'image'>;
    };
    Views: {
      recipe_item_costs: View<RecipeItemCostRow>;
      recipe_costs: View<RecipeCostRow>;
      product_costs: View<ProductCostRow>;
      stock_levels: View<StockLevelRow>;
      inventory_reconciliation: View<InventoryReconciliationRow>;
      kitchen_queue: View<KitchenQueueRow>;
      product_availability: View<{ product_id: Uuid; available: number | null }>;
      cash_session_summary: View<CashSessionSummaryRow>;
      employee_directory: View<{ id: Uuid; user_id: Uuid | null; display_name: string; phone: string | null; is_active: boolean; created_at: Timestamp; role: AppRole; email: string | null; legal_name: string | null }>;
    };
    Functions: {
      current_app_role: Fn<Record<string, never>, AppRole | null>;
      has_role: Fn<{ allowed: AppRole[] }, boolean>;
      is_staff: Fn<Record<string, never>, boolean>;
      claim_first_owner: Fn<{ p_display_name?: string }, string>;
      save_recipe: Fn<{
        p_product_id: string; p_name: string; p_yield_quantity: number; p_yield_unit: string;
        p_units_per_sale: number; p_items: Json; p_note?: string | null;
      }, string>;
      net_of_vat: Fn<{ p_amount: number }, number>;
      adjust_stock: Fn<{ p_ingredient_id: string; p_delta: number; p_unit_cost?: number | null; p_note?: string | null }, InventoryTransactionRow>;
      record_stock_count: Fn<{ p_ingredient_id: string; p_counted: number; p_note?: string | null }, InventoryTransactionRow | null>;
      record_waste: Fn<{ p_ingredient_id: string; p_quantity: number; p_reason: string }, WasteRow>;
      check_inventory_integrity: Fn<Record<string, never>, InventoryReconciliationRow[]>;
      current_cash_session_id: Fn<Record<string, never>, string | null>;
      quote_order: Fn<{ p_payload: Json }, Json>;
      create_order: Fn<{ p_payload: Json }, Json>;
      get_order: Fn<{ p_order_id: string }, Json>;
      cancel_order: Fn<{ p_order_id: string; p_reason: string }, Json>;
      refund_order: Fn<{ p_order_id: string; p_items: Json; p_reason: string; p_method: PaymentMethod; p_restock?: boolean }, Json>;
      set_kitchen_status: Fn<{ p_order_id: string; p_status: KitchenStatus }, undefined>;
      create_production: Fn<{ p_product_id: string; p_batches: number; p_note?: string | null }, string>;
      production_requirements: Fn<{ p_production_id: string }, ProductionRequirementRow[]>;
      complete_production: Fn<{ p_production_id: string; p_actual_output?: number | null }, ProductionRow>;
      cancel_production: Fn<{ p_production_id: string }, undefined>;
      save_purchase_order: Fn<{ p_id: string | null; p_supplier_id: string; p_items: Json; p_expected_date?: string | null; p_note?: string | null }, string>;
      set_purchase_order_status: Fn<{ p_id: string; p_status: PurchaseStatus }, undefined>;
      receive_purchase_order: Fn<{ p_id: string; p_items: Json; p_paid_from_drawer?: boolean }, PurchaseOrderRow>;
      open_cash_session: Fn<{ p_opening_cash: number; p_note?: string | null }, CashSessionRow>;
      cash_movement: Fn<{ p_type: CashTxnType; p_amount: number; p_note: string }, CashTransactionRow>;
      close_cash_session: Fn<{ p_actual_cash: number; p_note?: string | null }, CashSessionRow>;
      record_expense: Fn<{
        p_expense_date: string | null; p_category: string; p_description: string; p_amount: number;
        p_payment_method?: PaymentMethod; p_from_drawer?: boolean; p_supplier_id?: string | null; p_receipt_path?: string | null;
      }, ExpenseRow>;
      void_expense: Fn<{ p_id: string; p_reason: string }, ExpenseRow>;
      employee_name: Fn<{ p_user_id: string }, string | null>;
      report_sales: Fn<{ p_from: string; p_to: string }, Json>;
      report_pnl: Fn<{ p_from: string; p_to: string }, Json>;
      report_products: Fn<{ p_from: string; p_to: string }, ProductReportRow[]>;
      report_inventory: Fn<{ p_from: string; p_to: string }, InventoryReportRow[]>;
      report_purchases: Fn<{ p_from: string; p_to: string }, PurchaseReportRow[]>;
      report_production: Fn<{ p_from: string; p_to: string }, ProductionReportRow[]>;
      report_expenses: Fn<{ p_from: string; p_to: string }, ExpenseReportRow[]>;
      report_cash: Fn<{ p_from: string; p_to: string }, CashSessionSummaryRow[]>;
      report_employee_sales: Fn<{ p_from: string; p_to: string }, EmployeeSalesRow[]>;
      dashboard: Fn<{ p_date?: string | null }, Json>;
      adjust_customer_points: Fn<{ p_customer_id: string; p_change: number; p_note: string }, CustomerRow>;
      create_telegram_link_code: Fn<Record<string, never>, string>;
      unlink_telegram: Fn<{ p_employee_id: string }, undefined>;
      telegram_link_account: Fn<{ p_code: string; p_telegram_user_id: number; p_chat_id: number; p_username: string | null }, string>;
      telegram_employee: Fn<{ p_telegram_user_id: number }, { employee_id: Uuid; display_name: string }[]>;
      submit_bill: Fn<{
        p_telegram_update_id: number; p_chat_id: number; p_employee_id: string; p_has_receipt: boolean;
        p_photo_path: string | null; p_message_text: string | null; p_extraction: Json | null; p_extraction_error: string | null;
        p_vendor: string | null; p_bill_date: string | null; p_total: number | null;
      }, BillSubmissionRow>;
      approve_bill: Fn<{
        p_id: string; p_bill_date: string | null; p_vendor: string | null; p_lines: Json; p_category: string;
        p_payment_method?: PaymentMethod; p_from_drawer?: boolean;
      }, BillSubmissionRow>;
      reject_bill: Fn<{ p_id: string; p_reason: string }, BillSubmissionRow>;
      telegram_staff: Fn<{ p_telegram_user_id: number }, { employee_id: Uuid; user_id: Uuid; display_name: string; role: AppRole }[]>;
      telegram_summary: Fn<{ p_telegram_user_id: number; p_from: string; p_to: string }, Json>;
      telegram_latest_bills: Fn<{ p_telegram_user_id: number; p_limit?: number }, BillSubmissionRow[]>;
      post_journal: Fn<{ p_entry_date: string; p_memo: string; p_lines: Json; p_is_opening?: boolean }, JournalEntryRow>;
      reverse_journal: Fn<{ p_id: string; p_entry_date?: string | null }, JournalEntryRow>;
      save_my_signature: Fn<{ p_image: string | null }, undefined>;
      report_trial_balance: Fn<{ p_as_of: string }, TrialBalanceRow[]>;
      report_balance_sheet: Fn<{ p_as_of: string }, Json>;
      report_gl_pnl: Fn<{ p_from: string; p_to: string }, Json>;
      report_cash_flow: Fn<{ p_from: string; p_to: string }, Json>;
      add_bill_attachment: Fn<{ p_bill_id: string; p_kind: string; p_path: string }, BillAttachmentRow>;
      telegram_add_attachment: Fn<{ p_telegram_user_id: number; p_submission_number: string; p_path: string; p_kind?: AttachmentKind }, BillAttachmentRow>;
      telegram_await_upload: Fn<{ p_telegram_user_id: number; p_submission_number: string; p_kind: AttachmentKind }, undefined>;
      telegram_take_upload: Fn<{ p_telegram_user_id: number }, { submission_number: string; kind: AttachmentKind }[]>;
      telegram_cancel_bill: Fn<{ p_telegram_user_id: number; p_submission_number: string }, BillSubmissionRow>;
      bill_card: Fn<{ p_id: string }, Json>;
      telegram_bill_card: Fn<{ p_telegram_user_id: number; p_submission_number: string }, Json>;
      set_attachment_drive_url: Fn<{ p_id: string; p_url: string | null }, undefined>;
      edit_substitute: Fn<{ p_id: string; p_bill_date: string | null; p_payer_name: string; p_approver_name: string | null; p_lines: Json }, BillSubmissionRow>;
      void_bill: Fn<{ p_id: string; p_reason: string }, BillSubmissionRow>;
      set_bill_links: Fn<{ p_id: string; p_photo_url: string | null; p_substitute_url: string | null }, undefined>;
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
      bill_status: BillStatus;
      account_type: AccountType;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
