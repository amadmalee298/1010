'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ImagePlus, Pencil, Plus, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { formatAmount, formatPercent } from '@/domain/money';
import { marginBand } from '@/domain/costing';
import { saveProductAction, uploadProductImageAction } from '@/server/actions/catalog';
import type { CategoryRow, ProductCostRow, ProductRow } from '@/lib/database.types';
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '@/domain/schemas/catalog';
import { toast } from 'sonner';

export interface ProductListItem extends ProductRow { imageUrl: string | null; cost: ProductCostRow | null }

export function ProductManager({ products, categories }: { products: ProductListItem[]; categories: CategoryRow[] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<ProductListItem | 'new' | null>(null);
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const save = useAction(saveProductAction);
  const upload = useAction((fd: FormData) => uploadProductImageAction(fd));
  const current = editing === 'new' ? null : editing;
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name_th])), [categories]);

  const visible = products.filter((p) =>
    (showInactive || p.is_active) &&
    (!filter || p.name_th.toLowerCase().includes(filter.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(filter.toLowerCase())));

  async function onUpload(productId: string, file: File | undefined) {
    if (!file) return;
    if (file.size > IMAGE_MAX_BYTES || !(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      toast.error(t.catalog.imageHint);
      return;
    }
    const fd = new FormData();
    fd.set('productId', productId);
    fd.set('file', file);
    await upload.run(fd);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input placeholder={t.common.search} value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" type="search" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-5" /> {t.catalog.showInactive}</label>
        <Button className="ml-auto" onClick={() => setEditing('new')}><Plus /> {t.catalog.newProduct}</Button>
      </div>
      <Table>
        <THead>
          <TR>
            <TH />
            <TH>{t.common.name}</TH><TH>{t.catalog.category}</TH><TH>{t.catalog.inventoryMode}</TH>
            <TH className="text-right">{t.catalog.sellingPrice}</TH><TH className="text-right">{t.catalog.unitCost}</TH>
            <TH className="text-right">{t.catalog.grossMargin}</TH><TH>{t.common.status}</TH><TH />
          </TR>
        </THead>
        <TBody>
          {visible.map((p) => {
            const unitCost = p.cost?.unit_cost ?? null;
            const net = p.cost?.net_price ?? p.price;
            const margin = unitCost !== null && net > 0 ? (net - unitCost) / net : null;
            const band = marginBand(margin);
            return (
              <TR key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                <TD className="w-16">
                  <label className="relative grid size-12 cursor-pointer place-items-center overflow-hidden rounded-xl bg-muted" title={t.catalog.image}>
                    {p.imageUrl ? <Image src={p.imageUrl} alt={p.name_th} fill sizes="48px" className="object-cover" unoptimized /> : <ImagePlus className="size-5 text-muted-foreground" />}
                    <input type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" onChange={(e) => onUpload(p.id, e.target.files?.[0])} />
                  </label>
                </TD>
                <TD><p className="font-medium">{p.name_th}</p><p className="text-xs text-muted-foreground">{p.sku}</p></TD>
                <TD>{p.category_id ? catName.get(p.category_id) : t.catalog.noCategory}</TD>
                <TD className="text-xs">{t.catalog[`mode${p.inventory_mode}`]}</TD>
                <TD className="text-right tabular-nums">{formatAmount(p.price)}</TD>
                <TD className="text-right tabular-nums">{unitCost === null ? <span className="text-muted-foreground">{t.catalog.noRecipe}</span> : formatAmount(unitCost)}</TD>
                <TD className="text-right">
                  {margin === null ? '—' : <Badge variant={band === 'good' ? 'success' : band === 'fair' ? 'warning' : 'destructive'}>{formatPercent(margin)}</Badge>}
                </TD>
                <TD><Badge variant={p.is_active ? 'success' : 'secondary'}>{p.is_active ? t.common.active : t.common.inactive}</Badge></TD>
                <TD className="whitespace-nowrap text-right">
                  {p.inventory_mode !== 'NONE' ? (
                    <Button asChild size="sm" variant="ghost" aria-label={t.catalog.recipe}><Link href={`/recipes/${p.id}`}><ScrollText /></Link></Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={t.common.edit}><Pencil /></Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{current ? t.catalog.editProduct : t.catalog.newProduct}</DialogTitle></DialogHeader>
          <form
            key={current?.id ?? 'new'}
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save.run({ ...formToObject(e.currentTarget), id: current?.id });
              if (ok) setEditing(null);
            }}
          >
            <Field label={t.catalog.nameTh} error={save.fieldErrors.name_th?.[0]}><Input name="name_th" defaultValue={current?.name_th} required maxLength={150} /></Field>
            <Field label={t.catalog.nameEn}><Input name="name_en" defaultValue={current?.name_en ?? ''} maxLength={150} /></Field>
            <Field label={t.catalog.sku} error={save.fieldErrors.sku?.[0]}><Input name="sku" defaultValue={current?.sku ?? ''} pattern="[A-Za-z0-9_-]{1,30}" /></Field>
            <Field label={t.catalog.category}>
              <NativeSelect name="category_id" defaultValue={current?.category_id ?? ''}>
                <option value="">{t.catalog.noCategory}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name_th}</option>)}
              </NativeSelect>
            </Field>
            <Field label={`${t.catalog.sellingPrice} (฿)`} error={save.fieldErrors.price?.[0]}>
              <Input name="price" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={current?.price ?? ''} required />
            </Field>
            <Field label={t.catalog.inventoryMode}>
              <NativeSelect name="inventory_mode" defaultValue={current?.inventory_mode ?? 'RECIPE'}>
                <option value="RECIPE">{t.catalog.modeRECIPE}</option>
                <option value="FINISHED_GOOD">{t.catalog.modeFINISHED_GOOD}</option>
                <option value="NONE">{t.catalog.modeNONE}</option>
              </NativeSelect>
            </Field>
            <Field label={t.catalog.description} className="sm:col-span-2"><Textarea name="description" defaultValue={current?.description ?? ''} maxLength={500} /></Field>
            <Field label={t.catalog.sortOrder}><Input name="sort_order" type="number" min={0} defaultValue={current?.sort_order ?? 0} /></Field>
            <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="is_active" defaultChecked={current?.is_active ?? true} className="size-5" /> {t.common.active}</label>
            <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
