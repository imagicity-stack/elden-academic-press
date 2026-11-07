// Popups built in Admin → Popups: what they say and look like, when they open, who sees them and
// how often. Shared by the website (which decides when to show one), the admin's builder (its
// live preview) and the server (which checks what's saved). Pure data and functions only.
import type { Channel } from './attribution.js';

export type PopupStatus = 'draft' | 'live' | 'paused';
export type PopupLayout = 'modal' | 'slide' | 'bar' | 'fullscreen';
export type PopupGoal = 'subscribe' | 'coupon' | 'link' | 'announce';

export interface PopupContent {
  goal: PopupGoal;
  eyebrow: string;
  heading: string;
  /** Short text: **bold**, *italic*, [links](https://…), lists. */
  body: string;
  /** A picture (uploaded in the builder, or a /assets/… path), or ''. */
  image: string;
  imageAlt: string;
  /** The main button (link, coupon and announcement popups). */
  button: { label: string; url: string };
  /** A discount code: shown by coupon popups, and after an email sign-up if set. */
  coupon: string;
  /** "No thanks" link under the button ('' = only the × closes it). */
  dismissLabel: string;
  /** Show "Ends in 2d 4h" up to this time (ISO), or null. */
  countdownTo: string | null;
  /** Email sign-up: ask for a name too (email and mobile are always asked). */
  askName: boolean;
  submitLabel: string;
  /** After a sign-up. */
  success: { heading: string; body: string };
}

export interface PopupDesign {
  layout: PopupLayout;
  /** Slide-in: which corner. Bar: top or bottom. */
  position: 'bottom-right' | 'bottom-left' | 'top' | 'bottom';
  size: 'small' | 'medium' | 'large';
  imagePosition: 'top' | 'side' | 'background';
  align: 'left' | 'center';
  font: 'sans' | 'serif' | 'display';
  colors: { background: string; text: string; accent: string; accentText: string };
  /** Corner rounding in px. */
  radius: number;
  /** Dim the page behind a centred or full-screen popup (0 to 90 %). */
  overlay: number;
  animation: 'fade' | 'zoom' | 'slide';
}

export interface PopupTrigger {
  type: 'delay' | 'scroll' | 'exit' | 'pageviews' | 'link';
  /** delay: seconds on the page. exit: also opens after this many seconds on phones (no mouse to leave). */
  seconds: number;
  /** scroll: how far down the page (%). */
  percent: number;
  /** pageviews: opens on the visitor's Nth page in this visit. */
  pageviews: number;
}

export interface PopupAudience {
  pages: { mode: 'all' | 'only' | 'except'; patterns: string[] };
  device: 'all' | 'desktop' | 'mobile';
  visitor: 'all' | 'new' | 'returning';
  signedIn: 'all' | 'in' | 'out';
  /** Where the visitor came from (empty = anywhere). */
  channels: Channel[];
  /** Only visitors whose campaign (utm_campaign) contains this ('' = any). */
  campaign: string;
  cart: 'any' | 'empty' | 'has_items';
  /** Also show to signed-in student accounts (never for email sign-up popups). */
  students: boolean;
}

export interface PopupFrequency {
  show: 'every' | 'session' | 'days' | 'once';
  days: number;
  /** Stop showing it to someone who signed up or clicked its button. */
  stopAfterConvert: boolean;
}

export interface PopupFields {
  content: PopupContent; design: PopupDesign; trigger: PopupTrigger; audience: PopupAudience; frequency: PopupFrequency;
  startsAt: string | null; endsAt: string | null;
}
export interface LivePopup extends PopupFields { id: string; priority: number }

/** Where the builder's "Preview on the site" leaves the popup for the website to open. */
export const PREVIEW_KEY = 'elden-popup-preview';

/** Never on these pages, whatever the popup says: buying and the order pages stay clear. */
export const NEVER_ON = ['/checkout', '/order/*', '/track', '/admin/*'];

/* ---------------- Defaults and templates ---------------- */

const SITE_COLORS = { background: '#FFFFFF', text: '#0B1220', accent: '#0B1220', accentText: '#FFFFFF' };

export function blankPopup(): PopupFields {
  return {
    content: {
      goal: 'announce', eyebrow: '', heading: 'Your heading', body: 'A line or two about the offer.', image: '', imageAlt: '',
      button: { label: 'Shop now', url: '/store' }, coupon: '', dismissLabel: 'No thanks', countdownTo: null, askName: false, submitLabel: 'Subscribe',
      success: { heading: 'You’re in!', body: 'Thanks for subscribing. Look out for our emails.' },
    },
    design: {
      layout: 'modal', position: 'bottom-right', size: 'medium', imagePosition: 'top', align: 'center', font: 'sans',
      colors: { ...SITE_COLORS }, radius: 14, overlay: 55, animation: 'zoom',
    },
    trigger: { type: 'delay', seconds: 6, percent: 50, pageviews: 2 },
    audience: { pages: { mode: 'all', patterns: [] }, device: 'all', visitor: 'all', signedIn: 'all', channels: [], campaign: '', cart: 'any', students: false },
    frequency: { show: 'days', days: 7, stopAfterConvert: true },
    startsAt: null, endsAt: null,
  };
}

