'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts';
import { formatAmount } from '@/domain/money';

const BAR = '#b8761a';        // validated: passes lightness, chroma and 3:1 contrast on the card surface
const GRID = '#efe4d2';
const AXIS = '#6e5a48';

interface Point { label: string; value: number }

function TooltipBox({ active, payload, label, unit }: { active?: boolean; payload?: { value?: number | string }[]; label?: string | number; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{unit}{formatAmount(Number(payload[0]?.value ?? 0))}</p>
    </div>
  );
}

/** Single-series vertical bars (no legend needed: the card title names the series). */
export function ColumnChart({ data, title, unit = '฿', height = 240 }: { data: Point[]; title: string; unit?: string; height?: number }) {
  return (
    <figure aria-label={title}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} width={56}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip cursor={{ fill: '#f5ecdd' }} content={<TooltipBox unit={unit} />} />
          <Bar dataKey="value" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Horizontal bars with direct value labels — used for part-to-whole (payment mix) instead of a pie. */
export function RankedBars({ data, title, unit = '฿' }: { data: Point[]; title: string; unit?: string }) {
  return (
    <figure aria-label={title}>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 72, left: 8, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tick={{ fill: AXIS, fontSize: 13 }} tickLine={false} axisLine={false} width={96} />
          <Tooltip cursor={{ fill: '#f5ecdd' }} content={<TooltipBox unit={unit} />} />
          <Bar dataKey="value" fill={BAR} radius={[0, 4, 4, 0]} maxBarSize={24}>
            <LabelList dataKey="value" position="right" formatter={(v) => `${unit}${formatAmount(Number(v))}`} style={{ fill: '#2f2219', fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
