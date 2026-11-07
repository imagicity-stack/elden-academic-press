// Popups: counting views, clicks, closes and sign-ups per day (India time), and checking what
// the admin saves. Rendering and the rules for who sees what are in src/shared/popups.ts.
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Q } from '../db/client.js';
import { popupStats } from '../db/schema.js';
import { CHANNELS, type Channel } from '../../src/shared/attribution.js';
import { safeHref } from '../../src/shared/links.js';

export type PopupCounter = 'views' | 'clicks' | 'closes' | 'conversions';

/** "2026-11-07" in India. */
export const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Adds one to a popup's count for today. A popup deleted meanwhile is ignored. */
export async function countPopup(db: Q, popupId: string, counter: PopupCounter, now: Date) {
  try {
    await db.insert(popupStats).values({ popupId, day: istDay(now), [counter]: 1 })
      .onConflictDoUpdate({ target: [popupStats.popupId, popupStats.day], set: { [counter]: sql`${popupStats[counter]} + 1` } });
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).code !== '23503' && (e as { cause?: { code?: string } }).cause?.code !== '23503') throw e;
  }
}

/* ---------------- What the builder may save ---------------- */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0B1220');
const text = (max: number) => z.string().trim().max(max);
const link = z.string().trim().max(500).refine((u) => u === '' || safeHref(u) !== null, 'Links start with https://, mailto: or / (a page on this site)');
const isoOrNull = z.union([z.iso.datetime({ offset: true }), z.null()]);
const pattern = z.string().trim().max(120).regex(/^\/[\w\-./*]*$/, 'Pages look like /books/* or /store');

/** Pictures: uploaded to the store's covers bucket, or the site's own /assets/… files. */
export function zPopupFields(coversPrefix: string) {
  const image = z.string().trim().max(500).refine((u) => u === '' || u.startsWith(coversPrefix) || /^\/assets\/[\w\-./]+$/.test(u), 'Upload the picture here');
  return z.object({
    content: z.object({
      goal: z.enum(['subscribe', 'coupon', 'link', 'announce']),
      eyebrow: text(60), heading: text(140), body: text(1200), image, imageAlt: text(160),
      button: z.object({ label: text(40), url: link }),
      coupon: z.string().trim().toUpperCase().max(30).regex(/^[A-Z0-9_-]*$/, 'Codes use letters, numbers, - and _'),
      dismissLabel: text(40), countdownTo: isoOrNull, askName: z.boolean(), submitLabel: text(30),
      success: z.object({ heading: text(120), body: text(600) }),
    }),
    design: z.object({
      layout: z.enum(['modal', 'slide', 'bar', 'fullscreen']),
      position: z.enum(['bottom-right', 'bottom-left', 'top', 'bottom']),
      size: z.enum(['small', 'medium', 'large']),
      imagePosition: z.enum(['top', 'side', 'background']),
      align: z.enum(['left', 'center']),
      font: z.enum(['sans', 'serif', 'display']),
      colors: z.object({ background: color, text: color, accent: color, accentText: color }),
      radius: z.number().int().min(0).max(32),
      overlay: z.number().int().min(0).max(90),
      animation: z.enum(['fade', 'zoom', 'slide']),
    }),
    trigger: z.object({
      type: z.enum(['delay', 'scroll', 'exit', 'pageviews', 'link']),
      seconds: z.number().int().min(0).max(600), percent: z.number().int().min(5).max(100), pageviews: z.number().int().min(1).max(20),
    }),
    audience: z.object({
      pages: z.object({ mode: z.enum(['all', 'only', 'except']), patterns: z.array(pattern).max(20) }),
      device: z.enum(['all', 'desktop', 'mobile']),
      visitor: z.enum(['all', 'new', 'returning']),
      signedIn: z.enum(['all', 'in', 'out']),
      channels: z.array(z.enum(CHANNELS.map((c) => c.key) as [Channel, ...Channel[]])).max(10),
      campaign: text(60),
      cart: z.enum(['any', 'empty', 'has_items']),
      students: z.boolean(),
    }),
    frequency: z.object({ show: z.enum(['every', 'session', 'days', 'once']), days: z.number().int().min(1).max(365), stopAfterConvert: z.boolean() }),
    startsAt: isoOrNull, endsAt: isoOrNull,
  });
}

/** What must be filled in before a popup can go live. */
export function publishProblems(p: { content: { goal: string; heading: string; coupon: string; button: { label: string; url: string } }; startsAt: string | Date | null; endsAt: string | Date | null }): string[] {
  const out: string[] = [];
  const c = p.content;
  if (!c.heading) out.push('Add a heading.');
  if (c.goal === 'coupon' && !c.coupon) out.push('Add the discount code to show.');
  if (c.goal === 'link' && (!c.button.label || !c.button.url)) out.push('Add the button’s text and link.');
  if (p.startsAt && p.endsAt && new Date(p.endsAt) <= new Date(p.startsAt)) out.push('The end date is before the start date.');
  return out;
}
