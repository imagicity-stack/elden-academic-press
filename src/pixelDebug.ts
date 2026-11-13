// The Pixel's debug log: open any page with ?debug_pixel=1 and, for that tab, the console explains
// what the Meta Pixel and its server copies are doing (?debug_pixel=0 stops it). Never logs
// anything personal: no addresses, emails or phone numbers.
const KEY = 'elden-debug-pixel';

let on: boolean | undefined;

export function pixelDebugOn(): boolean {
  if (on !== undefined) return on;
  if (typeof location === 'undefined') return (on = false);
  const q = new URLSearchParams(location.search).get('debug_pixel');
  try {
    if (q === '1') sessionStorage.setItem(KEY, '1');
    if (q === '0') sessionStorage.removeItem(KEY);
    on = sessionStorage.getItem(KEY) === '1';
  } catch { on = q === '1'; }
  return on;
}

export function pixelLog(message: string) {
  if (pixelDebugOn()) console.info(`[pixel debug] ${message}`);
}
