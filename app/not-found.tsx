import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/elmaster-mark.png" alt="" style={{ height: 70 }} />
        <h1 style={{ font: '700 24px var(--fd)', letterSpacing: '-.025em', margin: '16px 0 0' }}>This page is off the shelf</h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 20px' }}>We couldn’t find what you were looking for.</p>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', height: 48, padding: '0 24px', borderRadius: 24, background: '#0A1F4D', color: '#F4F5FA', font: '800 14px var(--fb)' }}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
