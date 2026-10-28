import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs separately (the quickstart server on :8787); Vite forwards /v1 to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': process.env.HARNESS_URL ?? 'http://localhost:8787' },
  },
  build: { target: 'es2022', sourcemap: true },
});
