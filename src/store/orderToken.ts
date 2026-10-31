// Private order links carry a token (/order/123?t=…). The order page keeps it
// in this tab's storage rather than the address bar, so it never reaches
// analytics, browser history sync or screenshots. index.html moves a token
// from an emailed link into storage before anything else runs.
const key = (n: string | number) => `elden-order-token:${n}`;

function save(n: string | number, token: string): boolean {
  try { sessionStorage.setItem(key(n), token); return true; } catch { return false; }
}

/** Where to send the buyer after paying: the order page, with the token kept out of the URL when possible. */
export function orderPath(n: number, token: string, extra = '') {
  return save(n, token) ? `/order/${n}${extra ? '?' + extra : ''}` : `/order/${n}?t=${token}${extra ? '&' + extra : ''}`;
}

/** The token for an order page: from the URL if present (then stored), else from this tab. */
export function orderToken(n: string | undefined, fromUrl: string | null): string {
  if (!n) return '';
  if (fromUrl) { save(n, fromUrl); return fromUrl; }
  try { return sessionStorage.getItem(key(n)) ?? ''; } catch { return ''; }
}
