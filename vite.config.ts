import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { getRequestListener } from '@hono/node-server';

/**
 * Runs the /api server inside Vite's dev server, reloading server code on
 * change. Locally it uses an embedded database, a payment simulator and a
 * developer admin login unless real keys are set in .env.local.
 */
function storeApi(): Plugin {
  return {
    name: 'elden-store-api',
    configureServer(server) {
      process.env.ALLOW_DEV_ADMIN ??= 'true';
      process.env.ALLOW_PAYMENT_SIMULATOR ??= 'true';
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/') && !req.url?.startsWith('/feeds/') && !req.url?.startsWith('/.well-known/oauth-') && req.url !== '/sitemap.xml') return next();
        try {
          const { createApp } = await server.ssrLoadModule('/server/app.ts');
          const { getDeps } = await server.ssrLoadModule('/server/deps.ts');
          await getRequestListener(createApp(getDeps).fetch)(req, res);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

/**
 * src/main.tsx is kept small (it starts the Meta Pixel) and loads the app with import('./boot').
 * Left alone, the browser would only discover the app's files once main.tsx has run; this lists
 * them in the page (modulepreload, and the app's CSS as a non-blocking preload), so they download
 * alongside main.tsx and the app starts as early as before.
 */
function preloadApp(): Plugin {
  return {
    name: 'elden-preload-app',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const isBoot = (id: string) => id.replace(/\\/g, '/').endsWith('/src/boot.tsx');
        const boot = Object.values(bundle).find((c) => c.type === 'chunk' && c.moduleIds.some(isBoot));
        if (!boot || boot.type !== 'chunk') throw new Error('preloadApp: no chunk holds src/boot.tsx');
        const js = new Set<string>();
        const css = new Set<string>();
        const walk = (name: string) => {
          const c = bundle[name];
          if (!c || c.type !== 'chunk' || js.has(name)) return;
          js.add(name);
          for (const f of c.viteMetadata?.importedCss ?? []) css.add(f);
          c.imports.forEach(walk);
        };
        walk(boot.fileName);
        const fresh = (f: string) => !html.includes(`/${f}"`);
        return [
          ...[...js].filter(fresh).map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${f}` }, injectTo: 'head' as const })),
          ...[...css].filter(fresh).map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'style', crossorigin: true, href: `/${f}` }, injectTo: 'head' as const })),
        ];
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-side variables (no VITE_ prefix) for the dev API.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[k] ??= v;
  return {
    plugins: [react(), storeApi(), preloadApp()],
    build: { chunkSizeWarningLimit: 700 },
  };
});
