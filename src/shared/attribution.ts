// Where an order came from (Meta ads, Google search, a newsletter…). The browser notes how each
// visit arrived: the link's UTM tags, whether it carried an ad-click id, the referring site's
// name and the landing page. Nothing that identifies the person. The order keeps the first
// visit and the last visit that had a source, and is credited to the last one (a later
// "direct" visit doesn't wipe out the ad that brought the buyer). Used by the website, the
// server and the admin.

export interface Touch {
  /** When (ms since 1970). */
  at: number;
  source?: string; medium?: string; campaign?: string; content?: string; term?: string;
  /** An ad platform's click id was on the link (its value is not kept). */
  click?: 'google' | 'meta' | 'microsoft' | 'tiktok' | 'linkedin';
  /** The referring site's host name, e.g. "www.google.com". */
  ref?: string;
  /** The page they landed on, without its query string. */
  landing?: string;
}
export interface OrderSource { first?: Touch; last?: Touch }

export type Channel = 'meta_ads' | 'google_ads' | 'search' | 'meta_social' | 'social' | 'email' | 'referral' | 'campaign' | 'direct' | 'unknown';

export const CHANNELS: { key: Channel; label: string; hint: string }[] = [
  { key: 'meta_ads', label: 'Meta ads', hint: 'Facebook or Instagram ads (links tagged as paid)' },
  { key: 'google_ads', label: 'Google Ads', hint: 'Google search, YouTube or display ads' },
  { key: 'search', label: 'Search', hint: 'Google, Bing and other search results (not ads)' },
  { key: 'meta_social', label: 'Facebook / Instagram', hint: 'Posts, profile links, or Meta ads whose links aren’t tagged as paid' },
  { key: 'social', label: 'Other social', hint: 'YouTube, WhatsApp, X, LinkedIn and others' },
  { key: 'email', label: 'Email', hint: 'The newsletter and other tagged email links' },
  { key: 'referral', label: 'Other websites', hint: 'A link on another site' },
  { key: 'campaign', label: 'Other campaigns', hint: 'Tagged links (UTM) from other places' },
  { key: 'direct', label: 'Direct', hint: 'Typed the address, a bookmark, or an app that hides where the link was (often WhatsApp)' },
  { key: 'unknown', label: 'Not recorded', hint: 'Orders placed before sources were recorded' },
];
export const channelLabel = (k: string | null | undefined) => CHANNELS.find((c) => c.key === k)?.label ?? 'Not recorded';

/** Our own sites and the places sign-in and payment come back from: never a source. */
const IGNORE_REF = /(^|\.)(eldenap\.in|razorpay\.com|supabase\.co|vercel\.app)$|^accounts\.google\./;
const CLICK_IDS: [string, NonNullable<Touch['click']>][] = [
  ['gclid', 'google'], ['gbraid', 'google'], ['wbraid', 'google'], ['fbclid', 'meta'], ['msclkid', 'microsoft'], ['ttclid', 'tiktok'], ['li_fat_id', 'linkedin'],
];
const clip = (v: string | null | undefined, n = 100) => {
  const s = (v ?? '').trim().slice(0, n);
  return s || undefined;
};

/** How this page view arrived, or null for a direct visit (or an internal one). */
export function touchFrom(url: string, referrer: string, now = Date.now(), ownHost = ''): Touch | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const q = u.searchParams;
  const t: Touch = {
    at: now,
    source: clip(q.get('utm_source')?.toLowerCase()), medium: clip(q.get('utm_medium')?.toLowerCase()),
    campaign: clip(q.get('utm_campaign')), content: clip(q.get('utm_content')), term: clip(q.get('utm_term')),
    click: CLICK_IDS.find(([k]) => q.get(k))?.[1],
    landing: clip(u.pathname, 200),
  };
  try {
    const host = referrer ? new URL(referrer).hostname.toLowerCase() : '';
    if (host && host !== ownHost && !IGNORE_REF.test(host)) t.ref = clip(host);
  } catch { /* not a URL */ }
  if (!t.source && !t.medium && !t.campaign && !t.click && !t.ref) return null;
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) as Touch;
}

