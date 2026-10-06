import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listExpenses } from '@/server/repositories/operations';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ExpenseManager } from '@/components/operations/expense-manager';
import { can, MANAGEMENT } from '@/domain/permissions';
import { addDays, bangkokDate } from '@/domain/datetime';
import { formatTHB } from '@/domain/money';

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const employee = await requireEmployee(MANAGEMENT);
  const sp = await searchParams;
  const to = isDate(sp.to) ? sp.to : bangkokDate();
  const from = isDate(sp.from) ? sp.from : addDays(to, -30);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const expenses = await listExpenses(db, from, to);
  const total = expenses.filter((e) => !e.voided_at).reduce((s, e) => s + e.amount, 0);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.expenses.title} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Input type="date" name="from" defaultValue={from} className="w-auto" aria-label={t.common.from} />
        <Input type="date" name="to" defaultValue={to} className="w-auto" aria-label={t.common.to} />
        <Button type="submit" variant="outline">{t.common.search}</Button>
      </form>
      <div className="mb-4 max-w-xs"><StatCard label={t.expenses.total} value={formatTHB(total)} /></div>
      <ExpenseManager expenses={expenses} canVoid={can(employee.role, 'manageSettings')} />
    </div>
  );
}
