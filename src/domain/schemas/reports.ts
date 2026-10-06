import { z } from 'zod';

const n = z.coerce.number();
const nn = n.nullable();

export const salesReportSchema = z.object({
  summary: z.object({
    orders: n, gross_sales: n, discounts: n, vat: n, refunds: n, net_sales: n, cogs: n, avg_ticket: n, cancelled: n,
  }),
  by_day: z.array(z.object({ day: z.string(), net_sales: n, cogs: n, orders: n })),
  by_hour: z.array(z.object({ hour: n, orders: n, net_sales: n })),
  by_payment: z.array(z.object({ method: z.enum(['CASH', 'QR', 'TRANSFER', 'CARD']), orders: n, amount: n })),
  by_order_type: z.array(z.object({ order_type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']), orders: n, net_sales: n })),
});
export type SalesReport = z.infer<typeof salesReportSchema>;

export const pnlSchema = z.object({
  gross_sales: n, discounts: n, refunds: n, vat: n, net_sales: n, cogs: n, gross_profit: n, gross_margin: nn,
  waste: n, shrinkage: n, expenses: z.array(z.object({ category: z.string(), amount: n })), expenses_total: n,
  net_profit: n, net_margin: nn,
});
export type ProfitAndLoss = z.infer<typeof pnlSchema>;

export const dashboardSchema = z.object({
  date: z.string(),
  pnl: pnlSchema,
  orders: n,
  avg_ticket: n,
  by_payment: salesReportSchema.shape.by_payment,
  by_hour: salesReportSchema.shape.by_hour,
  trend: salesReportSchema.shape.by_day,
  top_products: z.array(z.object({ product_name: z.string(), quantity: n, net_sales: n, gross_margin: nn })),
  low_stock: z.array(z.object({ id: z.string(), name_th: z.string(), unit: z.string(), stock_qty: n, reorder_level: n })),
  open_session: z.boolean(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const REPORT_TYPES = ['sales', 'products', 'inventory', 'purchases', 'production', 'expenses', 'cogs', 'pnl', 'menu', 'cash', 'employees'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((r) => r.from <= r.to, 'from must be before to');
