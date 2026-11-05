// /api/my/entries/:registrationId and /api/my/submissions/:id — a student's entry:
// draft, files (uploaded straight to private storage, then checked here), text or
// link, submit, edit until the deadline, withdraw. The server's clock decides.
// Only the student themselves or a linked parent can see or change an entry.
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { competitionGroups, registrations, submissionFiles, submissions } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit, zText } from '../lib/http.js';
import { imageSize, isImage, sniff, stripImageMetadata } from '../lib/fileCheck.js';
import { countWords, istDateTime } from '../../src/shared/competition.js';
import { DEFAULT_DECLARATION } from '../../src/shared/consents.js';
import { loadFull, subOpen, type Full } from '../services/competitions.js';
import { notifySubmission } from '../services/competitionEmails.js';
import { studentFor, type Profile, type Relation } from '../services/students.js';
import { requireCustomer } from './account.js';

export const entries = new Hono<AppEnv>();
export const mySubmissions = new Hono<AppEnv>();
entries.use('*', requireCustomer);
mySubmissions.use('*', requireCustomer);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const THUMB_MAX = 1024 * 1024;

type Reg = typeof registrations.$inferSelect;
type Sub = typeof submissions.$inferSelect;
interface Ctx { reg: Reg; profile: Profile; rel: Relation; f: Full; group: Full['groups'][number] | undefined }

async function loadReg(c: Context<AppEnv>, registrationId: string, action: 'view' | 'submit'): Promise<Ctx> {
  const deps = c.get('deps');
  const [reg] = await deps.db.select().from(registrations).where(eq(registrations.id, registrationId));
  if (!reg) throw notFound('Entry not found');
  const { profile, rel } = await studentFor(deps.db, c.get('customer').userId, reg.studentProfileId, action).catch((e) => {
    if (e instanceof HttpError && e.status === 403) throw e;
    throw notFound('Entry not found');
  });
  const f = await loadFull(deps.db, { id: reg.competitionId });
  if (!f) throw notFound('Entry not found');
  return { reg, profile, rel, f, group: f.groups.find((g) => g.id === reg.groupId) };
}

async function loadSub(c: Context<AppEnv>, id: string, action: 'view' | 'submit') {
  const [sub] = await c.get('deps').db.select().from(submissions).where(eq(submissions.id, id));
  if (!sub) throw notFound('Entry not found');
  return { sub, ...(await loadReg(c, sub.registrationId, action)) };
}

/** This entry's rules: the competition's, with the group's own limits where set. */
function rules(x: Ctx) {
  const c = x.f.c;
  return {
    types: c.allowedSubmissionTypes, mimeTypes: c.allowedMimeTypes, maxFileSizeMb: c.maxFileSizeMb,
    maxMainFiles: x.group?.maxMainFiles ?? c.maxMainFiles, extraFiles: c.extraFiles,
    minWords: x.group?.minWords ?? c.minWords, maxWords: x.group?.maxWords ?? c.maxWords,
    allowEditUntilDeadline: c.allowEditUntilDeadline, allowWithdraw: c.allowWithdraw, declarationText: c.declarationText || DEFAULT_DECLARATION,
    languages: c.languages,
  };
}

function windowFor(c: Context<AppEnv>, x: Ctx, sub?: Sub) {
  const now = c.get('deps').now();
  const open = x.f.c.submissionRequired && subOpen(x.f.c, now);
  const active = x.reg.status === 'registered' && x.profile.approvalStatus === 'approved';
  const r = rules(x);
  const canEdit = open && active && (!sub || sub.status === 'draft' || (sub.status === 'submitted' && r.allowEditUntilDeadline));
  return {
    open, canEdit, canWithdraw: open && active && r.allowWithdraw && sub?.status === 'submitted',
    reason: !x.f.c.submissionRequired ? 'This competition doesn’t take uploads.'
      : !active ? (x.reg.status !== 'registered' ? 'This registration isn’t taking part any more.' : 'Waiting for a parent’s approval.')
        : !open ? (x.f.c.submissionOpensAt && now < x.f.c.submissionOpensAt ? `Uploads open ${istDateTime(x.f.c.submissionOpensAt)}.` : 'The deadline has passed.')
          : sub?.status === 'submitted' && !r.allowEditUntilDeadline ? 'This entry is submitted and can’t be changed.' : null,
  };
}

