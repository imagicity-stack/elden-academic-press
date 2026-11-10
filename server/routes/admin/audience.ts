// Admin → Audience: sign-ups (accounts and subscribers), profile completion and where they came from.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { toCsv } from '../../lib/csv.js';
import { query } from '../../lib/http.js';
import { audience, audienceStats, BUCKETS, FORM_LABEL, type Person } from '../../services/audience.js';
import { channelLabel, CHANNELS } from '../../../src/shared/attribution.js';
import { FIELD_LABEL, type ProfileField } from '../../../src/shared/profile.js';

export const adminAudience = new Hono<AppEnv>();

const zFilters = z.object({
  q: z.string().trim().max(100).optional(),
  channel: z.string().max(30).optional(),
  bucket: z.enum(['complete', 'most', 'some', 'barely', 'none']).optional(),
  form: z.string().max(130).optional(),
  days: z.coerce.number().int().min(1).max(3650).default(30),
  page: z.coerce.number().int().min(1).default(1),
});

function filter(people: Person[], f: z.infer<typeof zFilters>) {
  const q = f.q?.toLowerCase();
  return people.filter((p) => (!q || p.email.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.phone.includes(q))
    && (!f.channel || p.channel === f.channel)
    && (!f.bucket || p.bucket === f.bucket)
    && (!f.form || (f.form.startsWith('popup:') ? p.form === 'popup' && p.popupName === f.form.slice(6) : p.form === f.form)));
}

adminAudience.get('/', async (c) => {
  const { db, now } = c.get('deps');
  const f = query(c, zFilters);
  const people = await audience(db);
  const since = new Date(now().getTime() - f.days * 86_400_000);
  const shown = filter(people, f);
  return c.json({
    stats: audienceStats(people, since),
    buckets: BUCKETS,
    channels: CHANNELS,
    fieldLabels: FIELD_LABEL,
    items: shown.slice((f.page - 1) * 50, f.page * 50),
    total: shown.length, page: f.page, limit: 50,
  });
});

adminAudience.get('/export.csv', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, zFilters);
  const rows = filter(await audience(db), f);
  const csv = toCsv(rows, [
    ['Name', (r) => r.name], ['Email', (r) => r.email], ['Mobile', (r) => r.phone],
    ['Account', (r) => (r.account ? 'yes' : 'no')], ['Profile %', (r) => (r.progress ? r.progress.percent : '')],
    ['Missing', (r) => (r.progress ? r.progress.missing.map((m) => FIELD_LABEL[m as ProfileField] ?? m).join('; ') : '')],
    ['Came from', (r) => channelLabel(r.channel)], ['Detail', (r) => r.channelDetail], ['Campaign', (r) => r.campaign],
    ['Signed up on', (r) => (r.form === 'popup' ? `Popup: ${r.popupName}` : FORM_LABEL[r.form] ?? r.form)],
    ['Newsletter', (r) => r.newsletter ?? ''], ['Calls/WhatsApp OK', (r) => (r.callConsent ? 'yes' : 'no')],
    ['Orders', (r) => r.orders], ['Spent', (r) => (r.spent / 100).toFixed(2)], ['Joined', (r) => r.joinedAt],
  ]);
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audience.csv"' });
});
