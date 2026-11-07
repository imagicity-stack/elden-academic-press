// Team competitions (DoomsDay Diaries first): settings the admin can change, who may see a
// team, and the competition's own emails (application received, approved, changes needed,
// not approved, notices, file received). Competition emails are transactional: they go to
// the team whatever its newsletter choice, and never carry newsletter content.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Q } from '../db/client.js';
import { competitionSettings, teamApplications, teamFiles, teamMembers, type NoticeAudience } from '../db/schema.js';
import { esc } from '../lib/format.js';
import { addressList, sendSafely } from '../lib/mail.js';
import { stateName } from '../lib/states.js';
import { HttpError, notFound } from '../lib/http.js';
import { findCompetition, istDateTime, type Competition } from '../../src/shared/competitions.js';
import { ageOn, applicationCode, dayLabel, type TeamConfig } from '../../src/shared/teams.js';
import { getSettings } from './catalog.js';
import { button, FONT, INK, label, layout, LINE, p, PAPER, ACCENT, section } from './emails.js';

export type TeamComp = Competition & { team: TeamConfig };
export type App = typeof teamApplications.$inferSelect;
export type Member = typeof teamMembers.$inferSelect;
export type TeamFile = typeof teamFiles.$inferSelect;

export function teamCompetition(slug: string): TeamComp {
  const c = findCompetition(slug);
  if (!c || !c.team) throw notFound('Competition not found');
  return c as TeamComp;
}

/** What the admin can change without new code. Stored per competition. */
export interface TeamSettings {
  bannerKey: string | null;
  artKey: string | null;
  sponsorKeys: string[];
  /** The official rules and terms as a PDF (and an optional separate topic document). Approved teams only:
   *  they name the story's title, which the public page keeps secret. */
  rulesDocKey: string | null;
  topicDocKey: string | null;
  /** Overrides of the dates in the code (ISO with +05:30). */
  closesAt: string | null;
  submissionDeadline: string | null;
  resultsOn: string | null;
  /** Stop new registrations without changing dates. */
  registrationPaused: boolean;
  resultsPublished: boolean;
}
const DEFAULTS: TeamSettings = {
  bannerKey: null, artKey: null, sponsorKeys: [], rulesDocKey: null, topicDocKey: null,
  closesAt: null, submissionDeadline: null, resultsOn: null, registrationPaused: false, resultsPublished: false,
};

export async function settingsFor(db: Q, slug: string): Promise<TeamSettings> {
  const [row] = await db.select().from(competitionSettings).where(eq(competitionSettings.slug, slug));
  return { ...DEFAULTS, ...(row?.data as Partial<TeamSettings> | undefined) };
}

/** The dates that apply (code defaults with the admin's changes). */
export function datesOf(c: TeamComp, s: TeamSettings) {
  return {
    opensAt: c.opensAt,
    closesAt: s.closesAt || c.closesAt,
    submissionDeadline: s.submissionDeadline || c.team.submissionDeadline,
    resultsOn: s.resultsOn || c.team.resultsOn,
  };
}

/** Can a new team register, or a team change its application, right now? */
export function registrationState(c: TeamComp, s: TeamSettings, now: Date) {
  const d = datesOf(c, s);
  if (now < new Date(d.opensAt)) return { open: false, reason: `Registration opens on ${istDateTime(d.opensAt)}.` };
  if (now > new Date(d.closesAt)) return { open: false, reason: 'Registration has closed.' };
  if (s.registrationPaused) return { open: false, reason: 'Registration is paused for now. Please check back soon.' };
  return { open: true, reason: '' };
}

export const mediaUrl = (deps: Deps, key: string | null | undefined) => (key ? deps.storage.publicUrl('competition-media', key) : null);

