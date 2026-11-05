// /api/approvals/:token — a parent approves (or declines) a student who signed up
// themselves. /api/invites/:token — a child claims the login their parent created.
//
// Tokens are single-use and expire after 7 days. A student can never approve
// themselves: the student's own account, and any student account, is refused. A
// parent can't claim their own child's login invite.
import { Hono, type Context } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { accounts, parentApprovalRequests, studentGuardians, studentLoginInvites, studentProfiles } from '../db/schema.js';
import { body, HttpError, rateLimit, zPhone } from '../lib/http.js';
import { isStateCode } from '../lib/states.js';
import { notify } from '../services/notify.js';
import { accountOf, ensureAccount, hashToken, recordConsents, studentsOf, type Profile } from '../services/students.js';
import '../services/studentEmails.js';
import { readCustomer } from './account.js';

export const approvals = new Hono<AppEnv>();
export const invites = new Hono<AppEnv>();

const zParentDetails = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120), whatsapp: zPhone,
  city: z.string().trim().min(2, 'Enter a city or town').max(80), state: z.string().trim().refine(isStateCode, 'Choose a state'),
});

async function requestByToken(c: Context<AppEnv>) {
  const token = c.req.param('token') ?? '';
  if (!/^[\w-]{20,100}$/.test(token)) throw new HttpError(404, 'This link isn’t valid.', 'invalid_link');
  const [r] = await c.get('deps').db.select().from(parentApprovalRequests).where(eq(parentApprovalRequests.tokenHash, hashToken(token)));
  if (!r) throw new HttpError(404, 'This link isn’t valid. Ask the student to send it again.', 'invalid_link');
  const [p] = await c.get('deps').db.select().from(studentProfiles).where(eq(studentProfiles.id, r.studentProfileId));
  return { r, p };
}

const linkState = (r: { status: string; expiresAt: Date }, now: Date) => (r.status === 'pending' && r.expiresAt < now ? 'expired' : r.status);

/** Children this parent already has with the same name and class: offer to merge instead of a duplicate. */
async function mergeCandidates(c: Context<AppEnv>, parentUserId: string, p: Profile) {
  const kids = (await studentsOf(c.get('deps').db, parentUserId)).filter((k) => k.rel === 'parent' && !k.profile.studentUserId);
  return kids.filter((k) => k.profile.firstName.toLowerCase() === p.firstName.toLowerCase() && k.profile.lastName.toLowerCase() === p.lastName.toLowerCase() && k.profile.classGrade === p.classGrade)
    .map((k) => ({ id: k.profile.id, firstName: k.profile.firstName, lastName: k.profile.lastName, classGrade: k.profile.classGrade, schoolName: k.profile.schoolName }));
}

/** Who is looking at the approval page, and whether they may approve. */
async function viewer(c: Context<AppEnv>, p: Profile | undefined) {
  const me = await readCustomer(c).catch(() => null);
  if (!me) return null;
  const a = await accountOf(c.get('deps').db, me.userId);
  const self = Boolean(p && p.studentUserId === me.userId);
  return {
    email: me.email,
    type: a?.accountType ?? null,
    blocked: self || a?.accountType === 'student' ? 'This must be approved from a parent’s Google account.' : null,
    needsDetails: !a || a.accountType !== 'parent' || !a.fullName || !a.whatsapp || !a.city || !a.state,
    details: a ? { fullName: a.fullName || me.name, whatsapp: a.whatsapp, city: a.city, state: a.state } : { fullName: me.name, whatsapp: '', city: '', state: '' },
    mergeCandidates: p && !self && a?.accountType !== 'student' ? await mergeCandidates(c, me.userId, p) : [],
  };
}

/** The approval page: first name, class and school only. */
approvals.get('/:token', async (c) => {
  const { r, p } = await requestByToken(c);
  const status = linkState(r, c.get('deps').now());
  return c.json({
    status,
    student: p && status === 'pending' ? { firstName: p.firstName, classGrade: p.classGrade, schoolName: p.schoolName } : null,
    viewer: status === 'pending' ? await viewer(c, p) : null,
  }, 200, { 'Cache-Control': 'no-store' });
});

