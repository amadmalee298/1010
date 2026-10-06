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
  catalog: {
    newCategory: 'เพิ่มหมวดหมู่', editCategory: 'แก้ไขหมวดหมู่', nameTh: 'ชื่อ (ไทย)', nameEn: 'ชื่อ (อังกฤษ)',
    sortOrder: 'ลำดับ', productCount: 'จำนวนสินค้า', newProduct: 'เพิ่มสินค้า', editProduct: 'แก้ไขสินค้า',
    sku: 'รหัสสินค้า', category: 'หมวดหมู่', noCategory: 'ไม่มีหมวด', description: 'คำอธิบาย', sellingPrice: 'ราคาขาย',
    image: 'รูปสินค้า', imageHint: 'JPG/PNG/WebP ไม่เกิน 2MB', inventoryMode: 'การตัดสต็อก',
    modeRECIPE: 'ตัดวัตถุดิบตามสูตรตอนขาย', modeFINISHED_GOOD: 'ตัดสินค้าสำเร็จรูปที่ผลิตไว้', modeNONE: 'ไม่ตัดสต็อก',
    unitCost: 'ต้นทุน/ชิ้น', grossProfit: 'กำไรขั้นต้น', grossMargin: 'อัตรากำไร', noRecipe: 'ยังไม่มีสูตร',
    finishedStock: 'สต็อกสำเร็จรูป', showInactive: 'แสดงที่ปิดใช้งาน',
    newIngredient: 'เพิ่มวัตถุดิบ', editIngredient: 'แก้ไขวัตถุดิบ', ingredientCategory: 'กลุ่มวัตถุดิบ',
    newIngredientCategory: 'เพิ่มกลุ่มวัตถุดิบ', baseUnit: 'หน่วยฐาน (เช่น กรัม มล. ฟอง)', stock: 'คงเหลือ',
    avgCost: 'ต้นทุนเฉลี่ย/หน่วย', reorderLevel: 'จุดสั่งซื้อ', allowNegative: 'อนุญาตให้สต็อกติดลบ',
    lowStock: 'ใกล้หมด', raw: 'วัตถุดิบ', finished: 'สินค้าสำเร็จรูป', stockReadonly: 'สต็อกและต้นทุนปรับผ่านหน้าสต็อก/สั่งซื้อเท่านั้น',
    recipe: 'สูตร', editRecipe: 'แก้ไขสูตร', createRecipe: 'สร้างสูตร', recipeName: 'ชื่อสูตร', version: 'เวอร์ชัน',
    yieldQuantity: 'ผลผลิตต่อชุด', yieldUnit: 'หน่วยผลผลิต', unitsPerSale: 'ใช้ผลผลิตต่อการขาย 1 หน่วย',
    unitsPerSaleHint: 'เช่น ขายกล่องละ 4 ชิ้น ใส่ 4', ingredients: 'วัตถุดิบในสูตร', addIngredient: 'เพิ่มวัตถุดิบ',
    lineCost: 'ต้นทุน', recipeCost: 'ต้นทุนต่อชุด', costPerYield: 'ต้นทุนต่อหน่วยผลผลิต', costPerSellingUnit: 'ต้นทุนต่อหน่วยขาย',
    netPrice: 'ราคาสุทธิ (ไม่รวม VAT)', history: 'ประวัติเวอร์ชัน', savedNewVersion: 'บันทึกเป็นเวอร์ชันใหม่แล้ว',
    recipeVersionNote: 'การบันทึกจะสร้างเวอร์ชันใหม่ เวอร์ชันเดิมยังเก็บไว้เพื่อประวัติการผลิต',
    selectIngredient: 'เลือกวัตถุดิบ', perBatch: 'ต่อชุด',
  },
  inventory: {
    title: 'สต็อกคงเหลือ', movements: 'ความเคลื่อนไหว', stockValue: 'มูลค่าสต็อก', lowItems: 'รายการใกล้หมด',
    adjust: 'ปรับยอด', count: 'นับสต็อก', waste: 'ของเสีย', delta: 'จำนวนที่เพิ่ม/ลด (+/-)', unitCostIn: 'ต้นทุนต่อหน่วย (ถ้ารับเข้า)',
    counted: 'จำนวนที่นับได้จริง', currentStock: 'คงเหลือในระบบ', wasteReason: 'สาเหตุ (เช่น หมดอายุ ทำหก)',
    integrityOk: 'สต็อกตรงกับบัญชีความเคลื่อนไหวทุกรายการ', integrityBad: 'พบสต็อกไม่ตรงกับบัญชี', balance: 'คงเหลือหลังรายการ',
    reference: 'อ้างอิง', by: 'ผู้ทำรายการ',
    txn: { PURCHASE: 'รับซื้อ', SALE: 'ขาย', PRODUCTION: 'ผลิต', WASTE: 'ของเสีย', ADJUSTMENT: 'ปรับยอด', RETURN: 'รับคืน' },
  },
  pos: {
    searchProducts: 'ค้นหาเมนู / รหัส', allCategories: 'ทั้งหมด', cart: 'ตะกร้า', emptyCart: 'แตะเมนูเพื่อเพิ่มลงตะกร้า',
    items: 'รายการ', subtotal: 'รวม', promotion: 'โปรโมชั่น', promoCode: 'โค้ดส่วนลด', manualDiscount: 'ส่วนลดพิเศษ (บาท)',
    redeemPoints: 'แลกแต้ม', points: 'แต้ม', vat: 'VAT', vatIncluded: 'รวมใน', total: 'ยอดสุทธิ', charge: 'ชำระเงิน',
    clear: 'ล้างตะกร้า', itemNote: 'หมายเหตุรายการ', orderNote: 'หมายเหตุออเดอร์', customer: 'ลูกค้า', addCustomer: 'เลือกลูกค้า',
    phone: 'เบอร์โทร', findCustomer: 'ค้นหา', newCustomer: 'สมัครสมาชิกใหม่', noCustomer: 'ไม่พบลูกค้า', earn: 'จะได้รับ',
    discounts: 'ส่วนลด', none: 'ไม่ใช้', apply: 'ใช้', orderType: { DINE_IN: 'ทานที่ร้าน', TAKEAWAY: 'กลับบ้าน', DELIVERY: 'เดลิเวอรี่' },
    tableLabel: 'โต๊ะ / ชื่อเรียก', payment: 'ชำระเงิน', amountDue: 'ยอดที่ต้องชำระ', remaining: 'คงเหลือ', paid: 'ชำระแล้ว',
    change: 'เงินทอน', tendered: 'รับเงินมา', addPayment: 'เพิ่มการชำระ', splitPayment: 'แบ่งจ่ายหลายช่องทาง',
    method: { CASH: 'เงินสด', QR: 'QR พร้อมเพย์', TRANSFER: 'โอน', CARD: 'บัตร' },
    reference: 'เลขอ้างอิง', confirmPayment: 'ยืนยันการชำระเงิน', success: 'ชำระเงินสำเร็จ', queue: 'คิว', newOrder: 'บิลใหม่',
    printReceipt: 'พิมพ์ใบเสร็จ', underpaid: 'ยอดชำระยังไม่ครบ', overpaid: 'ยอดชำระเกิน', tenderShort: 'รับเงินน้อยกว่ายอด',
    qrHint: 'ให้ลูกค้าสแกน แล้วตรวจสอบยอดเงินเข้าก่อนยืนยัน', qrNotSet: 'ยังไม่ได้ตั้งค่าพร้อมเพย์ (ตั้งค่า > ร้าน)',
    sessionClosed: 'ลิ้นชักเงินสดยังไม่เปิด — เปิดกะก่อนขาย', openDrawer: 'ไปเปิดลิ้นชัก', outOfStock: 'หมด',
    queuedOffline: 'ออฟไลน์: บันทึกบิลไว้ในเครื่อง จะส่งอัตโนมัติเมื่อออนไลน์', pendingSync: 'รอส่ง', syncNow: 'ส่งตอนนี้',
    syncFailed: 'ส่งบิลไม่สำเร็จ', menuCached: 'ใช้เมนูที่บันทึกไว้ในเครื่อง', estimate: 'ยอดประมาณการ (ยืนยันโดยเซิร์ฟเวอร์)',
  },
  orders: {
    title: 'ออเดอร์', number: 'เลขที่', time: 'เวลา', cashier: 'พนักงาน', status: {
      COMPLETED: 'สำเร็จ', CANCELLED: 'ยกเลิก', PARTIALLY_REFUNDED: 'คืนเงินบางส่วน', REFUNDED: 'คืนเงินแล้ว',
    },
    cancel: 'ยกเลิกออเดอร์', cancelHint: 'คืนสต็อก เงินสด และแต้มทั้งหมด', refund: 'คืนเงิน', refundQty: 'จำนวนที่คืน',
    restock: 'คืนสินค้าเข้าสต็อก (สินค้ายังขายได้)', refundMethod: 'คืนเงินด้วย', refundAmount: 'ยอดคืนโดยประมาณ',
    cogs: 'ต้นทุนขาย', grossProfit: 'กำไรขั้นต้น', receipt: 'ใบเสร็จ', taxInvoice: 'ใบกำกับภาษีอย่างย่อ', copy: 'สำเนา',
    refunds: 'ประวัติคืนเงิน',
  },
  kitchen: {
    title: 'จอครัว', status: { PENDING: 'รอทำ', PREPARING: 'กำลังทำ', READY: 'พร้อมเสิร์ฟ', SERVED: 'เสิร์ฟแล้ว' },
    start: 'เริ่มทำ', done: 'ทำเสร็จ', serve: 'เสิร์ฟแล้ว', back: 'ย้อนกลับ', minutes: 'นาที', empty: 'ว่าง', sound: 'เสียงแจ้งเตือน',
  },
  errors: {
    generic: 'เกิดข้อผิดพลาด กรุณาลองใหม่', permission: 'ไม่มีสิทธิ์ทำรายการนี้', validation: 'ข้อมูลไม่ถูกต้อง',
    insufficientStock: 'วัตถุดิบไม่พอ', notFound: 'ไม่พบข้อมูล', duplicate: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว',
    noOpenSession: 'กรุณาเปิดลิ้นชักเงินสดก่อน', offline: 'ออฟไลน์อยู่ — รายการนี้ต้องเชื่อมต่ออินเทอร์เน็ต',
  },
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Dictionary = Widen<typeof th>;
