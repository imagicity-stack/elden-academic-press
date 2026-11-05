// /api/profile: "Who is using this account?", parent details, children (with
// consents and login invites) and the student path (own details, parent's details,
// waiting for approval). Shopping never needs any of this.
import { Hono, type Context } from 'hono';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { accounts, studentGuardians, studentLoginInvites, studentProfiles } from '../db/schema.js';
import { body, HttpError, rateLimit, zEmail, zPhone } from '../lib/http.js';
import { isStateCode } from '../lib/states.js';
import { classNeedsConfirming } from '../../src/shared/competition.js';
import { notify } from '../services/notify.js';
import {
  approvalLink, createApprovalRequest, deletePendingStudent, deleteStudentProfile, editableFields, ensureAccount, hashToken,
  INVITE_DAYS, inviteLink, latestConsents, openRequestFor, parentsOf, recordConsents, studentFor, studentsOf, tokenFor, type Profile, type Relation,
} from '../services/students.js';
import '../services/studentEmails.js';
import { requireCustomer } from './account.js';

export const profile = new Hono<AppEnv>();
profile.use('*', requireCustomer);

const zState = z.string().trim().refine(isStateCode, 'Choose a state');
const zPlace = z.string().trim().min(2, 'Enter a city or town').max(80);
const zFirst = z.string().trim().min(1, 'Enter a first name').max(60);
const zLast = z.string().trim().min(1, 'Enter a last name').max(60);
const zClass = z.number().int().min(3, 'Class 3 to 12').max(12, 'Class 3 to 12');
const zSchool = z.string().trim().min(2, 'Enter the school’s name').max(150);
const zChild = z.object({ firstName: zFirst, lastName: zLast, classGrade: zClass, schoolName: zSchool, city: zPlace, state: zState });
const zParentDetails = z.object({ fullName: z.string().trim().min(2, 'Enter your full name').max(120), whatsapp: zPhone, city: zPlace, state: zState });
const zConsents = z.object({ data_processing: z.boolean(), publication: z.boolean().default(false), marketing: z.boolean().default(false) });

const meta = (c: Context<AppEnv>) => ({ ip: c.get('ip'), userAgent: c.req.header('user-agent') ?? null });
const limit = (c: Context<AppEnv>, what: string, n = 40) => rateLimit(c.get('deps').db, `profile:${what}:${c.get('customer').userId}`, n, 3600);

async function me(c: Context<AppEnv>) {
  const deps = c.get('deps');
  return ensureAccount(deps.db, c.get('customer'));
}

/** What the account and onboarding pages need. */
async function view(c: Context<AppEnv>) {
  const deps = c.get('deps');
  const { db, now } = deps;
  const a = await me(c);
  const list = await studentsOf(db, a.userId);
  const consents = await latestConsents(db, list.filter((x) => x.rel === 'parent').map((x) => x.profile.id));
  const invites = list.length ? await db.select().from(studentLoginInvites)
    .where(and(isNull(studentLoginInvites.claimedAt), gt(studentLoginInvites.expiresAt, now()))).orderBy(desc(studentLoginInvites.createdAt)) : [];
  const students = await Promise.all(list.map(async ({ profile: p, rel }) => {
    const base = {
      id: p.id, firstName: p.firstName, lastName: p.lastName, classGrade: p.classGrade, schoolName: p.schoolName, city: p.city, state: p.state,
      approvalStatus: p.approvalStatus, relation: rel, hasLogin: Boolean(p.studentUserId),
      needsClassConfirm: p.approvalStatus === 'approved' && classNeedsConfirming(p.classConfirmedAt, now()),
      editable: editableFields(rel, p),
    };
    if (rel === 'parent') {
      const inv = invites.find((i) => i.studentProfileId === p.id && i.createdByParentUserId === a.userId);
      return { ...base, consents: consents.get(p.id), invite: !p.studentUserId && inv ? { url: inviteLink(deps, inv.id), expiresAt: inv.expiresAt } : null };
    }
    const r = p.approvalStatus === 'approved' ? null : await openRequestFor(db, p.id);
    return {
      ...base,
      approval: r ? {
        status: r.status === 'pending' && r.expiresAt < now() ? 'expired' : r.status,
        parentName: r.parentName, parentWhatsapp: r.parentWhatsapp, parentEmail: r.parentEmail, expiresAt: r.expiresAt,
        link: r.status === 'pending' ? approvalLink(deps, r.id) : null,
      } : null,
    };
  }));
  return {
    account: {
      email: a.email, name: a.name, type: a.accountType, fullName: a.fullName, whatsapp: a.whatsapp, city: a.city, state: a.state,
      completed: Boolean(a.onboardingCompletedAt), locked: Boolean(a.typeLockedAt),
    },
    students,
  };
}

