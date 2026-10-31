/** ₹ from paise: "₹1,299" or "₹1,299.50". */
export function inr(paise: number): string {
  const rupees = paise / 100;
  const whole = Number.isInteger(rupees);
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export const istDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

const PAY_METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', free: 'No payment due' };
/** "UPI", "Card"… for a Razorpay payment method. */
export const paymentMethodLabel = (method: string | null | undefined) => (method ? PAY_METHOD[method] ?? method : '');
