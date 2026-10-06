# Security model

## Roles

| Capability | OWNER | MANAGER | CASHIER | KITCHEN |
|---|:-:|:-:|:-:|:-:|
| Sell, view orders, cash drawer, customers | ✓ | ✓ | ✓ | |
| Record waste | ✓ | ✓ | ✓ | |
| Products, categories, ingredients, recipes, costs | ✓ | ✓ | | |
| Stock adjustments & counts, production, purchasing | ✓ | ✓ | | |
| Cancel / refund orders, promotions, expenses, reports | ✓ | ✓ | | |
| Void expenses, employees, settings, audit log | ✓ | | | |

The UI uses `src/domain/permissions.ts`; the database enforces the same rules independently.

## Enforcement in PostgreSQL

* **RLS on every table.** Non-employees (even authenticated) see nothing.
* **No direct write policies** on orders, payments, refunds, inventory/cash/points ledgers,
  production, purchasing, expenses or audit logs — they change only via `SECURITY DEFINER`
  RPCs that check the caller's role (`require_role`) and validate input.
* **Column privileges**: `ingredients.stock_qty` / `avg_cost` and `customers.points_balance`
  are not updatable by API roles at all; products carry no editable cost column (costs come
  from recipes + ledger), so cashiers cannot change product cost, recipes or ingredient costs.
* **Append-only ledgers**: `inventory_transactions`, `cash_transactions`, `customer_points`,
  `audit_logs` reject UPDATE/DELETE for every role (including the owner).
* Supabase's default `GRANT ALL` to `anon`/`authenticated` is revoked in the first migration.
* Internal helpers (`post_inventory`, `price_order`, `post_points`, …) are not executable by API roles.
* A deferred trigger guarantees at least one active OWNER.

## Audit

A generic trigger logs INSERT/UPDATE/DELETE (old/new JSON, user, time) on master data, and
every business RPC writes an explicit event (CREATE_ORDER, CANCEL_ORDER, REFUND_ORDER,
SAVE_RECIPE, ADJUST_STOCK, STOCK_COUNT, RECORD_WASTE, COMPLETE_PRODUCTION, RECEIVE_PURCHASE,
CASH_DEPOSIT/WITHDRAWAL, ADJUST_POINTS…).

## Secrets

* `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/admin.ts` (server-only) for
  creating staff accounts and password resets, after the caller is verified as OWNER.
* The browser only ever receives the anon key; all data access is RLS-scoped to the session.

## Input validation

Every Server Action validates with zod before touching the database; the database re-checks
(CHECK constraints, RPC validation). CSV exports neutralise spreadsheet formula injection.