profile.get('/', async (c) => c.json(await view(c)));

/** "I'm a Parent" / "I'm a Student". Can be changed until the account is linked to someone. */
profile.post('/type', async (c) => {
  const deps = c.get('deps');
  const { type } = await body(c, z.object({ type: z.enum(['parent', 'student']) }));
  await limit(c, 'type', 30);
  const a = await me(c);
  if (a.accountType !== type) {
    if (a.typeLockedAt) throw new HttpError(409, 'This account is linked to a family already, so its type can’t be changed. Write to us if it’s wrong.', 'type_locked');
    // Switching away from student: an unapproved request of their own goes.
    if (a.accountType === 'student') {
      const own = (await studentsOf(deps.db, a.userId)).find((x) => x.rel === 'self');
      if (own) await deletePendingStudent(deps.db, own.profile.id);
    }
    await deps.db.update(accounts).set({ accountType: type, onboardingCompletedAt: null, updatedAt: sql`now()` }).where(eq(accounts.userId, a.userId));
  }
  return c.json(await view(c));
});

/** A parent's own details (name, WhatsApp, city, state). */
profile.put('/details', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, zParentDetails);
  await limit(c, 'details');
  const a = await me(c);
  if (a.accountType !== 'parent') throw new HttpError(409, 'Choose “I’m a Parent” first.', 'not_parent');
  await deps.db.update(accounts).set({ ...input, onboardingCompletedAt: a.onboardingCompletedAt ?? deps.now(), updatedAt: sql`now()` }).where(eq(accounts.userId, a.userId));
  return c.json(await view(c));
});

/* ---------------- A parent's children ---------------- */

async function requireParent(c: Context<AppEnv>) {
  const a = await me(c);
  if (a.accountType !== 'parent' || !a.onboardingCompletedAt) throw new HttpError(409, 'Complete your parent details first.', 'not_parent');
  return a;
}

profile.post('/children', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, zChild.extend({ consents: zConsents }));
  await limit(c, 'child', 20);
  const a = await requireParent(c);
  if (!input.consents.data_processing) throw new HttpError(400, 'Please agree to taking part to add your child.', 'consent_required');
  const { consents, ...child } = input;
  await deps.db.transaction(async (tx) => {
    const [p] = await tx.insert(studentProfiles).values({ ...child, approvalStatus: 'approved', approvedAt: deps.now(), createdByUserId: a.userId }).returning();
    await tx.insert(studentGuardians).values({ studentProfileId: p.id, parentUserId: a.userId, isPrimary: true });
    await recordConsents(tx, p.id, a.userId, consents, meta(c));
    await tx.update(accounts).set({ typeLockedAt: a.typeLockedAt ?? deps.now() }).where(eq(accounts.userId, a.userId));
  });
  return c.json(await view(c), 201);
});

const zEdit = zChild.partial().extend({ confirmClass: z.boolean().optional() });

