// Who places the calls: the voice agents on Sarvam. The site decides who to call and when
// (services/calls.ts); a provider only starts one call and later reports how it went, through
// POST /api/calls/webhook/<secret> (normalised by callResultFrom below).
//
// The Sarvam connection (sarvamCalls below) is used once SARVAM_API_KEY, SARVAM_ORG_ID,
// SARVAM_WORKSPACE_ID and both campaign ids are set in Vercel; until then deps.calls is unset and
// the admin shows "not connected", while everything else (leads, queue, settings, do-not-call) works.
import type { CallKind } from '../../src/shared/calls.js';

export interface StartCall {
  /** Our call id: the provider sends it back with the result. */
  callId: string;
  kind: CallKind;
  /** +91XXXXXXXXXX */
  phone: string;
  /** The agent's call-start variables (customer_name, cart_items, ...). */
  variables: Record<string, string>;
}

export interface CallProvider {
  name: string;
  /** Start the call now; returns the provider's id for it. Throws if it can't. */
  start(call: StartCall): Promise<{ providerCallId: string }>;
  /** Check the connection without calling anyone: is the key accepted, and is each campaign there and running? */
  check?(): Promise<ConnectionCheck[]>;
  /**
   * Ask the provider how a call went, for when its call-end webhook didn't arrive. Returns a
   * payload in the webhook's shape (for recordCallResult), or null while there's no final result yet.
   */
  lookup?(call: { callId: string; kind: CallKind; since: Date }): Promise<Record<string, unknown> | null>;
}

export interface ConnectionCheck { kind: 'cart' | 'feedback'; campaignId: string; ok: boolean; status?: string; agentVersion?: number | null; endsAt?: string; error?: string }

