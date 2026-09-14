import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The client is static output under dist/client, served by Caddy. In dev,
// /api is forwarded to the Activity server so both halves run locally.
export default defineConfig({
  root: 'src/client',
  envDir: '../..',
  plugins: [react(), tailwind()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:3100' } },
});
