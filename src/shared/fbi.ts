/** The address inside Meta's _fbi cookie ("<ip>.<suffix>", written by the Parameter Builder), or ''. */
export function ipFromFbi(v: string | undefined): string {
  if (!v) return '';
  let s = v;
  try { s = decodeURIComponent(v); } catch { /* as it is */ }
  const ip = (x: string) => (/^[0-9a-f:]+$/i.test(x) && x.includes(':') ? x : /^\d{1,3}(\.\d{1,3}){3}$/.test(x) ? x : '');
  return ip(s) || ip(s.slice(0, Math.max(0, s.lastIndexOf('.'))));
}
