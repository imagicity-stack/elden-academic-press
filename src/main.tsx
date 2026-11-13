// The page's first script, kept small: the Meta Pixel starts (src/early.ts), then the app (src/boot.tsx),
// whose files the browser is already downloading alongside this one (vite.config.ts adds them to the page).
import './early';

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

import('./boot');
