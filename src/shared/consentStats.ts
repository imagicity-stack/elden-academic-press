// Cookie-banner analytics (Admin → Cookie consent): anonymous counts of how many visitors see the
// banner and what they choose. Nothing that identifies a visitor is stored: each event only adds
// one to a counter for (day, device type, approximate region, traffic channel, page, time to decide).

export type ConsentEvent = 'shown' | 'accept' | 'essential' | 'change_all' | 'change_essential';
export const CONSENT_EVENTS: ConsentEvent[] = ['shown', 'accept', 'essential', 'change_all', 'change_essential'];

/** How long after first seeing the banner they chose. */
export const TIMING: { key: string; label: string; maxSeconds: number }[] = [
  { key: 'lt5', label: 'Under 5 seconds', maxSeconds: 5 },
  { key: 'lt15', label: '5–15 seconds', maxSeconds: 15 },
  { key: 'lt60', label: '15–60 seconds', maxSeconds: 60 },
  { key: 'lt300', label: '1–5 minutes', maxSeconds: 300 },
  { key: 'same_day', label: 'Later that day', maxSeconds: 86_400 },
  { key: 'later', label: 'On a later visit', maxSeconds: Infinity },
];
export const timingOf = (seconds: number | null | undefined) => (seconds == null || !Number.isFinite(seconds) || seconds < 0 ? '' : TIMING.find((t) => seconds < t.maxSeconds)!.key);

/** The kind of page, never the full address. */
export function pageGroup(path: string): string {
  if (path === '/' || path === '') return 'home';
  if (/^\/books\/[^/]+/.test(path)) return 'book';
  if (/^\/(books|shop|catalogue)\/?$/.test(path)) return 'books';
  if (/^\/competitions/.test(path)) return 'competitions';
  if (/^\/(checkout|cart|order)/.test(path)) return 'checkout';
  if (/^\/account/.test(path)) return 'account';
  if (/^\/(resources|study|free)/.test(path)) return 'resources';
  return 'other';
}
export const PAGE_LABEL: Record<string, string> = {
  home: 'Home page', book: 'A book page', books: 'All books', competitions: 'Competitions', checkout: 'Cart & checkout',
  account: 'Account', resources: 'Free resources', other: 'Other pages',
};
export const DEVICE_LABEL: Record<string, string> = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' };