async function view(c: Context<AppEnv>, x: Ctx) {
  const deps = c.get('deps');
  const subs = await deps.db.select().from(submissions).where(eq(submissions.registrationId, x.reg.id)).orderBy(asc(submissions.createdAt));
  const current = subs.find((s) => s.status !== 'withdrawn') ?? subs[subs.length - 1];
  const files = current ? await deps.db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, current.id)).orderBy(asc(submissionFiles.sortOrder), asc(submissionFiles.uploadedAt)) : [];
  const link = (key: string | null) => (key ? deps.storage.signedDownloadUrl('competition-entries', key, 300) : Promise.resolve(null));
  return {
    registration: {
      id: x.reg.id, status: x.reg.status, relation: x.rel, studentFirstName: x.profile.firstName, classGrade: x.reg.classAtRegistration,
      groupName: x.group?.name ?? '', groupFormat: x.group?.formatNote ?? '',
    },
    competition: {
      slug: x.f.c.slug, title: x.f.c.title, prompt: x.f.c.prompt, status: x.f.c.publishState,
      deadline: x.f.c.submissionClosesAt, deadlineLabel: x.f.c.submissionClosesAt ? istDateTime(x.f.c.submissionClosesAt) : null,
      resultsAt: x.f.c.resultsAt, maxEntries: x.f.c.maxEntriesPerStudent, rules: rules(x),
    },
    window: windowFor(c, x, current),
    submission: current ? {
      id: current.id, entryCode: current.entryCode, status: current.status, title: current.title, language: current.language,
      textContent: current.textContent, linkUrl: current.linkUrl, submittedAt: current.submittedAt, updatedAt: current.updatedAt,
      hiddenFromPublic: current.hiddenFromPublic,
      files: await Promise.all(files.map(async (f) => ({
        id: f.id, kind: f.kind, extraKey: f.extraKey, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes,
        verified: Boolean(f.verifiedAt), width: f.width, height: f.height,
        thumbUrl: f.verifiedAt && (f.thumbnailKey || isImage(f.mimeType)) ? await link(f.thumbnailKey ?? f.storageKey) : null,
        viewUrl: f.verifiedAt ? await link(f.storageKey) : null,
      }))),
    } : null,
    others: subs.filter((s) => s.id !== current?.id).map((s) => ({ id: s.id, entryCode: s.entryCode, status: s.status })),
    activeEntries: subs.filter((s) => s.status !== 'withdrawn').length,
  };
}

entries.get('/:id{[0-9a-f-]{36}}', async (c) => c.json(await view(c, await loadReg(c, c.req.param('id'), 'view'))));

/** Start (or reopen) the entry: a draft with its entry code, e.g. ABC-A-0042. */
entries.post('/:id{[0-9a-f-]{36}}/draft', async (c) => {
  const deps = c.get('deps');
  const x = await loadReg(c, c.req.param('id'), 'submit');
  const { another } = await body(c, z.object({ another: z.boolean().default(false) }));
  const w = windowFor(c, x);
  if (!w.open || x.reg.status !== 'registered') throw new HttpError(409, w.reason ?? 'Uploads aren’t open.', 'closed');
  await deps.db.transaction(async (tx) => {
    const active = await tx.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.registrationId, x.reg.id), ne(submissions.status, 'withdrawn')));
    if (active.length && !another) return;
    if (active.length >= x.f.c.maxEntriesPerStudent) throw new HttpError(409, `Only ${x.f.c.maxEntriesPerStudent} entr${x.f.c.maxEntriesPerStudent === 1 ? 'y' : 'ies'} per student.`, 'max_entries');
    const [g] = await tx.update(competitionGroups).set({ nextEntryNo: sql`${competitionGroups.nextEntryNo} + 1` })
      .where(eq(competitionGroups.id, x.reg.groupId)).returning({ n: competitionGroups.nextEntryNo, letter: competitionGroups.letter });
    const entryCode = `${x.f.c.entryCodePrefix}-${g.letter}-${String(g.n - 1).padStart(4, '0')}`;
    await tx.insert(submissions).values({ registrationId: x.reg.id, entryCode, language: x.f.c.languages[0] ?? '', lastEditedByUserId: c.get('customer').userId });
  });
  return c.json(await view(c, x), 201);
});

