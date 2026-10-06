# 🍮 Custard POS — ระบบ POS ร้านขนมหวานคัสตาร์ด (Full system)

ระบบขายหน้าร้านครบวงจรสำหรับร้านสังขยา/คัสตาร์ด/ปังสังขยา: ขาย ชำระเงิน (เงินสด/พร้อมเพย์ QR/บัตร/โอน) จอครัว จอเรียกคิว
สต็อกวัตถุดิบตัดตามสูตร สมาชิกสะสมแต้ม โปรโมชั่น กะ/ลิ้นชักเงินสด รายงานกำไร และจัดการพนักงานตามสิทธิ์

**ไม่ต้องติดตั้ง package ใด ๆ** — ใช้แค่ Node.js 22.5 ขึ้นไป (มี SQLite ในตัว)

## เริ่มใช้งาน

```bash
npm start            # เปิดที่ http://localhost:3000
PORT=8080 npm start  # เปลี่ยนพอร์ต
npm test             # รัน unit + integration tests
npm run reset-db     # ล้างฐานข้อมูลและใส่ข้อมูลตัวอย่างใหม่
```

ครั้งแรกระบบสร้าง `data/pos.db` พร้อมเมนูตัวอย่าง 17 รายการ วัตถุดิบ 16 รายการ สมาชิกและโปรโมชั่นตัวอย่าง

| ผู้ใช้ตัวอย่าง | PIN | หน้าที่ |
|---|---|---|
| เจ้าของร้าน | 1234 | ทุกอย่าง รวมพนักงานและตั้งค่า |
| ผู้จัดการ | 2222 | เมนู สต็อก รายงาน ยกเลิกบิล |
| แคชเชียร์ | 1111 | ขาย บิล กะ สมาชิก |
| ครัว | 3333 | จอครัว |

> ⚠️ เปลี่ยน PIN ทั้งหมดที่หน้า **พนักงาน** ก่อนใช้งานจริง และตั้งเบอร์พร้อมเพย์ที่หน้า **ตั้งค่า**

## การใช้งานในร้าน

- **แท็บเล็ตแคชเชียร์** → เปิด `http://<IP เครื่องเซิร์ฟเวอร์>:3000` แล้วล็อกอินแคชเชียร์
- **จอครัว** → ล็อกอินผู้ใช้ "ครัว" (ออเดอร์ใหม่มีเสียงเตือน)
- **ทีวีเรียกคิวหน้าร้าน** → `http://<IP>:3000/#/queue` (ไม่ต้องล็อกอิน)
- **เครื่องพิมพ์ใบเสร็จ** → ตั้งกระดาษ 80mm ในเบราว์เซอร์ แล้วกด 🖨️ หลังชำระเงิน
- **สำรองข้อมูล** → คัดลอกไฟล์ `data/pos.db` (ปิดเซิร์ฟเวอร์ก่อน หรือใช้ `sqlite3 data/pos.db ".backup backup.db"`)

## โครงสร้างโปรเจกต์

```
server/
  index.js       HTTP server + error handling
  http.js        router, static files, validation helpers
  api.js         REST API ทั้งหมด + สิทธิ์ตามตำแหน่ง
  db.js          schema SQLite + ข้อมูลตัวอย่าง + transaction helper
  pricing.js     ตรรกะคำนวณราคา/ส่วนลด/แต้ม/VAT (pure)
  promptpay.js   payload QR พร้อมเพย์ (EMVCo + CRC16)
public/
  index.html, css/style.css
  js/app.js      router + login
  js/core.js     API client, UI helpers
  js/receipt.js  ใบเสร็จ 80mm / ใบสั่งครัว
  js/pages/      pos, orders, kitchen, shift, members, inventory, products, promotions, reports, admin
  vendor/        qrcode-generator (MIT) สำหรับสร้าง QR แบบออฟไลน์
test/            node:test — pricing + API integration
docs/DESIGN.md   เอกสารออกแบบระบบ (สถาปัตยกรรม, ER, flow, API, ความปลอดภัย)
```

รายละเอียดการออกแบบทั้งหมดอยู่ที่ [docs/DESIGN.md](docs/DESIGN.md)
