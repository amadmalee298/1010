# 🍮 Custard POS

ระบบขายหน้าร้านและบริหารร้านขนมหวาน **Custard** — ใช้งานได้บน iPad, iPhone, คอมพิวเตอร์ และจอสัมผัส ติดตั้งเป็นแอป (PWA) ได้

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui-style components · Supabase (PostgreSQL, Auth, Storage, Realtime) · Recharts · Vercel

## ความสามารถ

| กลุ่ม | รายละเอียด |
|---|---|
| ขายหน้าร้าน | ค้นหา/กรองหมวด, รูปสินค้า, ตะกร้า, หมายเหตุรายการ/ออเดอร์, ส่วนลด/โปรโมชั่น/แต้ม, เงินสด·QR พร้อมเพย์·โอน·บัตร และแบ่งจ่ายหลายช่องทาง, ใบเสร็จ 80mm, เลือก/สมัครลูกค้า |
| ออเดอร์ | ประวัติ, พิมพ์ซ้ำ, ยกเลิก (คืนทุกอย่าง), คืนเงินรายสินค้า (เลือกคืนเข้าสต็อกได้) |
| สินค้าและสูตร | หมวดหมู่, สินค้า, วัตถุดิบ, สูตรแบบมีเวอร์ชัน, ต้นทุนต่อชุด/ต่อหน่วยผลผลิต/ต่อหน่วยขาย, กำไรขั้นต้นและอัตรากำไร |
| สต็อก | ตัดสต็อกอัตโนมัติเมื่อขาย, บัญชีความเคลื่อนไหวแก้ไขไม่ได้, ต้นทุนเฉลี่ยถ่วงน้ำหนัก, นับสต็อก, ของเสีย, แจ้งเตือนใกล้หมด |
| การผลิต | ผลิตเป็นชุด คำนวณวัตถุดิบอัตโนมัติ ตรวจสต็อกครบทุกรายการก่อนยืนยัน วัตถุดิบลด–สินค้าสำเร็จรูปเพิ่ม |
| จัดซื้อ | ซัพพลายเออร์, ใบสั่งซื้อ, รับของบางส่วน/ทั้งหมดตามราคาจริง |
| รับบิล | พนักงานส่งรูปบิลทาง Telegram ให้ AI อ่าน หรือพิมพ์ค่าใช้จ่ายที่ไม่มีบิล → ผู้จัดการอนุมัติ → วัตถุดิบเข้าสต็อก + บันทึกค่าใช้จ่าย, ออกใบรับรองแทนใบเสร็จเก็บใน Google Drive |
| การเงิน | ค่าใช้จ่าย, ลิ้นชักเงินสด (เปิด/ปิดกะ นับแบงก์ ส่วนต่าง), แดชบอร์ด, กำไรขาดทุน, COGS, ความคุ้มค่าเมนู, รายงาน 11 ประเภท + ส่งออก CSV |
| ผู้ดูแล | พนักงาน 3 ตำแหน่ง (เจ้าของ/ผู้จัดการ/แคชเชียร์), RLS ทุกตาราง, บันทึกการใช้งาน, ตั้งค่าร้าน, ภาษาไทย/อังกฤษ |

## เริ่มพัฒนาในเครื่อง

```bash
npm install
cp .env.example .env.local            # ใส่ค่าจาก `npx supabase status`
npx supabase start                    # Supabase ในเครื่อง (ต้องมี Docker)
npm run seed:demo                     # ร้านตัวอย่าง + บัญชีพนักงาน
npm run dev                           # http://localhost:3000
```

บัญชีตัวอย่าง (รหัสผ่าน `custard1234`): `owner@custard.test`, `manager@custard.test`, `cashier@custard.test`, `kitchen@custard.test`

## คำสั่ง

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run dev` / `build` / `start` | รัน / build / production |
| `npm run lint` · `npm run typecheck` | ESLint (ห้าม `any`) · TypeScript strict |
| `npm test` | unit tests + database tests (migrations, RLS, RPC จริงบน PostgreSQL) |
| `npm run db:test-server` | เปิด PostgreSQL ชั่วคราวสำหรับ database tests (ไม่ต้องใช้ Docker) |
| `npm run seed:demo` | ใส่ข้อมูลร้านตัวอย่าง |

ฐานข้อมูลทั้งหมดอยู่ใน `supabase/migrations` (เรียงตามเฟส 1–13)

## เอกสาร

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — โครงสร้าง, flow การขาย, โมเดลสต็อก, สมมติฐานที่เลือก
* [docs/SECURITY.md](docs/SECURITY.md) — สิทธิ์ตามตำแหน่ง, RLS, audit
* [docs/REPORTING.md](docs/REPORTING.md) — นิยามตัวเลขในรายงานและงบกำไรขาดทุน
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — ขึ้นระบบจริงบน Supabase + Vercel, การเริ่มใช้งานครั้งแรก
