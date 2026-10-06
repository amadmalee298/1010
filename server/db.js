'use strict';
// ฐานข้อมูล SQLite (node:sqlite ในตัว Node 22+) — schema + ข้อมูลตัวอย่าง
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pos.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','kitchen')),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '🍮',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  icon TEXT DEFAULT '🍮',
  color TEXT DEFAULT '#f6d365',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  multiple INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta REAL NOT NULL DEFAULT 0,
  ingredient_id INTEGER REFERENCES ingredients(id),
  ingredient_qty REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_option_groups (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  cost_per_unit REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recipes (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL,
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  change REAL NOT NULL,
  balance REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale','void','purchase','adjust','waste')),
  ref TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  birthday TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  total_spent REAL NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  type TEXT NOT NULL CHECK (type IN ('percent','amount')),
  value REAL NOT NULL,
  min_total REAL NOT NULL DEFAULT 0,
  max_discount REAL NOT NULL DEFAULT 0,
  members_only INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  counted_cash REAL,
  expected_cash REAL,
  closed_by INTEGER REFERENCES users(id),
  note TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  amount REAL NOT NULL,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  queue_no INTEGER NOT NULL,
  shift_id INTEGER REFERENCES shifts(id),
  user_id INTEGER REFERENCES users(id),
  member_id INTEGER REFERENCES members(id),
  promotion_id INTEGER REFERENCES promotions(id),
  order_type TEXT NOT NULL DEFAULT 'takeaway' CHECK (order_type IN ('dine_in','takeaway','delivery')),
  table_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','served')),
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','void')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','promptpay','card','transfer')),
  subtotal REAL NOT NULL,
  promo_discount REAL NOT NULL DEFAULT 0,
  manual_discount REAL NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  points_discount REAL NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  cash_received REAL NOT NULL DEFAULT 0,
  change_amount REAL NOT NULL DEFAULT 0,
  note TEXT,
  void_reason TEXT,
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  line_total REAL NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, payment_status);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_ing ON stock_movements(ingredient_id, created_at);
`;

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pin), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(expected, test);
}

const DEFAULT_SETTINGS = {
  shop_name: 'ร้านคัสตาร์ดหวานละมุน',
  shop_address: '123 ถ.สุขุมวิท กรุงเทพฯ 10110',
  shop_phone: '02-123-4567',
  tax_id: '',
  vat_enabled: '0',
  vat_rate: '7',
  vat_inclusive: '1',
  promptpay_id: '0812345678',
  baht_per_point: '25',
  point_value: '1',
  min_redeem_points: '10',
  receipt_footer: 'ขอบคุณที่อุดหนุนค่ะ 🍮 แล้วพบกันใหม่',
  max_cashier_discount: '50'
};

function seed(db) {
  const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setSetting.run(k, v);

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const addUser = db.prepare('INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)');
  addUser.run('เจ้าของร้าน', 'owner', hashPin('1234'));
  addUser.run('ผู้จัดการ', 'manager', hashPin('2222'));
  addUser.run('แคชเชียร์', 'cashier', hashPin('1111'));
  addUser.run('ครัว', 'kitchen', hashPin('3333'));

  // วัตถุดิบ
  const addIng = db.prepare('INSERT INTO ingredients (name, unit, stock, min_stock, cost_per_unit) VALUES (?, ?, ?, ?, ?)');
  const ing = {};
  for (const [key, name, unit, stock, min, cost] of [
    ['egg', 'ไข่ไก่', 'ฟอง', 300, 60, 4],
    ['coconut', 'กะทิ', 'มล.', 10000, 2000, 0.06],
    ['palm', 'น้ำตาลมะพร้าว', 'กรัม', 8000, 1500, 0.08],
    ['sugar', 'น้ำตาลทราย', 'กรัม', 8000, 1500, 0.03],
    ['pandan', 'ใบเตย', 'กรัม', 1500, 300, 0.1],
    ['pumpkin', 'ฟักทอง', 'ลูก', 20, 5, 45],
    ['bread', 'ขนมปังแผ่น', 'แผ่น', 200, 40, 2.5],
    ['milk', 'นมสด', 'มล.', 12000, 2000, 0.05],
    ['thaitea', 'ผงชาไทย', 'กรัม', 2000, 400, 0.4],
    ['greentea', 'ผงชาเขียว', 'กรัม', 1000, 200, 0.9],
    ['cocoa', 'ผงโกโก้', 'กรัม', 1000, 200, 0.6],
    ['tart', 'แป้งทาร์ต', 'ชิ้น', 120, 30, 3],
    ['cream', 'วิปครีม', 'กรัม', 3000, 500, 0.15],
    ['pearl', 'ไข่มุก', 'กรัม', 3000, 500, 0.08],
    ['redbean', 'ถั่วแดงกวน', 'กรัม', 2000, 400, 0.1],
    ['cup', 'ถ้วย/กล่อง', 'ใบ', 500, 100, 1.5]
  ]) {
    ing[key] = Number(addIng.run(name, unit, stock, min, cost).lastInsertRowid);
  }

  // หมวดหมู่
  const addCat = db.prepare('INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)');
  const cat = {
    custard: Number(addCat.run('สังขยา / คัสตาร์ด', '🍮', 1).lastInsertRowid),
    bread: Number(addCat.run('ปังสังขยา', '🍞', 2).lastInsertRowid),
    bake: Number(addCat.run('เบเกอรี่ / ทาร์ต', '🥧', 3).lastInsertRowid),
    drink: Number(addCat.run('เครื่องดื่ม', '🧋', 4).lastInsertRowid),
    set: Number(addCat.run('ชุดคุ้ม', '🎁', 5).lastInsertRowid)
  };

  // กลุ่มตัวเลือก
  const addGroup = db.prepare('INSERT INTO option_groups (name, required, multiple, max_select, sort) VALUES (?, ?, ?, ?, ?)');
  const addOpt = db.prepare('INSERT INTO options (group_id, name, price_delta, ingredient_id, ingredient_qty, is_default, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const grp = {};
  grp.flavor = Number(addGroup.run('รสสังขยา', 1, 0, 1, 1).lastInsertRowid);
  [['ใบเตย', 0, ing.pandan, 5, 1], ['ไข่ (ดั้งเดิม)', 0, null, 0, 0], ['ชาไทย', 5, ing.thaitea, 8, 0], ['ชาเขียว', 10, ing.greentea, 6, 0], ['ช็อกโกแลต', 10, ing.cocoa, 8, 0]]
    .forEach(([n, p, i, q, d], s) => addOpt.run(grp.flavor, n, p, i, q, d, s));
  grp.bread = Number(addGroup.run('แบบขนมปัง', 1, 0, 1, 2).lastInsertRowid);
  [['ปังนึ่ง', 0, 1], ['ปังปิ้งเนย', 5, 0], ['ปังเย็น', 0, 0]]
    .forEach(([n, p, d], s) => addOpt.run(grp.bread, n, p, null, 0, d, s));
  grp.sweet = Number(addGroup.run('ระดับความหวาน', 1, 0, 1, 3).lastInsertRowid);
  [['หวานน้อย', 1], ['หวานปกติ', 0], ['หวานมาก', 0]]
    .forEach(([n, d], s) => addOpt.run(grp.sweet, n, 0, null, 0, d, s));
  grp.topping = Number(addGroup.run('ท็อปปิ้ง', 0, 1, 3, 4).lastInsertRowid);
  [['วิปครีม', 10, ing.cream, 20], ['ไข่มุก', 10, ing.pearl, 40], ['ถั่วแดง', 10, ing.redbean, 30], ['สังขยาเพิ่ม', 15, ing.egg, 1]]
    .forEach(([n, p, i, q], s) => addOpt.run(grp.topping, n, p, i, q, 0, s));
  grp.size = Number(addGroup.run('ขนาด', 1, 0, 1, 5).lastInsertRowid);
  [['ปกติ 16oz', 0, 1], ['ใหญ่ 22oz', 10, 0]]
    .forEach(([n, p, d], s) => addOpt.run(grp.size, n, p, null, 0, d, s));
  grp.temp = Number(addGroup.run('ร้อน/เย็น', 1, 0, 1, 6).lastInsertRowid);
  [['เย็น', 0, 1], ['ร้อน', -5, 0], ['ปั่น', 10, 0]]
    .forEach(([n, p, d], s) => addOpt.run(grp.temp, n, p, null, 0, d, s));

  // สินค้า + สูตร (หักสต็อกต่อ 1 ชิ้น)
  const addProd = db.prepare('INSERT INTO products (category_id, sku, name, description, price, cost, icon, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const addRecipe = db.prepare('INSERT INTO recipes (product_id, ingredient_id, qty) VALUES (?, ?, ?)');
  const addPog = db.prepare('INSERT INTO product_option_groups (product_id, group_id) VALUES (?, ?)');
  const products = [
    // [cat, sku, name, desc, price, cost, icon, color, groups, recipe]
    [cat.custard, 'C01', 'สังขยาฟักทอง', 'ฟักทองทั้งลูกนึ่งสังขยาไข่ (ชิ้น)', 45, 15, '🎃', '#f9a825', [grp.sweet], [[ing.pumpkin, 0.125], [ing.egg, 1], [ing.coconut, 40], [ing.palm, 25], [ing.cup, 1]]],
    [cat.custard, 'C02', 'สังขยาฟักทองทั้งลูก', 'ฟักทองทั้งลูก แบ่งได้ 8 ชิ้น', 320, 110, '🎃', '#ef6c00', [], [[ing.pumpkin, 1], [ing.egg, 8], [ing.coconut, 320], [ing.palm, 200], [ing.cup, 1]]],
    [cat.custard, 'C03', 'สังขยาถ้วย', 'สังขยาเนื้อเนียนนุ่ม เลือกรสได้', 35, 10, '🍮', '#ffd54f', [grp.flavor, grp.sweet, grp.topping], [[ing.egg, 1], [ing.coconut, 50], [ing.palm, 20], [ing.cup, 1]]],
    [cat.custard, 'C04', 'คัสตาร์ดพุดดิ้งคาราเมล', 'พุดดิ้งนมสดราดคาราเมล', 49, 14, '🍮', '#d7a86e', [grp.topping], [[ing.egg, 1], [ing.milk, 80], [ing.sugar, 25], [ing.cup, 1]]],
    [cat.custard, 'C05', 'ครีมบรูเล่', 'คัสตาร์ดวานิลลา เคลือบน้ำตาลไหม้', 69, 20, '🔥', '#bf8040', [], [[ing.egg, 2], [ing.milk, 60], [ing.cream, 40], [ing.sugar, 20], [ing.cup, 1]]],
    [cat.bread, 'B01', 'ปังสังขยา (จิ้ม)', 'ขนมปัง 2 แผ่น + สังขยาถ้วยจิ้ม', 45, 13, '🍞', '#ffcc80', [grp.flavor, grp.bread], [[ing.bread, 2], [ing.egg, 1], [ing.coconut, 40], [ing.palm, 15], [ing.cup, 1]]],
    [cat.bread, 'B02', 'ปังเย็นสังขยาท่วม', 'ปังปิ้งราดสังขยาบนน้ำแข็งไส', 79, 22, '🍧', '#80deea', [grp.flavor, grp.topping], [[ing.bread, 2], [ing.egg, 2], [ing.coconut, 60], [ing.milk, 50], [ing.palm, 20], [ing.cup, 1]]],
    [cat.bread, 'B03', 'โทสต์เนยนมสังขยา', 'โทสต์หนานุ่ม เนยนม + สังขยา', 59, 16, '🧈', '#fff59d', [grp.flavor, grp.topping], [[ing.bread, 2], [ing.egg, 1], [ing.milk, 30], [ing.coconut, 30], [ing.cup, 1]]],
    [cat.bake, 'T01', 'ทาร์ตไข่', 'ทาร์ตไข่อบใหม่ทุกวัน', 25, 8, '🥧', '#ffe082', [], [[ing.tart, 1], [ing.egg, 0.5], [ing.milk, 20], [ing.sugar, 10]]],
    [cat.bake, 'T02', 'ทาร์ตไข่ (กล่อง 6)', 'ทาร์ตไข่ 6 ชิ้นใส่กล่อง', 135, 48, '📦', '#ffca28', [], [[ing.tart, 6], [ing.egg, 3], [ing.milk, 120], [ing.sugar, 60], [ing.cup, 1]]],
    [cat.bake, 'T03', 'ขนมปังไส้สังขยา', 'ขนมปังนึ่งไส้สังขยาใบเตย', 20, 6, '🥯', '#a5d6a7', [], [[ing.bread, 1], [ing.egg, 0.5], [ing.pandan, 3], [ing.coconut, 20]]],
    [cat.drink, 'D01', 'ชาไทยนมสด', 'ชาไทยเข้มข้น', 45, 12, '🧋', '#ff8a65', [grp.temp, grp.size, grp.sweet, grp.topping], [[ing.thaitea, 15], [ing.milk, 150], [ing.sugar, 20], [ing.cup, 1]]],
    [cat.drink, 'D02', 'ชาเขียวนมสด', 'มัทฉะผสมนมสด', 50, 15, '🍵', '#9ccc65', [grp.temp, grp.size, grp.sweet, grp.topping], [[ing.greentea, 8], [ing.milk, 150], [ing.sugar, 20], [ing.cup, 1]]],
    [cat.drink, 'D03', 'นมสดคาราเมลสังขยา', 'นมสดเย็นท็อปสังขยา', 55, 15, '🥛', '#fff3e0', [grp.size, grp.sweet], [[ing.milk, 200], [ing.egg, 0.5], [ing.coconut, 20], [ing.cup, 1]]],
    [cat.drink, 'D04', 'โกโก้เข้มข้น', 'โกโก้แท้', 45, 12, '🍫', '#8d6e63', [grp.temp, grp.size, grp.sweet], [[ing.cocoa, 15], [ing.milk, 150], [ing.sugar, 15], [ing.cup, 1]]],
    [cat.set, 'S01', 'ชุดปังสังขยา + ชาไทย', 'ปังสังขยา (จิ้ม) + ชาไทยเย็น', 85, 25, '🎁', '#f48fb1', [grp.flavor], [[ing.bread, 2], [ing.egg, 1], [ing.coconut, 40], [ing.thaitea, 15], [ing.milk, 150], [ing.cup, 2]]],
    [cat.set, 'S02', 'ชุดสังขยาฟักทอง 4 ชิ้น', 'สังขยาฟักทอง 4 ชิ้น ใส่กล่อง', 169, 60, '🎁', '#ce93d8', [], [[ing.pumpkin, 0.5], [ing.egg, 4], [ing.coconut, 160], [ing.palm, 100], [ing.cup, 1]]]
  ];
  products.forEach(([c, sku, name, desc, price, cost, icon, color, groups, recipe], i) => {
    const pid = Number(addProd.run(c, sku, name, desc, price, cost, icon, color, i).lastInsertRowid);
    for (const g of groups) addPog.run(pid, g);
    for (const [ingId, qty] of recipe) addRecipe.run(pid, ingId, qty);
  });

  // สมาชิก + โปรโมชั่น
  const addMember = db.prepare('INSERT INTO members (phone, name, points, total_spent, visits) VALUES (?, ?, ?, ?, ?)');
  addMember.run('0891112222', 'คุณสมใจ รักหวาน', 120, 3000, 15);
  addMember.run('0823334444', 'คุณมานี ชอบคัสตาร์ด', 35, 875, 6);

  const addPromo = db.prepare('INSERT INTO promotions (name, code, type, value, min_total, max_discount, members_only) VALUES (?, ?, ?, ?, ?, ?, ?)');
  addPromo.run('สมาชิกลด 10%', 'MEMBER10', 'percent', 10, 0, 100, 1);
  addPromo.run('ซื้อครบ 300 ลด 30', 'SAVE30', 'amount', 30, 300, 0, 0);
  addPromo.run('Happy Hour 15%', 'HAPPY15', 'percent', 15, 100, 80, 0);
}

function open(file = DEFAULT_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

/** รันฟังก์ชันใน transaction (rollback อัตโนมัติเมื่อ throw) */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, tx, hashPin, verifyPin, DEFAULT_SETTINGS };

if (require.main === module && process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DEFAULT_PATH + suffix, { force: true });
  open().close();
  console.log('สร้างฐานข้อมูลใหม่พร้อมข้อมูลตัวอย่างแล้ว:', DEFAULT_PATH);
}
