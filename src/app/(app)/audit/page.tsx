import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { unwrap } from '@/server/db';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OWNER_ONLY } from '@/domain/permissions';
import { formatDateTime } from '@/domain/datetime';
import { auditDiff } from '@/domain/audit';

const ENTITIES = ['orders', 'refunds', 'products', 'recipes', 'ingredients', 'waste', 'production', 'purchase_orders', 'expenses', 'cash_sessions', 'customers', 'promotions', 'employees', 'settings'];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  await requireEmployee(OWNER_ONLY);
  const { entity } = await searchParams;
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  let q = db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300);
  if (entity && ENTITIES.includes(entity)) q = q.eq('entity', entity);
  const [logs, staff] = await Promise.all([q.then(unwrap), db.from('employee_directory').select('user_id, display_name').then(unwrap)]);
  const who = new Map(staff.map((s) => [s.user_id, s.display_name]));
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.admin.audit} />
      <form className="mb-4 flex gap-2">
        <NativeSelect name="entity" defaultValue={entity ?? ''} className="w-auto">
          <option value="">{t.admin.allEntities}</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">{t.common.search}</Button>
      </form>
      <Table>
        <THead><TR><TH>{t.common.date}</TH><TH>{t.admin.user}</TH><TH>{t.admin.action}</TH><TH>{t.admin.entity}</TH><TH>{t.admin.changes}</TH></TR></THead>
        <TBody>
          {logs.map((l) => {
            const diff = auditDiff(l.old_value, l.new_value);
            return (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-xs">{formatDateTime(l.created_at)}</TD>
                <TD>{l.user_id ? (who.get(l.user_id) ?? l.user_id.slice(0, 8)) : '—'}</TD>
                <TD><Badge variant={l.action === 'DELETE' || l.action.startsWith('CANCEL') || l.action.startsWith('REFUND') ? 'destructive' : 'secondary'}>{l.action}</Badge></TD>
                <TD className="text-xs">{l.entity}</TD>
                <TD className="max-w-xl text-xs">
                  {diff.slice(0, 6).map((d) => (
                    <div key={d.field} className="truncate"><span className="font-medium">{d.field}</span>: <span className="text-muted-foreground">{d.from}</span> → {d.to}</div>
                  ))}
                  {diff.length > 6 ? <div className="text-muted-foreground">+{diff.length - 6}</div> : null}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
