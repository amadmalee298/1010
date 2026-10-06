/** POS cart state (pure reducer, persisted per device). */
export interface CartLine {
  key: string;             // productId + note — same product with different notes stays separate
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  note: string;
}

export interface CartState {
  lines: CartLine[];
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  tableLabel: string;
  customer: { id: string; name: string; phone: string | null; pointsBalance: number } | null;
  promotionId: string | null;
  manualDiscount: number;
  redeemPoints: number;
  note: string;
}

export const emptyCart = (): CartState => ({
  lines: [], orderType: 'TAKEAWAY', tableLabel: '', customer: null, promotionId: null, manualDiscount: 0, redeemPoints: 0, note: '',
});

export type CartAction =
  | { type: 'add'; product: { id: string; name: string; price: number }; quantity?: number; note?: string }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'setNote'; key: string; note: string }
  | { type: 'remove'; key: string }
  | { type: 'set'; patch: Partial<Omit<CartState, 'lines'>> }
  | { type: 'repriced'; prices: Record<string, number> }
  | { type: 'clear' }
  | { type: 'load'; state: CartState };

const lineKey = (productId: string, note: string) => `${productId}::${note.trim()}`;

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const note = (action.note ?? '').trim();
      const key = lineKey(action.product.id, note);
      const qty = action.quantity ?? 1;
      const existing = state.lines.find((l) => l.key === key);
      const lines = existing
        ? state.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, l.quantity + qty) } : l))
        : [...state.lines, { key, productId: action.product.id, name: action.product.name, unitPrice: action.product.price, quantity: qty, note }];
      return { ...state, lines };
    }
    case 'setQuantity':
      return {
        ...state,
        lines: action.quantity <= 0
          ? state.lines.filter((l) => l.key !== action.key)
          : state.lines.map((l) => (l.key === action.key ? { ...l, quantity: Math.min(999, Math.floor(action.quantity)) } : l)),
      };
    case 'setNote': {
      const target = state.lines.find((l) => l.key === action.key);
      if (!target) return state;
      const note = action.note.trim();
      const newKey = lineKey(target.productId, note);
      const others = state.lines.filter((l) => l.key !== action.key);
      const merge = others.find((l) => l.key === newKey);
      return {
        ...state,
        lines: merge
          ? others.map((l) => (l.key === newKey ? { ...l, quantity: Math.min(999, l.quantity + target.quantity) } : l))
          : state.lines.map((l) => (l.key === action.key ? { ...l, key: newKey, note } : l)),
      };
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
    case 'set': {
      const next = { ...state, ...action.patch };
      if ('customer' in action.patch && !action.patch.customer) next.redeemPoints = 0;
      return next;
    }
    case 'repriced':
      return { ...state, lines: state.lines.filter((l) => l.productId in action.prices).map((l) => ({ ...l, unitPrice: action.prices[l.productId] ?? l.unitPrice })) };
    case 'clear':
      return emptyCart();
    case 'load':
      return action.state;
  }
}

export const cartItemCount = (s: CartState) => s.lines.reduce((n, l) => n + l.quantity, 0);
