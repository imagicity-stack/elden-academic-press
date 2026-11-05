// Students, parents and the links between them.
//
// Every student is treated as a minor. A student profile holds only first and last
// name, class, school, city and state. A parent can add a child (approved at once,
// since the parent is the one consenting); a student who signs up asks a parent to
// approve them through a single-use link. Consents come only from a linked parent.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Q } from '../db/client.js';
import {
  accounts, auditLog, consentRecords, parentApprovalRequests, registrations, studentGuardians, studentLoginInvites, studentProfiles,
  submissionFiles, submissions,
} from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import { CONSENT_VERSION, type ConsentKind } from '../../src/shared/consents.js';

export type Profile = typeof studentProfiles.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Relation = 'parent' | 'self' | null;

export const APPROVAL_DAYS = 7;
export const PENDING_PURGE_DAYS = 14;
export const INVITE_DAYS = 7;

/* ---------------- Tokens ---------------- */
// Link tokens are derived from the row id with the server's secret, so the waiting
// screen can show the same link again; only their SHA-256 is stored.

export const tokenFor = (secret: string, purpose: 'approve' | 'invite', id: string) =>
  createHmac('sha256', secret).update(`${purpose}:${id}`).digest('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const approvalLink = (deps: Deps, requestId: string) => `${site(deps)}/approve/${tokenFor(deps.env.ORDER_LINK_SECRET, 'approve', requestId)}`;
export const inviteLink = (deps: Deps, inviteId: string) => `${site(deps)}/invite/${tokenFor(deps.env.ORDER_LINK_SECRET, 'invite', inviteId)}`;
export const site = (deps: Deps) => deps.env.SITE_URL.replace(/\/$/, '');

/** Short code for referral links. */
export const shortCode = (n = 8) => randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n).toUpperCase();

/* ---------------- Accounts ---------------- */

export async function accountOf(db: Q, userId: string): Promise<Account | undefined> {
  const [a] = await db.select().from(accounts).where(eq(accounts.userId, userId));
  return a;
}

/** The account row for a signed-in customer (created on first use). */
export async function ensureAccount(db: Q, me: { userId: string; email: string; name: string; avatar: string | null }) {
  const [a] = await db.insert(accounts).values({ userId: me.userId, email: me.email, name: me.name, avatarUrl: me.avatar })
    .onConflictDoUpdate({ target: accounts.userId, set: { email: me.email } }).returning();
  return a;
}

/* ---------------- Who may do what ---------------- */

export type Action = 'view' | 'register' | 'submit' | 'download' | 'consent' | 'edit' | 'delete' | 'invite';

/** How this user relates to this student: their parent, the student themselves, or neither. */
export async function relationTo(db: Q, userId: string, profile: Profile): Promise<Relation> {
  if (profile.deletedAt) return null;
  if (profile.studentUserId === userId) return 'self';
  const [g] = await db.select({ id: studentGuardians.id }).from(studentGuardians)
    .where(and(eq(studentGuardians.studentProfileId, profile.id), eq(studentGuardians.parentUserId, userId)));
  return g ? 'parent' : null;
}

/** The single answer to "can this user do X for this student?" */
export function can(rel: Relation, action: Action, profile: Profile): boolean {
  if (!rel || profile.deletedAt) return false;
  const approved = profile.approvalStatus === 'approved';
  switch (action) {
    case 'view': return true;
    case 'register': case 'submit': case 'download': return approved;
    case 'consent': case 'invite': return rel === 'parent';
    case 'edit': return true; // which fields: see editableFields
    case 'delete': return rel === 'parent' || (rel === 'self' && !approved);
  }
}

export function editableFields(rel: Relation, profile: Profile): (keyof Profile)[] {
  if (rel === 'parent') return ['firstName', 'lastName', 'classGrade', 'schoolName', 'city', 'state'];
  if (rel === 'self') return profile.approvalStatus === 'approved' ? ['classGrade', 'schoolName'] : ['firstName', 'lastName', 'classGrade', 'schoolName', 'city', 'state'];
  return [];
}

