import type { Json } from '@/lib/database.types';

const IGNORED = new Set(['updated_at', 'created_at']);

/** Field-level diff between two audit snapshots (top-level keys only). */
export function auditDiff(oldValue: Json | null, newValue: Json | null): { field: string; from: string; to: string }[] {
  const o = oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue) ? oldValue : {};
  const n = newValue && typeof newValue === 'object' && !Array.isArray(newValue) ? newValue : {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  const show = (v: Json | undefined) => (v === undefined || v === null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return [...keys]
    .filter((k) => !IGNORED.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => ({ field: k, from: show(o[k]), to: show(n[k]) }));
}
