// Google Analytics 4 shopping events, in Google's standard format, so GA reports sales and
// revenue and Google Ads can import them as conversions. They go through gtag, which
// index.html loads with Consent Mode: until the visitor accepts cookies, Google receives
// only cookie-free signals. Staff (signed in to the admin) send no shopping events, and
// their page views are marked as internal traffic.
import { isStaff } from './consent';
import { knownUser, phoneDigits } from './visitor';

const BRAND = 'Elden Academic Press';
const gtag = (...args: unknown[]) => window.gtag?.(...args);

/** How a format is named in reports. */
const variant = (kind: string) => (kind === 'digital' ? 'E-book' : kind === 'bundle' ? 'E-book + print' : 'Print');

/** One line in GA4's items list. Prices in paise. */
export const gaItem = (id: string, name: string, kind: string, unitPaise: number, quantity: number, category?: string | null) => ({
  item_id: id, item_name: name, item_brand: BRAND, item_variant: variant(kind), ...(category ? { item_category: category } : {}),
  price: unitPaise / 100, quantity,
});

export function ga(name: string, params: Record<string, unknown> = {}) {
  if (isStaff() || /^\/admin(\/|$)/.test(location.pathname)) return;
  gtag('event', name, params);
}

/**
 * Enhanced conversions: details the visitor gave us (checkout, sign-in, a form), only after
 * they accepted cookies. Google hashes them in the browser and uses them to match sales to ads.
 */
function setUserData() {
  const u = knownUser();
  const phone = phoneDigits(u?.phone);
  if (!u || (!u.email && !phone)) return;
  const parts = (u.name ?? '').trim().split(/\s+/).filter(Boolean);
  gtag('set', 'user_data', {
    ...(u.email ? { email: u.email.toLowerCase() } : {}),
    ...(phone ? { phone_number: '+' + phone } : {}),
    address: {
      ...(parts[0] ? { first_name: parts[0] } : {}),
      ...(parts.length > 1 ? { last_name: parts[parts.length - 1] } : {}),
      ...(u.city ? { city: u.city } : {}),
      ...(u.pincode ? { postal_code: u.pincode } : {}),
      country: 'IN',
    },
  });
}
setUserData();
window.addEventListener('elden:visitor', setUserData);

// Someone taps your email address, phone number or WhatsApp link.
document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest?.('a[href^="mailto:"], a[href^="tel:"], a[href*="wa.me/"], a[href*="api.whatsapp.com"]') as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute('href') ?? '';
  ga('contact', { method: href.startsWith('mailto:') ? 'email' : href.startsWith('tel:') ? 'phone' : 'whatsapp' });
}, true);
