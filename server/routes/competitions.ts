// Competitions (each one built in code, see src/shared/competitions.ts): register one
// person or a group, after signing in with Google and completing the profile. No approval
// from anyone. A confirmation email follows; the registration shows in the person's
// account and in Admin → Competitions.
import { Hono } from 'hono';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import type { Deps } from '../deps.js';
import { accounts, competitionSignups } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit } from '../lib/http.js';
import { esc } from '../lib/format.js';
import { sendSafely } from '../lib/mail.js';
import { getSettings } from '../services/catalog.js';
import { button, FONT, INK, label, layout, LINE, p, section } from '../services/emails.js';
import { checkSignup, findCompetition, istDateTime, personName, phaseOf, type Competition } from '../../src/shared/competitions.js';
import { profileOf, requireCustomer } from './account.js';

export const competitions = new Hono<AppEnv>();
competitions.use('*', requireCustomer);

const zSignup = z.object({
  mode: z.enum(['individual', 'group']),
  groupName: z.string().max(200).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  participants: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
});

type Signup = typeof competitionSignups.$inferSelect;
const summary = (x: Signup) => ({ id: x.id, mode: x.mode, groupName: x.groupName, people: x.participants.map(personName), createdAt: x.createdAt });

function competitionOr404(slug: string) {
  const c = findCompetition(slug);
  if (!c) throw notFound('Competition not found');
  return c;
}

/** This account's registrations for one competition. */
competitions.get('/:slug/mine', async (c) => {
  const { db } = c.get('deps');
  const comp = competitionOr404(c.req.param('slug'));
  const rows = await db.select().from(competitionSignups)
    .where(and(eq(competitionSignups.competitionSlug, comp.slug), eq(competitionSignups.userId, c.get('customer').userId)))
    .orderBy(desc(competitionSignups.createdAt));
  return c.json({ items: rows.map(summary) });
});

competitions.post('/:slug/register', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const me = c.get('customer');
  const comp = competitionOr404(c.req.param('slug'));
  await rateLimit(db, `compreg:${me.userId}`, 30, 3600);
  const phase = phaseOf(comp, now().getTime());
  if (phase === 'upcoming') throw new HttpError(409, `Registration opens on ${istDateTime(comp.opensAt)}.`, 'not_open');
  if (phase === 'closed') throw new HttpError(409, 'Registration for this competition has closed.', 'closed');
  const [acct] = await db.select().from(accounts).where(eq(accounts.userId, me.userId));
  if (!acct || !profileOf(acct).completed) throw new HttpError(409, 'Please complete your profile first.', 'profile_incomplete');
  const [{ n }] = await db.select({ n: count() }).from(competitionSignups)
    .where(and(eq(competitionSignups.competitionSlug, comp.slug), eq(competitionSignups.userId, me.userId)));
  const max = comp.maxPerAccount ?? 10;
  if (n >= max) throw new HttpError(409, max === 1 ? 'You’ve already registered for this competition.' : `One account can make up to ${max} registrations for this competition.`, 'limit');
  const checked = checkSignup(comp, await body(c, zSignup));
  if (!checked.ok) throw new HttpError(400, checked.errors[0], 'invalid', { problems: checked.errors });
  const [row] = await db.insert(competitionSignups).values({ competitionSlug: comp.slug, userId: me.userId, email: me.email, ...checked.signup }).returning();
  // The email never holds up (or undoes) the registration.
  const mail = sendConfirmation(deps, comp, row, profileOf(acct).fullName || me.name).catch((e) => console.error('[competitions] email', (e as Error).message));
  if (deps.defer) deps.defer(mail); else await mail;
  return c.json({ signup: summary(row) }, 201);
});

async function sendConfirmation(deps: Deps, comp: Competition, x: Signup, name: string) {
  const s = await getSettings(deps.db);
  const people = x.participants.map(personName).filter(Boolean);
  const rows: [string, string][] = [
    ['Competition', comp.title],
    ...(x.mode === 'group' ? [['Group', x.groupName] as [string, string]] : []),
    [people.length > 1 ? 'Taking part' : 'Name', people.join(', ')],
    ['Registered', istDateTime(x.createdAt)],
    ['Reference', x.id.slice(0, 8).toUpperCase()],
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="width:120px;padding:10px 12px 10px 0;border-bottom:1px solid ${LINE};vertical-align:top">${label(esc(k))}</td><td style="padding:10px 0;border-bottom:1px solid ${LINE};font:400 15px/1.5 ${FONT};color:${INK}">${esc(v)}</td></tr>`).join('')}</table>`;
  const url = `${deps.env.SITE_URL}/competitions/${comp.slug}`;
  await sendSafely(deps.mailer, {
    to: x.email,
    replyTo: s.supportEmail,
    subject: `Registered: ${comp.title}`,
    html: layout(deps, s, {
      preheader: `You’re registered for ${comp.title}.`,
      kicker: 'Competitions',
      title: 'You’re registered',
      intro: `Hello ${esc(name.split(' ')[0] || 'there')}, thank you for registering for ${esc(comp.title)}.`,
      body: section(table) + section(`${p(`Registration is open until ${esc(istDateTime(comp.closesAt))}. Questions? Just reply to this email.`)}${button(url, 'See the competition', INK)}`, '4px 32px 32px'),
      footerNote: 'You’re getting this because you registered for a competition on eldenap.in.',
    }),
  });
}