export async function loadApplication(db: Q, id: string) {
  const [app] = await db.select().from(teamApplications).where(eq(teamApplications.id, id));
  if (!app) return null;
  const members = await db.select().from(teamMembers).where(eq(teamMembers.applicationId, id)).orderBy(asc(teamMembers.position));
  const files = await db.select().from(teamFiles).where(eq(teamFiles.applicationId, id)).orderBy(asc(teamFiles.uploadedAt));
  return { app, members, files };
}

export async function membersOf(db: Q, ids: string[]) {
  if (!ids.length) return new Map<string, Member[]>();
  const rows = await db.select().from(teamMembers).where(inArray(teamMembers.applicationId, ids)).orderBy(asc(teamMembers.position));
  const out = new Map<string, Member[]>();
  for (const m of rows) out.set(m.applicationId, [...(out.get(m.applicationId) ?? []), m]);
  return out;
}

/** The person who registered, or a member whose (Google-verified) email is on the team. */
export const canSee = (app: App, members: Member[], me: { userId: string; email: string }) =>
  app.userId === me.userId || members.some((m) => m.email && m.email === me.email.toLowerCase());
/** Uploads: the person who registered or the team captain. */
export const canUpload = (app: App, members: Member[], me: { userId: string; email: string }) =>
  app.userId === me.userId || (members[0]?.email !== '' && members[0]?.email === me.email.toLowerCase());

export function requireAccess<T extends { app: App; members: Member[] }>(x: T | null, me: { userId: string; email: string }): T {
  if (!x || !canSee(x.app, x.members, me)) throw notFound('Team not found');
  return x;
}

/** Does a notice reach this team? */
export function noticeReaches(a: NoticeAudience, app: App) {
  if (a.public) return true;
  if (a.applicationIds?.length) return a.applicationIds.includes(app.id);
  if (a.statuses?.length && !a.statuses.includes(app.status)) return false;
  if (a.categories?.length && !a.categories.includes(app.category)) return false;
  if (a.results?.length && !a.results.includes(app.result || 'none')) return false;
  return true;
}

export const code = (c: TeamComp, app: App) => applicationCode(c.team, app.applicationNo);
const recipients = (app: App, members: Member[]) => [...new Set([app.email, members[0]?.email].filter(Boolean).map((e) => e!.toLowerCase()))];

export type TeamEmail = 'received' | 'updated' | 'approved' | 'changes' | 'rejected' | 'file';

