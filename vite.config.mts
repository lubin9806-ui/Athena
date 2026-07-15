import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: '../../assets',
  server: {
    port: 3000,
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
    },
  },
});
