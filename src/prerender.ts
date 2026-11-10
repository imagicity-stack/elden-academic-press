// A book page arrives ready-made from the server (server/routes/og.ts → bookPage), so its content
// is there before any script runs. Meanwhile the app renders out of sight (a CSS rule in that
// page hides #root while #prerender exists); when the app's own page is ready, this removes the
// ready-made copy, before the browser paints, so the swap shows no blank frame.
export function dropPrerender() {
  document.getElementById('prerender')?.remove();
}

/** Remove the ready-made copy if the app is now showing a different address (it belongs to one page). */
export function dropPrerenderUnless(pathname: string) {
  const el = document.getElementById('prerender');
  if (el && el.dataset.path !== pathname) el.remove();
}
