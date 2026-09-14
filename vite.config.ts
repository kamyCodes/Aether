import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
// Ports come from the shared resolver (server/config.ts) — the single place
// a port default may be declared (audit Section 2). No literals here.
import { PORT, VITE_PORT, OMNI_PORT, LOOPBACK_HOST } from './server/config';

export default defineConfig(({ mode }) => {
  // loadEnv keeps .env-file support (those vars are not in process.env);
  // explicit process.env wins via the resolver defaults.
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = Number(env.PORT) > 0 ? Number(env.PORT) : PORT;
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      port: VITE_PORT,
      proxy: {
        '/api': { target: `http://${LOOPBACK_HOST}:${serverPort}`, changeOrigin: true },
        '/ws': { target: `ws://${LOOPBACK_HOST}:${serverPort}`, ws: true },
        '/omni': {
          target: `http://${LOOPBACK_HOST}:${OMNI_PORT}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/omni/, ''),
        },
      },
    },
  };
});