const PAID = /^(cpc|ppc|paid|paid[-_ ]?social|paidsocial|cpm|cpv|ad|ads|display|banner|retargeting|remarketing|sponsored)$/;
const META = /^(facebook|fb|instagram|ig|meta|msg|messenger|an|audience_network|threads)$|facebook|instagram/;
const GOOGLE = /^(google|adwords|gdn|youtube)$/;
const WEBMAIL = /^(mail\.google\.com|com\.google\.android\.gm|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|mail\.zoho\.(com|in))$/;
const SEARCH: [RegExp, string][] = [
  [/^(www\.)?google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'], [/^((search|in\.search|www)\.)?yahoo\.com$/, 'Yahoo'],
  [/(^|\.)yandex\.[a-z]+$/, 'Yandex'], [/(^|\.)ecosia\.org$/, 'Ecosia'], [/(^|\.)baidu\.com$/, 'Baidu'], [/^search\.brave\.com$/, 'Brave'],
];
const META_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|threads\.net|messenger\.com)$|^com\.(facebook\.katana|instagram\.android)$/;
const SOCIAL: [RegExp, string][] = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'], [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, 'X'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'], [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest'], [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)quora\.com$/, 'Quora'], [/^t\.me$|(^|\.)telegram\.org$/, 'Telegram'], [/(^|\.)sharechat\.com$/, 'ShareChat'], [/(^|\.)snapchat\.com$/, 'Snapchat'],
];
const nameOf = (s: string) => ({ fb: 'Facebook', ig: 'Instagram', msg: 'Messenger', an: 'Audience Network' } as Record<string, string>)[s] ?? s.replace(/^\w/, (c) => c.toUpperCase());

/** The channel a visit counts as, with a short detail (e.g. "Google", "summer-sale"). */
export function classify(t: Touch | null | undefined): { channel: Channel; detail: string } {
  if (!t) return { channel: 'direct', detail: '' };
  const src = t.source ?? '', med = t.medium ?? '';
  const host = t.ref ?? '';
  const campaign = t.campaign ?? '';
  if (t.click === 'google' || (GOOGLE.test(src) && PAID.test(med))) return { channel: 'google_ads', detail: campaign };
  if (META.test(src) && PAID.test(med)) return { channel: 'meta_ads', detail: [nameOf(src), campaign].filter(Boolean).join(' · ') };
  if (med === 'email' || /^(newsletter|email|mailchimp)$/.test(src)) return { channel: 'email', detail: campaign || src };
  if (WEBMAIL.test(host)) return { channel: 'email', detail: '' };
  if (PAID.test(med) || (t.click && t.click !== 'meta')) return { channel: 'campaign', detail: [src || t.click, campaign].filter(Boolean).join(' · ') };
  if (META.test(src) || t.click === 'meta' || META_HOSTS.test(host)) {
    return { channel: 'meta_social', detail: /instagram/.test(src + host) || src === 'ig' ? 'Instagram' : /facebook|^fb$/.test(src + host) || /(^|\.)fb\.(com|me)$/.test(host) ? 'Facebook' : '' };
  }
  const engine = SEARCH.find(([re]) => re.test(host))?.[1];
  if (engine || med === 'organic') return { channel: 'search', detail: engine ?? nameOf(src) };
  const social = SOCIAL.find(([re]) => re.test(host))?.[1] ?? (/^(youtube|whatsapp|twitter|x|linkedin|pinterest|reddit|telegram)$/.test(src) ? nameOf(src) : '');
  if (social) return { channel: 'social', detail: social };
  if (src || med || campaign) return { channel: 'campaign', detail: [src, med, campaign].filter(Boolean).join(' · ') };
  if (host) return { channel: 'referral', detail: host.replace(/^www\./, '') };
  return { channel: 'direct', detail: '' };
}

/** The order's channel: its last visit that had a source, else its first visit. */
export const orderChannel = (s: OrderSource | null | undefined) => classify(s?.last ?? s?.first);
