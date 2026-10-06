import {
  BarChart3, Boxes, ClipboardList, CookingPot, FileClock, FolderTree, LayoutDashboard, Package,
  Receipt, Settings, ShoppingCart, Tag, Truck, UserCog, Users, Wallet, Wheat, Factory, ScrollText,
  type LucideIcon,
} from 'lucide-react';
import type { IconName } from '@/config/navigation';

const ICONS: Record<IconName, LucideIcon> = {
  pos: ShoppingCart, orders: Receipt, dashboard: LayoutDashboard, products: Package,
  categories: FolderTree, ingredients: Wheat, recipes: ScrollText, inventory: Boxes, production: Factory,
  suppliers: Truck, purchasing: ClipboardList, customers: Users, promotions: Tag, expenses: Wallet, cash: CookingPot,
  reports: BarChart3, employees: UserCog, audit: FileClock, settings: Settings,
};

export function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}
