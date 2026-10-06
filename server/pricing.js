'use strict';
// ตรรกะคำนวณราคา (pure function — ทดสอบได้ ไม่แตะฐานข้อมูล)

class PricingError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * ราคาต่อหน่วยของสินค้า 1 รายการ พร้อมตรวจตัวเลือกตามกฎของกลุ่ม
 * @param {object} product  { price, name }
 * @param {Array} groups    กลุ่มตัวเลือกที่ผูกกับสินค้า [{id,name,required,multiple,max_select,options:[{id,name,price_delta}]}]
 * @param {Array<number>} optionIds ตัวเลือกที่ลูกค้าเลือก
 */
function priceItem(product, groups, optionIds = []) {
  const chosen = new Set(optionIds.map(Number));
  const selected = [];
  for (const g of groups) {
    const picked = g.options.filter((o) => chosen.has(o.id));
    if (g.required && picked.length === 0) throw new PricingError(`${product.name}: กรุณาเลือก "${g.name}"`);
    if (!g.multiple && picked.length > 1) throw new PricingError(`${product.name}: "${g.name}" เลือกได้ 1 อย่าง`);
    if (g.multiple && g.max_select > 0 && picked.length > g.max_select) {
      throw new PricingError(`${product.name}: "${g.name}" เลือกได้ไม่เกิน ${g.max_select} อย่าง`);
    }
    for (const o of picked) { selected.push({ ...o, group: g.name }); chosen.delete(o.id); }
  }
  if (chosen.size > 0) throw new PricingError(`${product.name}: มีตัวเลือกที่ไม่ถูกต้อง`);
  const unit = round2(product.price + selected.reduce((s, o) => s + Number(o.price_delta), 0));
  return { unit_price: Math.max(0, unit), options: selected };
}

function isPromotionValid(promo, { subtotal, hasMember, today }) {
  if (!promo || !promo.active) return 'โปรโมชั่นไม่พร้อมใช้งาน';
  if (promo.members_only && !hasMember) return 'โปรโมชั่นนี้สำหรับสมาชิกเท่านั้น';
  if (promo.start_date && today < promo.start_date) return 'โปรโมชั่นยังไม่เริ่ม';
  if (promo.end_date && today > promo.end_date) return 'โปรโมชั่นหมดอายุแล้ว';
  if (subtotal < promo.min_total) return `ยอดขั้นต่ำ ${promo.min_total} บาท`;
  return null;
}

/**
 * สรุปยอดบิล
 * ลำดับ: subtotal → ส่วนลดโปรโมชั่น → ส่วนลดเอง → แลกแต้ม → VAT → total
 */
function calculateTotals({ lines, promotion = null, member = null, manualDiscount = 0, redeemPoints = 0, settings, today }) {
  const s = {
    vat_enabled: settings.vat_enabled === '1' || settings.vat_enabled === true,
    vat_rate: Number(settings.vat_rate || 0),
    vat_inclusive: settings.vat_inclusive !== '0' && settings.vat_inclusive !== false,
    baht_per_point: Number(settings.baht_per_point || 0),
    point_value: Number(settings.point_value || 0),
    min_redeem_points: Number(settings.min_redeem_points || 0)
  };
  if (!Array.isArray(lines) || lines.length === 0) throw new PricingError('ไม่มีรายการสินค้า');

  const subtotal = round2(lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0));
  let remaining = subtotal;

  let promoDiscount = 0;
  if (promotion) {
    const err = isPromotionValid(promotion, { subtotal, hasMember: !!member, today: today || new Date().toISOString().slice(0, 10) });
    if (err) throw new PricingError(err);
    promoDiscount = promotion.type === 'percent' ? subtotal * promotion.value / 100 : promotion.value;
    if (promotion.max_discount > 0) promoDiscount = Math.min(promoDiscount, promotion.max_discount);
    promoDiscount = round2(Math.min(promoDiscount, remaining));
    remaining = round2(remaining - promoDiscount);
  }

  manualDiscount = round2(Math.max(0, Number(manualDiscount) || 0));
  if (manualDiscount > remaining) throw new PricingError('ส่วนลดมากกว่ายอดคงเหลือ');
  remaining = round2(remaining - manualDiscount);

  redeemPoints = Math.max(0, Math.floor(Number(redeemPoints) || 0));
  let pointsDiscount = 0;
  if (redeemPoints > 0) {
    if (!member) throw new PricingError('ต้องเลือกสมาชิกก่อนแลกแต้ม');
    if (redeemPoints > member.points) throw new PricingError(`แต้มไม่พอ (มี ${member.points} แต้ม)`);
    if (redeemPoints < s.min_redeem_points) throw new PricingError(`แลกขั้นต่ำ ${s.min_redeem_points} แต้ม`);
    pointsDiscount = round2(redeemPoints * s.point_value);
    if (pointsDiscount > remaining) throw new PricingError('แต้มที่แลกเกินยอดที่ต้องชำระ');
    remaining = round2(remaining - pointsDiscount);
  }

  let vat = 0;
  let total = remaining;
  if (s.vat_enabled && s.vat_rate > 0) {
    if (s.vat_inclusive) {
      vat = round2(remaining * s.vat_rate / (100 + s.vat_rate));
    } else {
      vat = round2(remaining * s.vat_rate / 100);
      total = round2(remaining + vat);
    }
  }

  const pointsEarned = member && s.baht_per_point > 0 ? Math.floor(total / s.baht_per_point) : 0;

  return {
    subtotal,
    promo_discount: promoDiscount,
    manual_discount: manualDiscount,
    points_redeemed: redeemPoints,
    points_discount: pointsDiscount,
    vat,
    vat_inclusive: s.vat_inclusive,
    total,
    points_earned: pointsEarned
  };
}

function calculateChange(total, method, cashReceived) {
  if (method !== 'cash') return { cash_received: total, change_amount: 0 };
  const received = round2(Number(cashReceived) || 0);
  if (received < total) throw new PricingError('รับเงินไม่พอ');
  return { cash_received: received, change_amount: round2(received - total) };
}

module.exports = { priceItem, calculateTotals, calculateChange, isPromotionValid, round2, PricingError };
