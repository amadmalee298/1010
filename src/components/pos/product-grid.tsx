'use client';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/domain/money';
import { useI18n } from '@/i18n/client';
import type { PosProduct } from './types';

export function ProductGrid({ products, onAdd }: { products: PosProduct[]; onAdd: (p: PosProduct) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
      {products.map((p) => {
        const out = p.available !== null && p.available <= 0;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onAdd(p)}
            className={cn(
              'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition active:scale-[0.97]',
              out && 'opacity-50',
            )}
          >
            <div className="relative aspect-[4/3] w-full bg-secondary">
              {p.imageUrl ? (
                <Image src={p.imageUrl} alt="" fill sizes="(max-width: 640px) 50vw, 200px" className="object-cover" unoptimized />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-3xl font-semibold text-primary-strong/60">{p.name.slice(0, 1)}</span>
              )}
              {p.available !== null ? (
                <span className={cn('absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium',
                  out ? 'bg-destructive text-destructive-foreground' : p.available <= 5 ? 'bg-warning text-foreground' : 'bg-card/90 text-muted-foreground')}>
                  {out ? t.pos.outOfStock : p.available}
                </span>
              ) : null}
            </div>
            <div className="flex flex-1 flex-col justify-between gap-1 p-3">
              <span className="line-clamp-2 font-medium leading-snug">{p.name}</span>
              <span className="font-semibold tabular-nums text-primary-strong">฿{formatAmount(p.price)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
