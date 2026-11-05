// Emails about competitions and student accounts: every send is logged in
// notification_log, goes out after the database work is done (never inside a
// transaction), and a failure never undoes what the person did. Failed sends are
// tried again by the scheduled job. A retry rebuilds the email from the ids in the
// log (never stored HTML), so links and names are always current.
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import { notificationLog } from '../db/schema.js';
import type { Attachment } from '../lib/mail.js';

export interface BuiltMail { subject: string; html: string; replyTo?: string; attachments?: Attachment[] }
type Builder = (deps: Deps, payload: Record<string, unknown>, to: string) => Promise<BuiltMail | null>;

const builders = new Map<string, Builder>();
export function registerEmail(template: string, build: Builder) { builders.set(template, build); }

export interface Notice {
  template: string;
  to: string;
  userId?: string | null;
  studentProfileId?: string | null;
  registrationId?: string | null;
  payload?: Record<string, unknown>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Log and send (in the background on the live site). Never throws. */
export async function notify(deps: Deps, n: Notice | Notice[]) {
  const list = (Array.isArray(n) ? n : [n]).filter((x) => x.to);
  if (!list.length) return;
  try {
    const rows = await deps.db.insert(notificationLog).values(list.map((x) => ({
      template: x.template, toAddress: x.to.toLowerCase(), userId: x.userId ?? null, studentProfileId: x.studentProfileId ?? null,
      registrationId: x.registrationId ?? null, payload: x.payload ?? {},
    }))).returning({ id: notificationLog.id });
    const run = Promise.all(rows.map((r) => deliver(deps, r.id, 3))).then(() => undefined);
    if (deps.defer) deps.defer(run); else await run;
  } catch (e) {
    console.error('[notify] could not log emails', (e as Error).message);
  }
}

/** Build and send one logged email, trying up to `tries` times. */
export async function deliver(deps: Deps, id: string, tries = 1) {
  const [row] = await deps.db.select().from(notificationLog).where(eq(notificationLog.id, id));
  if (!row || row.status === 'sent') return;
  const build = builders.get(row.template);
  let error = '';
  for (let i = 0; i < tries; i++) {
    if (i) await wait(deps.defer ? 1500 * i : 0);
    try {
      if (!build) throw new Error(`No email called ${row.template}`);
      const mail = await build(deps, row.payload, row.toAddress);
      if (!mail) {
        await deps.db.update(notificationLog).set({ status: 'sent', error: 'skipped: nothing to send', attempts: row.attempts + i + 1 }).where(eq(notificationLog.id, id));
        return;
      }
      await deps.mailer.send({ to: row.toAddress, ...mail });
      await deps.db.update(notificationLog).set({ status: 'sent', sentAt: deps.now(), error: null, attempts: row.attempts + i + 1 }).where(eq(notificationLog.id, id));
      return;
    } catch (e) {
      error = (e as Error).message ?? String(e);
    }
  }
  console.error(`[notify] ${row.template} to ${row.toAddress} failed:`, error);
  await deps.db.update(notificationLog).set({ status: 'failed', error: error.slice(0, 500), attempts: row.attempts + tries }).where(eq(notificationLog.id, id));
}

/** Scheduled job: try failed emails again (up to 6 attempts, for 3 days). */
export async function retryFailed(deps: Deps) {
  const rows = await deps.db.select({ id: notificationLog.id }).from(notificationLog)
    .where(and(inArray(notificationLog.status, ['failed', 'queued']), lt(notificationLog.attempts, 6),
      gte(notificationLog.createdAt, new Date(deps.now().getTime() - 3 * 86400_000)),
      // Leave sends that started a moment ago to finish on their own.
      lt(notificationLog.createdAt, new Date(deps.now().getTime() - 2 * 60_000))))
    .limit(50);
  for (const r of rows) await deliver(deps, r.id, 1);
  return { retried: rows.length };
}

export const sentCount = (deps: Deps, template: string) =>
  deps.db.select({ n: sql<number>`count(*)::int` }).from(notificationLog).where(and(eq(notificationLog.template, template), eq(notificationLog.status, 'sent')));
