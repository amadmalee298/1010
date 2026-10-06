# Custard POS — Architecture

## Layers

```
src/app/**            Next.js App Router pages (server components) + route handlers
src/components/**     UI (client components). shadcn-style primitives in components/ui
src/hooks/**          Client hooks (useAction, useOrderSync)
src/server/actions    Server Actions: zod validation → role check → repository call → revalidate
src/server/repositories  The ONLY place that talks to Supabase (tables, views, RPCs)
src/domain/**         Pure TypeScript business logic (no I/O): pricing, costing, payments,
                      cart, PromptPay, CSV, permissions, zod schemas. Fully unit-tested.
supabase/migrations   PostgreSQL schema, RLS, triggers and business RPCs (source of truth)
```

**Rule of thumb:** UI never computes money or stock that gets saved. It may *preview*
(e.g. `domain/pricing.ts` for instant cart totals), but every write goes through a
PostgreSQL function that recomputes and validates everything in one transaction.
Parity tests (`test/db/phase5-6-pricing-parity.test.ts`, `phase2-3-catalog.test.ts`)
assert the TypeScript previews and SQL agree.

## Core flow: completing an order (`create_order`)

One database transaction:

1. Authorise (OWNER/MANAGER/CASHIER) and require an open cash session
2. Idempotency check on `client_ref` (offline retries return the existing order)
3. `price_order`: re-price from `products.price`, validate promotion window/min/members,
   cashier manual-discount limit, points redemption, VAT
4. Payments must sum exactly to the total (mixed payments allowed); cash change computed
5. Daily queue number under an advisory lock
6. For each item: `product_usage` (active recipe → per-unit ingredient quantities, or
   finished-good units) → `SALE` rows in `inventory_transactions` → the ledger trigger
   updates `stock_qty`, blocks negative stock, values the movement at weighted average cost
7. Item and order COGS from the ledger rows' unit costs
8. Payments, drawer cash transaction, loyalty points ledger, customer totals
9. Audit log entry

If any step fails, nothing is written.

## Inventory model

* `ingredients` holds raw materials **and** finished goods (`item_type`), so sales,
  production and purchases share one ledger.
* `inventory_transactions` is append-only (UPDATE/DELETE raise). Its BEFORE INSERT
  trigger is the only code that changes `stock_qty` / `avg_cost`; API roles have no
  column privilege on those columns.
* Costing: weighted average cost. Outbound movements always use the current average
  (callers cannot pass a cost); inbound PURCHASE/PRODUCTION/RETURN update the average.
* `inventory_reconciliation` / `check_inventory_integrity()` prove stock = Σ ledger.

## Products & recipes

* `inventory_mode`: `RECIPE` (deduct ingredients at sale), `FINISHED_GOOD` (deduct produced
  stock; a hidden finished-goods item is created automatically) or `NONE`.
* One active recipe per product (partial unique index). `save_recipe` versions: the old
  version is deactivated, never edited, so production history stays accurate.
* Recipe quantities are per batch; `yield_quantity` = units per batch; `units_per_sale`
  = yield units in one sold item (e.g. a box of 4).

## Production

`create_production` snapshots the active recipe and required quantities. `complete_production`
locks all ingredient rows, reports **all** shortages at once, then posts raw-material
`PRODUCTION` outflows and a finished-goods inflow valued at actual batch cost ÷ actual output.

## Cash

Single register: one OPEN `cash_sessions` row at a time. Every drawer movement (opening
float, cash sales, cash refunds, cash expenses, purchase payments, deposits/withdrawals) is
an append-only `cash_transactions` row; expected cash = Σ amounts; variance = counted − expected.

## Offline-friendly POS

* Menu and cart are cached on the device; totals preview offline.
* Orders placed offline (or when the network drops mid-request) are queued in localStorage
  with their `client_ref`; `useOrderSync` flushes them when online. The server is idempotent
  on `client_ref`, so retries are safe. Rejected orders (e.g. out of stock) stay queued as
  FAILED for review — never silently dropped.
* The service worker caches static assets and pages but never API/Server Action calls.

## Assumptions (documented decisions)

| Topic | Decision |
|---|---|
| Registers | One cash drawer per shop (one open session). Multi-register = add `register_id`. |
| Costing | Weighted average cost; no FIFO lots/expiry tracking. |
| Purchases | Inventory, not expenses. They reach P&L as COGS when consumed. |
| Refunds | Manager-only, per item; optional restock. Without restock the goods are treated as consumed (COGS stays). |
| Cancel vs refund | Cancel = full reversal of an unrefunded order (stock, cash, points). |
| Cashier discounts | Up to `max_cashier_discount` THB; larger discounts need a manager to ring the sale. |
| Users table | `auth.users` is mirrored to `public.users`; `employees` holds role + display name. |
| Timezone | Stored UTC; business date = Asia/Bangkok calendar date. |
| Money | `numeric(12,2)` in the DB; TypeScript rounds half away from zero like PostgreSQL. |
