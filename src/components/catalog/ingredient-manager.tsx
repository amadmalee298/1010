'use client';
import { useMemo, useState } from 'react';
import { FolderPlus, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { formatAmount, formatQty } from '@/domain/money';
import { createIngredientCategoryAction, saveIngredientAction } from '@/server/actions/catalog';
import type { IngredientCategoryRow, IngredientRow } from '@/lib/database.types';

export function IngredientManager({ ingredients, categories }: { ingredients: IngredientRow[]; categories: IngredientCategoryRow[] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<IngredientRow | 'new' | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const [filter, setFilter] = useState('');
  const save = useAction(saveIngredientAction);
  const addGroup = useAction(createIngredientCategoryAction);
  const current = editing === 'new' ? null : editing;
  const groupName = useMemo(() => new Map(categories.map((c) => [c.id, c.name_th])), [categories]);
  const visible = ingredients.filter((i) => !filter || i.name_th.toLowerCase().includes(filter.toLowerCase()) || (i.sku ?? '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input placeholder={t.common.search} value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" type="search" />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setNewGroup(true)}><FolderPlus /> {t.catalog.newIngredientCategory}</Button>
          <Button onClick={() => setEditing('new')}><Plus /> {t.catalog.newIngredient}</Button>
        </div>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>{t.common.name}</TH><TH>{t.common.type}</TH><TH>{t.catalog.ingredientCategory}</TH>
            <TH className="text-right">{t.catalog.stock}</TH><TH className="text-right">{t.catalog.reorderLevel}</TH>
            <TH className="text-right">{t.catalog.avgCost}</TH><TH className="text-right">{t.common.total}</TH><TH />
          </TR>
        </THead>
        <TBody>
          {visible.map((i) => {
            const low = i.stock_qty <= i.reorder_level;
            return (
              <TR key={i.id} className={i.is_active ? '' : 'opacity-50'}>
                <TD><p className="font-medium">{i.name_th}</p><p className="text-xs text-muted-foreground">{i.sku}</p></TD>
                <TD><Badge variant={i.item_type === 'RAW' ? 'secondary' : 'info'}>{i.item_type === 'RAW' ? t.catalog.raw : t.catalog.finished}</Badge></TD>
                <TD>{i.category_id ? groupName.get(i.category_id) : '—'}</TD>
                <TD className="text-right tabular-nums">
                  {formatQty(i.stock_qty)} <span className="text-xs text-muted-foreground">{i.unit}</span>
                  {low ? <Badge variant="destructive" className="ml-2">{t.catalog.lowStock}</Badge> : null}
                </TD>
                <TD className="text-right tabular-nums">{formatQty(i.reorder_level)}</TD>
                <TD className="text-right tabular-nums">{formatAmount(i.avg_cost)}</TD>
                <TD className="text-right tabular-nums">{formatAmount(Math.max(0, i.stock_qty) * i.avg_cost)}</TD>
                <TD className="text-right">
                  {i.item_type === 'RAW' ? <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label={t.common.edit}><Pencil /></Button> : null}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{current ? t.catalog.editIngredient : t.catalog.newIngredient}</DialogTitle>
            <DialogDescription>{t.catalog.stockReadonly}</DialogDescription>
          </DialogHeader>
          <form
            key={current?.id ?? 'new'}
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save.run({ ...formToObject(e.currentTarget), id: current?.id });
              if (ok) setEditing(null);
            }}
          >
            <Field label={t.catalog.nameTh} error={save.fieldErrors.name_th?.[0]}><Input name="name_th" defaultValue={current?.name_th} required /></Field>
            <Field label={t.catalog.nameEn}><Input name="name_en" defaultValue={current?.name_en ?? ''} /></Field>
            <Field label={t.catalog.sku}><Input name="sku" defaultValue={current?.sku ?? ''} pattern="[A-Za-z0-9_-]{1,30}" /></Field>
            <Field label={t.catalog.baseUnit} error={save.fieldErrors.unit?.[0]}><Input name="unit" defaultValue={current?.unit ?? ''} required maxLength={20} /></Field>
            <Field label={t.catalog.ingredientCategory}>
              <NativeSelect name="category_id" defaultValue={current?.category_id ?? ''}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name_th}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t.catalog.reorderLevel}><Input name="reorder_level" type="number" min={0} step="any" defaultValue={current?.reorder_level ?? 0} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_negative" defaultChecked={current?.allow_negative ?? false} className="size-5" /> {t.catalog.allowNegative}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={current?.is_active ?? true} className="size-5" /> {t.common.active}</label>
            <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newGroup} onOpenChange={setNewGroup}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.catalog.newIngredientCategory}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await addGroup.run(formToObject(e.currentTarget))) setNewGroup(false); }}>
            <Field label={t.catalog.nameTh}><Input name="name_th" required /></Field>
            <Field label={t.catalog.nameEn}><Input name="name_en" /></Field>
            <DialogFooter><Button type="submit" disabled={addGroup.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
