import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ComingSoon } from './pages/ComingSoon';
import './styles.css';

// Set VITE_SITE_LIVE=true (e.g. in Vercel → Project → Settings → Environment
// Variables) and redeploy to launch the full site. Anything else shows the
// coming-soon page on every URL. Vite reads this at build time.
const live = import.meta.env.VITE_SITE_LIVE === 'true';

// Loaded only when live, so the coming-soon build doesn't ship the whole site.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {live ? (
      <BrowserRouter>
        <Suspense fallback={null}><App /></Suspense>
      </BrowserRouter>
    ) : (
      <ComingSoon />
    )}
  </StrictMode>,
);
