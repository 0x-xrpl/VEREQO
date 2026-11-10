import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    // Preserve the browser Host: same-origin GETs omit Origin, and wallet status
    // must resolve the same origin-scoped registry as challenge/verify POSTs.
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false } },
    fs: { deny: ['**/services/**', '**/.local/**', '**/*.sqlite*', '**/.env*', '**/references/**'] }
  }
});
