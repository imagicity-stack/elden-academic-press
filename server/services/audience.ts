// Admin → Audience: everyone who signed up (Google accounts and newsletter subscribers, merged by
// email), how complete each profile is, and where they came from: the channel that brought them
// to the site (Meta ads, Google, Instagram…) and the form they signed up on (a popup, the footer,
// checkout…). Older sign-ups with no recorded visit fall back to their first order's channel.
import { and, asc, inArray, sql } from 'drizzle-orm';
import type { Q } from '../db/client.js';
import { accounts, orders, popups, subscribers } from '../db/schema.js';
import { CHANNELS, type Channel } from '../../src/shared/attribution.js';
import { profileProgress, type ProfileValues } from '../../src/shared/profile.js';

export type Bucket = 'complete' | 'most' | 'some' | 'barely' | 'none';
export const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'complete', label: 'Complete' }, { key: 'most', label: 'Almost there (60–99%)' }, { key: 'some', label: 'Started (20–59%)' },
  { key: 'barely', label: 'Barely started (under 20%)' }, { key: 'none', label: 'No account (newsletter only)' },
];
const bucketOf = (pct: number | null): Bucket => (pct === null ? 'none' : pct >= 100 ? 'complete' : pct >= 60 ? 'most' : pct >= 20 ? 'some' : 'barely');

/** Where they signed up (the subscriber's form), in words. */
export const FORM_LABEL: Record<string, string> = {
  footer: 'Footer form', 'newsletter-page': 'Newsletter page', home: 'Home page form', popup: 'Popup', checkout: 'Checkout',
  signup: 'Google sign-in', account: 'Account page', admin: 'Added by the team', import: 'Imported',
};

export interface Person {
  key: string;
  email: string;
  name: string;
  phone: string;
  /** Has a Google account; is on the newsletter (and its status). */
  account: boolean;
  newsletter: 'subscribed' | 'pending' | 'unsubscribed' | null;
  callConsent: boolean;
  type: string | null;
  progress: { done: number; total: number; percent: number; missing: string[] } | null;
  bucket: Bucket;
  channel: Channel;
  channelDetail: string;
  /** Where the channel came from: their visit before signing up, or (older sign-ups) their first order. */
  channelFrom: 'visit' | 'order' | 'none';
  landing: string;
  campaign: string;
  form: string;
  popupName: string;
  orders: number;
  spent: number;
  joinedAt: Date;
  lastSeenAt: Date | null;
}

