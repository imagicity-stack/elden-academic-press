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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <BrowserRouter>
        <Suspense fallback={null}><AdminApp /></Suspense>
      </BrowserRouter>
    ) : (
      <WithIntro>
        {live ? (
          <BrowserRouter>
            <Suspense fallback={null}><App /></Suspense>
          </BrowserRouter>
        ) : (
          <ComingSoon />
        )}
      </WithIntro>
    )}
  </StrictMode>,
);