/** Send one of the competition's emails to the person who registered (and the captain). Never throws. */
export async function sendTeamEmail(deps: Deps, c: TeamComp, app: App, members: Member[], kind: TeamEmail, extra: { file?: TeamFile } = {}) {
  try {
    const s = await getSettings(deps.db);
    const ts = await settingsFor(deps.db, c.slug);
    const d = datesOf(c, ts);
    const url = `${deps.env.SITE_URL}/competitions/${c.slug}#team`;
    const id = code(c, app);
    const group = c.team.groups.find((g) => g.key === app.category)?.label ?? app.category;
    const facts = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${([
      ['Team', app.teamName], ['Application ID', id], ['Age group', group], ['Members', members.map((m) => m.fullName).join(', ')],
    ] as [string, string][]).map(([k, v]) => `<tr><td style="width:130px;padding:9px 12px 9px 0;border-bottom:1px solid ${LINE};vertical-align:top">${label(esc(k))}</td><td style="padding:9px 0;border-bottom:1px solid ${LINE};font:400 15px/1.5 ${FONT};color:${INK}">${esc(v)}</td></tr>`).join('')}</table>`;
    const note = (text: string) => section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${PAPER};padding:16px 18px;border-left:3px solid ${ACCENT};font:400 15px/1.6 ${FONT};color:${INK};white-space:pre-wrap">${esc(text)}</td></tr></table>`);
    const fileLabel = extra.file ? c.team.files.find((f) => f.kind === extra.file!.kind)?.label ?? extra.file.kind : '';
    const t: Record<TeamEmail, { subject: string; title: string; intro: string; body: string; cta: string }> = {
      received: {
        subject: `Application received: ${app.teamName} (${id})`, title: 'Application received',
        intro: `Thank you for registering ${esc(app.teamName)} for ${esc(c.title)}. Your status is <strong>Pending verification</strong>: we usually check registrations within 48 hours, and we’ll email you as soon as we have.`,
        body: section(facts), cta: 'See your team',
      },
      updated: {
        subject: `Application updated: ${app.teamName} (${id})`, title: 'We’ve got your changes',
        intro: `Thank you. ${esc(app.teamName)}’s application is back with us for verification. We’ll email you once it’s checked.`,
        body: section(facts), cta: 'See your team',
      },
      approved: {
        subject: `Approved: ${app.teamName} is in ${c.title}`, title: 'Your team is approved',
        intro: `Great news: ${esc(app.teamName)} is approved. The competition section is now open on your team page: read the story brief there, then upload your comic and your rough pencil sketches by <strong>${esc(istDateTime(d.submissionDeadline))}</strong>.`,
        body: section(facts) + (app.reviewNote ? note(app.reviewNote) : ''), cta: 'Open the competition section',
      },
      changes: {
        subject: `Changes needed: ${app.teamName} (${id})`, title: 'Please update your application',
        intro: `We’ve checked ${esc(app.teamName)}’s application and need a few changes before we can approve it:`,
        body: note(app.reviewNote) + section(p('Open your team page, make the changes and send it again. We’ll check it as soon as we can.')), cta: 'Update the application',
      },
      rejected: {
        subject: `Not approved: ${app.teamName} (${id})`, title: 'Your application wasn’t approved',
        intro: `We’re sorry: ${esc(app.teamName)}’s application for ${esc(c.title)} wasn’t approved.`,
        body: (app.reviewNote ? note(app.reviewNote) : '') + section(p(`If you think this is a mistake, just reply to this email.`)), cta: 'See your team',
      },
      file: {
        subject: `${fileLabel} received: ${app.teamName}`, title: `${fileLabel} received`,
        intro: `We received ${esc(app.teamName)}’s ${esc(fileLabel.toLowerCase())}${extra.file?.pages ? ` (${extra.file.pages} pages)` : ''} on ${esc(istDateTime(extra.file?.uploadedAt ?? deps.now()))}. You can replace it until ${esc(istDateTime(d.submissionDeadline))}; the last upload before the deadline is judged.`,
        body: section(facts), cta: 'See your submission',
      },
    };
    const m = t[kind];
    for (const to of recipients(app, members)) {
      await sendSafely(deps.mailer, {
        to, replyTo: s.supportEmail, subject: m.subject,
        html: layout(deps, s, {
          preheader: m.title, kicker: c.title, title: m.title, intro: m.intro,
          body: m.body + section(button(url, m.cta, INK), '4px 32px 32px'),
          footerNote: `You’re getting this because a team was registered for ${esc(c.title)} on eldenap.in with this email address. Results: ${esc(dayLabel(d.resultsOn))}.`,
        }),
      });
    }
  } catch (e) {
    console.error('[teams] email', kind, (e as Error).message);
  }
}

/**
 * Tells the organiser a team needs checking: a new registration, or one sent back after
 * "Request changes". To Settings → alerts, else MAIL_TO, else the support address. Never throws.
 */
