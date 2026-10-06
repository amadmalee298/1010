/**
 * Offline order queue.
 *
 * Orders created while offline are stored on the device with a client_ref (UUID).
 * create_order() is idempotent on client_ref, so retries can never double-charge
 * or double-deduct stock. Orders that the server rejects (e.g. insufficient stock)
 * stay in the queue as FAILED for a manager to review — they are never dropped silently.
 */
import type { CreateOrderInput } from '@/domain/schemas/orders';
import { readJson, writeJson } from './storage';

export interface QueuedOrder {
  clientRef: string;
  payload: CreateOrderInput;
  total: number;
  createdAt: string;
  attempts: number;
  status: 'PENDING' | 'FAILED';
  lastError: string | null;
}

const KEY = 'pos.orderQueue';
type Listener = (queue: QueuedOrder[]) => void;
const listeners = new Set<Listener>();

export const getQueue = (): QueuedOrder[] => readJson<QueuedOrder[]>(KEY, []);

function save(queue: QueuedOrder[]) {
  writeJson(KEY, queue);
  for (const l of listeners) l(queue);
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueueOrder(payload: CreateOrderInput, total: number): QueuedOrder {
  const entry: QueuedOrder = {
    clientRef: payload.client_ref, payload, total, createdAt: new Date().toISOString(), attempts: 0, status: 'PENDING', lastError: null,
  };
  save([...getQueue().filter((q) => q.clientRef !== entry.clientRef), entry]);
  return entry;
}

export function markResult(clientRef: string, result: { ok: true } | { ok: false; error: string; retryable: boolean }) {
  const queue = getQueue();
  if (result.ok) {
    save(queue.filter((q) => q.clientRef !== clientRef));
    return;
  }
  save(queue.map((q) => q.clientRef === clientRef
    ? { ...q, attempts: q.attempts + 1, lastError: result.error, status: result.retryable ? 'PENDING' : 'FAILED' }
    : q));
}

export function discardOrder(clientRef: string) {
  save(getQueue().filter((q) => q.clientRef !== clientRef));
}

export function retryOrder(clientRef: string) {
  save(getQueue().map((q) => (q.clientRef === clientRef ? { ...q, status: 'PENDING' } : q)));
}
