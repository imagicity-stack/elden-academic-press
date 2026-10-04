'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fmt } from '@/lib/format';
import { useStore } from '@/lib/store';
import { cartTotals } from '@/lib/totals';
import { BottomBar, Icon, PageHeader, display, font, primaryBtn } from '@/components/ui';

const METHODS = [
  ['upi', 'UPI', 'Google Pay, PhonePe, Paytm', 'qr_code_2'],
  ['card', 'Credit / Debit card', 'Visa, Mastercard, RuPay', 'credit_card'],
  ['nb', 'Net banking', 'All major Indian banks', 'account_balance'],
  ['emi', 'No-cost EMI', '3 or 6 months on select cards', 'calendar_month'],
] as const;

export default function Checkout() {
  const router = useRouter();
  const { mode, user, s, course, coupon, placeOrder } = useStore();
  const [method, setMethod] = useState<string>('upi');
  const [paying, setPaying] = useState(false);
  const paid = useRef(false);
  const items = s.cart.map(course).filter((c) => !!c);
  const t = cartTotals(items, coupon?.percent);

  useEffect(() => {
    if (paid.current) return;
    if (mode === 'live' && !user) router.replace('/signup?next=/checkout');
    else if (!items.length) router.replace('/cart');
  }, [mode, user, items.length, router]);

  const pay = async () => {
    if (paying || !items.length) return;
    setPaying(true);
    paid.current = true;
    const ok = await placeOrder(method);
    if (ok) router.replace('/success');
    else {
      paid.current = false;
      setPaying(false);
    }
  };

  return (
    <>
      <main className="scr-in" style={{ paddingBottom: 'calc(120px + var(--safe-b))' }}>
        <PageHeader title="Payment" />
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ background: '#0A1F4D', borderRadius: 24, padding: 20, color: '#F4F5FA', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(1,114,234,.6),transparent 65%)', right: -60, top: -60 }} />
            <div style={{ font: font(800, 10), letterSpacing: '.16em', color: '#3DD6CF', position: 'relative' }}>AMOUNT PAYABLE</div>
            <div style={{ ...display(700, 39, 1.05), marginTop: 8, position: 'relative' }}>{fmt(t.total)}</div>
            <div style={{ fontSize: 12.5, color: 'rgba(244,245,250,.7)', marginTop: 6, position: 'relative' }}>{items.length} course(s) · lifetime access · GST included</div>
          </div>

          <div style={{ font: font(800, 11), letterSpacing: '.1em', color: 'var(--muted)', margin: '22px 0 10px' }}>PAY WITH</div>
          <div role="radiogroup" aria-label="Payment method" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {METHODS.map(([id, title, sub, icon]) => {
              const on = id === method;
              return (
                <button key={id} role="radio" aria-checked={on} onClick={() => setMethod(id)} style={{ background: '#fff', borderRadius: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', border: `1.5px solid ${on ? '#0A1F4D' : 'transparent'}`, transition: 'all .2s', textAlign: 'left' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 13, background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center' }}>
                    <Icon name={icon} size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
                  </div>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${on ? '#0A1F4D' : 'transparent'}`, display: 'grid', placeItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: on ? '#0A1F4D' : 'transparent', transition: 'all .2s' }} />
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', marginTop: 18 }}>
            <Icon name="lock" size={16} />
            Secured by 256-bit encryption · 7-day refund
          </div>
        </div>
      </main>

      <BottomBar>
        <button onClick={pay} disabled={paying} style={{ ...primaryBtn(58, 15.5), width: '100%', gap: 10 }}>
          {paying && <span style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid rgba(244,245,250,.3)', borderTopColor: '#3DD6CF', animation: 'spin .8s linear infinite' }} />}
          {paying ? 'Processing…' : `Pay ${fmt(t.total)}`}
        </button>
      </BottomBar>
    </>
  );
}
