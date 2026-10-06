# Deployment (Supabase + Vercel)

## 1. Supabase project

1. Create a project (region: Singapore `ap-southeast-1` is closest to Thailand).
2. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Auth → Providers → Email: enable email/password; disable public sign-ups
   (staff accounts are created by the owner from the Employees page).
4. Database → Replication: the migration adds `orders` to `supabase_realtime` (kitchen display).

## 2. Vercel

1. Import the repository; framework preset **Next.js**.
2. Environment variables (Production + Preview):
   * `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   * `SUPABASE_SERVICE_ROLE_KEY` (server only — needed for creating staff logins)
3. Deploy. Add the Vercel domain to Supabase Auth → URL Configuration → Site URL.

## 3. First run

1. In Supabase Auth → Users, create the owner's email/password account.
2. Sign in to the app with it: the first account to sign in while no employees exist becomes
   **OWNER** automatically (`claim_first_owner`). After that this path is closed.
3. Settings: shop name/address/tax ID, VAT, PromptPay ID, loyalty rules.
4. Employees: create manager, cashier and kitchen accounts.
5. Catalog: categories → ingredients → products → recipes → opening stock
   (Inventory → Adjust, with unit cost).

## 4. Devices

* iPad / iPhone: open the site in Safari → Share → **Add to Home Screen**.
* Desktop Chrome/Edge: install icon in the address bar.
* Receipt printer: 80 mm thermal printer set as the default printer; the receipt uses `@page 80mm`.

## Local development

```bash
cp .env.example .env.local          # fill from `npx supabase status`
npx supabase start                  # local Supabase (Docker)
npm run seed:demo                   # demo shop + staff logins (password: custard1234)
npm run dev
```

## Tests

```bash
npm run db:test-server              # disposable PostgreSQL on :54329 (no Docker needed)
TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres?host=/tmp npm test
```

## Backups

Supabase Pro includes daily backups / PITR. For the free tier schedule `supabase db dump`.
