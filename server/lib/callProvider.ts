// Who places the calls: the voice agents on Sarvam. The site decides who to call and when
// (services/calls.ts); a provider only starts one call and later reports how it went, through
// POST /api/calls/webhook/<secret> (normalised by callResultFrom below).
//
// The Sarvam connection itself is added once its API is confirmed (SARVAM_API_KEY and the
// agents' ids in Vercel); until then deps.calls is unset and the admin shows "not connected",
// while everything else (leads, queue, settings, do-not-call) works.
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
}

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
  const vars = { ...obj(pick(o, 'variables', 'agent_variables', 'agentVariables', 'extracted_variables', 'extractedVariables', 'post_interaction_variables')) };
  const statusText = str(pick(o, 'status', 'call_status', 'callStatus', 'outcome', 'disposition')).toLowerCase();
  const duration = Number(pick(o, 'duration_seconds', 'durationSeconds', 'duration', 'call_duration', 'billsec'));
  const answered = /complet|answer|connect|success|ended|done/.test(statusText) && !/no[\s_-]?answer|not[\s_-]?answer|unanswer/.test(statusText);
  const notAnswered = /no[\s_-]?answer|not[\s_-]?answer|unanswer|busy|voicemail|missed|declin|reject|timeout/.test(statusText);
  let transcript = pick(o, 'transcript', 'transcription', 'conversation');
  if (Array.isArray(transcript)) {
    transcript = transcript.map((t) => { const x = obj(t); return `${str(pick(x, 'role', 'speaker', 'from')) || '?'}: ${str(pick(x, 'text', 'content', 'message'))}`; }).join('\n');
  }
  return {
    callId: str(pick(meta, 'call_id', 'callId', 'elden_call_id') ?? pick(o, 'call_id', 'callId', 'reference_id', 'referenceId', 'external_id')) || null,
    providerCallId: str(pick(o, 'interaction_id', 'interactionId', 'provider_call_id', 'id', 'sid')) || null,
    status: answered || (!notAnswered && Number.isFinite(duration) && duration > 10) ? 'answered' : notAnswered ? 'not_answered' : 'failed',
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
