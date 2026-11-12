// WhatsApp Cloud API (Meta): sending template and text messages from our business number,
// checking the webhook's signature and reading what it reports (incoming messages, and
// sent / delivered / read / failed for ours).
// POST https://graph.facebook.com/<version>/<phone number id>/messages, Authorization: Bearer <token>.
import { hmacHex, safeEqual } from './crypto.js';
import { GRAPH_VERSION } from './meta.js';

export interface WhatsApp {
  name: string;
  /** An approved template: its body variables in order, and the path for its link button (if it has one). */
  sendTemplate(to: string, template: string, language: string, params: string[], buttonPath?: string): Promise<{ id: string }>;
  /** Free text: only within 24 hours of the customer's last message. */
  sendText(to: string, text: string): Promise<{ id: string }>;
}

/** A template's parts as Meta stores them (HEADER, BODY, FOOTER, BUTTONS). */
export type WaComponent = Record<string, unknown>;
export interface WaTemplateInfo { id?: string; name: string; language: string; status: string; category: string; rejectedReason: string; components?: WaComponent[] }
export interface WaTemplateSpec { name: string; language: string; category: 'UTILITY' | 'MARKETING'; components: WaComponent[] }

/** Templates in the WhatsApp Business Account: list them, create the site's, and update them. */
export interface WaTemplates {
  list(): Promise<WaTemplateInfo[]>;
  create(t: WaTemplateSpec): Promise<{ id: string; status: string }>;
  /** Replace an existing template's content (Meta reviews it again; at most about once a day per template). */
  edit(id: string, components: WaComponent[]): Promise<void>;
  /** The phone numbers in the same account: the sending number must be one of them to use its templates. */
  phoneNumbers(): Promise<{ id: string; number: string }[]>;
  /** What Meta knows about one phone number id (the one the site sends from). */
  numberInfo(phoneNumberId: string): Promise<Record<string, string>>;
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

/**
 * messagingAccountId: the Messaging account (the WhatsApp Business Account id, where the templates
 * are) to send from. Under Meta's new account model a phone number can belong to several
 * Messaging accounts; without it Meta may pick another one (with none of our templates) and
 * refuse every template with 132001, or bill the wrong one.
 */
export function whatsappHttp(cfg: { token: string; phoneNumberId: string; messagingAccountId?: string; fetch?: typeof fetch; baseUrl?: string }): WhatsApp {
  const fetchImpl = cfg.fetch ?? fetch;
  const url = `${(cfg.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '')}/${GRAPH_VERSION}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  async function send(body: Record<string, unknown>) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...(cfg.messagingAccountId ? { messaging_account_id: cfg.messagingAccountId } : {}), ...body }),
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
    sendTemplate: (to, template, language, params, buttonPath) => send({
      to: waTo(to), type: 'template',
      template: {
        name: template, language: { code: language },
        components: [
          ...(params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: templateParam(p) })) }] : []),
          // The link button is the first button: its URL ends in {{1}}, filled with this path.
          ...(buttonPath ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonPath.slice(0, 2000) }] }] : []),
        ],
      },
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
      let next: string | undefined = `${url}?fields=id,name,language,status,category,rejected_reason,components&limit=100`;
      for (let page = 0; next && page < 10; page++) {
        const j = await call(next);
        for (const t of j.data ?? []) {
          out.push({
            id: String(t.id ?? ''), name: String(t.name), language: String(t.language), status: String(t.status), category: String(t.category ?? ''),
            rejectedReason: String(t.rejected_reason ?? '') === 'NONE' ? '' : String(t.rejected_reason ?? ''), components: Array.isArray(t.components) ? t.components : [],
          });
        }
        next = j.paging?.next;
      }
      return out;
    },
    async create(t) {
      const j = await call(url, {
        method: 'POST',
        body: JSON.stringify({ name: t.name, language: t.language, category: t.category, components: t.components }),
      });
      return { id: String(j.id ?? ''), status: String(j.status ?? 'PENDING') };
    },
    async edit(id, components) {
      const base = url.replace(/\/[^/]+\/message_templates$/, '');
      await call(`${base}/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ components }) });
    },
    async phoneNumbers() {
      const j = await call(`${url.replace(/\/message_templates$/, '/phone_numbers')}?fields=id,display_phone_number`);
      return (j.data ?? []).map((p: any) => ({ id: String(p.id), number: String(p.display_phone_number ?? '') }));
    },
    async numberInfo(phoneNumberId) {
      const base = url.replace(/\/[^/]+\/message_templates$/, '');
      const j = await call(`${base}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,name_status,status,platform_type,code_verification_status,quality_rating`);
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)]));
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
export function memoryWhatsApp(): WhatsApp & { sent: { to: string; template?: string; language?: string; params?: string[]; button?: string; text?: string }[]; fail?: string } {
  const sent: { to: string; template?: string; language?: string; params?: string[]; button?: string; text?: string }[] = [];
  const w: WhatsApp & { sent: typeof sent; fail?: string } = {
    name: 'test', sent,
    async sendTemplate(to, template, language, params, buttonPath) {
      if (w.fail) throw new Error(w.fail);
      sent.push({ to, template, language, params: params.map(templateParam), ...(buttonPath !== undefined ? { button: buttonPath } : {}) });
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
