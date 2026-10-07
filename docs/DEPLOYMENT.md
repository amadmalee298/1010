# Deployment (Supabase + Vercel)

## 1. Supabase project

1. Create a project (region: Singapore `ap-southeast-1` is closest to Thailand).
2. Apply migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push` —
   or, without a computer, the **Database migrations** GitHub Actions workflow (see the iPhone section below).
3. Auth → Providers → Email: enable email/password; disable public sign-ups
   (staff accounts are created by the owner from the Employees page).
4. Database → Replication: the migration adds `orders` to `supabase_realtime`.

## 2. Vercel

1. Import the repository; framework preset **Next.js**.
2. Environment variables (Production + Preview):
   * `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   * `SUPABASE_SERVICE_ROLE_KEY` (server only — needed for creating staff logins)
3. Deploy. Add the Vercel domain to Supabase Auth → URL Configuration → Site URL.
4. Server functions run in Singapore (`sin1`, set in `vercel.json`) next to the Supabase project;
   if the Supabase project is in another region, change `regions` to match or every page pays a cross-ocean round trip per query.

## 3. First run

1. In Supabase Auth → Users, create the owner's email/password account.
2. Sign in to the app with it: the first account to sign in while no employees exist becomes
   **OWNER** automatically (`claim_first_owner`). After that this path is closed.
3. Settings: shop name/address/tax ID, VAT, PromptPay ID, loyalty rules.
4. Employees: create manager and cashier accounts.
5. Catalog: categories → ingredients → products → recipes → opening stock
   (Inventory → Adjust, with unit cost).

## 4. Devices

* iPad / iPhone: open the site in Safari → Share → **Add to Home Screen**.
* Desktop Chrome/Edge: install icon in the address bar.
* Receipt printer: 80 mm thermal printer set as the default printer; the receipt uses `@page 80mm`.

## Setting up from an iPhone only (no computer) — ติดตั้งด้วย iPhone อย่างเดียว

ทุกขั้นทำใน Safari บน iPhone ได้ ขั้นที่ 2 (ติดตั้งฐานข้อมูล) ใช้ GitHub Actions รันแทนคอมพิวเตอร์

1. **Merge PR เข้า `main` ก่อน** — ปุ่ม "Run workflow" จะแสดงเฉพาะ workflow ที่อยู่ใน branch หลัก
2. **คัดลอก Connection string ของ Supabase (ไม่ต้องสร้าง token):** เปิดโปรเจกต์ → ปุ่ม **Connect** ด้านบนของหน้า
   → แท็บ **Connection String** → Type: **URI** → Method: **Session pooler** → คัดลอกข้อความที่ขึ้นต้นด้วย `postgresql://`
   (ใช้ *Session pooler* เท่านั้น — *Direct connection* เป็น IPv6 ซึ่ง GitHub Actions เชื่อมไม่ได้)
   ปล่อย `[YOUR-PASSWORD]` ไว้ตามเดิม ระบบจะใช้รหัสจาก `SUPABASE_DB_PASSWORD` เสมอ (คัดลอก-วาง อย่าพิมพ์เอง)
3. **ใส่ Secrets ใน GitHub:** repo → Settings → Secrets and variables → Actions → New repository secret ใส่ 2 ตัว:
   * `SUPABASE_DB_URL` — connection string จากข้อ 2
   * `SUPABASE_DB_PASSWORD` — รหัสผ่านฐานข้อมูลที่ตั้งตอนสร้างโปรเจกต์ (ลืม: Project Settings → Database → Reset database password)
   (ในเว็บ GitHub บน iPhone ถ้าไม่เห็นเมนู Settings ให้กด "aA" ในแถบที่อยู่ → ขอเว็บไซต์เดสก์ท็อป)
   *ทางเลือก:* ถ้ามี Supabase access token อยู่แล้ว ใช้ `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD` แทน `SUPABASE_DB_URL` ได้
4. **ทดลองรันก่อน:** Actions → **Database migrations** → Run workflow → ปล่อยติ๊ก *Preview only* ไว้ → Run
   ดูผลว่าจะติดตั้ง 8 migration และไม่มี error
5. **รันจริง:** Run workflow อีกครั้ง → **เอาติ๊ก Preview only ออก** → Run ขั้น "Apply migrations" ต้องเป็นเครื่องหมายถูกสีเขียว
6. ตรวจใน Supabase → Table Editor ต้องเห็นตาราง เช่น `products`, `orders`, `inventory_transactions`

ครั้งต่อไปที่มี migration ใหม่ ให้ทำข้อ 4–5 ซ้ำ ระบบจะติดตั้งเฉพาะไฟล์ที่ยังไม่เคยรัน

**ทางเลือกสำรอง (ไม่ใช้ GitHub Actions):** Supabase → SQL Editor → New query แล้ววาง SQL ทีละไฟล์จาก
`supabase/migrations` **เรียงตามชื่อไฟล์** (000100 → 000800) กด Run ทีละไฟล์ (เปิดไฟล์ใน GitHub → ปุ่ม Raw → เลือกทั้งหมด → คัดลอก)
วิธีนี้ CLI จะไม่รู้ว่ารันไปแล้ว ถ้าใช้วิธีนี้ให้ใช้วิธีเดียวกันตลอด อย่าสลับกับ workflow

## Bills via Telegram (AI reads bills, manager approves) — รับบิลผ่าน Telegram

Staff send a **bill photo** (AI reads it) or type an expense that has **no receipt** (e.g. `ค่ากุ้งสด ปลาหมึก 1060`)
to the shop's Telegram bot. It lands in **บิลรออนุมัติ** (`/bills`); a manager checks the lines, maps
ingredient lines to stock, and approves. Ingredient lines are posted as PURCHASE to the stock ledger at the bill
price; other lines become one expense. No-receipt items get a **ใบรับรองแทนใบเสร็จรับเงิน** numbered
`2569/10-001`, printable from the app and filed as PDF in Google Drive.

All three parts are optional; each one that is missing just switches that feature off.

| Vercel environment variable | Where it comes from |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram → @BotFather → `/newbot` |
| `TELEGRAM_WEBHOOK_SECRET` | any random text, 16+ letters/digits |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys (paid per use) |
| `GOOGLE_DRIVE_SCRIPT_URL`, `GOOGLE_DRIVE_SCRIPT_SECRET` | the Apps Script in `docs/google-drive-apps-script.gs` |

1. Add the variables in Vercel → Settings → Environment Variables, then **Redeploy**.
2. Owner: Settings → *การเชื่อมต่อ* → **เชื่อมบอท Telegram กับแอปนี้** (registers the webhook).
3. Each employee: menu **เชื่อม Telegram** → create link → open Telegram (links their account).
4. Google Drive: open script.google.com → New project → paste `docs/google-drive-apps-script.gs` → set `SECRET`
   → Deploy → New deployment → Web app (*Execute as: Me*, *Who has access: Anyone*) → copy the URL.
   Files go to My Drive / Custard POS / `<ปี พ.ศ.-เดือน>` / รูปบิล and ใบรับรองแทนใบเสร็จ.
5. Settings → shop info: fill **ชื่อนิติบุคคลบนเอกสาร**, tax ID, address and phone — they print on the substitute receipt.

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
