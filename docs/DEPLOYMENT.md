# Deployment (Supabase + Vercel)

## 1. Supabase project

1. Create a project (region: Singapore `ap-southeast-1` is closest to Thailand).
2. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push` —
   or, without a computer, the **Database migrations** GitHub Actions workflow (see the iPhone section below).
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

## Setting up from an iPhone only (no computer) — ติดตั้งด้วย iPhone อย่างเดียว

ทุกขั้นทำใน Safari บน iPhone ได้ ขั้นที่ 2 (ติดตั้งฐานข้อมูล) ใช้ GitHub Actions รันแทนคอมพิวเตอร์

1. **Merge PR เข้า `main` ก่อน** — ปุ่ม "Run workflow" จะแสดงเฉพาะ workflow ที่อยู่ใน branch หลัก
2. **สร้าง Access Token ของ Supabase:** supabase.com/dashboard/account/tokens → Generate new token → คัดลอกเก็บไว้
3. **ใส่ Secrets ใน GitHub:** repo → Settings → Secrets and variables → Actions → New repository secret ใส่ 3 ตัว:
   * `SUPABASE_ACCESS_TOKEN` — token จากข้อ 2
   * `SUPABASE_PROJECT_REF` — รหัสโปรเจกต์ใน URL `supabase.com/dashboard/project/<ref>`
   * `SUPABASE_DB_PASSWORD` — รหัสผ่านฐานข้อมูลที่ตั้งตอนสร้างโปรเจกต์
   (ในเว็บ GitHub บน iPhone ถ้าไม่เห็นเมนู Settings ให้กด "aA" ในแถบที่อยู่ → ขอเว็บไซต์เดสก์ท็อป)
4. **ทดลองรันก่อน:** Actions → **Database migrations** → Run workflow → ปล่อยติ๊ก *Preview only* ไว้ → Run
   ดูผลว่าจะติดตั้ง 8 migration และไม่มี error
5. **รันจริง:** Run workflow อีกครั้ง → **เอาติ๊ก Preview only ออก** → Run ขั้น "Apply migrations" ต้องเป็นเครื่องหมายถูกสีเขียว
6. ตรวจใน Supabase → Table Editor ต้องเห็นตาราง เช่น `products`, `orders`, `inventory_transactions`

ครั้งต่อไปที่มี migration ใหม่ ให้ทำข้อ 4–5 ซ้ำ ระบบจะติดตั้งเฉพาะไฟล์ที่ยังไม่เคยรัน

**ทางเลือกสำรอง (ไม่ใช้ GitHub Actions):** Supabase → SQL Editor → New query แล้ววาง SQL ทีละไฟล์จาก
`supabase/migrations` **เรียงตามชื่อไฟล์** (000100 → 000800) กด Run ทีละไฟล์ (เปิดไฟล์ใน GitHub → ปุ่ม Raw → เลือกทั้งหมด → คัดลอก)
วิธีนี้ CLI จะไม่รู้ว่ารันไปแล้ว ถ้าใช้วิธีนี้ให้ใช้วิธีเดียวกันตลอด อย่าสลับกับ workflow

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