/** Load a student the user is allowed to act for, or refuse with the same message either way. */
export async function studentFor(db: Q, userId: string, studentId: string, action: Action) {
  const [profile] = await db.select().from(studentProfiles).where(and(eq(studentProfiles.id, studentId), isNull(studentProfiles.deletedAt)));
  if (!profile) throw new HttpError(404, 'Student not found.', 'not_found');
  const rel = await relationTo(db, userId, profile);
  if (!rel) throw new HttpError(404, 'Student not found.', 'not_found');
  if (!can(rel, action, profile)) {
    if (rel === 'self' && profile.approvalStatus !== 'approved') throw new HttpError(403, 'Ask your parent to approve you first.', 'awaiting_approval');
    throw new HttpError(403, 'Only a parent can do this.', 'parent_only');
  }
  return { profile, rel };
}

/** Every student a user can act for: their children, or themselves. */
export async function studentsOf(db: Q, userId: string): Promise<{ profile: Profile; rel: 'parent' | 'self' }[]> {
  const kids = await db.select({ p: studentProfiles }).from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .where(and(eq(studentGuardians.parentUserId, userId), isNull(studentProfiles.deletedAt)))
    .orderBy(studentProfiles.createdAt);
  const [self] = await db.select().from(studentProfiles).where(and(eq(studentProfiles.studentUserId, userId), isNull(studentProfiles.deletedAt)));
  return [...kids.map((k) => ({ profile: k.p, rel: 'parent' as const })), ...(self ? [{ profile: self, rel: 'self' as const }] : [])];
}

/** The linked parents' accounts (for emails). */
export async function parentsOf(db: Q, studentId: string) {
  return db.select({ a: accounts }).from(studentGuardians).innerJoin(accounts, eq(accounts.userId, studentGuardians.parentUserId))
    .where(eq(studentGuardians.studentProfileId, studentId)).then((r) => r.map((x) => x.a));
}

/* ---------------- Consents (append-only) ---------------- */

export async function recordConsents(db: Q, profileId: string, parentUserId: string, choices: Partial<Record<ConsentKind, boolean>>, meta: { ip?: string | null; userAgent?: string | null }) {
  const rows = (Object.entries(choices) as [ConsentKind, boolean | undefined][]).filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ studentProfileId: profileId, givenByUserId: parentUserId, consentType: k, textVersion: CONSENT_VERSION, granted: Boolean(v), ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null }));
  if (rows.length) await db.insert(consentRecords).values(rows);
}

/** The latest choice for each consent, per student. */
export async function latestConsents(db: Q, profileIds: string[]): Promise<Map<string, Record<ConsentKind, boolean>>> {
  const out = new Map<string, Record<ConsentKind, boolean>>();
  if (!profileIds.length) return out;
  const rows = await db.select().from(consentRecords).where(inArray(consentRecords.studentProfileId, profileIds)).orderBy(desc(consentRecords.createdAt));
  for (const id of profileIds) out.set(id, { data_processing: false, publication: false, marketing: false });
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.studentProfileId}:${r.consentType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(r.studentProfileId)![r.consentType] = r.granted;
  }
  return out;
}

/* ---------------- Approval requests ---------------- */

export async function createApprovalRequest(db: Q, deps: Deps, profileId: string, parent: { name: string; whatsapp: string; email: string }) {
  // A new request replaces any open one.
  await db.update(parentApprovalRequests).set({ status: 'expired', resolvedAt: deps.now() })
    .where(and(eq(parentApprovalRequests.studentProfileId, profileId), eq(parentApprovalRequests.status, 'pending')));
  const id = crypto.randomUUID();
  const token = tokenFor(deps.env.ORDER_LINK_SECRET, 'approve', id);
  const [row] = await db.insert(parentApprovalRequests).values({
    id, studentProfileId: profileId, parentName: parent.name, parentWhatsapp: parent.whatsapp, parentEmail: parent.email.toLowerCase(),
    tokenHash: hashToken(token), expiresAt: new Date(deps.now().getTime() + APPROVAL_DAYS * 86400_000),
  }).returning();
  return row;
}

export async function openRequestFor(db: Q, profileId: string) {
  const [r] = await db.select().from(parentApprovalRequests).where(eq(parentApprovalRequests.studentProfileId, profileId))
    .orderBy(desc(parentApprovalRequests.createdAt)).limit(1);
  return r;
}

