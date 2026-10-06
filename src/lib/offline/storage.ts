/** Versioned, failure-tolerant localStorage helpers (private mode / quota errors never crash the POS). */
const PREFIX = 'custard.v1.';

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: degrade silently */
  }
}

export function removeKey(key: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}