export async function sendTeamStaffAlert(deps: Deps, c: TeamComp, app: App, members: Member[], kind: 'new' | 'resubmitted') {
  try {
    const s = await getSettings(deps.db);
    const to = s.notifyEmails.length ? s.notifyEmails : addressList(deps.env.MAIL_TO).length ? addressList(deps.env.MAIL_TO) : [s.supportEmail];
    const id = code(c, app);
    const group = c.team.groups.find((g) => g.key === app.category)?.label ?? app.category;
    const inst = c.team.institutionTypes.find((t) => t.key === app.institutionType);
    const role = (k: string) => c.team.roles.find((r) => r.key === k)?.label ?? k;
    const age = (dob: string | null) => (dob ? ageOn(dob, c.team.ageOn) : null);
    const memberLines = members.map((m) => `${esc(m.fullName)}${m.position === 0 ? ' (captain)' : ''} · ${esc(m.roles.map(role).join(', '))}${age(m.dob) !== null ? ` · ${age(m.dob)} yrs` : ''}${inst && !inst.same && m.institutionName ? ` · ${esc(m.institutionName)}` : ''}`);
    const rows: [string, string][] = [
      ['Team', esc(app.teamName)], ['Application ID', esc(id)], ['Age group', esc(group)],
      ['From', `${esc(inst?.label ?? app.institutionType)}${app.institutionName ? `: ${esc(app.institutionName)}` : ''}<br>${esc(app.city)}, ${esc(stateName(app.state))}`],
      ['Members', memberLines.join('<br>')], ['Registered by', esc(app.email)],
    ];
    const facts = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(([k, v]) => `<tr><td style="width:130px;padding:9px 12px 9px 0;border-bottom:1px solid ${LINE};vertical-align:top">${label(esc(k))}</td><td style="padding:9px 0;border-bottom:1px solid ${LINE};font:400 15px/1.5 ${FONT};color:${INK}">${v}</td></tr>`).join('')}</table>`;
    const m = kind === 'new'
      ? { subject: `New registration: ${app.teamName} (${id})`, title: 'New team registration', intro: `${esc(app.teamName)} registered for ${esc(c.title)} and is waiting for your check (pending verification).` }
      : { subject: `Changes sent: ${app.teamName} (${id})`, title: 'Changes sent back for checking', intro: `${esc(app.teamName)} made the changes you asked for and sent the application back. It’s waiting for your check again.` };
    const html = layout(deps, s, {
      preheader: m.title, kicker: c.title, title: m.title, intro: m.intro,
      body: section(facts) + section(button(`${deps.env.SITE_URL.replace(/\/$/, '')}/admin/competitions/${c.slug}/teams/${app.id}`, 'Review the application', INK), '4px 32px 32px'),
      footerNote: 'Sent to the alert addresses in Admin → Settings. Replying writes to the person who registered the team. ID documents are only in the admin.',
    });
    for (const addr of to) await sendSafely(deps.mailer, { to: addr, replyTo: app.email, subject: m.subject, html });
  } catch (e) {
    console.error('[teams] staff alert', kind, (e as Error).message);
  }
}

/** A notice by email, to many teams at once (in BCC batches, so nobody sees the others' addresses). */
export async function sendNoticeEmail(deps: Deps, c: TeamComp, notice: { title: string; body: string }, to: string[]) {
  const s = await getSettings(deps.db);
  const html = layout(deps, s, {
    preheader: notice.title, kicker: c.title, title: notice.title, intro: '',
    body: section(`<div style="font:400 15.5px/1.65 ${FONT};color:${INK};white-space:pre-wrap">${esc(notice.body)}</div>`) +
      section(button(`${deps.env.SITE_URL}/competitions/${c.slug}#team`, 'Open your team page', INK), '4px 32px 32px'),
    footerNote: `You’re getting this because your team is registered for ${esc(c.title)} on eldenap.in.`,
  });
  let sent = 0;
  for (let i = 0; i < to.length; i += 50) {
    const batch = to.slice(i, i + 50);
    try {
      await deps.mailer.send({ to: s.supportEmail, bcc: batch, replyTo: s.supportEmail, subject: `${c.title}: ${notice.title}`, html });
      sent += batch.length;
    } catch (e) {
      console.error('[teams] notice batch failed', (e as Error).message);
    }
  }
  return sent;
}

export const allRecipients = recipients;
export function assertOpen(state: { open: boolean; reason: string }) {
  if (!state.open) throw new HttpError(409, state.reason, 'closed');
}
export const ID_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const teamWhere = (slug: string, id: string) => and(eq(teamApplications.competitionSlug, slug), eq(teamApplications.id, id));
