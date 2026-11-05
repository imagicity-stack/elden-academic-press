// Competition emails, designed per competition by the admin, in the same look as
// every other EAP email (shared layout: logo, colours, footer).
//
// - Registration confirmed and submission received, each in a Parent and a Student
//   version. The parent gets the Parent version; a student with their own login gets
//   the Student version too.
// - The Student version never has the referral link, the upsell or any marketing,
//   whatever the template says: enforced here, not only in the editor.
// - Every merged value is HTML-escaped (names come from people).
// - Children's uploaded files are never linked or attached; only competition
//   marketing images (public bucket) appear.
// - Sent after the registration/submission is saved; a failure never undoes it;
//   failures are logged and retried (notify.ts).
import { and, eq, inArray } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import {
  accounts, competitionEmailTemplates, registrations, studentGuardians, studentProfiles, submissionFiles, submissions,
} from '../db/schema.js';
import { esc } from '../lib/format.js';
import type { Attachment } from '../lib/mail.js';
import { istDateTime, istDay } from '../../src/shared/competition.js';
import { defaultTemplate, type Audience, type EmailType, type TemplateContent } from '../../src/shared/competitionEmail.js';
import { getSettings, type Settings } from './catalog.js';
import { competitionUrl, loadFull, mediaUrl, type Full } from './competitions.js';
import { ACCENT, button, FONT, INK, label, layout, LINE, MUTED, p, PAPER, section } from './emails.js';
import { notify, registerEmail, type BuiltMail } from './notify.js';
import { latestConsents, site } from './students.js';
import { products } from '../db/schema.js';