/** Everyone, newest first (merged by email). */
export async function audience(db: Q, today?: string): Promise<Person[]> {
  const [accs, subs, pops] = await Promise.all([
    db.select().from(accounts).limit(20_000),
    db.select().from(subscribers).limit(50_000),
    db.select({ id: popups.id, name: popups.name }).from(popups),
  ]);
  const popupName = new Map(pops.map((p) => [p.id, p.name]));
  const emails = [...new Set([...accs.map((a) => a.email.toLowerCase()), ...subs.map((s) => s.email.toLowerCase())])];
  // Paid orders by email: count, spend, and the first one's channel (a fallback source).
  const paid = emails.length ? await db.select({ email: sql<string>`lower(${orders.email})`, channel: orders.channel, total: orders.total, paidAt: orders.paidAt })
    .from(orders).where(and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), inArray(sql`lower(${orders.email})`, emails)))
    .orderBy(asc(orders.paidAt)) : [];
  const buys = new Map<string, { n: number; spent: number; firstChannel: string }>();
  for (const o of paid) {
    const b = buys.get(o.email) ?? { n: 0, spent: 0, firstChannel: o.channel };
    b.n++; b.spent += o.total;
    buys.set(o.email, b);
  }
  const byEmail = new Map<string, Person>();
  const sub = new Map(subs.map((s) => [s.email.toLowerCase(), s]));
  const acc = new Map(accs.map((a) => [a.email.toLowerCase(), a]));
  for (const email of emails) {
    const a = acc.get(email);
    const s = sub.get(email);
    const values: ProfileValues | null = a ? {
      type: a.accountType, fullName: a.fullName, phone: a.phone, city: a.city, state: a.state, dob: a.dob,
      institutionType: a.institutionType, institutionName: a.institutionName, grade: a.grade, guardianName: a.guardianName, guardianPhone: a.guardianPhone, instagram: a.instagram,
    } : null;
    const progress = values ? profileProgress(values, today) : null;
    const b = buys.get(email);
    const visitChannel = (a?.channel || s?.channel || '') as Channel | '';
    const channel: Channel = visitChannel || (b?.firstChannel && b.firstChannel !== 'unknown' ? b.firstChannel as Channel : 'unknown');
    const v = a?.source ?? s?.visit ?? null;
    const t = v?.last ?? v?.first;
    byEmail.set(email, {
      key: a?.userId ?? s!.id,
      email: a?.email ?? s!.email,
      name: a?.fullName || a?.name || s?.name || '',
      phone: a?.phone || s?.phone || '',
      account: Boolean(a),
      newsletter: s?.status ?? null,
      callConsent: Boolean(s?.callConsent),
      type: a?.accountType ?? null,
      progress,
      bucket: bucketOf(progress?.percent ?? null),
      channel,
      channelDetail: (a?.channel ? a.channelDetail : s?.channel ? s.channelDetail : '') || '',
      channelFrom: visitChannel ? 'visit' : channel !== 'unknown' ? 'order' : 'none',
      landing: v?.first?.landing ?? '',
      campaign: t?.campaign ?? '',
      form: s?.source || (a ? 'signup' : ''),
      popupName: s?.popupId ? popupName.get(s.popupId) ?? 'A deleted popup' : '',
      orders: b?.n ?? 0,
      spent: b?.spent ?? 0,
      joinedAt: new Date(Math.min(...[a?.createdAt, s?.createdAt].filter((d): d is Date => Boolean(d)).map((d) => d.getTime()))),
      lastSeenAt: a?.lastSeenAt ?? null,
    });
  }
  return [...byEmail.values()].sort((x, y) => y.joinedAt.getTime() - x.joinedAt.getTime());
}

/** The numbers above the list, for people who joined since `since`. */
export function audienceStats(people: Person[], since: Date) {
  const recent = people.filter((p) => p.joinedAt >= since);
  const withAccount = people.filter((p) => p.progress);
  const count = <K extends string>(xs: Person[], key: (p: Person) => K) => {
    const m = new Map<K, number>();
    for (const p of xs) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return m;
  };
  const channels = count(recent, (p) => p.channel);
  const forms = count(recent, (p) => (p.form === 'popup' ? `popup:${p.popupName}` : p.form || 'unknown'));
  const buckets = count(people, (p) => p.bucket);
  const missing = new Map<string, number>();
  for (const p of withAccount) for (const f of p.progress!.missing) missing.set(f, (missing.get(f) ?? 0) + 1);
  return {
    total: people.length,
    accounts: withAccount.length,
    subscribed: people.filter((p) => p.newsletter === 'subscribed').length,
    joined: recent.length,
    averageCompletion: withAccount.length ? Math.round(withAccount.reduce((n, p) => n + p.progress!.percent, 0) / withAccount.length) : null,
    complete: withAccount.filter((p) => p.bucket === 'complete').length,
    buyers: people.filter((p) => p.orders > 0).length,
    buckets: Object.fromEntries(buckets) as Partial<Record<Bucket, number>>,
    channels: CHANNELS.map((c) => ({ key: c.key, label: c.label, n: channels.get(c.key) ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n),
    forms: [...forms].map(([k, n]) => ({ key: k, label: k.startsWith('popup:') ? `Popup: ${k.slice(6) || 'unnamed'}` : FORM_LABEL[k] ?? 'Not recorded', n })).sort((a, b) => b.n - a.n),
    /** What people most often leave out of their profile. */
    missing: [...missing].map(([field, n]) => ({ field, n })).sort((a, b) => b.n - a.n).slice(0, 6),
  };
}

export const personByKey = (people: Person[], key: string) => people.find((p) => p.key === key) ?? null;
