import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite only builds static client assets. This is not a Node production server.
// The development proxy preserves one browser origin for the Go API and SO/IL.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/kash/v1': 'http://127.0.0.1:8080', '/app/api': 'http://127.0.0.1:8080' } },
  build: { target: 'es2022', sourcemap: false },
});
