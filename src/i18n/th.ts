/**
 * Thai dictionary — the source of truth for UI text.
 * en.ts must provide the same keys (enforced by the Dictionary type).
 */
export const th = {
  app: { name: 'Custard POS', tagline: 'ระบบขายและบริหารร้านขนมหวาน' },
  common: {
    save: 'บันทึก', cancel: 'ยกเลิก', close: 'ปิด', edit: 'แก้ไข', add: 'เพิ่ม', delete: 'ลบ', search: 'ค้นหา',
    confirm: 'ยืนยัน', back: 'กลับ', loading: 'กำลังโหลด…', noData: 'ไม่มีข้อมูล', active: 'ใช้งาน', inactive: 'ปิดใช้งาน',
    status: 'สถานะ', note: 'หมายเหตุ', name: 'ชื่อ', total: 'รวม', actions: 'จัดการ', all: 'ทั้งหมด', yes: 'ใช่', no: 'ไม่',
    from: 'ตั้งแต่', to: 'ถึง', date: 'วันที่', quantity: 'จำนวน', price: 'ราคา', cost: 'ต้นทุน', unit: 'หน่วย',
    saved: 'บันทึกแล้ว', error: 'เกิดข้อผิดพลาด', required: 'จำเป็นต้องกรอก', optional: 'ไม่บังคับ', print: 'พิมพ์',
    export: 'ส่งออก', today: 'วันนี้', details: 'รายละเอียด', reason: 'เหตุผล', type: 'ประเภท', create: 'สร้าง',
  },
  nav: {
    pos: 'ขายหน้าร้าน', orders: 'ออเดอร์', kitchen: 'ครัว', dashboard: 'ภาพรวม', products: 'สินค้า', categories: 'หมวดหมู่',
    ingredients: 'วัตถุดิบ', recipes: 'สูตร', inventory: 'สต็อก', production: 'การผลิต', suppliers: 'ซัพพลายเออร์',
    purchasing: 'สั่งซื้อ', customers: 'ลูกค้า', promotions: 'โปรโมชั่น', expenses: 'ค่าใช้จ่าย', cash: 'ลิ้นชักเงินสด',
    reports: 'รายงาน', employees: 'พนักงาน', audit: 'บันทึกการใช้งาน', settings: 'ตั้งค่า', signOut: 'ออกจากระบบ',
    groupSales: 'การขาย', groupStock: 'สต็อกและการผลิต', groupFinance: 'การเงิน', groupAdmin: 'ผู้ดูแล',
  },
  auth: {
    title: 'เข้าสู่ระบบ', email: 'อีเมล', password: 'รหัสผ่าน', submit: 'เข้าสู่ระบบ',
    invalid: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', notEmployee: 'บัญชีนี้ยังไม่ได้ลงทะเบียนเป็นพนักงาน หรือถูกปิดใช้งาน',
    forbidden: 'คุณไม่มีสิทธิ์ใช้งานหน้านี้', configError: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase',
  },
  roles: { OWNER: 'เจ้าของร้าน', MANAGER: 'ผู้จัดการ', CASHIER: 'แคชเชียร์', KITCHEN: 'ครัว' },
  errors: {
    generic: 'เกิดข้อผิดพลาด กรุณาลองใหม่', permission: 'ไม่มีสิทธิ์ทำรายการนี้', validation: 'ข้อมูลไม่ถูกต้อง',
    insufficientStock: 'วัตถุดิบไม่พอ', notFound: 'ไม่พบข้อมูล', duplicate: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว',
    noOpenSession: 'กรุณาเปิดลิ้นชักเงินสดก่อน', offline: 'ออฟไลน์อยู่ — รายการนี้ต้องเชื่อมต่ออินเทอร์เน็ต',
  },
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Dictionary = Widen<typeof th>;
