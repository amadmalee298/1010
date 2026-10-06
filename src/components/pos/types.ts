import type { PricingSettings, PromotionRule } from '@/domain/pricing';

export interface PosProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  categoryId: string | null;
  imageUrl: string | null;
  available: number | null;   // null = not stock-tracked
}

export interface ReceiptSettings {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  taxId: string;
  vatEnabled: boolean;
  vatRate: number;
  receiptFooter: string;
}

export interface PosConfig {
  pricing: PricingSettings;
  receipt: ReceiptSettings;
  promptpayId: string;
  maxCashierDiscount: number;
  isCashier: boolean;
}

export interface PosMenu {
  categories: { id: string; name: string }[];
  products: PosProduct[];
  promotions: PromotionRule[];
  fetchedAt: string;
}
