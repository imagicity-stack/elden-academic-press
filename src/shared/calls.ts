// Phone calls by the AI voice agents (Sarvam): cart recovery, cash-on-delivery order confirmation
// and order feedback. Shared by the server (who to call, when, and what happened) and the admin
// (Admin → Calls).

export type CallKind = 'cart' | 'cod_confirm' | 'feedback';
export const CALL_KINDS: { key: CallKind; label: string; help: string }[] = [
  { key: 'cart', label: 'Cart recovery', help: 'Calls people who left checkout without paying.' },
  { key: 'cod_confirm', label: 'COD confirmation', help: 'Calls cash-on-delivery buyers to confirm the order before it is shipped (the cart agent makes this call).' },
  { key: 'feedback', label: 'Order feedback', help: 'Calls buyers a few days after their order to ask how it went, and mentions new titles.' },
];

/**
 * Where a cash-on-delivery order stands with its confirmation ('' for online orders):
 * pending: waiting for the call (or for the team); confirmed: the customer said yes on the call, or
 * the team confirmed it by hand (the call is then stopped); cancel_requested: the customer said
 * they don't want it (the team cancels it by hand); unreachable: nobody answered after every try;
 * unclear: they talked, but didn't clearly say yes or no.
 */
export type CodConfirmation = '' | 'pending' | 'confirmed' | 'cancel_requested' | 'unreachable' | 'unclear';
export const COD_CONFIRMATION_LABEL: Record<Exclude<CodConfirmation, ''>, string> = {
  pending: 'Awaiting confirmation', confirmed: 'Confirmed', cancel_requested: 'Customer said no', unreachable: 'Not reachable', unclear: 'Not confirmed',
};
/** Who confirmed: the agent on the call, or the team member's email. */
export const CONFIRMED_BY_CALL = 'call';

/**
 * queued: waiting for its time (or the calling hours); dialling: handed to the voice agent;
 * done: the call ended and its outcome is in; no_answer / failed: tried and it didn't connect
 * (retried while attempts remain); skipped: not needed any more (they paid, asked not to be
 * called, or the admin skipped it); cancelled: the admin stopped it.
 */
export type CallStatus = 'queued' | 'dialling' | 'done' | 'no_answer' | 'failed' | 'skipped' | 'cancelled';
export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  queued: 'Queued', dialling: 'Calling', done: 'Completed', no_answer: 'No answer', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled',
};

/** What the agent recorded as the call's outcome (call_outcome on the Sarvam agents). */
export const OUTCOME_LABEL: Record<string, string> = {
  will_order: 'Will order', callback: 'Call back', not_interested: 'Not interested', do_not_call: 'Do not call',
  wrong_person: 'Wrong person', transferred: 'Transferred to team', feedback_given: 'Feedback given', declined: 'Declined',
  enquiry: 'Question answered', order_confirmed: 'Order confirmed', cancel_requested: 'Wants to cancel', not_confirmed: 'Not confirmed',
};

/** Calls the customer made to our numbers are stored with this createdBy. */
export const INBOUND = 'inbound';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Day = (typeof DAYS)[number];

export interface CallSettings {
  /** Master switch: nothing is dialled while false. */
  enabled: boolean;
  cart: {
    enabled: boolean;
    /** Minutes after the checkout was left before calling. */
    delayMinutes: number;
    /** Coupon code the agent may offer after two hesitations ('' = none). */
    discountCode: string;
    /** How the agent describes it, e.g. "10 percent off the whole order". */
    discountOffer: string;
  };
  /** Cash on delivery: call to confirm each order before it's shipped (by the cart agent). */
  cod_confirm: {
    enabled: boolean;
    /** Minutes after the order is placed before calling (inside the calling hours). */
    delayMinutes: number;
  };
  feedback: {
    enabled: boolean;
    /** Days after payment (printed books: after delivery when known). */
    daysAfter: number;
    /** Product ids of new titles the agent may mention. */
    newBookIds: string[];
    /** Also call buyers who never saw the call box (orders before it existed, or other checkouts),
     *  unless they unticked it. A call about their own order, so a service call. */
    allBuyers: boolean;
    /** With allBuyers: how far back to look for paid orders (days). */
    lookbackDays: number;
  };
  /** Calling hours, India time. */
  hours: { start: string; end: string; days: Day[] };
  /** Extra tries when nobody answers. */
  maxRetries: number;
  retryAfterMinutes: number;
}

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  enabled: false,
  cart: { enabled: true, delayMinutes: 60, discountCode: '', discountOffer: '' },
  cod_confirm: { enabled: true, delayMinutes: 10 },
  feedback: { enabled: true, daysAfter: 3, newBookIds: [], allBuyers: false, lookbackDays: 30 },
  hours: { start: '10:00', end: '19:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
  maxRetries: 2,
  retryAfterMinutes: 120,
};

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** India time parts of a moment. */
function ist(d: Date) {
  const t = new Date(d.getTime() + 330 * 60_000);
  return { day: DAYS[(t.getUTCDay() + 6) % 7], minute: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** Is this moment inside the calling hours? */
export function inCallingHours(s: Pick<CallSettings, 'hours'>, now: Date): boolean {
  const { day, minute } = ist(now);
  return s.hours.days.includes(day) && minute >= minutes(s.hours.start) && minute < minutes(s.hours.end);
}

/** The next moment at or after `from` that is inside the calling hours (within two weeks). */
export function nextCallingTime(s: Pick<CallSettings, 'hours'>, from: Date): Date {
  if (inCallingHours(s, from)) return from;
  const start = minutes(s.hours.start);
  for (let i = 0; i < 15; i++) {
    // Midnight IST of day i, then the start time.
    const t = new Date(from.getTime() + 330 * 60_000);
    t.setUTCHours(0, 0, 0, 0);
    const candidate = new Date(t.getTime() + i * 86_400_000 + start * 60_000 - 330 * 60_000);
    if (candidate >= from && inCallingHours(s, candidate)) return candidate;
  }
  return from;
}

/** Indian mobile numbers only, as +91 and 10 digits; null if it isn't one. */
export function callableNumber(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}