export const regCode = (id: string) => `R-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export interface MergeValues {
  parent_name: string; student_first_name: string; competition_title: string; competition_url: string; group_name: string; group_format: string;
  registration_id: string; entry_code: string; submitted_at: string; submission_deadline: string; results_date: string;
  submit_url: string; resources_url: string; referral_url: string; support_email: string;
}

/** Fill {{tags}}: every value HTML-escaped; unknown tags vanish. */
export const fillHtml = (text: string, v: Partial<MergeValues>) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => esc((v as Record<string, string>)[k] ?? ''));
const fillPlain = (text: string, v: Partial<MergeValues>) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => (v as Record<string, string>)[k] ?? '');

/** The editor's small Markdown: **bold**, *italic*, [links](https://…), lists, ## headings. Input already escaped. */
function markdown(escaped: string) {
  const inline = (s: string) => s
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${INK}">$1</strong>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}" style="color:${INK};text-decoration:underline">${t}</a>`);
  return escaped.trim().split(/\n{2,}/).filter(Boolean).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return `<ol style="margin:0 0 14px;padding-left:22px;font:400 15px/1.6 ${FONT};color:${INK}">${lines.map((l) => `<li style="margin:0 0 4px">${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul style="margin:0 0 14px;padding-left:22px;font:400 15px/1.6 ${FONT};color:${INK}">${lines.map((l) => `<li style="margin:0 0 4px">${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^##\s+/.test(block)) return `<h2 style="margin:6px 0 10px;font:700 18px/1.25 ${FONT};color:${INK}">${inline(block.replace(/^##\s+/, ''))}</h2>`;
    return p(inline(lines.join('<br>')), `font-size:16px;color:${INK}`);
  }).join('');
}

const box = (title: string, html: string) => section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${PAPER};padding:18px 20px">
${label(esc(title))}<div style="margin-top:10px">${html}</div></td></tr></table>`, '0 32px 20px');
const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;font:400 14px/1.5 ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;font:600 14px/1.5 ${FONT};color:${INK}">${esc(v)}</td></tr>`;

export interface EmailContext {
  type: EmailType; audience: Audience; f: Full; values: MergeValues;
  /** Parent version only: a book suggestion if the parent allowed book news. */
  upsell?: { headline: string; url: string; title: string | null } | null;
}

/** Build one competition email from its template. */
export async function renderCompetitionEmail(deps: Deps, t: TemplateContent, ctx: EmailContext, s?: Settings): Promise<BuiltMail> {
  s ??= await getSettings(deps.db);
  const { f, values: v } = ctx;
  const student = ctx.audience === 'student';
  // The Student version never carries referral or marketing blocks.
  const blocks = { ...t.blocks, ...(student ? { showReferral: false, showUpsell: false } : {}) };
  const vals: MergeValues = student ? { ...v, referral_url: '' } : v;
  const noSubmission = !f.c.submissionRequired;
  const url = (u: string) => {
    const filled = fillPlain(u, vals).trim();
    return /^(https?:\/\/|mailto:)/.test(filled) ? filled : '';
  };
  const parts: string[] = [];
  const bannerKey = t.bannerImageKey ?? f.c.banner16x9Key;
  const bannerUrl = mediaUrl(deps, bannerKey);
  if (bannerUrl) parts.push(section(`<img src="${esc(bannerUrl)}" width="536" alt="${esc(t.bannerAlt || f.c.title)}" style="display:block;width:100%;max-width:536px;height:auto;border:0">`, '0 32px 22px'));
  parts.push(section(markdown(fillHtml(t.bodyContent, vals)), '0 32px 10px'));

  const buttons = [[t.primaryCtaLabel, t.primaryCtaUrl], [t.secondaryCtaLabel, t.secondaryCtaUrl]]
    .filter(([l, u]) => l.trim() && url(u))
    // No submission in this competition: no submit button.
    .filter(([, u]) => !(noSubmission && /\{\{\s*submit_url\s*\}\}/.test(u)));
  if (buttons.length) {
    parts.push(section(buttons.map(([l, u], i) => button(url(u), fillPlain(l, vals), i === 0 ? ACCENT : INK)).join('<div style="height:10px;font-size:0">&nbsp;</div>'), '6px 32px 26px'));
  }

  if (blocks.showDetails) {
    parts.push(box('Key details', `<table role="presentation" cellpadding="0" cellspacing="0">
${row('Student', v.student_first_name)}${v.group_name ? row('Group', v.group_name) : ''}${v.group_format ? row('Format', v.group_format) : ''}
${row('Registration ID', v.registration_id)}${ctx.type === 'submission_received' && v.entry_code ? row('Entry code', v.entry_code) : ''}
${ctx.type === 'submission_received' && v.submitted_at ? row('Received', v.submitted_at) : ''}${!noSubmission && v.submission_deadline ? row('Deadline', v.submission_deadline) : ''}
${v.results_date ? row('Results', v.results_date) : ''}</table>`));
  }
  if (blocks.showPrizes && f.prizes.length) {
    parts.push(box('Prizes', f.prizes.slice(0, 8).map((x) => {
      const g = x.groupId ? f.groups.find((gg) => gg.id === x.groupId)?.name : '';
      return `<div style="font:400 14.5px/1.55 ${FONT};color:${INK}"><strong>${esc(x.awardName)}</strong>${g ? ` · ${esc(g)}` : ''}${x.description ? ` — ${esc(x.description)}` : ''}</div>`;
    }).join('')));
  }
  if (blocks.showRules && f.c.rulesContent.trim()) {
    const rules = f.c.rulesContent.split('\n').map((l) => l.replace(/^\s*([-•]|\d+\.)\s*/, '').trim()).filter(Boolean).slice(0, 5);
    parts.push(box('Quick rules', `<ul style="margin:0;padding-left:20px;font:400 14.5px/1.55 ${FONT};color:${INK}">${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>${url(vals.competition_url) ? `<div style="margin-top:8px"><a href="${esc(vals.competition_url)}" style="color:${INK};font:600 13.5px ${FONT}">All rules</a></div>` : ''}`));
  }
  if (blocks.showResources && f.resources.length) {
    parts.push(box('Resources', `${f.resources.map((r) => `<div style="font:400 14.5px/1.55 ${FONT};color:${INK}">• ${esc(r.title)}${r.description ? ` <span style="color:${MUTED}">— ${esc(r.description)}</span>` : ''}</div>`).join('')}
${url(vals.resources_url) ? `<div style="margin-top:10px"><a href="${esc(vals.resources_url)}" style="color:${INK};font:600 13.5px ${FONT}">Download them here</a></div>` : ''}`));
  }
  if (blocks.showReferral && vals.referral_url) {
    parts.push(box('Invite friends', `${p(`Know a child who’d love this? Share this link: <a href="${esc(vals.referral_url)}" style="color:${INK};word-break:break-all">${esc(vals.referral_url)}</a>`, `margin:0;color:${INK}`)}`));
  }
  if (blocks.showUpsell && ctx.upsell) {
    parts.push(box('For your child', `${p(esc(ctx.upsell.headline), `margin:0 0 10px;color:${INK};font-weight:600`)}${button(ctx.upsell.url, ctx.upsell.title ? `See ${ctx.upsell.title}` : 'Take a look', INK)}`));
  }

  const why = student
    ? `You’re getting this because you registered for ${esc(f.c.title)} on eldenap.in.`
    : `You’re getting this because ${esc(v.student_first_name)} is taking part in ${esc(f.c.title)} on eldenap.in.`;
  const attachments: Attachment[] = [];
  let total = 0;
  for (const key of t.attachmentKeys.slice(0, 2)) {
    try {
      const content = await deps.storage.read('competition-files', key);
      if (total + content.length > 5 * 1024 * 1024) break;
      total += content.length;
      attachments.push({ filename: key.split('/').pop() || 'attachment', content });
    } catch { /* a missing attachment never stops the email */ }
  }
  return {
    subject: fillPlain(t.subject, vals).replace(/\s+/g, ' ').trim(),
    replyTo: s.supportEmail,
    attachments: attachments.length ? attachments : undefined,
    html: layout(deps, s, {
      preheader: fillPlain(noSubmission ? t.preheader.replace(/[^.]*\{\{\s*submission_deadline\s*\}\}[^.]*\.?/g, '') : t.preheader, vals).trim() || f.c.title,
      kicker: f.c.title,
      title: fillPlain(t.heading, vals),
      intro: '',
      body: parts.join('\n'),
      footerNote: `${why}${f.c.disclaimer ? `<br>${esc(f.c.disclaimer)}` : ''}`,
    }),
  };
}

/** Merge values for one registration (and one parent, for the Parent version). */
export async function valuesFor(deps: Deps, f: Full, reg: typeof registrations.$inferSelect, firstName: string, parentName: string, sub?: typeof submissions.$inferSelect): Promise<MergeValues> {
  const s = await getSettings(deps.db);
  const g = f.groups.find((x) => x.id === reg.groupId);
  const base = site(deps);
  return {
    parent_name: parentName || 'there',
    student_first_name: firstName,
    competition_title: f.c.title,
    competition_url: competitionUrl(deps, f.c.slug),
    group_name: g?.name ?? '', group_format: g?.formatNote ?? '',
    registration_id: regCode(reg.id),
    entry_code: sub?.entryCode ?? '', submitted_at: sub?.submittedAt ? istDateTime(sub.submittedAt) : '',
    submission_deadline: f.c.submissionClosesAt ? istDateTime(f.c.submissionClosesAt) : '',
    results_date: f.c.resultsAt ? istDay(f.c.resultsAt) : 'to be announced',
    submit_url: `${base}/competitions/${f.c.slug}/entry/${reg.id}`,
    resources_url: `${base}/competitions/${f.c.slug}/registered/${reg.id}`,
    referral_url: `${competitionUrl(deps, f.c.slug)}?ref=${reg.referralCode}`,
    support_email: s.supportEmail,
  };
}

/** The saved template, or the default. */
export async function templateFor(deps: Deps, competitionId: string, type: EmailType, audience: Audience, title: string): Promise<TemplateContent> {
  const [t] = await deps.db.select().from(competitionEmailTemplates).where(and(
    eq(competitionEmailTemplates.competitionId, competitionId), eq(competitionEmailTemplates.templateType, type), eq(competitionEmailTemplates.audience, audience)));
  return t ?? defaultTemplate(type, audience, title);
}

async function upsellFor(deps: Deps, f: Full, studentId: string, classGrade: number) {
  const rule = f.c.upsellRules.find((u) => classGrade >= u.classMin && classGrade <= u.classMax);
  if (!rule) return null;
  // Book suggestions only if the parent allowed book news for this child.
  if (!(await latestConsents(deps.db, [studentId])).get(studentId)?.marketing) return null;
  const [prod] = rule.productId ? await deps.db.select().from(products).where(and(eq(products.id, rule.productId), eq(products.status, 'active'))) : [];
  const url = prod ? `${site(deps)}/books/${prod.slug}` : rule.url;
  return url ? { headline: rule.headline, url, title: prod?.title ?? null } : null;
}

/** Who gets which version: the student (own login) the Student one, each linked parent the Parent one. */
async function recipients(deps: Deps, studentId: string) {
  const [st] = await deps.db.select().from(studentProfiles).where(eq(studentProfiles.id, studentId));
  if (!st || st.deletedAt) return null;
  const parents = await deps.db.select({ a: accounts }).from(studentGuardians).innerJoin(accounts, eq(accounts.userId, studentGuardians.parentUserId))
    .where(eq(studentGuardians.studentProfileId, studentId)).then((r) => r.map((x) => x.a));
  const [own] = st.studentUserId ? await deps.db.select().from(accounts).where(eq(accounts.userId, st.studentUserId)) : [];
  return { st, parents, own };
}

/** Queue the registration emails (called after the registration is saved). */
export async function notifyRegistration(deps: Deps, registrationId: string) {
  const [reg] = await deps.db.select().from(registrations).where(eq(registrations.id, registrationId));
  if (!reg) return;
  const r = await recipients(deps, reg.studentProfileId);
  if (!r) return;
  await notify(deps, [
    ...r.parents.map((pa) => ({ template: 'comp_registration', to: pa.email, userId: pa.userId, studentProfileId: r.st.id, registrationId, payload: { registrationId, audience: 'parent', parentUserId: pa.userId } })),
    ...(r.own ? [{ template: 'comp_registration', to: r.own.email, userId: r.own.userId, studentProfileId: r.st.id, registrationId, payload: { registrationId, audience: 'student' } }] : []),
  ]);
}

/** Queue the "entry received", "entry changed" or "entry withdrawn" emails. */
export async function notifySubmission(deps: Deps, submissionId: string, kind: 'received' | 'edited' | 'withdrawn') {
  const [sub] = await deps.db.select().from(submissions).where(eq(submissions.id, submissionId));
  if (!sub) return;
  const [reg] = await deps.db.select().from(registrations).where(eq(registrations.id, sub.registrationId));
  const r = reg ? await recipients(deps, reg.studentProfileId) : null;
  if (!reg || !r) return;
  const template = kind === 'received' ? 'comp_submission' : `comp_submission_${kind}`;
  await notify(deps, [
    ...r.parents.map((pa) => ({ template, to: pa.email, userId: pa.userId, studentProfileId: r.st.id, registrationId: reg.id, payload: { submissionId, audience: 'parent', parentUserId: pa.userId } })),
    ...(r.own ? [{ template, to: r.own.email, userId: r.own.userId, studentProfileId: r.st.id, registrationId: reg.id, payload: { submissionId, audience: 'student' } }] : []),
  ]);
}

async function context(deps: Deps, registrationId: string, parentUserId?: string) {
  const [reg] = await deps.db.select().from(registrations).where(eq(registrations.id, registrationId));
  if (!reg) return null;
  const f = await loadFull(deps.db, { id: reg.competitionId });
  const r = await recipients(deps, reg.studentProfileId);
  if (!f || !r) return null;
  const parent = r.parents.find((x) => x.userId === parentUserId) ?? r.parents[0];
  return { reg, f, r, parentName: parent ? (parent.fullName || parent.name).split(' ')[0] : '' };
}

registerEmail('comp_registration', async (deps, payload) => {
  const audience = payload.audience === 'student' ? 'student' : 'parent';
  const ctx = await context(deps, String(payload.registrationId), payload.parentUserId as string | undefined);
  if (!ctx) return null;
  const t = await templateFor(deps, ctx.f.c.id, 'registration_confirmed', audience, ctx.f.c.title);
  if (!t.enabled) return null;
  const values = await valuesFor(deps, ctx.f, ctx.reg, ctx.r.st.firstName, ctx.parentName);
  const upsell = audience === 'parent' ? await upsellFor(deps, ctx.f, ctx.r.st.id, ctx.reg.classAtRegistration) : null;
  return renderCompetitionEmail(deps, t, { type: 'registration_confirmed', audience, f: ctx.f, values, upsell });
});

async function submissionContext(deps: Deps, payload: Record<string, unknown>) {
  const [sub] = await deps.db.select().from(submissions).where(eq(submissions.id, String(payload.submissionId)));
  if (!sub) return null;
  const audience: Audience = payload.audience === 'student' ? 'student' : 'parent';
  const ctx = await context(deps, sub.registrationId, payload.parentUserId as string | undefined);
  return ctx ? { ...ctx, sub, audience } : null;
}

registerEmail('comp_submission', async (deps, payload) => {
  const ctx = await submissionContext(deps, payload);
  if (!ctx || ctx.sub.status !== 'submitted') return null;
  const t = await templateFor(deps, ctx.f.c.id, 'submission_received', ctx.audience, ctx.f.c.title);
  if (!t.enabled) return null;
  const values = await valuesFor(deps, ctx.f, ctx.reg, ctx.r.st.firstName, ctx.parentName, ctx.sub);
  return renderCompetitionEmail(deps, t, { type: 'submission_received', audience: ctx.audience, f: ctx.f, values });
});

/** Short fixed notices: an entry was changed, or withdrawn. */
for (const kind of ['edited', 'withdrawn'] as const) {
  registerEmail(`comp_submission_${kind}`, async (deps, payload) => {
    const ctx = await submissionContext(deps, payload);
    if (!ctx) return null;
    const s = await getSettings(deps.db);
    const v = await valuesFor(deps, ctx.f, ctx.reg, ctx.r.st.firstName, ctx.parentName, ctx.sub);
    const who = ctx.audience === 'student' ? 'Your' : `${esc(v.student_first_name)}’s`;
    const files = await deps.db.select({ n: submissionFiles.id }).from(submissionFiles).where(inArray(submissionFiles.submissionId, [ctx.sub.id]));
    return {
      subject: kind === 'edited' ? `Entry updated: ${ctx.sub.entryCode}` : `Entry withdrawn: ${ctx.sub.entryCode}`,
      replyTo: s.supportEmail,
      html: layout(deps, s, {
        preheader: kind === 'edited' ? 'The latest version is the one that counts.' : 'It won’t be judged.',
        kicker: ctx.f.c.title,
        title: kind === 'edited' ? 'Entry updated' : 'Entry withdrawn',
        intro: '',
        body: section(`${p(kind === 'edited'
          ? `${who} entry <strong style="color:${INK}">${esc(ctx.sub.entryCode)}</strong> for ${esc(ctx.f.c.title)} was changed on ${esc(istDateTime(ctx.sub.updatedAt))} (${files.length} file${files.length === 1 ? '' : 's'}). The latest version is the one that counts.${v.submission_deadline ? ` Changes are possible until ${esc(v.submission_deadline)}.` : ''}`
          : `${who} entry <strong style="color:${INK}">${esc(ctx.sub.entryCode)}</strong> for ${esc(ctx.f.c.title)} was withdrawn and won’t be judged.`, `color:${INK}`)}
${p(`If you didn’t do this, reply to this email straight away.`, 'font-size:13px')}
<div style="border-top:1px solid ${LINE};margin-top:8px"></div>${button(v.submit_url, 'View the entry', INK)}`, '4px 32px 28px'),
        footerNote: `You’re getting this because of an entry in ${esc(ctx.f.c.title)} on eldenap.in.`,
      }),
    };
  });
}

/** Sample data for the editor's preview and test emails. */
export async function sampleValues(deps: Deps, f: Full): Promise<MergeValues> {
  const s = await getSettings(deps.db);
  const g = f.groups[0];
  const base = site(deps);
  return {
    parent_name: 'Meera', student_first_name: 'Riya', competition_title: f.c.title, competition_url: competitionUrl(deps, f.c.slug),
    group_name: g?.name ?? 'Group A', group_format: g?.formatNote ?? '', registration_id: 'R-3F9A1C2B', entry_code: `${f.c.entryCodePrefix}-${g?.letter ?? 'A'}-0042`,
    submitted_at: istDateTime(new Date()), submission_deadline: f.c.submissionClosesAt ? istDateTime(f.c.submissionClosesAt) : '8 Dec 2026, 11:59 PM IST',
    results_date: f.c.resultsAt ? istDay(f.c.resultsAt) : '20 Dec 2026',
    submit_url: `${base}/competitions/${f.c.slug}`, resources_url: `${base}/competitions/${f.c.slug}`,
    referral_url: `${competitionUrl(deps, f.c.slug)}?ref=SAMPLE12`, support_email: s.supportEmail,
  };
}
