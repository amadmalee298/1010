'use client';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { CloudOff, Printer, RefreshCw, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/client';
import { cartItemCount, cartReducer, emptyCart, type CartState } from '@/domain/cart';
import { priceOrder, PricingError, type PricingResult } from '@/domain/pricing';
import { formatAmount } from '@/domain/money';
import type { PaymentLine } from '@/domain/payments';
import type { CreateOrderInput, OrderDocument } from '@/domain/schemas/orders';
import { createOrderAction } from '@/server/actions/orders';
import { readJson, writeJson } from '@/lib/offline/storage';
import { enqueueOrder } from '@/lib/offline/order-queue';
import { useOrderSync } from '@/hooks/use-order-sync';
import { useOnline } from '@/components/pwa/online-status';
import { ProductGrid } from './product-grid';
import { CartPanel } from './cart-panel';
import { CustomerDialog } from './customer-dialog';
import { DiscountDialog } from './discount-dialog';
import { PaymentDialog } from './payment-dialog';
import { Receipt } from './receipt';
import type { PosConfig, PosMenu, PosProduct } from './types';

const CART_KEY = 'pos.cart';
const MENU_KEY = 'pos.menu';

export function PosScreen({ menu: serverMenu, config, sessionOpen }: { menu: PosMenu | null; config: PosConfig; sessionOpen: boolean }) {
  const { t } = useI18n();
  const online = useOnline();
  const { queue, flush } = useOrderSync();
  const [menu, setMenu] = useState<PosMenu | null>(serverMenu);
  const [cart, dispatch] = useReducer(cartReducer, undefined, emptyCart);
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'customer' | 'discount' | 'payment' | 'cart' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ order: OrderDocument | null; queued: boolean; change: number; total: number } | null>(null);
  const clientRef = useRef<string | null>(null);
  const hydrated = useRef(false);

  // Cache the menu for offline use; fall back to the cached copy when the server had none.
  useEffect(() => {
    if (serverMenu) writeJson(MENU_KEY, serverMenu);
    else {
      const cached = readJson<PosMenu | null>(MENU_KEY, null);
      if (cached) { setMenu(cached); toast.info(t.pos.menuCached); }
    }
  }, [serverMenu, t]);

  // Restore and persist the cart per device; drop products that are no longer sold and refresh prices.
  useEffect(() => {
    const saved = readJson<CartState | null>(CART_KEY, null);
    if (saved) dispatch({ type: 'load', state: saved });
    hydrated.current = true;
  }, []);
  useEffect(() => { if (hydrated.current) writeJson(CART_KEY, cart); }, [cart]);
  useEffect(() => {
    if (menu) dispatch({ type: 'repriced', prices: Object.fromEntries(menu.products.map((p) => [p.id, p.price])) });
  }, [menu]);

  const products = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (menu?.products ?? []).filter((p) => (category === 'all' || p.categoryId === category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)));
  }, [menu, category, search]);

  const promotion = menu?.promotions.find((p) => p.id === cart.promotionId) ?? null;
  const { pricing, pricingError } = useMemo((): { pricing: PricingResult | null; pricingError: string | null } => {
    if (!cart.lines.length) return { pricing: null, pricingError: null };
    try {
      const pricing = priceOrder({
        lines: cart.lines.map((l) => ({ productId: l.productId, unitPrice: l.unitPrice, quantity: l.quantity })),
        promotion, customer: cart.customer, manualDiscount: cart.manualDiscount, redeemPoints: cart.redeemPoints,
      }, config.pricing);
      if (config.isCashier && pricing.manualDiscount > config.maxCashierDiscount) {
        return { pricing, pricingError: `${t.pos.manualDiscount} ≤ ฿${formatAmount(config.maxCashierDiscount)}` };
      }
      return { pricing, pricingError: null };
    } catch (e) {
      return { pricing: null, pricingError: e instanceof PricingError ? `${t.errors.validation}: ${e.code}` : t.errors.generic };
    }
  }, [cart, promotion, config, t]);

  function addProduct(p: PosProduct) {
    if (p.available !== null && p.available <= 0) toast.warning(`${p.name}: ${t.pos.outOfStock}`);
    dispatch({ type: 'add', product: { id: p.id, name: p.name, price: p.price } });
  }

  function openPayment() {
    clientRef.current = crypto.randomUUID();
    setDialog('payment');
  }

  async function confirmPayment(lines: PaymentLine[]) {
    if (!pricing || !clientRef.current) return;
    const payload: CreateOrderInput = {
      client_ref: clientRef.current,
      order_type: cart.orderType,
      table_label: cart.tableLabel || undefined,
      note: cart.note || undefined,
      customer_id: cart.customer?.id,
      promotion_id: cart.promotionId ?? undefined,
      promo_code: undefined,
      manual_discount: cart.manualDiscount,
      redeem_points: cart.redeemPoints,
      items: cart.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, note: l.note || undefined })),
      payments: lines.map((l) => ({ method: l.method, amount: l.amount, tendered: l.tendered, reference: l.reference })),
    };
    const change = lines.reduce((s, l) => s + (l.method === 'CASH' ? (l.tendered ?? l.amount) - l.amount : 0), 0);
    const queueOffline = () => {
      enqueueOrder(payload, pricing.total);
      setDone({ order: null, queued: true, change, total: pricing.total });
      dispatch({ type: 'clear' });
      setDialog(null);
    };
    if (!navigator.onLine) return queueOffline();
    setSubmitting(true);
    try {
      const res = await createOrderAction(payload);
      if (res.ok) {
        setDone({ order: res.data, queued: false, change, total: res.data.total });
        dispatch({ type: 'clear' });
        setDialog(null);
      } else {
        toast.error(res.error);
      }
    } catch {
      queueOffline(); // network dropped mid-request: idempotent client_ref makes the retry safe
    } finally {
      setSubmitting(false);
    }
  }

  const failed = queue.filter((q) => q.status === 'FAILED');
  const cartPanel = (cls?: string) => (
    <CartPanel
      className={cls}
      cart={cart}
      dispatch={dispatch}
      pricing={pricing}
      pricingError={pricingError}
      onCustomer={() => setDialog('customer')}
      onDiscount={() => setDialog('discount')}
      onCharge={openPayment}
      chargeDisabled={!pricing || !!pricingError || !sessionOpen}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] lg:h-[calc(100dvh-2.5rem)]">
      {/* Desktop: category column */}
      <nav className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2 xl:flex">
        {[{ id: 'all', name: t.pos.allCategories }, ...(menu?.categories ?? [])].map((c) => (
          <button key={c.id} type="button" onClick={() => setCategory(c.id)}
            className={cn('rounded-xl px-3 py-3 text-left text-sm font-medium', category === c.id ? 'bg-foreground text-background' : 'hover:bg-muted')}>
            {c.name}
          </button>
        ))}
      </nav>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="grid gap-2 border-b border-border p-3">
          {!sessionOpen ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-warning/20 p-3 text-sm">
              <span>{t.pos.sessionClosed}</span>
              <Button asChild size="sm"><Link href="/cash">{t.pos.openDrawer}</Link></Button>
            </div>
          ) : null}
          {queue.length ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-info/10 p-2 text-sm">
              <CloudOff className="size-4" /> {t.pos.pendingSync}: {queue.length - failed.length}
              {failed.length ? <Badge variant="destructive">{t.pos.syncFailed}: {failed.length}</Badge> : null}
              <Button size="sm" variant="outline" className="ml-auto" disabled={!online} onClick={() => void flush()}><RefreshCw /> {t.pos.syncNow}</Button>
            </div>
          ) : null}
          <Input type="search" placeholder={t.pos.searchProducts} value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && products[0]) { addProduct(products[0]); setSearch(''); } }} />
          <div className="flex gap-2 overflow-x-auto pb-1 xl:hidden">
            {[{ id: 'all', name: t.pos.allCategories }, ...(menu?.categories ?? [])].map((c) => (
              <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                className={cn('shrink-0 rounded-full border px-4 py-2 text-sm font-medium', category === c.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-card')}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-28 md:pb-3">
          <ProductGrid products={products} onAdd={addProduct} />
        </div>
      </section>

      {/* Tablet & desktop: cart column */}
      {cartPanel('hidden w-[360px] shrink-0 border-l border-border md:flex xl:w-[400px]')}

      {/* Mobile: cart as bottom sheet */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <Button size="lg" className="w-full justify-between" onClick={() => setDialog('cart')} disabled={!cart.lines.length}>
          <span className="flex items-center gap-2"><ShoppingBag /> {cartItemCount(cart)} {t.pos.items}</span>
          <span className="tabular-nums">฿{formatAmount(pricing?.total ?? 0)}</span>
        </Button>
      </div>
      <Dialog open={dialog === 'cart'} onOpenChange={(o) => setDialog(o ? 'cart' : null)}>
        <DialogContent side="bottom" className="h-[88dvh] p-0">
          <DialogHeader className="px-4 pt-4"><DialogTitle>{t.pos.cart}</DialogTitle></DialogHeader>
          {cartPanel('min-h-0 flex-1')}
        </DialogContent>
      </Dialog>

      <CustomerDialog open={dialog === 'customer'} onOpenChange={(o) => setDialog(o ? 'customer' : null)} onSelect={(c) => dispatch({ type: 'set', patch: { customer: c } })} />
      {dialog === 'discount' ? (
        <DiscountDialog open onOpenChange={(o) => setDialog(o ? 'discount' : null)} cart={cart} promotions={menu?.promotions ?? []}
          maxCashierDiscount={config.maxCashierDiscount} isCashier={config.isCashier} onApply={(patch) => dispatch({ type: 'set', patch })} />
      ) : null}
      {dialog === 'payment' && pricing ? (
        <PaymentDialog open onOpenChange={(o) => setDialog(o ? 'payment' : null)} total={pricing.total} promptpayId={config.promptpayId}
          submitting={submitting} onConfirm={(lines) => void confirmPayment(lines)} />
      ) : null}

      <Dialog open={done !== null} onOpenChange={(o) => !o && setDone(null)}>
        <DialogContent className="max-w-sm text-center">
          {done ? (
            <>
              <DialogHeader><DialogTitle className="text-center">{done.queued ? t.pos.queuedOffline : t.pos.success}</DialogTitle></DialogHeader>
              {done.order ? (
                <div>
                  <p className="text-sm text-muted-foreground">{t.pos.queue}</p>
                  <p className="text-6xl font-bold text-primary-strong">{done.order.queue_number}</p>
                  <p className="text-sm text-muted-foreground">{done.order.order_number}</p>
                </div>
              ) : null}
              <p className="text-lg">฿{formatAmount(done.total)}</p>
              {done.change > 0 ? <p className="rounded-xl bg-success/10 p-3 text-2xl font-bold text-success-strong">{t.pos.change} ฿{formatAmount(done.change)}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                {done.order ? <Button variant="outline" onClick={() => window.print()}><Printer /> {t.pos.printReceipt}</Button> : <span />}
                <Button onClick={() => setDone(null)} autoFocus>{t.pos.newOrder}</Button>
              </div>
              {done.order && typeof document !== 'undefined'
                ? createPortal(<div className="print-area hidden print:block"><Receipt order={done.order} settings={config.receipt} /></div>, document.body)
                : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
