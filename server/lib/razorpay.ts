// Razorpay: server-side order creation, payment checks, captures and refunds.
// https://razorpay.com/docs/api/
import { hmacHex, randomToken, safeEqual } from './crypto.js';

export interface RzpOrder { id: string; amount: number; currency: string; status: string; receipt?: string }
export interface RzpPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  method?: string;
  email?: string;
  contact?: string;
  error_description?: string | null;
  [k: string]: unknown;
}
export interface RzpRefund { id: string; payment_id: string; amount: number; status: string }

export interface Razorpay {
  keyId: string;
  /** True for the local simulator (no real money, no Razorpay account). */
  simulated: boolean;
  createOrder(args: { amount: number; receipt: string; notes?: Record<string, string> }): Promise<RzpOrder>;
  fetchPayment(paymentId: string): Promise<RzpPayment>;
  capturePayment(paymentId: string, amount: number): Promise<RzpPayment>;
  refund(paymentId: string, args: { amount: number; notes?: Record<string, string> }): Promise<RzpRefund>;
  /** Checkout handler signature: HMAC(order_id|payment_id, key secret). */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
}

/** Webhook signature: HMAC(raw body, webhook secret). */
export const verifyWebhookSignature = (rawBody: string, signature: string, secret: string) =>
  Boolean(signature) && safeEqual(hmacHex(secret, rawBody), signature);

export class RazorpayError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) { super(message); }
}

export function razorpayHttp(keyId: string, keySecret: string, fetchImpl: typeof fetch = fetch): Razorpay {
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl('https://api.razorpay.com/v1' + path, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: { description?: string } }).error?.description ?? `Razorpay ${res.status}`;
      throw new RazorpayError(msg, res.status, json);
    }
    return json as T;
  }
  return {
    keyId,
    simulated: false,
    createOrder: ({ amount, receipt, notes }) => call('POST', '/orders', { amount, currency: 'INR', receipt, notes }),
    fetchPayment: (id) => call('GET', `/payments/${encodeURIComponent(id)}`),
    capturePayment: (id, amount) => call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency: 'INR' }),
    refund: (id, { amount, notes }) => call('POST', `/payments/${encodeURIComponent(id)}/refund`, { amount, notes, speed: 'normal' }),
    verifyPaymentSignature: (orderId, paymentId, signature) =>
      Boolean(signature) && safeEqual(hmacHex(keySecret, `${orderId}|${paymentId}`), signature),
  };
}

/**
 * Local stand-in for Razorpay so the full checkout can be exercised without an
 * account. Only enabled off Vercel with ALLOW_PAYMENT_SIMULATOR=true.
 */
export function razorpaySimulator(secret = 'simulator-secret'): Razorpay & {
  simulatePayment(orderId: string, opts?: { fail?: boolean; method?: string }): { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
  payments: Map<string, RzpPayment>;
  orders: Map<string, RzpOrder>;
} {
  const orders = new Map<string, RzpOrder>();
  const payments = new Map<string, RzpPayment>();
  const get = (id: string) => {
    const p = payments.get(id);
    if (!p) throw new RazorpayError('The id provided does not exist', 400);
    return p;
  };
  return {
    keyId: 'rzp_simulator',
    simulated: true,
    orders,
    payments,
    async createOrder({ amount, receipt }) {
      const o = { id: 'order_sim_' + randomToken(9), amount, currency: 'INR', status: 'created', receipt };
      orders.set(o.id, o);
      return o;
    },
    async fetchPayment(id) { return get(id); },
    async capturePayment(id, amount) {
      const p = get(id);
      if (p.amount !== amount) throw new RazorpayError('Capture amount mismatch', 400);
      p.status = 'captured';
      return p;
    },
    async refund(id, { amount }) {
      const p = get(id);
      return { id: 'rfnd_sim_' + randomToken(9), payment_id: p.id, amount, status: 'processed' };
    },
    verifyPaymentSignature: (orderId, paymentId, signature) =>
      Boolean(signature) && safeEqual(hmacHex(secret, `${orderId}|${paymentId}`), signature),
    simulatePayment(orderId, opts = {}) {
      const o = orders.get(orderId);
      if (!o) throw new RazorpayError('Unknown order', 400);
      const id = 'pay_sim_' + randomToken(9);
      payments.set(id, { id, order_id: orderId, amount: o.amount, currency: 'INR', status: opts.fail ? 'failed' : 'captured', method: opts.method ?? 'upi' });
      return { razorpay_order_id: orderId, razorpay_payment_id: id, razorpay_signature: hmacHex(secret, `${orderId}|${id}`) };
    },
  };
}
