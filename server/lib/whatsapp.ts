// WhatsApp Cloud API (Meta): sending template and text messages from our business number,
// checking the webhook's signature and reading what it reports (incoming messages, and
// sent / delivered / read / failed for ours).
// POST https://graph.facebook.com/<version>/<phone number id>/messages, Authorization: Bearer <token>.
import { hmacHex, safeEqual } from './crypto.js';
import { GRAPH_VERSION } from './meta.js';

export interface WhatsApp {
  name: string;
  /** A template approved in WhatsApp Manager, with its body variables in order. */
  sendTemplate(to: string, template: string, language: string, params: string[]): Promise<{ id: string }>;
  /** Free text: only within 24 hours of the customer's last message. */
  sendText(to: string, text: string): Promise<{ id: string }>;
}

export interface WaTemplateInfo { name: string; language: string; status: string; category: string; rejectedReason: string }
export interface WaTemplateSpec { name: string; language: string; category: 'UTILITY' | 'MARKETING'; text: string; samples: string[] }

/** Templates in the WhatsApp Business Account: list them, and create the site's. */
export interface WaTemplates {
  list(): Promise<WaTemplateInfo[]>;
  create(t: WaTemplateSpec): Promise<{ id: string; status: string }>;
}

/** "+919876543210" → "919876543210" (WhatsApp wants digits only). */
export const waTo = (phone: string) => phone.replace(/\D/g, '');
/** "919876543210" (from WhatsApp) → "+919876543210", our stored form. */
export const waPhone = (waId: string) => `+${waId.replace(/\D/g, '')}`;

/** Template variables can't hold new lines, tabs or more than four spaces in a row, nor be empty. */
export const templateParam = (s: string) => (s.replace(/\s+/g, ' ').trim() || '-').slice(0, 1000);

export class WhatsAppError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) { super(message); }
}

export function whatsappHttp(cfg: { token: string; phoneNumberId: string; fetch?: typeof fetch; baseUrl?: string }): WhatsApp {
  const fetchImpl = cfg.fetch ?? fetch;
  const url = `${(cfg.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '')}/${GRAPH_VERSION}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  async function send(body: Record<string, unknown>) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let j: Record<string, any> = {};
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || j.error) {
      const e = j.error ?? {};
      const msg = [e.message, e.error_data?.details].filter(Boolean).join(': ') || text.slice(0, 200) || 'no details';
      throw new WhatsAppError(`WhatsApp ${res.status}${e.code ? ` (${e.code})` : ''}: ${msg}`.slice(0, 300), res.status, e.code);
    }
    const id = j.messages?.[0]?.id;
    if (!id) throw new WhatsAppError('WhatsApp accepted the message but returned no id', res.status);
    return { id: String(id) };
  }
  return {
    name: 'whatsapp-cloud',
    sendTemplate: (to, template, language, params) => send({
      to: waTo(to), type: 'template',
      template: { name: template, language: { code: language }, components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: templateParam(p) })) }] : [] },
    }),
    sendText: (to, text) => send({ to: waTo(to), type: 'text', text: { body: text.slice(0, 4096), preview_url: true } }),
  };
}

/** GET/POST https://graph.facebook.com/<version>/<WhatsApp Business Account id>/message_templates */
export function whatsappTemplatesHttp(cfg: { token: string; businessAccountId: string; fetch?: typeof fetch; baseUrl?: string }): WaTemplates {
  const fetchImpl = cfg.fetch ?? fetch;
  const url = `${(cfg.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '')}/${GRAPH_VERSION}/${encodeURIComponent(cfg.businessAccountId)}/message_templates`;
  async function call(u: string, init: RequestInit = {}) {
    const res = await fetchImpl(u, { ...init, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let j: Record<string, any> = {};
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || j.error) {
      const e = j.error ?? {};
      throw new WhatsAppError(`WhatsApp ${res.status}: ${[e.error_user_title, e.error_user_msg || e.message].filter(Boolean).join(': ') || text.slice(0, 200)}`.slice(0, 400), res.status, e.code);
    }
    return j;
  }
  return {
    async list() {
      const out: WaTemplateInfo[] = [];
      let next: string | undefined = `${url}?fields=name,language,status,category,rejected_reason&limit=100`;
      for (let page = 0; next && page < 10; page++) {
        const j = await call(next);
        for (const t of j.data ?? []) out.push({ name: String(t.name), language: String(t.language), status: String(t.status), category: String(t.category ?? ''), rejectedReason: String(t.rejected_reason ?? '') === 'NONE' ? '' : String(t.rejected_reason ?? '') });
        next = j.paging?.next;
      }
      return out;
    },
    async create(t) {
      const j = await call(url, {
        method: 'POST',
        body: JSON.stringify({
          name: t.name, language: t.language, category: t.category,
          components: [{ type: 'BODY', text: t.text, example: { body_text: [t.samples] } }],
        }),
      });
      return { id: String(j.id ?? ''), status: String(j.status ?? 'PENDING') };
    },
  };
}

/** X-Hub-Signature-256: "sha256=<hex HMAC of the raw body with the app secret>". */
export const verifyWhatsAppSignature = (raw: string, header: string, appSecret: string) =>
  Boolean(header) && safeEqual(`sha256=${hmacHex(appSecret, raw)}`, header);

export interface WaIncoming { waId: string; from: string; name: string; text: string; type: string; at: Date }
export interface WaStatusUpdate { waId: string; status: string; error: string; at: Date }

/** The messages and status updates in one webhook delivery. */
export function parseWebhook(body: unknown): { messages: WaIncoming[]; statuses: WaStatusUpdate[] } {
  const messages: WaIncoming[] = [];
  const statuses: WaStatusUpdate[] = [];
  const b = body as { entry?: { changes?: { field?: string; value?: any }[] }[] };
  for (const entry of b?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? '')]));
      for (const m of v.messages ?? []) {
        const type = String(m.type ?? 'unknown');
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? m[type]?.caption ?? `[${type}]`;
        messages.push({ waId: String(m.id), from: waPhone(String(m.from)), name: names.get(String(m.from)) ?? '', text: String(text).slice(0, 4096), type, at: new Date(Number(m.timestamp) * 1000 || Date.now()) });
      }
      for (const s of v.statuses ?? []) {
        const err = (s.errors ?? [])[0];
        statuses.push({
          waId: String(s.id), status: String(s.status),
          error: err ? [err.code, err.title, err.message, err.error_data?.details].filter(Boolean).join(': ').slice(0, 300) : '',
          at: new Date(Number(s.timestamp) * 1000 || Date.now()),
        });
      }
    }
  }
  return { messages, statuses };
}

/** For tests and local development: records what it is asked to send. */
export function memoryWhatsApp(): WhatsApp & { sent: { to: string; template?: string; language?: string; params?: string[]; text?: string }[]; fail?: string } {
  const sent: { to: string; template?: string; language?: string; params?: string[]; text?: string }[] = [];
  const w: WhatsApp & { sent: typeof sent; fail?: string } = {
    name: 'test', sent,
    async sendTemplate(to, template, language, params) {
      if (w.fail) throw new Error(w.fail);
      sent.push({ to, template, language, params: params.map(templateParam) });
      return { id: `wamid.test-${sent.length}` };
    },
    async sendText(to, text) {
      if (w.fail) throw new Error(w.fail);
      sent.push({ to, text });
      return { id: `wamid.test-${sent.length}` };
    },
  };
  return w;
}
