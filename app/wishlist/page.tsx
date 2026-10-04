'use client';

import { useRouter } from 'next/navigation';
import { fmt } from '@/lib/format';
import { useStore } from '@/lib/store';
import { BookCover, Icon, PageHeader, display, font } from '@/components/ui';

export default function Wishlist() {
  const router = useRouter();
  const { s, course, toggleWish, addCart, showToast } = useStore();
  const items = s.wish.map(course).filter((c) => !!c);

  return (
    <main className="scr-in" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
      <PageHeader title="Wishlist" />
      <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((c) => {
          const owned = s.owned.includes(c.id);
          const inCart = s.cart.includes(c.id);
          return (
            <div key={c.id} style={{ background: '#fff', borderRadius: 20, padding: 12, display: 'flex', gap: 12, alignItems: 'center', animation: 'scrIn .3s both' }}>
              <BookCover c={c} w={58} h={74} radius={11} spine={5} sym={25} symBottom={7} symLeft={10} onClick={() => router.push(`/course/${c.id}`)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.25 }}>{c.title}</div>
                <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>{fmt(c.price)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <button aria-label="Remove from wishlist" onClick={() => toggleWish(c.id)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#F4F5FA', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                  <Icon name="favorite" size={18} fill color="#E5484D" />
                </button>
                <button
                  onClick={() => {
                    if (owned) return router.push(`/learn/${c.id}`);
                    const r = addCart(c.id);
                    if (r === 'in-cart') router.push('/cart');
                    else showToast('Added to cart');
                  }}
                  style={{ height: 32, padding: '0 12px', borderRadius: 16, border: 'none', background: '#0A1F4D', color: '#F4F5FA', font: font(800, 11.5), cursor: 'pointer' }}
                >
                  {owned ? 'Open' : inCart ? 'In cart' : 'Add to cart'}
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '70px 20px' }}>
            <div style={display(700, 22)}>Nothing saved yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Tap the heart on any course to keep it here.</div>
          </div>
        )}
      </div>
    </main>
  );
}
