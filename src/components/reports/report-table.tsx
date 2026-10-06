import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatAmount, formatPercent } from '@/domain/money';
import type { CsvValue } from '@/domain/csv';
import { cn } from '@/lib/utils';

export function ReportTableView({ headers, rows, numeric, percent = [], emptyText }: {
  headers: string[]; rows: CsvValue[][]; numeric: number[]; percent?: number[]; emptyText: string;
}) {
  const fmt = (v: CsvValue, i: number) => {
    if (v === null || v === undefined || v === '') return '—';
    if (percent.includes(i)) return formatPercent(Number(v));
    if (numeric.includes(i) && typeof v === 'number') return formatAmount(v);
    return String(v);
  };
  return (
    <Table>
      <THead><TR>{headers.map((h, i) => <TH key={i} className={numeric.includes(i) ? 'text-right' : ''}>{h}</TH>)}</TR></THead>
      <TBody>
        {rows.length === 0 ? <TR><TD colSpan={headers.length} className="py-8 text-center text-muted-foreground">{emptyText}</TD></TR> : null}
        {rows.map((r, ri) => (
          <TR key={ri}>
            {r.map((v, i) => (
              <TD key={i} className={cn(numeric.includes(i) && 'text-right tabular-nums', typeof v === 'number' && v < 0 && 'text-destructive')}>{fmt(v, i)}</TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
