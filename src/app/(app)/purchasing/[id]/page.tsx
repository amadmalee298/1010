import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { getPurchaseOrder, listSuppliers } from '@/server/repositories/operations';
import { listIngredients } from '@/server/repositories/ingredients';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { PurchaseOrderEditor } from '@/components/operations/purchase-order-editor';
import { MANAGEMENT } from '@/domain/permissions';

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEmployee(MANAGEMENT);
  const { id } = await params;
  const isNew = id === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [doc, suppliers, ingredients] = await Promise.all([
    isNew ? Promise.resolve(null) : getPurchaseOrder(db, id), listSuppliers(db, { activeOnly: true }), listIngredients(db, { type: 'RAW' }),
  ]);
  if (!isNew && !doc) notFound();
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={doc ? doc.po.po_number : t.purchasing.newPo}
        actions={doc ? <Badge>{t.purchasing.status[doc.po.status]}</Badge> : undefined} />
      <PurchaseOrderEditor po={doc?.po ?? null} items={doc?.items ?? []} suppliers={suppliers} ingredients={ingredients} />
    </div>
  );
}