async function editStudent(c: Context<AppEnv>, p: Profile, rel: Relation, input: z.infer<typeof zEdit>) {
  const deps = c.get('deps');
  const allowed = editableFields(rel, p);
  const { confirmClass, ...fields } = input;
  const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && allowed.includes(k as keyof Profile)));
  if (Object.keys(fields).some((k) => !allowed.includes(k as keyof Profile) && (fields as Record<string, unknown>)[k] !== (p as Record<string, unknown>)[k])) {
    throw new HttpError(403, rel === 'self' ? 'You can change your class and school. Ask your parent for anything else.' : 'You can’t change that.', 'not_editable');
  }
  await deps.db.update(studentProfiles).set({
    ...changes, ...(confirmClass || 'classGrade' in changes ? { classConfirmedAt: deps.now() } : {}), updatedAt: sql`now()`,
  }).where(eq(studentProfiles.id, p.id));
}

profile.put('/children/:id', async (c) => {
  const input = await body(c, zEdit);
  await limit(c, 'edit');
  const { profile: p, rel } = await studentFor(c.get('deps').db, c.get('customer').userId, c.req.param('id'), 'edit');
  await editStudent(c, p, rel, input);
  return c.json(await view(c));
});

/** Publication and marketing can change any time; withdrawing "taking part" means deleting the profile. */
profile.post('/children/:id/consents', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({ publication: z.boolean(), marketing: z.boolean() }));
  await limit(c, 'consent');
  const { profile: p } = await studentFor(deps.db, c.get('customer').userId, c.req.param('id'), 'consent');
  const before = (await latestConsents(deps.db, [p.id])).get(p.id)!;
  const changed = Object.fromEntries((['publication', 'marketing'] as const).filter((k) => before[k] !== input[k]).map((k) => [k, input[k]]));
  await recordConsents(deps.db, p.id, c.get('customer').userId, changed, meta(c));
  return c.json(await view(c));
});

/** "Give Riya her own login": a single-use link for 7 days. */
profile.post('/children/:id/invite', async (c) => {
  const deps = c.get('deps');
  await limit(c, 'invite', 10);
  const a = await me(c);
  const { profile: p } = await studentFor(deps.db, a.userId, c.req.param('id'), 'invite');
  if (p.studentUserId) throw new HttpError(409, `${p.firstName} already has a login.`, 'has_login');
  // A new link replaces older unused ones.
  await deps.db.update(studentLoginInvites).set({ expiresAt: deps.now() })
    .where(and(eq(studentLoginInvites.studentProfileId, p.id), isNull(studentLoginInvites.claimedAt), gt(studentLoginInvites.expiresAt, deps.now())));
  const id = crypto.randomUUID();
  await deps.db.insert(studentLoginInvites).values({
    id, studentProfileId: p.id, createdByParentUserId: a.userId,
    tokenHash: hashToken(tokenFor(deps.env.ORDER_LINK_SECRET, 'invite', id)), expiresAt: new Date(deps.now().getTime() + INVITE_DAYS * 86400_000),
  });
  await notify(deps, { template: 'student_invite', to: a.email, userId: a.userId, studentProfileId: p.id, payload: { inviteId: id } });
  return c.json({ ...(await view(c)), inviteUrl: inviteLink(deps, id) }, 201);
});

profile.delete('/children/:id', async (c) => {
  const deps = c.get('deps');
  await limit(c, 'delete', 10);
  const { profile: p } = await studentFor(deps.db, c.get('customer').userId, c.req.param('id'), 'delete');
  await deleteStudentProfile(deps, p.id, c.get('customer').email);
  return c.json(await view(c));
});

/* ---------------- The student path ---------------- */

const zStudentSignup = zChild.extend({
  parent: z.object({ name: z.string().trim().min(2, 'Enter your parent’s name').max(120), whatsapp: zPhone, email: zEmail }),
});

