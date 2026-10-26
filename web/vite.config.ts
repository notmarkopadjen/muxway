/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The build lands in dist/, which the hub embeds. assetsInlineLimit 0 keeps
// the font and the icon as files: the content security policy allows no
// data: URLs.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/v1': { target: 'https://127.0.0.1:7600', secure: false } },
  },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
