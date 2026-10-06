'use client';
import { useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { saveCustomerAction, searchCustomersAction } from '@/server/actions/customers';
import type { CustomerRow } from '@/lib/database.types';
import type { CartState } from '@/domain/cart';

export function CustomerDialog({ open, onOpenChange, onSelect }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSelect: (c: NonNullable<CartState['customer']>) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerRow[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const search = useAction(searchCustomersAction, { successMessage: false, refresh: false });
  const save = useAction(saveCustomerAction, { refresh: false });

  const pick = (c: CustomerRow) => {
    onSelect({ id: c.id, name: c.name, phone: c.phone, pointsBalance: c.points_balance });
    onOpenChange(false);
    setResults(null); setQuery(''); setRegistering(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.pos.customer}</DialogTitle></DialogHeader>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (query.trim()) setResults(await search.run({ query })); }}>
          <Input autoFocus inputMode="tel" placeholder={`${t.pos.phone} / ${t.common.name}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={search.pending} aria-label={t.pos.findCustomer}><Search /></Button>
        </form>
        {results ? (
          results.length ? (
            <ul className="grid gap-2">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c)} className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left hover:bg-muted">
                    <span><span className="font-medium">{c.name}</span> <span className="text-sm text-muted-foreground">{c.phone}</span></span>
                    <span className="text-sm font-medium text-primary-strong">{c.points_balance} {t.pos.points}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t.pos.noCustomer}</p>
        ) : null}
        {registering ? (
          <form
            className="grid gap-3 rounded-xl bg-muted/50 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const c = await save.run({ name: fd.get('name'), phone: fd.get('phone') });
              if (c) pick(c);
            }}
          >
            <Field label={t.common.name} error={save.fieldErrors.name?.[0]}><Input name="name" required /></Field>
            <Field label={t.pos.phone} error={save.fieldErrors.phone?.[0]}><Input name="phone" inputMode="tel" defaultValue={/^\d+$/.test(query) ? query : ''} required /></Field>
            <Button type="submit" disabled={save.pending}>{t.common.save}</Button>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setRegistering(true)}><UserPlus /> {t.pos.newCustomer}</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
