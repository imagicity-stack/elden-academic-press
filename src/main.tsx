import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WithIntro } from './components/Intro';
import { ComingSoon } from './pages/ComingSoon';
import './styles.css';

// Set VITE_SITE_LIVE=true (e.g. in Vercel → Project → Settings → Environment
// Variables) and redeploy to launch the full site. Anything else shows the
// coming-soon page on every URL. Vite reads this at build time.
const live = import.meta.env.VITE_SITE_LIVE === 'true';

// After a new deployment, a page that was already open still asks for the
// previous build's files, which are gone. Reload once to pick up the new build;
// if that doesn't help, the error screen below takes over.
const RELOADED = 'elden-reloaded-at';
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - (Number(sessionStorage.getItem(RELOADED)) || 0) < 10_000) return;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// Loaded only when needed, so the coming-soon page doesn't ship the whole site
// and store visitors never download the admin.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
const AdminApp = lazy(() => import('./admin/AdminApp'));

// The admin works whether or not the store is live, so products can be set up before launch.
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

// Before launch, staff signed in to /admin in this browser see the full site,
// to check it and place test orders. Signing out of the admin ends the preview.
const staffPreview = !live && (() => {
  try { return Boolean(localStorage.getItem('elden-admin-auth')); } catch { return false; }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isAdmin ? (
        <BrowserRouter>
          <Suspense fallback={null}><AdminApp /></Suspense>
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
