// Outgoing email through Resend (https://resend.com). Without an API key,
// messages are logged instead so local development works.

export interface Mail { to: string | string[]; subject: string; html: string; text?: string; replyTo?: string }
export interface Mailer { send(mail: Mail): Promise<void> }

export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(mail) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, reply_to: mail.replyTo }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
    },
  };
}

export function consoleMailer(): Mailer {
  return { async send(m) { console.info(`[mail] to=${[m.to].flat().join(',')} subject="${m.subject}"`); } };
}

/** Collects mail in memory (tests). */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { sent, async send(m) { sent.push(m); } };
}

/** Email must never break an order: failures are logged, not thrown. */
export async function sendSafely(mailer: Mailer, mail: Mail) {
  try { await mailer.send(mail); } catch (e) { console.error('[mail] failed:', (e as Error).message); }
}