approvals.post('/:token', async (c) => {
  const deps = c.get('deps');
  await rateLimit(deps.db, `approve:${c.get('ip')}`, 30, 3600);
  const me = await readCustomer(c);
  if (!me) throw new HttpError(401, 'Please sign in with your Google account first.', 'unauthenticated');
  const input = await body(c, z.object({
    decision: z.enum(['approve', 'decline']),
    details: zParentDetails.optional(),
    consents: z.object({ data_processing: z.boolean(), publication: z.boolean().default(false), marketing: z.boolean().default(false) }).optional(),
    mergeInto: z.uuid().optional(),
  }));
  const { r, p } = await requestByToken(c);
  if (linkState(r, deps.now()) !== 'pending' || !p) throw new HttpError(410, r.status === 'approved' ? 'This request has already been approved.' : 'This link has run out or was already used. Ask the student to send a new one.', 'link_used');
  // Never self-approval, never from a student account.
  const a = await ensureAccount(deps.db, me);
  if (p.studentUserId === me.userId || a.accountType === 'student') throw new HttpError(403, 'This must be approved from a parent’s Google account.', 'not_parent');
  const studentAccount = p.studentUserId ? await accountOf(deps.db, p.studentUserId) : undefined;

  if (input.decision === 'decline') {
    await deps.db.transaction(async (tx) => {
      await tx.update(parentApprovalRequests).set({ status: 'declined', resolvedAt: deps.now(), approvedByUserId: me.userId }).where(eq(parentApprovalRequests.id, r.id));
      await tx.delete(studentProfiles).where(and(eq(studentProfiles.id, p.id), eq(studentProfiles.approvalStatus, 'pending')));
      if (studentAccount) await tx.update(accounts).set({ onboardingCompletedAt: null }).where(eq(accounts.userId, studentAccount.userId));
    });
    if (studentAccount) await notify(deps, { template: 'approval_result', to: studentAccount.email, userId: studentAccount.userId, payload: { approved: false, firstName: p.firstName } });
    return c.json({ status: 'declined' });
  }

  // Approving: a parent's details and the one-time consents.
  const needsDetails = a.accountType !== 'parent' || !a.fullName || !a.whatsapp || !a.city || !a.state;
  if (needsDetails && !input.details) throw new HttpError(400, 'Please add your details.', 'details_required');
  if (!input.consents?.data_processing) throw new HttpError(400, 'Please agree to taking part to approve.', 'consent_required');
  let target = p.id;
  if (input.mergeInto) {
    const options = await mergeCandidates(c, me.userId, p);
    if (!options.some((o) => o.id === input.mergeInto)) throw new HttpError(400, 'That child can’t be merged with this request.', 'bad_merge');
    target = input.mergeInto;
  }
  await deps.db.transaction(async (tx) => {
    await tx.update(accounts).set({
      accountType: 'parent', ...(input.details ?? {}), onboardingCompletedAt: a.onboardingCompletedAt ?? deps.now(),
      typeLockedAt: a.typeLockedAt ?? deps.now(), updatedAt: sql`now()`,
    }).where(eq(accounts.userId, me.userId));
    if (target !== p.id) {
      // Same child already in this parent's account: give it the student's login, drop the duplicate.
      await tx.delete(studentProfiles).where(eq(studentProfiles.id, p.id));
      await tx.update(studentProfiles).set({ studentUserId: p.studentUserId, updatedAt: sql`now()` }).where(eq(studentProfiles.id, target));
    } else {
      await tx.update(studentProfiles).set({ approvalStatus: 'approved', approvedAt: deps.now(), updatedAt: sql`now()` }).where(eq(studentProfiles.id, p.id));
      await tx.insert(studentGuardians).values({ studentProfileId: p.id, parentUserId: me.userId, isPrimary: true }).onConflictDoNothing();
      await tx.update(parentApprovalRequests).set({ status: 'approved', resolvedAt: deps.now(), approvedByUserId: me.userId }).where(eq(parentApprovalRequests.id, r.id));
    }
    await recordConsents(tx, target, me.userId, input.consents!, { ip: c.get('ip'), userAgent: c.req.header('user-agent') ?? null });
    if (studentAccount) await tx.update(accounts).set({ typeLockedAt: studentAccount.typeLockedAt ?? deps.now() }).where(eq(accounts.userId, studentAccount.userId));
  });
  if (studentAccount) await notify(deps, { template: 'approval_result', to: studentAccount.email, userId: studentAccount.userId, studentProfileId: target, payload: { approved: true, firstName: p.firstName } });
  return c.json({ status: 'approved', studentId: target });
});