function requireEditable(c: Context<AppEnv>, x: Ctx, sub: Sub) {
  const w = windowFor(c, x, sub);
  if (!w.canEdit) throw new HttpError(409, w.reason ?? 'This entry can’t be changed now.', 'closed');
}

const zText2 = z.object({
  title: zText(150).default(''), language: zText(40).default(''),
  textContent: z.string().max(200_000).default(''),
  linkUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/, error: 'Enter a full link starting with https://' })]).default(''),
});

function checkWords(x: Ctx, text: string) {
  const r = rules(x);
  if (!r.types.includes('text') || !text.trim()) return;
  const n = countWords(text);
  if (r.minWords && n < r.minWords) throw new HttpError(400, `Write at least ${r.minWords} words (now ${n}).`, 'too_short');
  if (r.maxWords && n > r.maxWords) throw new HttpError(400, `Keep it to ${r.maxWords} words (now ${n}).`, 'too_long');
}

mySubmissions.put('/:id{[0-9a-f-]{36}}', async (c) => {
  const deps = c.get('deps');
  const { sub, ...x } = await loadSub(c, c.req.param('id'), 'submit');
  requireEditable(c, x, sub);
  const input = await body(c, zText2);
  if (sub.status === 'submitted') checkWords(x, input.textContent);
  await deps.db.update(submissions).set({ ...input, lastEditedByUserId: c.get('customer').userId, updatedAt: sql`now()` }).where(eq(submissions.id, sub.id));
  return c.json(await view(c, x));
});

/** Ask to upload a file: checks type, size and count, then gives a one-time upload link (private bucket, random name). */
mySubmissions.post('/:id{[0-9a-f-]{36}}/files', async (c) => {
  const deps = c.get('deps');
  await rateLimit(deps.db, `upload:${c.get('customer').userId}`, 80, 3600);
  const { sub, ...x } = await loadSub(c, c.req.param('id'), 'submit');
  requireEditable(c, x, sub);
  const input = await body(c, z.object({
    kind: z.enum(['main', 'extra']), extraKey: z.string().max(40).optional(),
    fileName: z.string().trim().min(1).max(200), contentType: z.string().max(100), size: z.number().int().positive(),
    thumb: z.object({ size: z.number().int().positive().max(THUMB_MAX) }).optional(),
  }));
  const r = rules(x);
  if (!r.types.includes('file')) throw new HttpError(400, 'This competition doesn’t take files.', 'no_files');
  const allowed = input.kind === 'extra' ? [...new Set([...IMAGE_TYPES, 'application/pdf'])] : r.mimeTypes;
  if (!allowed.includes(input.contentType)) {
    throw new HttpError(400, `This file type isn’t allowed. Upload ${allowed.map((m) => m.split('/')[1].replace('jpeg', 'JPG').toUpperCase()).join(', ')}.`, 'bad_type');
  }
  if (input.size > r.maxFileSizeMb * 1024 * 1024) throw new HttpError(400, `This file is too big. The limit is ${r.maxFileSizeMb} MB.`, 'too_big');
  const existing = await deps.db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id));
  if (input.kind === 'main' && existing.filter((f) => f.kind === 'main').length >= r.maxMainFiles) {
    throw new HttpError(400, `You can upload ${r.maxMainFiles} file${r.maxMainFiles === 1 ? '' : 's'}. Remove one to add another.`, 'too_many');
  }
  if (input.kind === 'extra') {
    if (!r.extraFiles.some((e) => e.key === input.extraKey)) throw new HttpError(400, 'Unknown extra file.', 'bad_extra');
    if (existing.some((f) => f.kind === 'extra' && f.extraKey === input.extraKey)) throw new HttpError(400, 'Remove the current file first.', 'too_many');
  }
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4' } as Record<string, string>)[input.contentType] ?? 'bin';
  const base = `${x.f.c.id}/${randomUUID()}`;
  const storageKey = `${base}.${ext}`;
  const thumbnailKey = input.thumb ? `${base}-thumb.jpg` : null;
  const [row] = await deps.db.insert(submissionFiles).values({
    submissionId: sub.id, kind: input.kind, extraKey: input.kind === 'extra' ? input.extraKey : null, storageKey, thumbnailKey,
    mimeType: input.contentType, sizeBytes: input.size, originalName: input.fileName.slice(0, 200),
    sortOrder: existing.length, uploadedByUserId: c.get('customer').userId,
  }).returning();
  const upload = await deps.storage.signedUploadUrl('competition-entries', storageKey);
  const thumb = thumbnailKey ? await deps.storage.signedUploadUrl('competition-entries', thumbnailKey) : null;
  return c.json({ fileId: row.id, upload, thumb }, 201);
});