/* ---------------- Deleting a student ---------------- */
// Files are removed from storage straight away; registrations and entries are kept
// as anonymous withdrawn records (so counts and the audit trail still add up);
// consent records stay as proof of what was agreed.

export async function deleteStudentProfile(deps: Deps, profileId: string, actor: string) {
  const { db, storage } = deps;
  const regs = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.studentProfileId, profileId));
  const subs = regs.length ? await db.select({ id: submissions.id }).from(submissions).where(inArray(submissions.registrationId, regs.map((r) => r.id))) : [];
  const files = subs.length ? await db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))) : [];
  for (const f of files) {
    for (const key of [f.storageKey, f.thumbnailKey]) if (key) await storage.remove('competition-entries', key).catch(() => {});
  }
  await db.transaction(async (tx) => {
    if (files.length) await tx.delete(submissionFiles).where(inArray(submissionFiles.id, files.map((f) => f.id)));
    if (subs.length) {
      await tx.update(submissions).set({ status: 'withdrawn', title: '', textContent: '', linkUrl: '', adminNotes: '', hiddenFromPublic: true, updatedAt: sql`now()` })
        .where(inArray(submissions.id, subs.map((s) => s.id)));
    }
    if (regs.length) await tx.update(registrations).set({ status: 'withdrawn', customAnswers: {} }).where(inArray(registrations.id, regs.map((r) => r.id)));
    await tx.delete(studentGuardians).where(eq(studentGuardians.studentProfileId, profileId));
    await tx.delete(parentApprovalRequests).where(eq(parentApprovalRequests.studentProfileId, profileId));
    await tx.delete(studentLoginInvites).where(eq(studentLoginInvites.studentProfileId, profileId));
    const [p] = await tx.update(studentProfiles).set({
      firstName: 'Deleted', lastName: '', schoolName: '', city: '', state: '', studentUserId: null, deletedAt: deps.now(), updatedAt: sql`now()`,
    }).where(eq(studentProfiles.id, profileId)).returning({ createdBy: studentProfiles.createdByUserId });
    await tx.insert(auditLog).values({ actor, action: 'student.delete', entity: 'student', entityId: profileId, details: { files: files.length, registrations: regs.length, createdBy: p?.createdBy } });
  });
}

/** A pending student nobody approved: delete it entirely (it never took part in anything). */
export async function deletePendingStudent(db: Q, profileId: string) {
  await db.delete(studentProfiles).where(and(eq(studentProfiles.id, profileId), eq(studentProfiles.approvalStatus, 'pending')));
}

/** Scheduled job (and the admin button): pending students not approved within 14 days are deleted. */
export async function purgeExpiredRequests(deps: Deps) {
  const { db, now } = deps;
  // Links older than 7 days stop working.
  await db.update(parentApprovalRequests).set({ status: 'expired', resolvedAt: now() })
    .where(and(eq(parentApprovalRequests.status, 'pending'), lt(parentApprovalRequests.expiresAt, now())));
  const cutoff = new Date(now().getTime() - PENDING_PURGE_DAYS * 86400_000);
  const stale = await db.select({ id: studentProfiles.id, userId: studentProfiles.studentUserId, firstName: studentProfiles.firstName })
    .from(studentProfiles).where(and(inArray(studentProfiles.approvalStatus, ['pending', 'declined', 'expired']), isNull(studentProfiles.deletedAt), lt(studentProfiles.createdAt, cutoff)));
  const emails: { to: string; userId: string; firstName: string }[] = [];
  for (const s of stale) {
    await db.delete(studentProfiles).where(eq(studentProfiles.id, s.id));
    if (s.userId) {
      // Their account starts again from "Who is using this account?" (type kept, so they're still a student).
      const [a] = await db.update(accounts).set({ onboardingCompletedAt: null, typeLockedAt: null, updatedAt: sql`now()` }).where(eq(accounts.userId, s.userId)).returning();
      if (a) emails.push({ to: a.email, userId: a.userId, firstName: s.firstName });
    }
  }
  return { purged: stale.length, emails };
}
