import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WithIntro } from './components/Intro';
import { ComingSoon } from './pages/ComingSoon';
import './styles.css';

// Set VITE_SITE_LIVE=true (e.g. in Vercel → Project → Settings → Environment
// Variables) and redeploy to launch the full site. Anything else shows the
// coming-soon page on every URL. Vite reads this at build time.
const live = import.meta.env.VITE_SITE_LIVE === 'true';

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
  </StrictMode>,
);
