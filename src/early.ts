// The first script on every page, kept tiny (no React, no app code): it starts the Meta Pixel and
// counts the page view straight away, instead of after the whole
// app has downloaded. On slow phone data that wait was about 10 seconds, and most people who tapped
// an ad had left by then, so Meta never saw them arrive. The app imports the same modules, so there
// is one Pixel and one page view (src/meta.ts skips a second PageView for the same address).
import { track } from './meta';
import { startEngagedVisit } from './engagedVisit';

// Count the page now (meta.ts skips it on the admin, for staff and for younger signed-in students).
track('PageView');
// EngagedVisit: 15 seconds of visible time or half-way down a page, once per session (src/engagement.ts).
startEngagedVisit();