/** A student's own details and their parent's; creates (or updates) the request for approval. */
profile.put('/student', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, zStudentSignup);
  await limit(c, 'student', 20);
  const a = await me(c);
  if (a.accountType !== 'student') throw new HttpError(409, 'Choose “I’m a Student” first.', 'not_student');
  if (input.parent.email === a.email) throw new HttpError(400, 'Enter your parent’s email, not yours.', 'own_email', { 'parent.email': ['Enter your parent’s email, not yours'] });
  const { parent, ...details } = input;
  const own = (await studentsOf(deps.db, a.userId)).find((x) => x.rel === 'self');
  if (own?.profile.approvalStatus === 'approved') {
    await editStudent(c, own.profile, 'self', { classGrade: details.classGrade, schoolName: details.schoolName });
    return c.json(await view(c));
  }
  let requestId: string | null = null;
  await deps.db.transaction(async (tx) => {
    let p = own?.profile;
    if (p) [p] = await tx.update(studentProfiles).set({ ...details, updatedAt: sql`now()` }).where(eq(studentProfiles.id, p.id)).returning();
    else [p] = await tx.insert(studentProfiles).values({ ...details, studentUserId: a.userId, createdByUserId: a.userId, approvalStatus: 'pending' }).returning();
    const open = await openRequestFor(tx, p.id);
    const same = open && open.status === 'pending' && open.expiresAt > deps.now() && open.parentEmail === parent.email && open.parentWhatsapp === parent.whatsapp && open.parentName === parent.name;
    if (!same) requestId = (await createApprovalRequest(tx, deps, p.id, parent)).id;
    await tx.update(accounts).set({ onboardingCompletedAt: a.onboardingCompletedAt ?? deps.now(), updatedAt: sql`now()` }).where(eq(accounts.userId, a.userId));
  });
  if (requestId) await notify(deps, { template: 'approval_request', to: parent.email, payload: { requestId } });
  return c.json(await view(c));
});

/** Send the approval email again (a new link if the old one ran out). */
profile.post('/student/resend', async (c) => {
  const deps = c.get('deps');
  await limit(c, 'resend', 6);
  const a = await me(c);
  const own = (await studentsOf(deps.db, a.userId)).find((x) => x.rel === 'self');
  if (!own || own.profile.approvalStatus === 'approved') throw new HttpError(409, 'There’s nothing waiting for approval.', 'nothing_pending');
  let r = await openRequestFor(deps.db, own.profile.id);
  if (!r) throw new HttpError(409, 'Add your parent’s details first.', 'no_request');
  if (r.status !== 'pending' || r.expiresAt < deps.now()) {
    r = await createApprovalRequest(deps.db, deps, own.profile.id, { name: r.parentName, whatsapp: r.parentWhatsapp, email: r.parentEmail });
    await deps.db.update(studentProfiles).set({ approvalStatus: 'pending' }).where(eq(studentProfiles.id, own.profile.id));
  }
  await notify(deps, { template: 'approval_request', to: r.parentEmail, payload: { requestId: r.id } });
  return c.json(await view(c));
});

/** Pending: cancel the request (everything is deleted). Approved: ask the parent to delete it. */
profile.delete('/student', async (c) => {
  const deps = c.get('deps');
  await limit(c, 'student-delete', 6);
  const a = await me(c);
  const own = (await studentsOf(deps.db, a.userId)).find((x) => x.rel === 'self');
  if (!own) return c.json(await view(c));
  if (own.profile.approvalStatus !== 'approved') {
    await deletePendingStudent(deps.db, own.profile.id);
    await deps.db.update(accounts).set({ onboardingCompletedAt: null }).where(eq(accounts.userId, a.userId));
    return c.json({ ...(await view(c)), requested: false });
  }
  const parents = await parentsOf(deps.db, own.profile.id);
  await notify(deps, parents.map((p) => ({ template: 'deletion_request', to: p.email, userId: p.userId, studentProfileId: own.profile.id, payload: { firstName: own.profile.firstName } })));
  return c.json({ ...(await view(c)), requested: true });
});

