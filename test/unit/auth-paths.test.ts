import { describe, expect, it } from 'vitest';
import { isTransientStatus } from '@/domain/http-status';
import { safeNextPath } from '@/domain/safe-path';

describe('isTransientStatus', () => {
  it('retries only when there was no answer, a timeout or a server error', () => {
    for (const s of [0, 408, 500, 502, 503, 504]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [200, 400, 401, 403, 404, 406]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps paths on this site and rejects everything else', () => {
    expect(safeNextPath('/orders/123?x=1')).toBe('/orders/123?x=1');
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});
