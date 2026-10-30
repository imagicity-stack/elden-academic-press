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
        if (!req.url?.startsWith('/api/')) return next();
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

export default defineConfig(({ mode }) => {
  // Server-side variables (no VITE_ prefix) for the dev API.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[k] ??= v;
  return {
    plugins: [react(), storeApi()],
    build: { chunkSizeWarningLimit: 700 },
  };
});