type Patch = { content?: Partial<PopupContent>; design?: Partial<PopupDesign>; trigger?: Partial<PopupTrigger>; audience?: Partial<PopupAudience>; frequency?: Partial<PopupFrequency> };
const make = (p: Patch): PopupFields => {
  const b = blankPopup();
  return {
    ...b, content: { ...b.content, ...p.content }, design: { ...b.design, ...p.design, colors: { ...b.design.colors, ...p.design?.colors } },
    trigger: { ...b.trigger, ...p.trigger }, audience: { ...b.audience, ...p.audience }, frequency: { ...b.frequency, ...p.frequency },
  };
};

export const TEMPLATES: { key: string; name: string; description: string; popup: PopupFields }[] = [
  {
    key: 'welcome', name: 'Welcome offer', description: 'Email sign-up that reveals a first-order discount. New visitors, after 8 seconds.',
    popup: make({
      content: {
        goal: 'subscribe', eyebrow: 'Welcome to Elden', heading: 'Get 10% off your first order',
        body: 'Join our newsletter for new books, free sample papers and member-only offers.', coupon: 'WELCOME10', submitLabel: 'Get my code',
        dismissLabel: 'No thanks', success: { heading: 'Here’s your code', body: 'Use it at checkout. We’ve also sent a welcome email.' },
      },
      design: { layout: 'modal', size: 'medium', colors: { background: '#FFF8E6', text: '#0B1220', accent: '#E8572A', accentText: '#FFFFFF' } },
      trigger: { type: 'delay', seconds: 8 }, audience: { visitor: 'new' }, frequency: { show: 'days', days: 14 },
    }),
  },
  {
    key: 'exit', name: 'Exit-intent coupon', description: 'A last-moment discount when someone is about to leave a book page.',
    popup: make({
      content: {
        goal: 'coupon', eyebrow: 'Before you go', heading: 'Here’s 10% off your books', body: 'Use this code at checkout. It’s yours for the next 48 hours.',
        coupon: 'STAY10', button: { label: 'Continue shopping', url: '/store' }, dismissLabel: 'Maybe later',
      },
      design: { layout: 'modal', size: 'small', colors: { background: '#0B1220', text: '#FFFFFF', accent: '#FFD84D', accentText: '#0B1220' } },
      trigger: { type: 'exit', seconds: 30 }, audience: { pages: { mode: 'only', patterns: ['/books/*', '/store', '/catalogue'] } }, frequency: { show: 'days', days: 3 },
    }),
  },
  {
    key: 'bar', name: 'Announcement bar', description: 'A slim bar at the top of every page: free shipping, a sale, a new release.',
    popup: make({
      content: { goal: 'link', heading: 'Free shipping on orders above ₹499', body: '', button: { label: 'Shop now', url: '/store' }, dismissLabel: '' },
      design: { layout: 'bar', position: 'top', align: 'center', colors: { background: '#0B1220', text: '#FFFFFF', accent: '#FFD84D', accentText: '#0B1220' }, radius: 0, animation: 'slide' },
      trigger: { type: 'delay', seconds: 0 }, frequency: { show: 'session' },
    }),
  },
  {
    key: 'competition', name: 'Competition promo', description: 'A corner card for DoomsDay Diaries with its banner, after a visitor scrolls.',
    popup: make({
      content: {
        goal: 'link', eyebrow: 'Now open', heading: 'DoomsDay Diaries', body: 'Form a team, create an original hero and win. Free entry, ages 8 to 24.',
        image: '/assets/competitions/doomsday-diaries-800.webp', imageAlt: 'DoomsDay Diaries: comic book writing competition',
        button: { label: 'Register your team', url: '/competitions/doomsday-diaries' }, dismissLabel: '',
      },
      design: { layout: 'slide', position: 'bottom-right', size: 'small', align: 'left', font: 'display', colors: { background: '#10301F', text: '#FFFFFF', accent: '#FF3B1F', accentText: '#FFFFFF' }, animation: 'slide' },
      trigger: { type: 'scroll', percent: 40 }, audience: { pages: { mode: 'except', patterns: ['/competitions/*'] }, students: true }, frequency: { show: 'days', days: 3 },
    }),
  },
  {
    key: 'new-book', name: 'New book', description: 'A slide-in with the cover of a new release and a link to it.',
    popup: make({
      content: { goal: 'link', eyebrow: 'Just published', heading: 'Book title', body: 'One line on why it’s worth reading.', button: { label: 'See the book', url: '/store' }, dismissLabel: '' },
      design: { layout: 'slide', position: 'bottom-left', size: 'small', imagePosition: 'side', align: 'left', animation: 'slide' },
      trigger: { type: 'pageviews', pageviews: 2 }, frequency: { show: 'days', days: 7 },
    }),
  },
  {
    key: 'fullscreen', name: 'Big launch', description: 'A full-screen takeover for a major launch (a centred card on phones).',
    popup: make({
      content: { goal: 'link', eyebrow: 'Launching today', heading: 'Session 2027–28 books are here', body: 'New editions for CBSE, ICSE and State Boards.', button: { label: 'Explore the catalogue', url: '/catalogue' }, dismissLabel: 'Not now' },
      design: { layout: 'fullscreen', size: 'large', font: 'serif', colors: { background: '#0E1F33', text: '#FFFFFF', accent: '#CC955F', accentText: '#0E1F33' }, overlay: 0, animation: 'fade' },
      trigger: { type: 'delay', seconds: 3 }, frequency: { show: 'once' },
    }),
  },
  { key: 'blank', name: 'Blank', description: 'Start from scratch.', popup: blankPopup() },
];

