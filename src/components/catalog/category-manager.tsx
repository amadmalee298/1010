'use client';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { saveCategoryAction } from '@/server/actions/catalog';
import type { CategoryRow } from '@/lib/database.types';

export function CategoryManager({ categories, counts }: { categories: CategoryRow[]; counts: Record<string, number> }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<CategoryRow | 'new' | null>(null);
  const { run, pending, fieldErrors } = useAction(saveCategoryAction);
  const current = editing === 'new' ? null : editing;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}><Plus /> {t.catalog.newCategory}</Button>
      </div>
      <Table>
        <THead><TR><TH>{t.catalog.nameTh}</TH><TH>{t.catalog.nameEn}</TH><TH>{t.catalog.sortOrder}</TH><TH>{t.catalog.productCount}</TH><TH>{t.common.status}</TH><TH /></TR></THead>
        <TBody>
          {categories.map((c) => (
            <TR key={c.id} className={c.is_active ? '' : 'opacity-50'}>
              <TD className="font-medium">{c.name_th}</TD>
              <TD>{c.name_en}</TD>
              <TD>{c.sort_order}</TD>
              <TD>{counts[c.id] ?? 0}</TD>
              <TD><Badge variant={c.is_active ? 'success' : 'secondary'}>{c.is_active ? t.common.active : t.common.inactive}</Badge></TD>
              <TD className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={t.common.edit}><Pencil /></Button></TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{current ? t.catalog.editCategory : t.catalog.newCategory}</DialogTitle></DialogHeader>
          <form
            key={current?.id ?? 'new'}
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run({ ...formToObject(e.currentTarget), id: current?.id });
              if (ok) setEditing(null);
            }}
          >
            <Field label={t.catalog.nameTh} error={fieldErrors.name_th?.[0]}><Input name="name_th" defaultValue={current?.name_th} required maxLength={100} /></Field>
            <Field label={t.catalog.nameEn}><Input name="name_en" defaultValue={current?.name_en ?? ''} maxLength={100} /></Field>
            <Field label={t.catalog.sortOrder}><Input name="sort_order" type="number" min={0} defaultValue={current?.sort_order ?? 0} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={current?.is_active ?? true} className="size-5 accent-[var(--primary)]" /> {t.common.active}</label>
            <DialogFooter><Button type="submit" disabled={pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
