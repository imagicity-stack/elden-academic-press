// Meta test mode panel (eldenap.in/?meta-test): what the Pixel needs on this page, live.
import { useEffect, useState, type CSSProperties } from 'react';
import { getConsent, leaveMetaTest } from '../consent';

const PIXEL = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim();

const box: CSSProperties = {
  position: 'fixed', left: 16, bottom: 16, zIndex: 85, width: 'min(420px, calc(100vw - 32px))', padding: '14px 16px',
  background: '#FFFFFF', color: '#0B1220', border: '2px solid #0B1220', boxShadow: '0 20px 50px -20px rgba(11,18,32,.5)',
  font: "400 13px/1.45 'Geist Variable', system-ui, sans-serif",
};

export function MetaStatus({ live, staffPreview }: { live: boolean; staffPreview: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const consent = getConsent();
  const fullSite = live || staffPreview;
  const requested = Boolean(document.querySelector('script[src*="connect.facebook.net"]'));
  const running = Boolean((window as { fbq?: { callMethod?: unknown } }).fbq?.callMethod);
  const rows: [boolean, string][] = [
    [Boolean(PIXEL), PIXEL ? `Pixel ID in this version of the site: ${PIXEL}` : 'No Pixel ID in this version of the site. Add VITE_META_PIXEL_ID in Vercel (Production), then redeploy.'],
    [fullSite, live ? 'The store is live.' : staffPreview ? 'Store preview (you’re signed in to the admin). Visitors still see the coming-soon page, which has no Pixel.' : 'This is the coming-soon page, which has no Pixel. Sign in to /admin to preview the store, or launch it (VITE_SITE_LIVE=true).'],
    ...(fullSite ? [[consent === 'all', consent === 'all' ? 'Cookies: Accept all.' : consent === 'essential' ? 'Cookies: Only essential. Click “Cookie settings” at the bottom of the page → Accept all.' : 'Cookies: not chosen yet. Press “Accept all” on the banner.'] as [boolean, string]] : []),
    [running, running ? 'Meta Pixel is running: the Pixel Helper and Test events should see it.' : requested ? 'The Pixel script was blocked: turn off ad blockers or Brave Shields for this site.' : 'Meta Pixel not loaded yet (fix the items above).'],
  ];
  return (
    <div style={box} role="status">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>Meta test mode</b>
        <button type="button" onClick={leaveMetaTest} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', textDecoration: 'underline', cursor: 'pointer', color: '#0B1220' }}>Exit</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {rows.map(([ok, text]) => (
          <li key={text} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 6 }}>
            <span aria-hidden="true" style={{ color: ok ? '#0F7A4F' : '#C42D1C', fontWeight: 700 }}>{ok ? '✓' : '✗'}</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: '8px 0 0', color: '#576072', fontSize: 12 }}>Your admin sign-in is ignored in this tab, so your visits and test orders reach Meta.</p>
    </div>
  );
}
