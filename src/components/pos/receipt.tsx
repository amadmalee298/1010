'use client';
import { formatAmount } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';
import { useI18n } from '@/i18n/client';
import type { OrderDocument } from '@/domain/schemas/orders';
import type { ReceiptSettings } from './types';

/** 80mm thermal receipt. Wrap in .print-area and call window.print(). */
export function Receipt({ order, settings, copy = false }: { order: OrderDocument; settings: ReceiptSettings; copy?: boolean }) {
  const { t } = useI18n();
  const row = (label: string, value: string, bold = false) => (
    <div className={`flex justify-between gap-2 ${bold ? 'text-base font-bold' : ''}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>
  );
  const cash = order.payments.filter((p) => p.method === 'CASH');
  return (
    <div className="mx-auto w-[74mm] bg-white p-2 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <p className="text-base font-bold">{settings.shopName}</p>
        {settings.shopAddress ? <p>{settings.shopAddress}</p> : null}
        {settings.shopPhone ? <p>โทร {settings.shopPhone}</p> : null}
        {settings.taxId ? <p>TAX ID {settings.taxId}</p> : null}
        <p>{settings.vatEnabled ? t.orders.taxInvoice : t.orders.receipt}{copy ? ` (${t.orders.copy})` : ''}</p>
        {order.status === 'CANCELLED' ? <p className="font-bold">*** {t.orders.status.CANCELLED} ***</p> : null}
      </div>
      <hr className="my-1.5 border-dashed border-black" />
      <p className="text-center">{t.pos.queue}</p>
      <p className="text-center text-3xl font-bold">{order.queue_number}</p>
      <p>{order.order_number} · {t.pos.orderType[order.order_type]}{order.table_label ? ` · ${order.table_label}` : ''}</p>
      <p>{formatDateTime(order.created_at)} · {order.cashier_name ?? ''}</p>
      <hr className="my-1.5 border-dashed border-black" />
      {order.items.map((i) => (
        <div key={i.id}>
          {row(`${i.quantity} x ${i.product_name}`, formatAmount(i.line_total))}
          {i.note ? <p className="pl-3">* {i.note}</p> : null}
        </div>
      ))}
      <hr className="my-1.5 border-dashed border-black" />
      {row(t.pos.subtotal, formatAmount(order.subtotal))}
      {order.promotion_discount > 0 ? row(t.pos.promotion, `-${formatAmount(order.promotion_discount)}`) : null}
      {order.manual_discount > 0 ? row(t.pos.discounts, `-${formatAmount(order.manual_discount)}`) : null}
      {order.points_discount > 0 ? row(`${t.pos.redeemPoints} ${order.points_redeemed}`, `-${formatAmount(order.points_discount)}`) : null}
      {row(t.pos.total, formatAmount(order.total), true)}
      {settings.vatEnabled ? row(`${t.pos.vat} ${settings.vatRate}%`, formatAmount(order.vat_amount)) : null}
      {order.payments.map((p, i) => <div key={i}>{row(t.pos.method[p.method], formatAmount(p.tendered ?? p.amount))}</div>)}
      {cash.length ? row(t.pos.change, formatAmount(cash.reduce((s, p) => s + p.change_amount, 0))) : null}
      {order.customer ? (
        <>
          <hr className="my-1.5 border-dashed border-black" />
          <p>{order.customer.name} {order.customer.phone ?? ''}</p>
          <p>+{order.points_earned} {t.pos.points} · {order.customer.points_balance} {t.pos.points}</p>
        </>
      ) : null}
      {order.note ? <p className="mt-1">{t.pos.orderNote}: {order.note}</p> : null}
      <hr className="my-1.5 border-dashed border-black" />
      <p className="text-center">{settings.receiptFooter}</p>
    </div>
  );
}
