'use strict';
// REST API ทั้งหมดของระบบ
const crypto = require('node:crypto');
const { Router, HttpError, str, num, bool, send } = require('./http');
const { tx, hashPin, verifyPin } = require('./db');
const { priceItem, calculateTotals, calculateChange, round2 } = require('./pricing');
const { promptPayPayload } = require('./promptpay');

const ROLES = {
  ALL: ['owner', 'manager', 'cashier', 'kitchen'],
  STAFF: ['owner', 'manager', 'cashier'],
  MGR: ['owner', 'manager'],
  OWNER: ['owner']
};
const SESSION_HOURS = 16;
const ORDER_FLOW = ['pending', 'preparing', 'ready', 'served'];

// วันที่/เวลาท้องถิ่นแบบเดียวกับ SQLite datetime('now','localtime')
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localDateTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${localDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function createApi(db) {
  const r = new Router();
  const q = (sql) => db.prepare(sql);

  // ---------------- helpers ----------------
  const getSettings = () => Object.fromEntries(q('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]));
  const audit = (userId, action, detail) => q('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)').run(userId ?? null, action, detail ? JSON.stringify(detail) : null);

  function auth(roles = ROLES.ALL) {
    return (ctx) => {
      const h = ctx.req.headers.authorization || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : ctx.query.token;
      if (!token) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
      const row = q(`SELECT u.id, u.name, u.role, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
      if (!row || !row.active || row.expires_at < localDateTime()) throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      if (!roles.includes(row.role)) throw new HttpError(403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
      ctx.user = { id: row.id, name: row.name, role: row.role };
      ctx.token = token;
    };
  }

  function loadGroups(productIds) {
    const map = new Map(productIds.map((id) => [id, []]));
    if (!productIds.length) return map;
    const ph = productIds.map(() => '?').join(',');
    const links = q(`SELECT pog.product_id, g.* FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
                     WHERE pog.product_id IN (${ph}) ORDER BY g.sort, g.id`).all(...productIds);
    const groupIds = [...new Set(links.map((l) => l.id))];
    const opts = groupIds.length
      ? q(`SELECT id, group_id, name, price_delta, ingredient_id, ingredient_qty, is_default FROM options
           WHERE active = 1 AND group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY sort, id`).all(...groupIds)
      : [];
    for (const l of links) {
      map.get(l.product_id).push({
        id: l.id, name: l.name, required: !!l.required, multiple: !!l.multiple, max_select: l.max_select,
        options: opts.filter((o) => o.group_id === l.id)
      });
    }
    return map;
  }

  function currentShift() {
    return q(`SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.closed_at IS NULL ORDER BY s.id DESC LIMIT 1`).get();
  }

  function shiftSummary(shift) {
    const sales = q(`SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM orders
                     WHERE shift_id = ? AND payment_status = 'paid' GROUP BY payment_method`).all(shift.id);
    const voids = q(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM orders WHERE shift_id = ? AND payment_status = 'void'`).get(shift.id);
    const moves = q(`SELECT cm.*, u.name AS user_name FROM cash_movements cm LEFT JOIN users u ON u.id = cm.user_id WHERE shift_id = ? ORDER BY cm.id`).all(shift.id);
    const cashSales = sales.find((s) => s.payment_method === 'cash')?.total || 0;
    const cashIn = moves.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
    const cashOut = moves.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);
    return {
      shift,
      sales,
      total_sales: round2(sales.reduce((s, x) => s + x.total, 0)),
      order_count: sales.reduce((s, x) => s + x.count, 0),
      voids,
      cash_movements: moves,
      cash_sales: round2(cashSales),
      cash_in: round2(cashIn),
      cash_out: round2(cashOut),
      expected_cash: round2(shift.opening_cash + cashSales + cashIn - cashOut)
    };
  }

  function getOrder(id) {
    const order = q(`SELECT o.*, u.name AS cashier_name, m.name AS member_name, m.phone AS member_phone, m.points AS member_points,
                     p.name AS promotion_name FROM orders o
                     LEFT JOIN users u ON u.id = o.user_id LEFT JOIN members m ON m.id = o.member_id
                     LEFT JOIN promotions p ON p.id = o.promotion_id WHERE o.id = ?`).get(id);
    if (!order) throw new HttpError(404, 'ไม่พบออเดอร์');
    order.items = q('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id)
      .map((i) => ({ ...i, options: JSON.parse(i.options_json) }));
    return order;
  }

  function moveStock(ingredientId, change, reason, ref, userId, note = null) {
    const ing = q('SELECT stock FROM ingredients WHERE id = ?').get(ingredientId);
    if (!ing) throw new HttpError(400, 'ไม่พบวัตถุดิบ');
    const balance = round2(ing.stock + change);
    q('UPDATE ingredients SET stock = ? WHERE id = ?').run(balance, ingredientId);
    q('INSERT INTO stock_movements (ingredient_id, change, balance, reason, ref, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ingredientId, round2(change), balance, reason, ref, note, userId);
  }

  function checkManagerOverride(ctx, pin) {
    if (ROLES.MGR.includes(ctx.user.role)) return ctx.user.id;
    if (!pin) throw new HttpError(403, 'ต้องให้ผู้จัดการยืนยันด้วย PIN');
    const mgrs = q(`SELECT id, pin_hash FROM users WHERE active = 1 AND role IN ('owner','manager')`).all();
    const ok = mgrs.find((m) => verifyPin(pin, m.pin_hash));
    if (!ok) throw new HttpError(403, 'PIN ผู้จัดการไม่ถูกต้อง');
    return ok.id;
  }

  /** แปลงตะกร้าเป็นรายการที่มีราคา + คำนวณยอดรวม (ใช้ทั้ง quote และ checkout) */
  function buildQuote(body) {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new HttpError(400, 'ไม่มีรายการสินค้า');
    if (items.length > 100) throw new HttpError(400, 'รายการสินค้ามากเกินไป');
    const ids = [...new Set(items.map((i) => Number(i.product_id)))];
    const prods = new Map(q(`SELECT * FROM products WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((p) => [p.id, p]));
    const groups = loadGroups(ids);

    const lines = items.map((it) => {
      const p = prods.get(Number(it.product_id));
      if (!p) throw new HttpError(400, 'สินค้าบางรายการไม่พร้อมขาย');
      const qty = num(it.qty, 'จำนวน', { min: 1, max: 999, int: true });
      const { unit_price, options } = priceItem(p, groups.get(p.id), it.option_ids || []);
      return { product: p, qty, unit_price, options, line_total: round2(unit_price * qty), note: str(it.note, 'หมายเหตุ', { required: false, max: 200 }) };
    });

    let member = null;
    if (body.member_id) {
      member = q('SELECT * FROM members WHERE id = ?').get(Number(body.member_id));
      if (!member) throw new HttpError(400, 'ไม่พบสมาชิก');
    }
    let promotion = null;
    if (body.promotion_id) {
      promotion = q('SELECT * FROM promotions WHERE id = ?').get(Number(body.promotion_id));
    } else if (body.promo_code) {
      promotion = q('SELECT * FROM promotions WHERE UPPER(code) = UPPER(?)').get(String(body.promo_code).trim());
      if (!promotion) throw new HttpError(400, 'ไม่พบโค้ดส่วนลด');
    }
    const settings = getSettings();
    const totals = calculateTotals({
      lines, promotion, member, settings,
      manualDiscount: body.manual_discount, redeemPoints: body.redeem_points, today: localDate()
    });
    return { lines, member, promotion, settings, totals };
  }

  // ================= AUTH =================
  r.get('/api/auth/users', () => q(`SELECT id, name, role FROM users WHERE active = 1 ORDER BY CASE role WHEN 'cashier' THEN 1 WHEN 'kitchen' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END, id`).all());

  r.post('/api/auth/login', (ctx) => {
    const id = num(ctx.body.user_id, 'ผู้ใช้', { int: true });
    const pin = str(ctx.body.pin, 'PIN', { max: 12 });
    const u = q('SELECT * FROM users WHERE id = ? AND active = 1').get(id);
    if (!u || !verifyPin(pin, u.pin_hash)) {
      audit(id, 'login_failed');
      throw new HttpError(401, 'PIN ไม่ถูกต้อง');
    }
    const token = crypto.randomBytes(24).toString('hex');
    const exp = localDateTime(new Date(Date.now() + SESSION_HOURS * 3600e3));
    q('DELETE FROM sessions WHERE expires_at < ?').run(localDateTime());
    q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, exp);
    audit(u.id, 'login');
    return { token, user: { id: u.id, name: u.name, role: u.role } };
  });

  r.post('/api/auth/logout', auth(), (ctx) => { q('DELETE FROM sessions WHERE token = ?').run(ctx.token); });
  r.get('/api/me', auth(), (ctx) => ({ user: ctx.user, shift: currentShift() || null }));

  // ================= PUBLIC (จอคิวลูกค้า) =================
  r.get('/api/public/queue', () => {
    const rows = q(`SELECT queue_no, status, order_type FROM orders WHERE payment_status = 'paid' AND status IN ('pending','preparing','ready')
                    AND date(created_at) = ? ORDER BY id`).all(localDate());
    return { shop_name: getSettings().shop_name, preparing: rows.filter((r) => r.status !== 'ready').map((r) => r.queue_no), ready: rows.filter((r) => r.status === 'ready').map((r) => r.queue_no) };
  });

  // ================= SETTINGS =================
  r.get('/api/settings', auth(), () => getSettings());
  r.put('/api/settings', auth(ROLES.OWNER), (ctx) => {
    const allowed = ['shop_name', 'shop_address', 'shop_phone', 'tax_id', 'vat_enabled', 'vat_rate', 'vat_inclusive', 'promptpay_id',
      'baht_per_point', 'point_value', 'min_redeem_points', 'receipt_footer', 'max_cashier_discount'];
    const up = q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of allowed) if (k in ctx.body) up.run(k, String(ctx.body[k] ?? ''));
    audit(ctx.user.id, 'settings_update', ctx.body);
    return getSettings();
  });

  r.get('/api/promptpay', auth(ROLES.STAFF), (ctx) => {
    const s = getSettings();
    try {
      return { payload: promptPayPayload(s.promptpay_id, num(ctx.query.amount, 'ยอดเงิน', { min: 0 })), promptpay_id: s.promptpay_id };
    } catch (e) { throw new HttpError(400, e.message); }
  });

  // ================= MENU / PRODUCTS =================
  r.get('/api/menu', auth(), () => {
    const categories = q('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id').all();
    const products = q(`SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND c.active = 1 ORDER BY p.sort, p.id`).all();
    const groups = loadGroups(products.map((p) => p.id));
    // จำนวนที่ทำได้จากสต็อกคงเหลือ (ตามสูตร)
    const recipes = q(`SELECT r.product_id, r.qty, i.stock FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id`).all();
    return {
      categories,
      products: products.map((p) => {
        const rs = recipes.filter((x) => x.product_id === p.id && x.qty > 0);
        const available = rs.length ? Math.max(0, Math.floor(Math.min(...rs.map((x) => x.stock / x.qty)))) : null;
        return { ...p, groups: groups.get(p.id), available };
      })
    };
  });

  r.get('/api/categories', auth(ROLES.MGR), () => q('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count FROM categories c ORDER BY sort, id').all());
  r.post('/api/categories', auth(ROLES.MGR), (ctx) => {
    const b = ctx.body;
    const id = q('INSERT INTO categories (name, icon, sort, active) VALUES (?, ?, ?, ?)').run(str(b.name, 'ชื่อหมวด'), b.icon || '🍮', num(b.sort, 'ลำดับ', { required: false }) || 0, b.active === undefined ? 1 : bool(b.active)).lastInsertRowid;
    return q('SELECT * FROM categories WHERE id = ?').get(id);
  });
  r.put('/api/categories/:id', auth(ROLES.MGR), (ctx) => {
    const b = ctx.body;
    q('UPDATE categories SET name = ?, icon = ?, sort = ?, active = ? WHERE id = ?').run(str(b.name, 'ชื่อหมวด'), b.icon || '🍮', num(b.sort, 'ลำดับ', { required: false }) || 0, bool(b.active), Number(ctx.params.id));
    return q('SELECT * FROM categories WHERE id = ?').get(Number(ctx.params.id));
  });

  r.get('/api/products', auth(ROLES.MGR), () => {
    const products = q('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.active DESC, c.sort, p.sort, p.id').all();
    const links = q('SELECT * FROM product_option_groups').all();
    const recipes = q('SELECT r.*, i.name AS ingredient_name, i.unit, i.cost_per_unit FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id').all();
    return products.map((p) => {
      const recipe = recipes.filter((x) => x.product_id === p.id);
      return {
        ...p,
        group_ids: links.filter((l) => l.product_id === p.id).map((l) => l.group_id),
        recipe,
        recipe_cost: round2(recipe.reduce((s, x) => s + x.qty * x.cost_per_unit, 0))
      };
    });
  });

  function saveProduct(ctx, id) {
    const b = ctx.body;
    const fields = [
      num(b.category_id, 'หมวดหมู่', { int: true }), str(b.sku, 'รหัส', { required: false, max: 30 }), str(b.name, 'ชื่อสินค้า'),
      str(b.description, 'คำอธิบาย', { required: false, max: 500 }) || '', num(b.price, 'ราคา', { min: 0 }), num(b.cost, 'ต้นทุน', { min: 0, required: false }) || 0,
      b.icon || '🍮', b.color || '#f6d365', num(b.sort, 'ลำดับ', { required: false }) || 0, b.active === undefined ? 1 : bool(b.active)
    ];
    return tx(db, () => {
      if (id) q('UPDATE products SET category_id=?, sku=?, name=?, description=?, price=?, cost=?, icon=?, color=?, sort=?, active=? WHERE id=?').run(...fields, id);
      else id = Number(q('INSERT INTO products (category_id, sku, name, description, price, cost, icon, color, sort, active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...fields).lastInsertRowid);
      if (Array.isArray(b.group_ids)) {
        q('DELETE FROM product_option_groups WHERE product_id = ?').run(id);
        for (const g of new Set(b.group_ids.map(Number))) q('INSERT INTO product_option_groups (product_id, group_id) VALUES (?, ?)').run(id, g);
      }
      if (Array.isArray(b.recipe)) {
        q('DELETE FROM recipes WHERE product_id = ?').run(id);
        for (const x of b.recipe) {
          const qty = num(x.qty, 'ปริมาณวัตถุดิบ', { min: 0 });
          if (qty > 0) q('INSERT OR REPLACE INTO recipes (product_id, ingredient_id, qty) VALUES (?, ?, ?)').run(id, num(x.ingredient_id, 'วัตถุดิบ', { int: true }), qty);
        }
      }
      audit(ctx.user.id, 'product_save', { id, name: fields[2] });
      return q('SELECT * FROM products WHERE id = ?').get(id);
    });
  }
  r.post('/api/products', auth(ROLES.MGR), (ctx) => saveProduct(ctx, null));
  r.put('/api/products/:id', auth(ROLES.MGR), (ctx) => saveProduct(ctx, Number(ctx.params.id)));
  r.delete('/api/products/:id', auth(ROLES.MGR), (ctx) => { q('UPDATE products SET active = 0 WHERE id = ?').run(Number(ctx.params.id)); });

  // ---------- option groups ----------
  r.get('/api/option-groups', auth(ROLES.MGR), () => {
    const groups = q('SELECT * FROM option_groups ORDER BY sort, id').all();
    const opts = q('SELECT o.*, i.name AS ingredient_name, i.unit FROM options o LEFT JOIN ingredients i ON i.id = o.ingredient_id WHERE o.active = 1 ORDER BY o.sort, o.id').all();
    return groups.map((g) => ({ ...g, options: opts.filter((o) => o.group_id === g.id) }));
  });
  function saveGroup(ctx, id) {
    const b = ctx.body;
    const f = [str(b.name, 'ชื่อกลุ่ม'), bool(b.required), bool(b.multiple), num(b.max_select, 'เลือกสูงสุด', { min: 0, int: true, required: false }) || 0, num(b.sort, 'ลำดับ', { required: false }) || 0];
    const options = Array.isArray(b.options) ? b.options : [];
    if (!options.length) throw new HttpError(400, 'ต้องมีตัวเลือกอย่างน้อย 1 รายการ');
    return tx(db, () => {
      if (id) q('UPDATE option_groups SET name=?, required=?, multiple=?, max_select=?, sort=? WHERE id=?').run(...f, id);
      else id = Number(q('INSERT INTO option_groups (name, required, multiple, max_select, sort) VALUES (?,?,?,?,?)').run(...f).lastInsertRowid);
      const keep = [];
      options.forEach((o, i) => {
        const vals = [str(o.name, 'ชื่อตัวเลือก'), num(o.price_delta, 'ราคาเพิ่ม', { required: false }) || 0, o.ingredient_id ? Number(o.ingredient_id) : null,
          num(o.ingredient_qty, 'ปริมาณ', { min: 0, required: false }) || 0, bool(o.is_default), i];
        if (o.id && q('SELECT 1 FROM options WHERE id = ? AND group_id = ?').get(Number(o.id), id)) {
          q('UPDATE options SET name=?, price_delta=?, ingredient_id=?, ingredient_qty=?, is_default=?, sort=?, active=1 WHERE id=?').run(...vals, Number(o.id));
          keep.push(Number(o.id));
        } else {
          keep.push(Number(q('INSERT INTO options (name, price_delta, ingredient_id, ingredient_qty, is_default, sort, group_id) VALUES (?,?,?,?,?,?,?)').run(...vals, id).lastInsertRowid));
        }
      });
      q(`UPDATE options SET active = 0 WHERE group_id = ? AND id NOT IN (${keep.map(() => '?').join(',')})`).run(id, ...keep);
      return { id };
    });
  }
  r.post('/api/option-groups', auth(ROLES.MGR), (ctx) => saveGroup(ctx, null));
  r.put('/api/option-groups/:id', auth(ROLES.MGR), (ctx) => saveGroup(ctx, Number(ctx.params.id)));
  r.delete('/api/option-groups/:id', auth(ROLES.MGR), (ctx) => { q('DELETE FROM option_groups WHERE id = ?').run(Number(ctx.params.id)); });

  // ================= INVENTORY =================
  r.get('/api/ingredients', auth(ROLES.STAFF), () =>
    q('SELECT *, (stock <= min_stock) AS low FROM ingredients WHERE active = 1 ORDER BY (stock <= min_stock) DESC, name').all());
  function saveIngredient(ctx, id) {
    const b = ctx.body;
    const f = [str(b.name, 'ชื่อวัตถุดิบ'), str(b.unit, 'หน่วย', { max: 20 }), num(b.min_stock, 'สต็อกขั้นต่ำ', { min: 0, required: false }) || 0, num(b.cost_per_unit, 'ต้นทุน/หน่วย', { min: 0, required: false }) || 0];
    if (id) {
      q('UPDATE ingredients SET name=?, unit=?, min_stock=?, cost_per_unit=? WHERE id=?').run(...f, id);
    } else {
      id = Number(q('INSERT INTO ingredients (name, unit, min_stock, cost_per_unit) VALUES (?,?,?,?)').run(...f).lastInsertRowid);
      const init = num(b.stock, 'สต็อกเริ่มต้น', { min: 0, required: false });
      if (init) moveStock(id, init, 'purchase', 'เริ่มต้น', ctx.user.id);
    }
    return q('SELECT * FROM ingredients WHERE id = ?').get(id);
  }
  r.post('/api/ingredients', auth(ROLES.MGR), (ctx) => tx(db, () => saveIngredient(ctx, null)));
  r.put('/api/ingredients/:id', auth(ROLES.MGR), (ctx) => saveIngredient(ctx, Number(ctx.params.id)));
  r.delete('/api/ingredients/:id', auth(ROLES.MGR), (ctx) => { q('UPDATE ingredients SET active = 0 WHERE id = ?').run(Number(ctx.params.id)); });

  r.post('/api/ingredients/:id/adjust', auth(ROLES.STAFF), (ctx) => {
    const id = Number(ctx.params.id);
    const reason = ctx.body.reason;
    if (!['purchase', 'waste', 'adjust'].includes(reason)) throw new HttpError(400, 'ประเภทการปรับสต็อกไม่ถูกต้อง');
    if (reason === 'adjust' && !ROLES.MGR.includes(ctx.user.role)) throw new HttpError(403, 'การนับสต็อกต้องเป็นผู้จัดการ');
    const qty = num(ctx.body.qty, 'จำนวน', { min: 0 });
    const note = str(ctx.body.note, 'หมายเหตุ', { required: false });
    return tx(db, () => {
      const ing = q('SELECT * FROM ingredients WHERE id = ?').get(id);
      if (!ing) throw new HttpError(404, 'ไม่พบวัตถุดิบ');
      const change = reason === 'purchase' ? qty : reason === 'waste' ? -qty : qty - ing.stock;
      if (reason === 'purchase' && ctx.body.cost_per_unit !== undefined && ctx.body.cost_per_unit !== '') {
        q('UPDATE ingredients SET cost_per_unit = ? WHERE id = ?').run(num(ctx.body.cost_per_unit, 'ต้นทุน', { min: 0 }), id);
      }
      moveStock(id, change, reason, null, ctx.user.id, note);
      return q('SELECT * FROM ingredients WHERE id = ?').get(id);
    });
  });

  r.get('/api/stock-movements', auth(ROLES.MGR), (ctx) => {
    const params = [];
    let where = '1=1';
    if (ctx.query.ingredient_id) { where += ' AND sm.ingredient_id = ?'; params.push(Number(ctx.query.ingredient_id)); }
    if (ctx.query.reason) { where += ' AND sm.reason = ?'; params.push(ctx.query.reason); }
    return q(`SELECT sm.*, i.name AS ingredient_name, i.unit, u.name AS user_name FROM stock_movements sm
              JOIN ingredients i ON i.id = sm.ingredient_id LEFT JOIN users u ON u.id = sm.user_id
              WHERE ${where} ORDER BY sm.id DESC LIMIT 300`).all(...params);
  });

  // ================= MEMBERS =================
  r.get('/api/members', auth(ROLES.STAFF), (ctx) => {
    const term = `%${ctx.query.q || ''}%`;
    return q('SELECT * FROM members WHERE phone LIKE ? OR name LIKE ? ORDER BY total_spent DESC LIMIT 200').all(term, term);
  });
  r.get('/api/members/lookup', auth(ROLES.STAFF), (ctx) => {
    const phone = String(ctx.query.phone || '').replace(/\D/g, '');
    const m = q('SELECT * FROM members WHERE phone = ?').get(phone);
    if (!m) throw new HttpError(404, 'ไม่พบสมาชิกเบอร์นี้');
    return m;
  });
  r.get('/api/members/:id', auth(ROLES.STAFF), (ctx) => {
    const m = q('SELECT * FROM members WHERE id = ?').get(Number(ctx.params.id));
    if (!m) throw new HttpError(404, 'ไม่พบสมาชิก');
    m.orders = q(`SELECT id, order_no, total, points_earned, points_redeemed, payment_status, created_at FROM orders WHERE member_id = ? ORDER BY id DESC LIMIT 50`).all(m.id);
    return m;
  });
  function memberFields(b) {
    const phone = String(b.phone || '').replace(/\D/g, '');
    if (!/^0\d{8,9}$/.test(phone)) throw new HttpError(400, 'เบอร์โทรไม่ถูกต้อง');
    return [phone, str(b.name, 'ชื่อสมาชิก'), str(b.birthday, 'วันเกิด', { required: false, max: 10 }), str(b.note, 'หมายเหตุ', { required: false, max: 500 })];
  }
  r.post('/api/members', auth(ROLES.STAFF), (ctx) => {
    const id = q('INSERT INTO members (phone, name, birthday, note) VALUES (?, ?, ?, ?)').run(...memberFields(ctx.body)).lastInsertRowid;
    return q('SELECT * FROM members WHERE id = ?').get(id);
  });
  r.put('/api/members/:id', auth(ROLES.STAFF), (ctx) => {
    const id = Number(ctx.params.id);
    q('UPDATE members SET phone = ?, name = ?, birthday = ?, note = ? WHERE id = ?').run(...memberFields(ctx.body), id);
    if (ctx.body.points !== undefined && ROLES.MGR.includes(ctx.user.role)) {
      const pts = num(ctx.body.points, 'แต้ม', { min: 0, int: true });
      const old = q('SELECT points FROM members WHERE id = ?').get(id);
      if (old && old.points !== pts) {
        q('UPDATE members SET points = ? WHERE id = ?').run(pts, id);
        audit(ctx.user.id, 'member_points_adjust', { id, from: old.points, to: pts });
      }
    }
    return q('SELECT * FROM members WHERE id = ?').get(id);
  });

  // ================= PROMOTIONS =================
  r.get('/api/promotions', auth(ROLES.STAFF), (ctx) => {
    if (ctx.query.active) {
      const today = localDate();
      return q(`SELECT * FROM promotions WHERE active = 1 AND (start_date IS NULL OR start_date = '' OR start_date <= ?) AND (end_date IS NULL OR end_date = '' OR end_date >= ?) ORDER BY id`).all(today, today);
    }
    return q('SELECT * FROM promotions ORDER BY active DESC, id').all();
  });
  function promoFields(b) {
    if (!['percent', 'amount'].includes(b.type)) throw new HttpError(400, 'ประเภทส่วนลดไม่ถูกต้อง');
    const value = num(b.value, 'มูลค่าส่วนลด', { min: 0, max: b.type === 'percent' ? 100 : Infinity });
    return [str(b.name, 'ชื่อโปรโมชั่น'), str(b.code, 'โค้ด', { required: false, max: 30 })?.toUpperCase() || null, b.type, value,
      num(b.min_total, 'ยอดขั้นต่ำ', { min: 0, required: false }) || 0, num(b.max_discount, 'ลดสูงสุด', { min: 0, required: false }) || 0,
      bool(b.members_only), b.start_date || null, b.end_date || null, b.active === undefined ? 1 : bool(b.active)];
  }
  r.post('/api/promotions', auth(ROLES.MGR), (ctx) => {
    const id = q('INSERT INTO promotions (name, code, type, value, min_total, max_discount, members_only, start_date, end_date, active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...promoFields(ctx.body)).lastInsertRowid;
    return q('SELECT * FROM promotions WHERE id = ?').get(id);
  });
  r.put('/api/promotions/:id', auth(ROLES.MGR), (ctx) => {
    q('UPDATE promotions SET name=?, code=?, type=?, value=?, min_total=?, max_discount=?, members_only=?, start_date=?, end_date=?, active=? WHERE id=?').run(...promoFields(ctx.body), Number(ctx.params.id));
    return q('SELECT * FROM promotions WHERE id = ?').get(Number(ctx.params.id));
  });

  // ================= SHIFTS =================
  r.get('/api/shifts/current', auth(ROLES.STAFF), () => {
    const s = currentShift();
    return s ? shiftSummary(s) : { shift: null };
  });
  r.post('/api/shifts/open', auth(ROLES.STAFF), (ctx) => tx(db, () => {
    if (currentShift()) throw new HttpError(409, 'มีกะที่เปิดอยู่แล้ว');
    const cash = num(ctx.body.opening_cash, 'เงินทอนตั้งต้น', { min: 0 });
    const id = q('INSERT INTO shifts (user_id, opening_cash) VALUES (?, ?)').run(ctx.user.id, cash).lastInsertRowid;
    audit(ctx.user.id, 'shift_open', { id, cash });
    return shiftSummary(currentShift());
  }));
  r.post('/api/shifts/cash', auth(ROLES.STAFF), (ctx) => {
    const s = currentShift();
    if (!s) throw new HttpError(400, 'ยังไม่ได้เปิดกะ');
    const type = ctx.body.type === 'in' ? 'in' : 'out';
    q('INSERT INTO cash_movements (shift_id, type, amount, reason, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, type, num(ctx.body.amount, 'จำนวนเงิน', { min: 0.01 }), str(ctx.body.reason, 'เหตุผล'), ctx.user.id);
    return shiftSummary(s);
  });
  r.post('/api/shifts/close', auth(ROLES.STAFF), (ctx) => tx(db, () => {
    const s = currentShift();
    if (!s) throw new HttpError(400, 'ยังไม่ได้เปิดกะ');
    const counted = num(ctx.body.counted_cash, 'เงินสดที่นับได้', { min: 0 });
    const sum = shiftSummary(s);
    q(`UPDATE shifts SET closed_at = datetime('now','localtime'), counted_cash = ?, expected_cash = ?, closed_by = ?, note = ? WHERE id = ?`)
      .run(counted, sum.expected_cash, ctx.user.id, str(ctx.body.note, 'หมายเหตุ', { required: false, max: 500 }), s.id);
    audit(ctx.user.id, 'shift_close', { id: s.id, counted, expected: sum.expected_cash });
    const closed = q('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(s.id);
    return { ...shiftSummary(closed), difference: round2(counted - sum.expected_cash) };
  }));
  r.get('/api/shifts', auth(ROLES.MGR), () =>
    q(`SELECT s.*, u.name AS user_name, c.name AS closed_by_name,
        (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.shift_id = s.id AND o.payment_status = 'paid') AS total_sales,
        (SELECT COUNT(*) FROM orders o WHERE o.shift_id = s.id AND o.payment_status = 'paid') AS order_count
       FROM shifts s JOIN users u ON u.id = s.user_id LEFT JOIN users c ON c.id = s.closed_by ORDER BY s.id DESC LIMIT 100`).all());

  // ================= ORDERS =================
  r.post('/api/orders/quote', auth(ROLES.STAFF), (ctx) => {
    const { lines, totals, member, promotion } = buildQuote(ctx.body);
    return {
      ...totals,
      items: lines.map((l) => ({ product_id: l.product.id, name: l.product.name, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total, options: l.options.map((o) => o.name) })),
      member: member && { id: member.id, name: member.name, points: member.points },
      promotion: promotion && { id: promotion.id, name: promotion.name }
    };
  });

  r.post('/api/orders', auth(ROLES.STAFF), (ctx) => {
    const b = ctx.body;
    const method = b.payment_method;
    if (!['cash', 'promptpay', 'card', 'transfer'].includes(method)) throw new HttpError(400, 'กรุณาเลือกวิธีชำระเงิน');
    const orderType = ['dine_in', 'takeaway', 'delivery'].includes(b.order_type) ? b.order_type : 'takeaway';

    const orderId = tx(db, () => {
      const shift = currentShift();
      if (!shift) throw new HttpError(400, 'กรุณาเปิดกะก่อนขาย');
      const { lines, member, promotion, settings, totals } = buildQuote(b);

      const maxDisc = Number(settings.max_cashier_discount || 0);
      if (totals.manual_discount > 0 && ctx.user.role === 'cashier' && totals.manual_discount > maxDisc) {
        checkManagerOverride(ctx, b.manager_pin);
      }
      const pay = calculateChange(totals.total, method, b.cash_received);

      const today = localDate();
      const queueNo = q('SELECT COUNT(*) AS c FROM orders WHERE date(created_at) = ?').get(today).c + 1;
      const orderNo = `${today.slice(2).replace(/-/g, '')}-${String(queueNo).padStart(4, '0')}`;

      const id = Number(q(`INSERT INTO orders (order_no, queue_no, shift_id, user_id, member_id, promotion_id, order_type, table_no, payment_method,
          subtotal, promo_discount, manual_discount, points_redeemed, points_discount, points_earned, vat, total, cash_received, change_amount, note)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        orderNo, queueNo, shift.id, ctx.user.id, member?.id ?? null, promotion?.id ?? null, orderType,
        str(b.table_no, 'โต๊ะ', { required: false, max: 20 }), method,
        totals.subtotal, totals.promo_discount, totals.manual_discount, totals.points_redeemed, totals.points_discount, totals.points_earned,
        totals.vat, totals.total, pay.cash_received, pay.change_amount, str(b.note, 'หมายเหตุ', { required: false, max: 500 })
      ).lastInsertRowid);

      // บันทึกรายการ + ตัดสต็อกตามสูตร + คำนวณต้นทุน
      const recipeStmt = q('SELECT r.ingredient_id, r.qty, i.cost_per_unit FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = ?');
      const ingCost = q('SELECT cost_per_unit FROM ingredients WHERE id = ?');
      const usage = new Map();
      let cost = 0;
      for (const l of lines) {
        q('INSERT INTO order_items (order_id, product_id, name, qty, unit_price, options_json, line_total, note) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, l.product.id, l.product.name, l.qty, l.unit_price,
            JSON.stringify(l.options.map((o) => ({ id: o.id, group: o.group, name: o.name, price_delta: o.price_delta }))), l.line_total, l.note);
        const recipe = recipeStmt.all(l.product.id);
        if (recipe.length) {
          for (const x of recipe) {
            usage.set(x.ingredient_id, (usage.get(x.ingredient_id) || 0) + x.qty * l.qty);
            cost += x.qty * l.qty * x.cost_per_unit;
          }
        } else {
          cost += l.product.cost * l.qty;
        }
        for (const o of l.options) {
          if (o.ingredient_id && o.ingredient_qty > 0) {
            usage.set(o.ingredient_id, (usage.get(o.ingredient_id) || 0) + o.ingredient_qty * l.qty);
            cost += o.ingredient_qty * l.qty * (ingCost.get(o.ingredient_id)?.cost_per_unit || 0);
          }
        }
      }
      for (const [ingId, qty] of usage) moveStock(ingId, -qty, 'sale', orderNo, ctx.user.id);
      q('UPDATE orders SET cost = ? WHERE id = ?').run(round2(cost), id);

      if (member) {
        q('UPDATE members SET points = points - ? + ?, total_spent = total_spent + ?, visits = visits + 1 WHERE id = ?')
          .run(totals.points_redeemed, totals.points_earned, totals.total, member.id);
      }
      audit(ctx.user.id, 'order_create', { id, orderNo, total: totals.total });
      return id;
    });
    return getOrder(orderId);
  });

  r.get('/api/orders', auth(ROLES.STAFF), (ctx) => {
    const date = ctx.query.date || localDate();
    const params = [date];
    let where = 'date(o.created_at) = ?';
    if (ctx.query.status) { where += ' AND o.payment_status = ?'; params.push(ctx.query.status); }
    if (ctx.query.q) { where += ' AND (o.order_no LIKE ? OR m.phone LIKE ? OR m.name LIKE ?)'; const t = `%${ctx.query.q}%`; params.push(t, t, t); }
    return q(`SELECT o.id, o.order_no, o.queue_no, o.order_type, o.table_no, o.status, o.payment_status, o.payment_method, o.total, o.created_at,
              u.name AS cashier_name, m.name AS member_name,
              (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS item_count
              FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN members m ON m.id = o.member_id
              WHERE ${where} ORDER BY o.id DESC`).all(...params);
  });

  r.get('/api/orders/:id', auth(ROLES.ALL), (ctx) => getOrder(Number(ctx.params.id)));

  r.post('/api/orders/:id/void', auth(ROLES.STAFF), (ctx) => {
    const id = Number(ctx.params.id);
    const reason = str(ctx.body.reason, 'เหตุผลการยกเลิก', { max: 300 });
    tx(db, () => {
      const approver = checkManagerOverride(ctx, ctx.body.manager_pin);
      const o = q('SELECT * FROM orders WHERE id = ?').get(id);
      if (!o) throw new HttpError(404, 'ไม่พบออเดอร์');
      if (o.payment_status === 'void') throw new HttpError(409, 'ออเดอร์นี้ถูกยกเลิกแล้ว');
      q(`UPDATE orders SET payment_status = 'void', void_reason = ?, voided_by = ?, voided_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(reason, approver, id);
      // คืนสต็อกตามที่ตัดไปจริง
      const used = q(`SELECT ingredient_id, SUM(change) AS change FROM stock_movements WHERE reason = 'sale' AND ref = ? GROUP BY ingredient_id`).all(o.order_no);
      for (const u of used) moveStock(u.ingredient_id, -u.change, 'void', o.order_no, ctx.user.id, reason);
      if (o.member_id) {
        q('UPDATE members SET points = MAX(0, points + ? - ?), total_spent = MAX(0, total_spent - ?), visits = MAX(0, visits - 1) WHERE id = ?')
          .run(o.points_redeemed, o.points_earned, o.total, o.member_id);
      }
      audit(ctx.user.id, 'order_void', { id, order_no: o.order_no, reason, approver });
    });
    return getOrder(id);
  });

  // ================= KITCHEN =================
  r.get('/api/kitchen', auth(ROLES.ALL), () => {
    const orders = q(`SELECT id, order_no, queue_no, order_type, table_no, status, note, created_at, updated_at FROM orders
                      WHERE payment_status = 'paid' AND status IN ('pending','preparing','ready') AND date(created_at) >= date(?, '-1 day')
                      ORDER BY id`).all(localDate());
    const items = orders.length
      ? q(`SELECT order_id, name, qty, options_json, note FROM order_items WHERE order_id IN (${orders.map(() => '?').join(',')})`).all(...orders.map((o) => o.id))
      : [];
    return orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id).map((i) => ({ ...i, options: JSON.parse(i.options_json).map((x) => x.name) })) }));
  });
  r.patch('/api/orders/:id/status', auth(ROLES.ALL), (ctx) => {
    const status = ctx.body.status;
    if (!ORDER_FLOW.includes(status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    const res = q(`UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND payment_status = 'paid'`).run(status, Number(ctx.params.id));
    if (!res.changes) throw new HttpError(404, 'ไม่พบออเดอร์');
    return { id: Number(ctx.params.id), status };
  });

  // ================= REPORTS =================
  function range(ctx) {
    const from = ctx.query.from || localDate();
    const to = ctx.query.to || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, 'รูปแบบวันที่ไม่ถูกต้อง');
    return [from, to];
  }
  r.get('/api/reports/summary', auth(ROLES.MGR), (ctx) => {
    const [from, to] = range(ctx);
    const W = `date(o.created_at) BETWEEN ? AND ?`;
    const kpi = q(`SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(promo_discount + manual_discount + points_discount),0) AS discounts,
                   COALESCE(SUM(total),0) AS net, COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(cost),0) AS cost,
                   COUNT(DISTINCT member_id) AS members
                   FROM orders o WHERE ${W} AND payment_status = 'paid'`).get(from, to);
    kpi.profit = round2(kpi.net - kpi.vat - kpi.cost);
    kpi.avg_ticket = kpi.orders ? round2(kpi.net / kpi.orders) : 0;
    kpi.voids = q(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM orders o WHERE ${W} AND payment_status = 'void'`).get(from, to);
    return {
      from, to, kpi,
      by_payment: q(`SELECT payment_method, COUNT(*) AS count, SUM(total) AS total FROM orders o WHERE ${W} AND payment_status='paid' GROUP BY payment_method ORDER BY total DESC`).all(from, to),
      by_type: q(`SELECT order_type, COUNT(*) AS count, SUM(total) AS total FROM orders o WHERE ${W} AND payment_status='paid' GROUP BY order_type`).all(from, to),
      by_hour: q(`SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count, SUM(total) AS total FROM orders o WHERE ${W} AND payment_status='paid' GROUP BY hour ORDER BY hour`).all(from, to),
      by_day: q(`SELECT date(created_at) AS day, COUNT(*) AS count, SUM(total) AS total, SUM(cost) AS cost FROM orders o WHERE ${W} AND payment_status='paid' GROUP BY day ORDER BY day`).all(from, to),
      top_products: q(`SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE ${W} AND o.payment_status='paid' GROUP BY oi.product_id, oi.name ORDER BY qty DESC LIMIT 15`).all(from, to),
      by_category: q(`SELECT COALESCE(c.name,'อื่น ๆ') AS category, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
                      WHERE ${W} AND o.payment_status='paid' GROUP BY c.id ORDER BY revenue DESC`).all(from, to),
      by_staff: q(`SELECT u.name, COUNT(*) AS count, SUM(o.total) AS total FROM orders o JOIN users u ON u.id = o.user_id WHERE ${W} AND payment_status='paid' GROUP BY u.id ORDER BY total DESC`).all(from, to),
      low_stock: q('SELECT name, unit, stock, min_stock FROM ingredients WHERE active = 1 AND stock <= min_stock ORDER BY stock / NULLIF(min_stock,0)').all()
    };
  });

  r.get('/api/reports/export.csv', auth(ROLES.MGR), (ctx) => {
    const [from, to] = range(ctx);
    const rows = q(`SELECT o.order_no, o.created_at, o.order_type, o.payment_method, o.payment_status, u.name AS cashier, m.phone AS member,
                    o.subtotal, o.promo_discount + o.manual_discount + o.points_discount AS discount, o.vat, o.total, o.cost,
                    (SELECT GROUP_CONCAT(name || ' x' || qty, ' | ') FROM order_items WHERE order_id = o.id) AS items
                    FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN members m ON m.id = o.member_id
                    WHERE date(o.created_at) BETWEEN ? AND ? ORDER BY o.id`).all(from, to);
    const cols = ['order_no', 'created_at', 'order_type', 'payment_method', 'payment_status', 'cashier', 'member', 'subtotal', 'discount', 'vat', 'total', 'cost', 'items'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [cols.join(','), ...rows.map((row) => cols.map((c) => esc(row[c])).join(','))].join('\n');
    send(ctx.res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales_${from}_${to}.csv"` });
  });

  r.get('/api/audit', auth(ROLES.OWNER), () =>
    q('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300').all());

  // ================= USERS =================
  r.get('/api/users', auth(ROLES.OWNER), () => q('SELECT id, name, role, active, created_at FROM users ORDER BY active DESC, id').all());
  function userFields(b) {
    if (!ROLES.ALL.includes(b.role)) throw new HttpError(400, 'ตำแหน่งไม่ถูกต้อง');
    return [str(b.name, 'ชื่อพนักงาน', { max: 60 }), b.role];
  }
  const validPin = (pin) => { if (!/^\d{4,6}$/.test(String(pin))) throw new HttpError(400, 'PIN ต้องเป็นตัวเลข 4-6 หลัก'); return String(pin); };
  r.post('/api/users', auth(ROLES.OWNER), (ctx) => {
    const id = q('INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)').run(...userFields(ctx.body), hashPin(validPin(ctx.body.pin))).lastInsertRowid;
    audit(ctx.user.id, 'user_create', { id });
    return q('SELECT id, name, role, active FROM users WHERE id = ?').get(id);
  });
  r.put('/api/users/:id', auth(ROLES.OWNER), (ctx) => tx(db, () => {
    const id = Number(ctx.params.id);
    const [name, role] = userFields(ctx.body);
    const active = ctx.body.active === undefined ? 1 : bool(ctx.body.active);
    q('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, id);
    if (!q(`SELECT 1 FROM users WHERE role = 'owner' AND active = 1`).get()) throw new HttpError(400, 'ต้องมีเจ้าของร้านที่ใช้งานอยู่อย่างน้อย 1 คน');
    if (ctx.body.pin) q('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(validPin(ctx.body.pin)), id);
    if (!active || ctx.body.pin) q('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, ctx.token);
    audit(ctx.user.id, 'user_update', { id, role, active, pin_changed: !!ctx.body.pin });
    return q('SELECT id, name, role, active FROM users WHERE id = ?').get(id);
  }));

  return r;
}

module.exports = { createApi, localDate };
