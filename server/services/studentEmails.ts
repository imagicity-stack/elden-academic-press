// Fixed account emails for competitions: a parent approval request, the result
// for the student, a parent's login invite for their child, a student's request to
// delete their profile, and a pending request that ran out. Same look as order emails.
import { eq } from 'drizzle-orm';
import { parentApprovalRequests, studentLoginInvites, studentProfiles } from '../db/schema.js';
import { esc } from '../lib/format.js';
import { istDay } from '../../src/shared/competition.js';
import { getSettings } from './catalog.js';
import { button, layout, p, section } from './emails.js';
import { registerEmail } from './notify.js';
import { approvalLink, inviteLink, site } from './students.js';

const WHY = 'You’re getting this because of an Elden Academic Press competitions account.';

registerEmail('approval_request', async (deps, payload) => {
  const [r] = await deps.db.select().from(parentApprovalRequests).where(eq(parentApprovalRequests.id, String(payload.requestId)));
  if (!r || r.status !== 'pending') return null;
  const [st] = await deps.db.select().from(studentProfiles).where(eq(studentProfiles.id, r.studentProfileId));
  if (!st) return null;
  const s = await getSettings(deps.db);
  const first = esc(st.firstName);
  return {
    subject: `Please approve ${st.firstName} for Elden competitions`,
    replyTo: s.supportEmail,
    html: layout(deps, s, {
      preheader: `${st.firstName} named you as their parent. It takes a minute.`,
      kicker: 'Parent approval needed',
      title: `Approve ${st.firstName}?`,
      intro: `Hello ${esc(r.parentName)},`,
      body: section(`${p(`<strong>${first}</strong> (Class ${st.classGrade}, ${esc(st.schoolName)}) signed up for Elden Academic Press competitions and named you as their parent.`)}
${p(`Before ${first} can take part, a parent needs to approve. Sign in with <strong>your own</strong> Google account (not ${first}’s), check the details and choose Approve or Decline. You do this once, not for every competition.`)}
${button(approvalLink(deps, r.id), 'Review and approve')}
${p(`<br>This link works once, until ${istDay(r.expiresAt)}. If you don’t know ${first}, ignore this email and nothing happens.`, 'font-size:13px')}`, '4px 32px 32px'),
      footerNote: WHY,
    }),
  };
});

registerEmail('approval_result', async (deps, payload) => {
  const s = await getSettings(deps.db);
  const first = String(payload.firstName ?? '');
  const approved = payload.approved === true;
  return {
    subject: approved ? 'Your parent approved you: you can take part now' : 'Your parent didn’t approve the request',
    replyTo: s.supportEmail,
    html: layout(deps, s, {
      preheader: approved ? 'Register for a competition and upload your entry.' : 'You can ask again any time.',
      kicker: 'Competitions',
      title: approved ? `You’re approved, ${first}!` : 'Not approved this time',
      intro: `Hi ${esc(first)},`,
      body: section(approved
        ? `${p('Your parent approved your account. You can now register for competitions and upload your entries.')}${button(`${site(deps)}/competitions`, 'See competitions')}`
        : `${p('Your parent chose not to approve this request, so your details have been removed. If this was a mistake, sign in again and start over.')}${button(`${site(deps)}/onboarding`, 'Start again')}`, '4px 32px 32px'),
      footerNote: WHY,
    }),
  };
});

registerEmail('student_invite', async (deps, payload) => {
  const [inv] = await deps.db.select().from(studentLoginInvites).where(eq(studentLoginInvites.id, String(payload.inviteId)));
  if (!inv || inv.claimedAt) return null;
  const [st] = await deps.db.select().from(studentProfiles).where(eq(studentProfiles.id, inv.studentProfileId));
  if (!st) return null;
  const s = await getSettings(deps.db);
  const first = esc(st.firstName);
  return {
    subject: `${st.firstName}’s login link for Elden competitions`,
    replyTo: s.supportEmail,
    html: layout(deps, s, {
      preheader: `Share it with ${st.firstName}. It works once, for 7 days.`,
      kicker: 'Login for your child',
      title: `${st.firstName}’s own login`,
      intro: 'Here’s the link you created.',
      body: section(`${p(`Send this link to <strong>${first}</strong>. ${first} opens it and signs in with <strong>their own</strong> Google account; it will be linked to the profile you set up, already approved. It won’t work with your own account.`)}
${button(inviteLink(deps, inv.id), `Open ${st.firstName}’s login link`)}
${p(`<br>It works once, until ${istDay(inv.expiresAt)}. You can create a new one from your account any time.`, 'font-size:13px')}`, '4px 32px 32px'),
      footerNote: WHY,
    }),
  };
});

registerEmail('deletion_request', async (deps, payload) => {
  const s = await getSettings(deps.db);
  const first = esc(String(payload.firstName ?? 'Your child'));
  return {
    subject: `${String(payload.firstName ?? 'Your child')} asked to delete their competition profile`,
    replyTo: s.supportEmail,
    html: layout(deps, s, {
      preheader: 'Only a parent can delete it.',
      kicker: 'Competitions',
      title: 'A request to delete a profile',
      intro: 'Hello,',
      body: section(`${p(`<strong>${first}</strong> asked to delete their Elden competitions profile and entries. Only a parent can do this. If you agree, open your account, choose ${first} and select Delete.`)}${button(`${site(deps)}/account/students`, 'Open my account')}`, '4px 32px 32px'),
      footerNote: WHY,
    }),
  };
});

registerEmail('request_expired', async (deps, payload) => {
  const s = await getSettings(deps.db);
  return {
    subject: 'Your approval request ran out',
    replyTo: s.supportEmail,
    html: layout(deps, s, {
      preheader: 'Sign in and start again; it only takes a minute.',
      kicker: 'Competitions',
      title: 'Please start again',
      intro: `Hi ${esc(String(payload.firstName ?? ''))},`,
      body: section(`${p('Your parent didn’t approve your account within 14 days, so we removed the details you entered. Sign in and start again whenever you’re ready.')}${button(`${site(deps)}/onboarding`, 'Start again')}`, '4px 32px 32px'),
      footerNote: WHY,
    }),
  };
});
