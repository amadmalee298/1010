/** No answer (network failure → 0), a timeout or a server error: worth retrying, unlike 4xx. */
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status >= 500;
}
