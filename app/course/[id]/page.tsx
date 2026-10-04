'use client';

import { notFound, useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { REVIEWS } from '@/lib/seed';
import { fmt, initialsOf, offPct } from '@/lib/format';
import { useStore } from '@/lib/store';
import { BottomBar, HeartButton, Icon, RoundButton, Stars, TabLine, display, font, primaryBtn, useBack } from '@/components/ui';

const TABS = ['About', 'Curriculum', 'Reviews'] as const;
const MODULES = ['Foundations', 'Core techniques', 'Problem-solving patterns', 'Olympiad-level practice', 'Full mock & review'];
const RATING_BARS = [['5', 78], ['4', 15], ['3', 4], ['2', 2], ['1', 1]] as const;

const heroBtn: React.CSSProperties = { background: 'rgba(255,255,255,.9)', color: '#0A1F4D' };

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const back = useBack('/explore');
  const { s, course, toggleWish, addCart, showToast } = useStore();
  const [tab, setTab] = useState<(typeof TABS)[number]>('About');
  const c = course(id);
  if (!c) notFound();

  const owned = s.owned.includes(c.id);
  const inCart = s.cart.includes(c.id);
  const stat = (v: React.ReactNode, l: string) => (
    <div style={{ background: '#fff', borderRadius: 16, padding: '12px 8px', textAlign: 'center' }}>
      <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{l}</div>
    </div>
  );

  const onCart = () => {
    const r = addCart(c.id);
    if (r === 'in-cart') router.push('/cart');
    else if (r === 'added') showToast('Added to cart');
  };
  const buyNow = () => {
    addCart(c.id);
    router.push('/checkout');
  };
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: c.title, url });
      else {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
      }
    } catch {}
  };

  return (
    <>
      <main className="fade-in" style={{ paddingBottom: 'calc(120px + var(--safe-b))' }}>
        <div style={{ height: 'calc(350px + env(safe-area-inset-top, 0px))', background: c.cover, position: 'relative', overflow: 'hidden', color: c.ink }}>
          <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 5px)' }} />
          <div style={{ position: 'absolute', width: 380, height: 380, borderRadius: '50%', border: '1px solid currentColor', opacity: 0.15, right: -120, top: -40 }} />
          <div style={{ position: 'absolute', right: 20, bottom: 40, font: font(800, 151, 1.05, 'var(--fd)'), letterSpacing: '-.05em', opacity: 0.95, animation: 'scrIn .6s' }}>{c.sym}</div>
          <div style={{ position: 'absolute', top: 'calc(var(--top) - 2px)', left: 20, right: 20, display: 'flex', gap: 10 }}>
            <RoundButton icon="arrow_back" label="Back" onClick={back} bg={heroBtn.background as string} color="#0A1F4D" />
            <div style={{ flex: 1 }} />
            <RoundButton icon="ios_share" iconSize={20} label="Share" onClick={share} bg={heroBtn.background as string} color="#0A1F4D" />
            <HeartButton on={s.wish.includes(c.id)} onClick={() => toggleWish(c.id)} size={42} iconSize={21} bg="rgba(255,255,255,.9)" />
          </div>
          <div style={{ position: 'absolute', left: 24, bottom: 56 }}>
            <div style={{ font: font(700, 12), opacity: 0.7 }}>No. {c.num}</div>
            <div style={{ font: font(800, 10), letterSpacing: '.16em', marginTop: 6, opacity: 0.85 }}>{c.subject.toUpperCase()}</div>
          </div>
        </div>

        <div style={{ marginTop: -30, position: 'relative', background: '#F4F5FA', borderRadius: '30px 30px 0 0', padding: '24px 20px 20px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[c.level, c.grade].map((t) => (
              <span key={t} style={{ height: 26, padding: '0 10px', borderRadius: 13, background: 'var(--tint)', color: '#0B4FB3', font: font(800, 11, '26px') }}>{t}</span>
            ))}
            <span style={{ height: 26, padding: '0 10px', borderRadius: 13, background: '#E2F6EA', color: '#0F7A3D', font: font(800, 11, '26px') }}>Certificate</span>
          </div>
          <h1 style={{ ...display(700, 26, 1.05), margin: '12px 0 0', textWrap: 'balance' }}>{c.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#0A1F4D', color: '#3DD6CF', display: 'grid', placeItems: 'center', font: font(800, 13) }}>{initialsOf(c.instructor)}</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>{c.instructor}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.role}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 18 }}>
            {stat(<><Icon name="star" size={16} fill color="var(--star)" />{c.rating}</>, `${c.reviews} reviews`)}
            {stat(c.students, 'students')}
            {stat(`${c.hours}h`, 'content')}
            {stat(c.lessons, 'lessons')}
          </div>

          <TabLine options={TABS} value={tab} onChange={setTab} style={{ marginTop: 22 }} />

          {tab === 'About' && (
            <div className="fade-in">
              <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-2)', margin: '16px 0 0', textWrap: 'pretty' }}>{c.desc}</p>
              <div style={{ ...display(700, 17), marginTop: 18 }}>What you&apos;ll learn</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {c.learn.map((l) => (
                  <div key={l} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.45 }}>
                    <Icon name="check_circle" size={19} color="#0172EA" />
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'Curriculum' && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {MODULES.map((m, i) => {
                const open = owned || i < 1;
                return (
                  <div key={m} onClick={open ? () => router.push(owned ? `/learn/${c.id}` : `/learn/${c.id}?preview=1`) : undefined} style={{ background: '#fff', borderRadius: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: open ? 'pointer' : undefined }}>
                    <div style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center', font: font(800, 13) }}>{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{m}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {6 + i * 2} lessons · {2 + i}h {10 * i + 15}m
                      </div>
                    </div>
                    <Icon name={open ? 'play_circle' : 'lock'} size={20} color={open ? '#0172EA' : '#B3B8C7'} />
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'Reviews' && (
            <div className="fade-in">
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 16, background: '#fff', borderRadius: 20, padding: 16 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={display(700, 39, 1.05)}>{c.rating}</div>
                  <Stars />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{c.reviews} reviews</div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {RATING_BARS.map(([n, w]) => (
                    <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                      <span>{n}</span>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--tint)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${w}%`, background: '#3DD6CF' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {REVIEWS.map((r) => (
                  <div key={r.n} style={{ background: '#fff', borderRadius: 18, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center', font: font(800, 12) }}>{r.i}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{r.n}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.m}</div>
                      </div>
                      <Stars size={13} />
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', marginTop: 10 }}>{r.t}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <BottomBar animate>
        {owned ? (
          <button onClick={() => router.push(`/learn/${c.id}`)} style={{ ...primaryBtn(54), flex: 1 }}>
            <Icon name="play_arrow" size={22} fill />
            Continue learning
          </button>
        ) : (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={display(700, 24, 1.05)}>{fmt(c.price)}</span>
                <span style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'line-through' }}>{fmt(c.mrp)}</span>
              </div>
              <div style={{ font: font(800, 11), color: 'var(--green)', marginTop: 2 }}>{offPct(c.price, c.mrp)} · ends tonight</div>
            </div>
            <button aria-label={inCart ? 'Go to cart' : 'Add to cart'} onClick={onCart} style={{ width: 52, height: 52, flex: 'none', borderRadius: 26, border: '1.5px solid #0A1F4D', background: inCart ? '#0A1F4D' : 'transparent', color: inCart ? '#F4F5FA' : '#0A1F4D', display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'all .25s' }}>
              <Icon name={inCart ? 'shopping_bag' : 'add_shopping_cart'} size={22} />
            </button>
            <button onClick={buyNow} className="press press-96" style={{ ...primaryBtn(52, 14.5), padding: '0 24px' }}>
              Buy now
            </button>
          </>
        )}
      </BottomBar>
    </>
  );
}
