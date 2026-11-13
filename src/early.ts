// The first script on every page, kept tiny (no React, no app code): it starts the Meta Pixel and
// counts the page view as soon as the visitor's cookie choice is known, instead of after the whole
// app has downloaded. On slow phone data that wait was about 10 seconds, and most people who tapped
// an ad had left by then, so Meta never saw them arrive. The app imports the same modules, so there
// is one Pixel and one page view (src/meta.ts skips a second PageView for the same address).
import { track } from './meta';
import { applySiteConsentMode } from './consent';
import { loadStoreConfig } from './store/config';

if (!/^\/admin(\/|$)/.test(location.pathname)) {
  // A visitor who already chose "Accept all": count the page now.
  track('PageView');
  // The cookie switch (Admin → Settings → Cookies & tracking). index.html has already started this
  // download; when it says the banner is off, consent.ts announces "all" and meta.ts counts the page.
  loadStoreConfig().then((c) => applySiteConsentMode(Boolean(c.consentAuto)), () => {});
}
