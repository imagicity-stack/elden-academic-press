// Outgoing email: Google Workspace (or any SMTP server) when SMTP_USER and
// SMTP_PASS are set, otherwise Resend's HTTP API. Without either, messages are
// logged instead so local development works.
import nodemailer from 'nodemailer';

export interface Attachment { filename: string; content: Uint8Array; contentType?: string }
export interface Mail { to: string | string[]; bcc?: string[]; subject: string; html: string; text?: string; replyTo?: string; attachments?: Attachment[] }
export interface Mailer { send(mail: Mail): Promise<void> }

/** A readable plain-text part from our own email HTML, for mail apps that prefer text. */
export function htmlToText(html: string) {
  return html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => `${label.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<br\s*\/?>|<div[^>]*>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|h3|div|table)>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&rarr;/g, '→').replace(/&middot;/g, '·').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function smtpMailer(opts: { host: string; port: number; user: string; pass: string; from: string }): Mailer {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 465,
    auth: { user: opts.user, pass: opts.pass },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(mail) {
      await transport.sendMail({
        from: opts.from,
        to: mail.to,
        bcc: mail.bcc?.length ? mail.bcc : undefined,
        subject: mail.subject,
        html: mail.html,
        text: mail.text ?? htmlToText(mail.html),
        replyTo: mail.replyTo,
        attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      });
    },
  };
}

export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(mail) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: mail.to, bcc: mail.bcc?.length ? mail.bcc : undefined, subject: mail.subject, html: mail.html, text: mail.text ?? htmlToText(mail.html), reply_to: mail.replyTo,
          attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64'), content_type: a.contentType })),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
    },
  };
}

export function consoleMailer(): Mailer {
  return {
    async send(m) {
      const files = m.attachments?.map((a) => `${a.filename} (${Math.round(a.content.length / 1024)} KB)`).join(', ');
      console.info(`[mail] to=${[m.to].flat().join(',')}${m.bcc?.length ? ` bcc=${m.bcc.join(',')}` : ''} subject="${m.subject}"${files ? ` attachments=${files}` : ''}`);
    },
  };
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

/** Comma- or space-separated addresses from a setting. */
export const addressList = (v: string | undefined) => (v ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
