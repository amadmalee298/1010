import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { accountLedger, balanceSheet, cashFlow, glPnl, listAccounts, listJournals, trialBalance } from '@/server/repositories/accounting';
import { getSettings } from '@/server/repositories/settings';
import { getLocale, getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { JournalForm, PrintButton, ReverseJournalButton } from '@/components/accounting/journal-form';
import { can, MANAGEMENT } from '@/domain/permissions';
import { formatAmount } from '@/domain/money';
import { addDays, bangkokDate, formatDate } from '@/domain/datetime';
import { NativeSelect } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DbOperationError } from '@/server/action';
import { translateDbError } from '@/server/errors';

const TABS = ['pnl', 'balance', 'cashflow', 'journal', 'trial', 'ledger'] as const;
type Tab = (typeof TABS)[number];
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** "-0.00" reads as a loss; show zero plainly. */
const money = (n: number) => formatAmount(n || 0);

function Row({ label, amount, strong, indent, negative, href }: { label: string; amount: number; strong?: boolean; indent?: boolean; negative?: boolean; href?: string }) {
  return (
    <TR className={strong ? 'font-semibold' : undefined}>
      <TD className={indent ? 'pl-8' : undefined}>{href ? <Link href={href} className="underline decoration-dotted underline-offset-4">{label}</Link> : label}</TD>
      <TD className={cn('text-right tabular-nums', (negative ?? amount < 0) && 'text-destructive')}>{money(amount)}</TD>
    </TR>
  );
}

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; as_of?: string; account?: string }> }) {
  const employee = await requireEmployee(MANAGEMENT);
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'pnl';
  const today = bangkokDate();
  const to = isDate(sp.to) ? sp.to : today;
  const from = isDate(sp.from) ? sp.from : `${to.slice(0, 8)}01`;
  const asOf = isDate(sp.as_of) ? sp.as_of : today;
  const [t, locale, db] = await Promise.all([getT(), getLocale(), createSupabaseServerClient()]);
  const A = t.accounting;
  const name = (r: { name_th: string; name_en: string }) => (locale === 'en' ? r.name_en : r.name_th);
  const tabLabel: Record<Tab, string> = { pnl: A.pnl, balance: A.balance, cashflow: A.cashflow, journal: A.journal, trial: A.trial, ledger: A.ledger };
  /** Drill-down: the entries behind one account, for the statement's period (or the year up to a balance date). */
  const ledgerHref = (code: string, range: 'period' | 'asOf') => `/accounting?${new URLSearchParams({
    tab: 'ledger', account: code, from: range === 'period' ? from : addDays(asOf, -365), to: range === 'period' ? to : asOf, as_of: asOf,
  })}`;
  const settings = await getSettings(db);
  const company = settings.company_name || settings.shop_name;

  let body: React.ReactNode = null;
  try {
    if (tab === 'pnl') {
      const p = await glPnl(db, from, to);
      const rev = p.lines.filter((l) => l.type === 'REVENUE');
      const other = p.lines.filter((l) => l.code.startsWith('5') && l.code !== '5000');
      body = (
        <Table>
          <TBody>
            <Row label={A.revenue} amount={p.revenue} strong />
            {rev.map((l) => <Row key={l.code} label={`${l.code} ${name(l)}`} amount={l.amount} indent href={ledgerHref(l.code, 'period')} />)}
            <Row label={A.costOfSales} amount={-p.cogs} />
            <Row label={A.grossProfit} amount={p.gross_profit} strong />
            <Row label={A.otherCosts} amount={-p.other_costs} />
            {other.map((l) => <Row key={l.code} label={`${l.code} ${name(l)}`} amount={-l.amount} indent href={ledgerHref(l.code, 'period')} />)}
            <Row label={A.operatingExpenses} amount={-p.operating_expenses} />
            {p.expense_categories.map((c) => <Row key={c.category} label={c.category} amount={-c.amount} indent />)}
            {p.lines.filter((l) => l.code.startsWith('6') && l.code !== '6000').map((l) => <Row key={l.code} label={`${l.code} ${name(l)}`} amount={-l.amount} indent href={ledgerHref(l.code, 'period')} />)}
            <Row label={A.netProfit} amount={p.net_profit} strong />
          </TBody>
        </Table>
      );
    } else if (tab === 'balance') {
      const b = await balanceSheet(db, asOf);
      const group = (type: string) => b.lines.filter((l) => l.type === type);
      const clearing = b.lines.find((l) => l.code === '1190');
      body = (
        <div className="grid gap-3">
          <Table>
            <TBody>
              <Row label={A.assets} amount={b.total_assets} strong negative={false} />
              {group('ASSET').map((l) => <Row key={l.code} label={`${l.code} ${name(l)}`} amount={l.amount} indent href={ledgerHref(l.code, 'asOf')} />)}
              <Row label={A.totalAssets} amount={b.total_assets} strong />
              <Row label={A.liabilities} amount={b.total_liabilities} strong negative={false} />
              {group('LIABILITY').map((l) => <Row key={l.code} label={`${l.code} ${name(l)}`} amount={l.amount} indent href={ledgerHref(l.code, 'asOf')} />)}
              <Row label={A.totalLiabilities} amount={b.total_liabilities} strong />
              <Row label={A.equity} amount={b.total_equity} strong negative={false} />
              {group('EQUITY').map((l) => <Row key={l.code} label={`${l.code} ${name(l)}`} amount={l.amount} indent href={ledgerHref(l.code, 'asOf')} />)}
              <Row label={A.earningsToDate} amount={b.earnings_to_date} indent />
              <Row label={A.totalEquity} amount={b.total_equity} strong />
              <Row label={A.totalLe} amount={b.total_liabilities + b.total_equity} strong />
            </TBody>
          </Table>
          <p className={cn('text-sm', Math.abs(b.difference) < 0.01 ? 'text-success-strong' : 'text-destructive')}>
            {Math.abs(b.difference) < 0.01 ? A.balanced : `${A.unbalanced} ${money(b.difference)}`}
          </p>
          {clearing && Math.abs(clearing.amount) >= 0.01 ? <p className="text-sm text-warning-strong">{A.clearingWarning}</p> : null}
        </div>
      );
    } else if (tab === 'cashflow') {
      const c = await cashFlow(db, from, to);
      const item = (k: string) => c.items[k] ?? 0;
      body = (
        <Table>
          <TBody>
            <Row label={A.openingCash} amount={c.opening_cash} strong />
            <Row label={A.operating} amount={c.operating} strong />
            <Row label={A.customers} amount={item('customers')} indent />
            <Row label={A.suppliers} amount={item('suppliers')} indent />
            <Row label={A.expensesPaid} amount={item('expenses')} indent />
            <Row label={A.otherOperating} amount={item('other_operating')} indent />
            <Row label={A.investing} amount={c.investing} strong />
            <Row label={A.financing} amount={c.financing} strong />
            <Row label={A.netChange} amount={c.operating + c.investing + c.financing} strong />
            <Row label={A.closingCash} amount={c.closing_cash} strong />
            <TR><TD colSpan={2} className="pt-4 text-sm text-muted-foreground">{A.cashByAccount}</TD></TR>
            {c.closing_by_account.map((a) => <Row key={a.code} label={`${a.code} ${name(a)}`} amount={a.balance} indent href={ledgerHref(a.code, 'period')} />)}
          </TBody>
        </Table>
      );
    } else if (tab === 'journal') {
      const [accounts, journals] = await Promise.all([listAccounts(db), listJournals(db)]);
      const owner = can(employee.role, 'postJournals');
      body = (
        <div className="grid gap-4">
          {owner ? <JournalForm accounts={accounts} /> : <p className="text-sm text-muted-foreground">{A.ownerOnly}</p>}
          {journals.length === 0 ? <p className="text-muted-foreground">{A.noJournals}</p> : journals.map((j) => (
            <Card key={j.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {j.entry_number} · {formatDate(j.entry_date)} · {j.memo}
                  {j.is_opening ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{A.openingTag}</span> : null}
                </CardTitle>
                {owner && !j.reverses && !journals.some((x) => x.reverses === j.id) ? <ReverseJournalButton id={j.id} />
                  : journals.some((x) => x.reverses === j.id) ? <span className="text-sm text-muted-foreground">{A.reversed}</span> : null}
              </CardHeader>
              <CardContent>
                <Table>
                  <THead><TR><TH>{A.account}</TH><TH className="text-right">{A.debit}</TH><TH className="text-right">{A.credit}</TH></TR></THead>
                  <TBody>
                    {j.lines.map((l) => {
                      const a = accounts.find((x) => x.code === l.account_code);
                      return <TR key={l.id}><TD>{l.account_code} {a ? name(a) : ''}{l.note ? ` · ${l.note}` : ''}</TD>
                        <TD className="text-right tabular-nums">{l.debit ? formatAmount(l.debit) : ''}</TD>
                        <TD className="text-right tabular-nums">{l.credit ? formatAmount(l.credit) : ''}</TD></TR>;
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      );
    } else if (tab === 'ledger') {
      const accounts = await listAccounts(db);
      const code = accounts.some((a) => a.code === sp.account) ? (sp.account as string) : null;
      const rows = code ? await accountLedger(db, code, from, to) : [];
      const sources = A.sources as Record<string, string>;
      const opening = rows.length ? (rows[0]?.running_balance ?? 0) - (rows[0]?.debit ?? 0) + (rows[0]?.credit ?? 0) : 0;
      body = (
        <div className="grid gap-3">
          <form className="flex flex-wrap items-end gap-2 print:hidden">
            <input type="hidden" name="tab" value="ledger" />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <NativeSelect name="account" defaultValue={code ?? ''} aria-label={A.chooseAccount} className="w-auto">
              <option value="">— {A.chooseAccount} —</option>
              {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {name(a)}</option>)}
            </NativeSelect>
            <Button type="submit" variant="outline">{t.common.search}</Button>
          </form>
          {!code ? <p className="text-sm text-muted-foreground">{A.ledgerHint}</p> : (
            <Table>
              <THead><TR><TH>{t.common.date}</TH><TH>{A.source}</TH><TH className="text-right">{A.debit}</TH><TH className="text-right">{A.credit}</TH><TH className="text-right">{A.balanceCol}</TH></TR></THead>
              <TBody>
                <TR><TD colSpan={4} className="text-muted-foreground">{A.openingRow}</TD><TD className="text-right tabular-nums">{money(opening)}</TD></TR>
                {rows.length === 0 ? <TR><TD colSpan={5} className="text-muted-foreground">{A.noLines}</TD></TR> : rows.map((r, i) => (
                  <TR key={i}>
                    <TD className="whitespace-nowrap">{formatDate(r.entry_date)}</TD>
                    <TD>{sources[r.source_type] ?? r.source_type}{r.reference ? ` · ${r.reference}` : ''}{r.memo ? <span className="block text-xs text-muted-foreground">{r.memo}</span> : null}</TD>
                    <TD className="text-right tabular-nums">{r.debit ? money(r.debit) : ''}</TD>
                    <TD className="text-right tabular-nums">{r.credit ? money(r.credit) : ''}</TD>
                    <TD className="text-right tabular-nums">{money(r.running_balance)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {code === '5900' || code === '4900' ? <p className="text-sm text-muted-foreground">{A.cashCloseHint}</p> : null}
        </div>
      );
    } else {
      const rows = await trialBalance(db, asOf);
      const totalDr = rows.reduce((s, r) => s + r.debit, 0);
      const totalCr = rows.reduce((s, r) => s + r.credit, 0);
      body = (
        <Table>
          <THead><TR><TH>{A.account}</TH><TH className="text-right">{A.debit}</TH><TH className="text-right">{A.credit}</TH><TH className="text-right">{A.balanceCol}</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.account_code}><TD><Link href={ledgerHref(r.account_code, 'asOf')} className="underline decoration-dotted underline-offset-4">{r.account_code} {name(r)}</Link></TD>
                <TD className="text-right tabular-nums">{money(r.debit)}</TD><TD className="text-right tabular-nums">{money(r.credit)}</TD>
                <TD className="text-right tabular-nums">{money(r.balance)}</TD></TR>
            ))}
            <TR className="font-semibold"><TD>{t.common.total}</TD><TD className="text-right tabular-nums">{money(totalDr)}</TD><TD className="text-right tabular-nums">{money(totalCr)}</TD><TD /></TR>
          </TBody>
        </Table>
      );
    }
  } catch (err) {
    if (err instanceof DbOperationError) body = <p className="text-destructive">{translateDbError(err.db, t)}</p>; else throw err;
  }

  const ranged = tab === 'pnl' || tab === 'cashflow' || tab === 'ledger';
  const pointInTime = tab === 'balance' || tab === 'trial';
  return (
    <div className="grid gap-5 p-4 lg:p-6">
      <PageHeader title={A.title} description={A.assumptions} actions={tab !== 'journal' ? <PrintButton /> : undefined} />
      <nav className="flex flex-wrap gap-2 print:hidden" aria-label={A.title}>
        {TABS.map((x) => (
          <Link key={x} href={`/accounting?${new URLSearchParams({ tab: x, from, to, as_of: asOf })}`}
            className={cn('rounded-full border px-4 py-2 text-sm font-medium', x === tab ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-muted')}>
            {tabLabel[x]}
          </Link>
        ))}
      </nav>
      {ranged || pointInTime ? (
        <form className="flex flex-wrap items-end gap-2 print:hidden">
          <input type="hidden" name="tab" value={tab} />
          {tab === 'ledger' && sp.account ? <input type="hidden" name="account" value={sp.account} /> : null}
          {ranged ? <>
            <Input type="date" name="from" defaultValue={from} className="w-auto" aria-label={t.common.from} />
            <Input type="date" name="to" defaultValue={to} className="w-auto" aria-label={t.common.to} />
          </> : <Input type="date" name="as_of" defaultValue={asOf} className="w-auto" aria-label={A.asOf} />}
          <Button type="submit" variant="outline">{t.common.search}</Button>
        </form>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{company} · {tabLabel[tab]}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {ranged ? `${A.period} ${formatDate(from)} – ${formatDate(to)}` : pointInTime ? `${A.asOf} ${formatDate(asOf)}` : null}
          </p>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}
