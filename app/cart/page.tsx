'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fmt } from '@/lib/format';
import { useStore } from '@/lib/store';
import { cartTotals } from '@/lib/totals';
import { BookCover, BottomBar, Icon, PageHeader, display, font, primaryBtn } from '@/components/ui';

export default function Cart() {
  const router = useRouter();
  const { mode, user, s, course, removeCart, coupon, applyCoupon } = useStore();
  const [code, setCode] = useState(coupon?.code ?? '');
  const items = s.cart.map(course).filter((c) => !!c);
  const t = cartTotals(items, coupon?.percent);

  const checkout = () => router.push(mode === 'live' && !user ? '/signup?next=/checkout' : '/checkout');

  return (
    <>
      <main className="scr-in" style={{ paddingBottom: 'calc(120px + var(--safe-b))' }}>
        <PageHeader title="Your cart" />
        <div style={{ padding: '12px 20px 0' }}>
          {items.length > 0 ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((c) => (
                  <div key={c.id} style={{ background: '#fff', borderRadius: 20, padding: 12, display: 'flex', gap: 12, alignItems: 'center', animation: 'scrIn .3s both' }}>
                    <BookCover c={c} w={58} h={74} radius={11} spine={5} sym={25} symBottom={7} symLeft={10} onClick={() => router.push(`/course/${c.id}`)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.25 }}>{c.title}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontWeight: 800, fontSize: 14.5 }}>{fmt(c.price)}</span>
                        <span style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'line-through' }}>{fmt(c.mrp)}</span>
                      </div>
                    </div>
                    <button aria-label="Remove from cart" onClick={() => removeCart(c.id)} style={{ width: 36, height: 36, flex: 'none', borderRadius: '50%', border: 'none', background: '#F4F5FA', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--muted)' }}>
                      <Icon name="delete" size={19} />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); if (!coupon) applyCoupon(code); }} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <label style={{ flex: 1, height: 50, borderRadius: 16, background: '#fff', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', border: '1.5px dashed #3DD6CF' }}>
                  <Icon name="sell" size={20} color="#0172EA" />
                  <input aria-label="Coupon code" value={code} disabled={!!coupon} onChange={(e) => setCode(e.target.value)} placeholder="Coupon code — try ELDEN20" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', font: font(700, 13), textTransform: 'uppercase' }} />
                </label>
                <button type="submit" style={{ ...primaryBtn(50, 13), borderRadius: 16, padding: '0 18px' }}>{coupon ? 'Applied' : 'Apply'}</button>
              </form>

              <div style={{ background: '#fff', borderRadius: 20, padding: 16, marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5 }}>
                <Row l="Price (MRP)" v={fmt(t.mrp)} />
                <Row l="Discount on MRP" v={`− ${fmt(t.disc)}`} green />
                {coupon && <Row l={`Coupon ${coupon.code}`} v={`− ${fmt(t.coupon)}`} green />}
                <div style={{ height: 1, background: 'var(--line)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 800 }}>Total</span>
                  <span style={display(700, 22)}>{fmt(t.total)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--green)', fontWeight: 700 }}>You save {fmt(t.saved)} on this order</div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '70px 20px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/elmaster-mark.png" alt="" style={{ height: 70 }} />
              <div style={{ ...display(700, 24), marginTop: 16 }}>Your cart is empty</div>
              <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>The best shelves are built one book at a time.</div>
              <button onClick={() => router.push('/explore')} style={{ ...primaryBtn(48, 14), margin: '20px auto 0', padding: '0 24px' }}>Browse courses</button>
            </div>
          )}
        </div>
      </main>

      {items.length > 0 && (
        <BottomBar>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{items.length} item(s)</div>
            <div style={display(700, 22, 1.05)}>{fmt(t.total)}</div>
          </div>
          <button onClick={checkout} style={{ ...primaryBtn(54), padding: '0 28px' }}>
            Checkout
            <Icon name="arrow_forward" size={20} />
          </button>
        </BottomBar>
      )}
    </>
  );
}

function Row({ l, v, green }: { l: string; v: string; green?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', animation: 'fadeIn .3s' }}>
      <span style={{ color: 'var(--muted)' }}>{l}</span>
      <span style={{ fontWeight: 700, color: green ? 'var(--green)' : undefined }}>{v}</span>
    </div>
  );
}