/* ---------------- Who sees it ---------------- */

/** "/books/*" matches every book page; "/" only the home page; a trailing "*" matches the rest of the path. */
export function pageMatches(pattern: string, path: string): boolean {
  const p = pattern.trim().replace(/\/+$/, '') || '/';
  const at = path.replace(/\/+$/, '') || '/';
  if (p.endsWith('*')) {
    const base = p.slice(0, -1).replace(/\/+$/, '');
    return at === (base || '/') || at.startsWith(`${base}/`);
  }
  return at === p;
}

export interface PopupMemory { lastShown?: number; converted?: boolean }
export interface VisitorContext {
  path: string; device: 'desktop' | 'mobile'; isNew: boolean; signedIn: boolean; student: boolean;
  channel: Channel; campaign: string; cartItems: number; now: number;
  /** Shown (or converted) before, in this browser. */
  memory: Record<string, PopupMemory>;
  /** Shown in this visit. */
  session: string[];
}

/** Whether this visitor may see this popup on this page now (its trigger is checked separately). */
export function eligible(p: LivePopup, v: VisitorContext): boolean {
  const a = p.audience;
  if (NEVER_ON.some((x) => pageMatches(x, v.path))) return false;
  if (p.startsAt && v.now < Date.parse(p.startsAt)) return false;
  if (p.endsAt && v.now > Date.parse(p.endsAt)) return false;
  if (v.student && (!a.students || p.content.goal === 'subscribe')) return false;
  if (a.pages.mode === 'only' && !a.pages.patterns.some((x) => pageMatches(x, v.path))) return false;
  if (a.pages.mode === 'except' && a.pages.patterns.some((x) => pageMatches(x, v.path))) return false;
  if (a.device !== 'all' && a.device !== v.device) return false;
  if (a.visitor === 'new' && !v.isNew) return false;
  if (a.visitor === 'returning' && v.isNew) return false;
  if (a.signedIn === 'in' && !v.signedIn) return false;
  if (a.signedIn === 'out' && v.signedIn) return false;
  if (a.channels.length && !a.channels.includes(v.channel)) return false;
  if (a.campaign && !v.campaign.toLowerCase().includes(a.campaign.toLowerCase())) return false;
  if (a.cart === 'empty' && v.cartItems > 0) return false;
  if (a.cart === 'has_items' && v.cartItems === 0) return false;
  const m = v.memory[p.id] ?? {};
  if (p.frequency.stopAfterConvert && m.converted) return false;
  const f = p.frequency;
  if (f.show === 'once' && m.lastShown) return false;
  if (f.show === 'session' && v.session.includes(p.id)) return false;
  if (f.show === 'days' && m.lastShown && v.now - m.lastShown < f.days * 86_400_000) return false;
  return true;
}

/* ---------------- Words for the admin ---------------- */

export const LAYOUT_LABEL: Record<PopupLayout, string> = { modal: 'Centred', slide: 'Slide-in', bar: 'Bar', fullscreen: 'Full screen' };
export const GOAL_LABEL: Record<PopupGoal, string> = { subscribe: 'Email sign-up', coupon: 'Coupon', link: 'Link', announce: 'Announcement' };

export function triggerText(t: PopupTrigger): string {
  switch (t.type) {
    case 'delay': return t.seconds ? `After ${t.seconds} s on a page` : 'As soon as a page opens';
    case 'scroll': return `At ${t.percent}% down a page`;
    case 'exit': return `When leaving (phones: after ${t.seconds} s)`;
    case 'pageviews': return `On the ${t.pageviews}${['th', 'st', 'nd', 'rd'][t.pageviews % 10 > 3 || Math.floor(t.pageviews / 10) === 1 ? 0 : t.pageviews % 10]} page of a visit`;
    case 'link': return 'When a link to it is clicked';
  }
}

export function frequencyText(f: PopupFrequency): string {
  const base = { every: 'Every page view', session: 'Once per visit', days: `At most once every ${f.days} day${f.days === 1 ? '' : 's'}`, once: 'Only once' }[f.show];
  return f.stopAfterConvert ? `${base}, until they sign up or click` : base;
}
