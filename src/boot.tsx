import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MetaStatus } from './components/MetaStatus';
import { metaTestMode } from './consent';
import { WithIntro } from './components/Intro';
import { legalDocFor } from './legal';
import { recordVisit } from './attribution';
import { ComingSoon } from './pages/ComingSoon';
import './styles.css';

// Started by src/main.tsx, right after the Meta Pixel (src/early.ts).

// Set VITE_SITE_LIVE=true (e.g. in Vercel → Project → Settings → Environment
// Variables) and redeploy to launch the full site. Anything else shows the
// coming-soon page on every URL. Vite reads this at build time.
const live = import.meta.env.VITE_SITE_LIVE === 'true';

// Loaded only when needed, so the coming-soon page doesn't ship the whole site
// and store visitors never download the admin.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
const AdminApp = lazy(() => import('./admin/AdminApp'));
const LegalStandalone = lazy(() => import('./pages/Legal').then((m) => ({ default: m.LegalStandalone })));

// The admin works whether or not the store is live, so products can be set up before launch.
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

// How this visitor reached the site, kept for their order (not for the admin's own visits).
if (!isAdmin) recordVisit();

// The cookie switch (Admin → Settings → Cookies & tracking) is read on every page load by src/early.ts,
// which also starts the Meta Pixel before this app has downloaded.

// Before launch, staff signed in to /admin in this browser see the full site,
// to check it and place test orders. Signing out of the admin ends the preview.
const staffPreview = !live && (() => {
  try { return Boolean(localStorage.getItem('elden-admin-auth')); } catch { return false; }
})();

// The policies are public before launch too (payment providers check them), and
// so is /newsletter, where the confirm and unsubscribe links in emails land.
const prelaunchPolicy = !live && !staffPreview
  && (Boolean(legalDocFor(window.location.pathname)) || window.location.pathname.replace(/\/+$/, '') === '/newsletter');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {!isAdmin && metaTestMode() && <MetaStatus live={live} staffPreview={staffPreview} />}
    <ErrorBoundary>
      {isAdmin ? (
        <BrowserRouter>
          <Suspense fallback={null}><AdminApp /></Suspense>
        </BrowserRouter>
      ) : prelaunchPolicy ? (
        <BrowserRouter>
          <Suspense fallback={null}><LegalStandalone /></Suspense>
        </BrowserRouter>
      ) : (
        <WithIntro>
          {live || staffPreview ? (
            <BrowserRouter>
              <Suspense fallback={null}><App /></Suspense>
              {staffPreview && (
                <div className="preview-bar" role="status">
                  Preview: visitors still see the coming-soon page. <a href="/admin">Admin</a>
                </div>
              )}
            </BrowserRouter>
          ) : (
            <ComingSoon />
          )}
        </WithIntro>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
