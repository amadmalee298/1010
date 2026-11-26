'use client';
import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatQty, round4 } from '@/domain/money';

export interface PackInfo { unit: string; pack_unit: string | null; pack_size: number | null }

/** The ingredient has a buying unit ("แผง" of 30) besides its base unit. */
export const hasPack = (p: PackInfo): p is PackInfo & { pack_unit: string; pack_size: number } =>
  !!p.pack_unit && !!p.pack_size && p.pack_size > 0;

/**
 * Quantity entry in the base unit or in packs: − / + step by one, a tap on the unit switches
 * ฟอง ⇄ แผง, and "= 30 ฟอง" shows what is stored. `value`/`onChange` are always in the base unit;
 * a hidden input named `name` carries the base quantity for plain forms.
 */
export function PackQuantityInput({ item, value, onChange, name, autoFocus, required, preferPack = true }: {
  item: PackInfo; value: string; onChange: (base: string) => void; name?: string; autoFocus?: boolean; required?: boolean; preferPack?: boolean;
}) {
  const pack = hasPack(item) ? item : null;
  const [inPacks, setInPacks] = useState(!!pack && preferPack);
  const toShown = (base: string, packs: boolean) => (base === '' || !packs || !pack ? base : String(round4(Number(base) / pack.pack_size)));
  const [shown, setShown] = useState(() => toShown(value, inPacks));
  // Follow changes made from outside (e.g. an "all" button).
  useEffect(() => {
    const base = shown === '' ? '' : String(inPacks && pack ? round4(Number(shown) * pack.pack_size) : Number(shown));
    if (base !== value) setShown(toShown(value, inPacks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = (s: string) => {
    setShown(s);
    onChange(s === '' ? '' : String(inPacks && pack ? round4(Number(s) * pack.pack_size) : Number(s)));
  };
  const step = (d: number) => set(String(Math.max(0, round4((Number(shown) || 0) + d))));
  const unit = inPacks && pack ? pack.pack_unit : item.unit;

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={() => step(-1)} aria-label="−1"><Minus /></Button>
        <Input type="number" inputMode="decimal" min={0} step="any" value={shown} onChange={(e) => set(e.target.value)}
          autoFocus={autoFocus} required={required} className="text-center text-lg" />
        <Button type="button" variant="outline" size="icon" onClick={() => step(1)} aria-label="+1"><Plus /></Button>
        {pack ? (
          <Button type="button" variant="ghost" className="shrink-0 px-2 font-semibold text-primary"
            onClick={() => { const next = !inPacks; setInPacks(next); setShown(toShown(value, next)); }}>
            {unit} ⇄
          </Button>
        ) : <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {pack && inPacks && value !== '' ? (
        <p className="text-center text-xs text-muted-foreground">= {formatQty(Number(value))} {item.unit}</p>
      ) : null}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