/** After the upload: check what the file really is, remove photo metadata (location), record its size. */
mySubmissions.post('/:id{[0-9a-f-]{36}}/files/:fileId{[0-9a-f-]{36}}/verify', async (c) => {
  const deps = c.get('deps');
  const { sub, ...x } = await loadSub(c, c.req.param('id'), 'submit');
  const [f] = await deps.db.select().from(submissionFiles).where(and(eq(submissionFiles.id, c.req.param('fileId')), eq(submissionFiles.submissionId, sub.id)));
  if (!f) throw notFound('File not found');
  const r = rules(x);
  const reject = async (msg: string) => {
    for (const key of [f.storageKey, f.thumbnailKey]) if (key) await deps.storage.remove('competition-entries', key).catch(() => {});
    await deps.db.delete(submissionFiles).where(eq(submissionFiles.id, f.id));
    throw new HttpError(400, msg, 'bad_file');
  };
  let bytes: Uint8Array;
  try { bytes = await deps.storage.read('competition-entries', f.storageKey); } catch { return reject('The upload didn’t arrive. Please try again.'); }
  const kind = sniff(bytes);
  const allowed = f.kind === 'extra' ? [...IMAGE_TYPES, 'application/pdf'] : r.mimeTypes;
  if (!kind || !allowed.includes(kind)) return reject('This file isn’t a picture or PDF we can accept, or it’s damaged. Please choose another file.');
  if (bytes.length > r.maxFileSizeMb * 1024 * 1024) return reject(`This file is too big. The limit is ${r.maxFileSizeMb} MB.`);
  let size = bytes.length;
  let dims: { width: number; height: number } | null = null;
  if (isImage(kind)) {
    try {
      const clean = stripImageMetadata(bytes, kind);
      if (clean.length !== bytes.length) await deps.storage.write('competition-entries', f.storageKey, clean, kind);
      size = clean.length;
      dims = imageSize(clean, kind);
    } catch { return reject('This picture looks damaged. Please take or choose it again.'); }
  }
  let thumbOk = false;
  if (f.thumbnailKey) {
    try {
      const t = await deps.storage.read('competition-entries', f.thumbnailKey);
      const tk = sniff(t);
      if (tk && isImage(tk) && t.length <= THUMB_MAX) {
        const clean = stripImageMetadata(t, tk);
        if (clean.length !== t.length) await deps.storage.write('competition-entries', f.thumbnailKey, clean, tk);
        thumbOk = true;
      }
    } catch { /* no thumbnail: the admin sees the file itself */ }
    if (!thumbOk) await deps.storage.remove('competition-entries', f.thumbnailKey).catch(() => {});
  }
  await deps.db.update(submissionFiles).set({
    verifiedAt: deps.now(), mimeType: kind, sizeBytes: size, width: dims?.width ?? null, height: dims?.height ?? null,
    thumbnailKey: thumbOk ? f.thumbnailKey : null,
  }).where(eq(submissionFiles.id, f.id));
  await deps.db.update(submissions).set({ lastEditedByUserId: c.get('customer').userId, updatedAt: sql`now()` }).where(eq(submissions.id, sub.id));
  return c.json(await view(c, x));
});

mySubmissions.delete('/:id{[0-9a-f-]{36}}/files/:fileId{[0-9a-f-]{36}}', async (c) => {
  const deps = c.get('deps');
  const { sub, ...x } = await loadSub(c, c.req.param('id'), 'submit');
  requireEditable(c, x, sub);
  const files = await deps.db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id));
  const f = files.find((y) => y.id === c.req.param('fileId'));
  if (!f) throw notFound('File not found');
  // A submitted entry always stays complete: replace a file by adding the new one first.
  if (sub.status === 'submitted') {
    const r = rules(x);
    const mains = files.filter((y) => y.kind === 'main' && y.verifiedAt);
    const needsFile = r.types.length === 1 && r.types[0] === 'file';
    if (f.kind === 'main' && needsFile && mains.length <= 1) throw new HttpError(409, 'Add the new file first, then remove this one.', 'last_file');
    if (f.kind === 'extra' && r.extraFiles.find((e) => e.key === f.extraKey)?.required) throw new HttpError(409, 'Add the new file first, then remove this one.', 'last_file');
  }
  for (const key of [f.storageKey, f.thumbnailKey]) if (key) await deps.storage.remove('competition-entries', key).catch(() => {});
  await deps.db.delete(submissionFiles).where(eq(submissionFiles.id, f.id));
  await deps.db.update(submissions).set({ lastEditedByUserId: c.get('customer').userId, updatedAt: sql`now()` }).where(eq(submissions.id, sub.id));
  return c.json(await view(c, x));
});