/** How a call went, from the provider's webhook. */
export interface CallResult {
  callId: string | null;
  providerCallId: string | null;
  /** answered: someone talked to the agent; not_answered: no answer, busy or voicemail; failed: it never connected. */
  status: 'answered' | 'not_answered' | 'failed';
  durationSeconds: number | null;
  transcript: string;
  recordingUrl: string;
  /** The values the agent recorded after the call (call_outcome, rating, wants_link, ...). */
  variables: Record<string, unknown>;
  /** inbound: the customer rang one of our numbers (Sarvam names the deployment, not a campaign). */
  direction: 'outbound' | 'inbound';
  /** The customer's number, as the provider gives it. */
  phone: string;
  /** The webhook's own metadata.purpose (set on each Sarvam number), e.g. cart_recovery_call_end. */
  purpose: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const pick = (o: Record<string, unknown>, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/**
 * A call-end payload, normalised. Accepts the common spellings (snake and camel case, the result
 * nested under data/payload, variables under variables/agent_variables/extracted_variables), so
 * the site doesn't break when the provider adds or renames a wrapper.
 */
export function callResultFrom(raw: unknown): CallResult {
  const top = obj(raw);
  const o = { ...top, ...obj(top.data), ...obj(top.payload) };
  const meta = obj(pick(o, 'metadata', 'meta'));
  // Sarvam: final_agent_variables is everything the agent held, output_agent_variables the part it reports.
  const vars = {
    ...obj(o.final_agent_variables),
    ...obj(pick(o, 'variables', 'agent_variables', 'agentVariables', 'extracted_variables', 'extractedVariables', 'post_interaction_variables', 'output_agent_variables')),
  };
  // Sarvam reports connected / busy / no_answer / failed as connectivity_status.
  const statusText = str(pick(o, 'connectivity_status', 'status', 'call_status', 'callStatus', 'outcome', 'disposition')).toLowerCase();
  const duration = Number(pick(o, 'duration_seconds', 'durationSeconds', 'duration', 'call_duration', 'billsec'));
  const answered = /complet|answer|connect|success|ended|done/.test(statusText) && !/no[\s_-]?answer|not[\s_-]?answer|unanswer/.test(statusText);
  const notAnswered = /no[\s_-]?answer|not[\s_-]?answer|unanswer|busy|voicemail|missed|declin|reject|timeout/.test(statusText);
  let transcript = pick(o, 'interaction_transcript', 'transcript', 'transcription', 'conversation');
  if (Array.isArray(transcript)) {
    transcript = transcript.map((t) => { const x = obj(t); return `${str(pick(x, 'role', 'speaker', 'from')) || '?'}: ${str(pick(x, 'text', 'content', 'message', 'en_text', 'indic_text'))}`; }).join('\n');
  }
  const inbound = Boolean(o.deployment_id) && !o.campaign_id;
  return {
    direction: inbound ? 'inbound' : 'outbound',
    phone: str(pick(o, 'user_phone_number', 'customer_number', 'from')).slice(0, 20),
    purpose: str(meta.purpose).slice(0, 60),
    callId: str(pick(meta, 'call_id', 'callId', 'elden_call_id') ?? pick(o, 'call_id', 'callId', 'user_identifier', 'reference_id', 'referenceId', 'external_id')) || null,
    providerCallId: str(pick(o, 'interaction_id', 'interactionId', 'attempt_id', 'provider_call_id', 'id', 'sid')) || null,
    // An inbound call connected by definition: the customer rang us.
    status: inbound || answered || (!notAnswered && Number.isFinite(duration) && duration > 10) ? 'answered' : notAnswered ? 'not_answered' : 'failed',
    durationSeconds: Number.isFinite(duration) ? Math.round(duration) : null,
    transcript: str(transcript).slice(0, 50_000),
    recordingUrl: str(pick(o, 'recording_url', 'recordingUrl', 'recording')).slice(0, 1000),
    variables: vars,
  };
}

/** For tests and local development: records the calls it is asked to place. */
export function memoryCalls(): CallProvider & { started: StartCall[]; fail?: boolean } {
  const started: StartCall[] = [];
  const p: CallProvider & { started: StartCall[]; fail?: boolean } = {
    name: 'test',
    started,
    async start(call) {
      if (p.fail) throw new Error('provider down');
      started.push(call);
      return { providerCallId: `test-${started.length}` };
    },
  };
  return p;
}

export interface SarvamCallsConfig {
  /** Voice Agents workspace API key (apps.sarvam.ai → Settings → API Key), sent as X-API-Key. */
  apiKey: string;
  /** From the dashboard address: apps.sarvam.ai/…/orgs/<org>/workspaces/<workspace>/… */
  orgId: string;
  workspaceId: string;
  cartCampaignId: string;
  feedbackCampaignId: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Sarvam's error body: { error: { message } }, FastAPI's { detail }, or plain text. */
function sarvamError(status: number, text: string): string {
  let msg = text.trim();
  try {
    const j = obj(JSON.parse(text));
    const detail = j.detail;
    msg = str(obj(j.error).message) || str(j.message)
      || (Array.isArray(detail) ? detail.map((d) => str(obj(d).msg) || str(d)).join('; ') : str(detail)) || msg;
  } catch { /* not JSON */ }
  return `Sarvam ${status}: ${msg || 'no details'}`.slice(0, 280);
}

/**
 * Places calls through Sarvam's outgoing campaigns: one campaign per kind (each on its own agent
 * and number, already scheduled with its dialling hours and call-end webhook). Starting a call adds
 * the customer to that campaign as a one-person cohort ("Stream cohort"), with our call id as
 * user_identifier: Sarvam sends it back in the call-end webhook.
 * POST https://apps.sarvam.ai/api/scheduling/v1/orgs/{org}/workspaces/{ws}/campaigns/{id}/cohorts/stream
 */
export function sarvamCalls(cfg: SarvamCallsConfig): CallProvider {
  const fetchImpl = cfg.fetch ?? fetch;
  const base = (cfg.baseUrl ?? 'https://apps.sarvam.ai').replace(/\/+$/, '');
  const e = encodeURIComponent;
  const campaignUrl = (id: string) => `${base}/api/scheduling/v1/orgs/${e(cfg.orgId)}/workspaces/${e(cfg.workspaceId)}/campaigns/${e(id)}`;
  async function getJson(url: string) {
    const res = await fetchImpl(url, { headers: { 'X-API-Key': cfg.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(sarvamError(res.status, text));
    try { return obj(JSON.parse(text)); } catch { return {}; }
  }
  // The agent behind each campaign (the analytics API is per agent), asked once.
  const agentOf = new Map<string, string>();
  async function agentId(campaignId: string) {
    if (!agentOf.has(campaignId)) agentOf.set(campaignId, str((await getJson(campaignUrl(campaignId))).app_id));
    return agentOf.get(campaignId)!;
  }
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, '+00:00');
  return {
    name: 'sarvam',
    async lookup({ callId, kind, since }) {
      const campaignId = kind === 'feedback' ? cfg.feedbackCampaignId : cfg.cartCampaignId;
      const app = await agentId(campaignId);
      if (!app) return null;
      const analytics = `${base}/api/analytics/v1/${e(cfg.orgId)}/${e(cfg.workspaceId)}/${e(app)}`;
      const range = { start_datetime: iso(new Date(since.getTime() - 15 * 60_000)), end_datetime: iso(new Date()) };
      const byId = (field: string, value: string) => JSON.stringify([{ field, operator: 'equals', value }]);
      const attempts = await getJson(`${analytics}/attempts?${new URLSearchParams({ ...range, sort_by: 'attempted_at', sort_order: 'desc', limit: '5', filter_conditions: byId('user_identifier', callId) })}`);
      const a = obj((Array.isArray(attempts.items) ? attempts.items : [])[0]);
      if (!Object.keys(a).length) return null; // not dialled yet
      const status = str(a.connectivity_status).toLowerCase();
      const base_ = { user_identifier: callId, campaign_id: a.campaign_id ?? campaignId, cohort_id: a.cohort_id, attempt_id: a.attempt_id, connectivity_status: status, failure_reason: a.failure_reason, source: 'sarvam_lookup' };
      if (status !== 'connected') {
        // Not connected: final unless Sarvam itself will try again.
        return status && str(a.next_action_status).toLowerCase() !== 'retry' ? base_ : null;
      }
      const interactionId = str(a.interaction_id);
      if (!interactionId) return null;
      const list = await getJson(`${analytics}/interactions?${new URLSearchParams({ ...range, limit: '1', include_transcript: 'true', filter_conditions: byId('interaction_id', interactionId) })}`);
      const it = obj((Array.isArray(list.items) ? list.items : [])[0]);
      // The conversation's record can lag the attempt by a minute: try again on the next run.
      if (!Object.keys(it).length) return null;
      const turns = (Array.isArray(it.translate_transcript) && it.translate_transcript.length ? it.translate_transcript : Array.isArray(it.original_transcript) ? it.original_transcript : []) as unknown[];
      return {
        ...base_, interaction_id: interactionId,
        duration: it.duration_in_seconds ?? a.duration_in_seconds,
        recording_url: it.audio_url ?? a.audio_url ?? '',
        final_agent_variables: obj(it.agent_variables),
        interaction_transcript: turns.map((t) => { const x = obj(t); return { role: str(x.role), en_text: str(pick(x, 'content', 'text', 'en_text')) }; }),
      };
    },
    async check() {
      const out: ConnectionCheck[] = [];
      for (const [kind, campaignId] of [['cart', cfg.cartCampaignId], ['feedback', cfg.feedbackCampaignId]] as const) {
        try {
          const res = await fetchImpl(campaignUrl(campaignId), { headers: { 'X-API-Key': cfg.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
          const text = await res.text();
          if (!res.ok) { out.push({ kind, campaignId, ok: false, error: sarvamError(res.status, text) }); continue; }
          const j = obj(JSON.parse(text));
          const status = str(j.status);
          out.push({ kind, campaignId, ok: status === 'active' || status === 'scheduled', status, agentVersion: j.app_version == null ? null : Number(j.app_version), endsAt: str(j.end_timestamp) });
        } catch (err) {
          out.push({ kind, campaignId, ok: false, error: (err as Error).message.slice(0, 200) });
        }
      }
      return out;
    },
    async start({ callId, kind, phone, variables }) {
      // The cart agent also makes the cash-on-delivery confirmation calls (call_purpose tells it which).
      const campaignId = kind === 'feedback' ? cfg.feedbackCampaignId : cfg.cartCampaignId;
      const url = `${campaignUrl(campaignId)}/cohorts/stream`;
      // Sarvam takes string values only.
      const appVariables = Object.fromEntries(Object.entries(variables ?? {}).map(([k, v]) => [k, str(v)]));
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        // Cohort names: 1-50 letters, digits, spaces, _ and -.
        body: JSON.stringify({ name: `${kind}-${callId}`.replace(/[^\w -]/g, '-').slice(0, 50), users: [{ user_phone_number: phone, user_identifier: callId, app_variables: appVariables }] }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(sarvamError(res.status, text));
      let body: Record<string, unknown> = {};
      try { body = obj(JSON.parse(text)); } catch { /* empty or not JSON */ }
      const result = obj(body.result);
      if (body.status === 'failed' || (Number(result.valid_records) === 0 && Number(result.rejected_records) > 0)) {
        throw new Error(`Sarvam rejected the number or its details (cohort ${str(body.cohort_id) || 'unknown'})`);
      }
      return { providerCallId: str(body.cohort_id) || callId };
    },
  };
}