/* ---------------- A parent's login invite for their child ---------------- */

async function inviteByToken(c: Context<AppEnv>) {
  const token = c.req.param('token') ?? '';
  if (!/^[\w-]{20,100}$/.test(token)) throw new HttpError(404, 'This link isn’t valid.', 'invalid_link');
  const [inv] = await c.get('deps').db.select().from(studentLoginInvites).where(eq(studentLoginInvites.tokenHash, hashToken(token)));
  if (!inv) throw new HttpError(404, 'This link isn’t valid. Ask your parent for a new one.', 'invalid_link');
  const [p] = await c.get('deps').db.select().from(studentProfiles).where(and(eq(studentProfiles.id, inv.studentProfileId), isNull(studentProfiles.deletedAt)));
  const status = !p ? 'invalid' : inv.claimedAt ? 'used' : inv.expiresAt < c.get('deps').now() ? 'expired' : p.studentUserId ? 'used' : 'open';
  return { inv, p, status };
}

invites.get('/:token', async (c) => {
  const { p, status } = await inviteByToken(c);
  return c.json({ status, firstName: status === 'open' ? p!.firstName : null }, 200, { 'Cache-Control': 'no-store' });
});

invites.post('/:token/claim', async (c) => {
  const deps = c.get('deps');
  await rateLimit(deps.db, `invite:${c.get('ip')}`, 30, 3600);
  const me = await readCustomer(c);
  if (!me) throw new HttpError(401, 'Please sign in with your own Google account first.', 'unauthenticated');
  const { inv, p, status } = await inviteByToken(c);
  if (status !== 'open' || !p) throw new HttpError(410, 'This link has run out or was already used. Ask your parent for a new one.', 'link_used');
  const a = await ensureAccount(deps.db, me);
  // A parent can't take their own child's login.
  const [guardian] = await deps.db.select({ id: studentGuardians.id }).from(studentGuardians)
    .where(and(eq(studentGuardians.studentProfileId, p.id), eq(studentGuardians.parentUserId, me.userId)));
  if (guardian || me.userId === inv.createdByParentUserId || a.accountType === 'parent') {
    throw new HttpError(403, `This link is for ${p.firstName} to open with ${p.firstName}’s own Google account, not a parent’s.`, 'parent_account');
  }
  const own = (await studentsOf(deps.db, me.userId)).find((x) => x.rel === 'self');
  if (own) throw new HttpError(409, 'This Google account already has a student profile.', 'has_profile');
  await deps.db.transaction(async (tx) => {
    await tx.update(studentProfiles).set({ studentUserId: me.userId, updatedAt: sql`now()` }).where(and(eq(studentProfiles.id, p.id), isNull(studentProfiles.studentUserId)));
    await tx.update(studentLoginInvites).set({ claimedByUserId: me.userId, claimedAt: deps.now() }).where(eq(studentLoginInvites.id, inv.id));
    await tx.update(accounts).set({ accountType: 'student', onboardingCompletedAt: a.onboardingCompletedAt ?? deps.now(), typeLockedAt: deps.now(), updatedAt: sql`now()` })
      .where(eq(accounts.userId, me.userId));
  });
  return c.json({ status: 'claimed', firstName: p.firstName });
});