/** Submit (or save changes to a submitted entry). Everything checked against the server's clock. */
mySubmissions.post('/:id{[0-9a-f-]{36}}/submit', async (c) => {
  const deps = c.get('deps');
  const { sub, ...x } = await loadSub(c, c.req.param('id'), 'submit');
  requireEditable(c, x, sub);
  const { declaration } = await body(c, z.object({ declaration: z.boolean() }));
  if (!declaration) throw new HttpError(400, 'Please tick the declaration to submit.', 'declaration');
  const r = rules(x);
  const files = await deps.db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, sub.id));
  if (files.some((f) => !f.verifiedAt)) throw new HttpError(409, 'A file is still uploading. Wait for it to finish, or remove it.', 'uploading');
  const mains = files.filter((f) => f.kind === 'main');
  const hasFile = mains.length > 0, hasText = sub.textContent.trim().length > 0, hasLink = sub.linkUrl.trim().length > 0;
  const provided = (r.types.includes('file') && hasFile) || (r.types.includes('text') && hasText) || (r.types.includes('link') && hasLink);
  if (!provided) {
    const what = r.types.map((t) => (t === 'file' ? 'upload your work' : t === 'text' ? 'write your entry' : 'add the link')).join(' or ');
    throw new HttpError(400, `Please ${what} before submitting.`, 'empty');
  }
  if (r.types.length === 1 && r.types[0] === 'file' && !hasFile) throw new HttpError(400, 'Please upload your work before submitting.', 'empty');
  for (const e of r.extraFiles) if (e.required && !files.some((f) => f.kind === 'extra' && f.extraKey === e.key)) throw new HttpError(400, `Please add: ${e.label}.`, 'missing_extra');
  checkWords(x, sub.textContent);
  const first = sub.status !== 'submitted';
  await deps.db.update(submissions).set({
    status: 'submitted', submittedAt: first ? deps.now() : sub.submittedAt, declarationAcceptedAt: deps.now(),
    submittedByUserId: first ? c.get('customer').userId : sub.submittedByUserId, lastEditedByUserId: c.get('customer').userId, updatedAt: sql`now()`,
  }).where(eq(submissions.id, sub.id));
  await notifySubmission(deps, sub.id, first ? 'received' : 'edited');
  return c.json(await view(c, x));
});

mySubmissions.post('/:id{[0-9a-f-]{36}}/withdraw', async (c) => {
  const deps = c.get('deps');
  const { sub, ...x } = await loadSub(c, c.req.param('id'), 'submit');
  if (!windowFor(c, x, sub).canWithdraw) throw new HttpError(409, 'This entry can’t be withdrawn now.', 'closed');
  await deps.db.update(submissions).set({ status: 'withdrawn', lastEditedByUserId: c.get('customer').userId, updatedAt: sql`now()` }).where(eq(submissions.id, sub.id));
  await notifySubmission(deps, sub.id, 'withdrawn');
  return c.json(await view(c, x));
});

/** A parent keeps one entry out of anything public. */
mySubmissions.post('/:id{[0-9a-f-]{36}}/visibility', async (c) => {
  const deps = c.get('deps');
  const { sub, rel } = await loadSub(c, c.req.param('id'), 'view');
  if (rel !== 'parent') throw new HttpError(403, 'Only a parent can change this.', 'parent_only');
  const { hidden } = await body(c, z.object({ hidden: z.boolean() }));
  await deps.db.update(submissions).set({ hiddenFromPublic: hidden, updatedAt: sql`now()` }).where(eq(submissions.id, sub.id));
  return c.json({ ok: true, hidden });
});
