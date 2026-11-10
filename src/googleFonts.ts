// The admin's and the coming-soon page's fonts (Cormorant Garamond, Montserrat, JetBrains Mono,
// Caveat), from Google Fonts. The store's own pages use the bundled fonts in fonts.ts, so this
// is loaded only by the pages that need it, never in front of the store.
const HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Montserrat:wght@400;500;600;700&family=JetBrains+Mono:wght@400&family=Caveat:wght@500;600&display=swap';

export function loadGoogleFonts() {
  if (document.querySelector(`link[href="${HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = HREF;
  document.head.appendChild(link);
}
