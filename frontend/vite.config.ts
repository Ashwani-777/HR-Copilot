import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Backend for the dev proxy. Override with VITE_BACKEND_URL (shell env or frontend/.env).
  const env = loadEnv(mode, process.cwd(), '');
  const backend = process.env.VITE_BACKEND_URL ?? env.VITE_BACKEND_URL ?? 'http://localhost:4100';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/socket.io': { target: backend, changeOrigin: true, ws: true },
      },
    },
    preview: { port: 5173 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
