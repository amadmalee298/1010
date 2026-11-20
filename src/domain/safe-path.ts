/**
 * Only a path on this site: "/orders?x=1". Rejects "//evil.com", "/\\evil.com" (browsers read a
 * backslash as a slash), control characters and anything with a scheme.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f]/.test(next)) return null;
  try {
    const url = new URL(next, 'http://local.invalid');
    return url.origin === 'http://local.invalid' ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
