import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rendererOutput = fileURLToPath(new URL('./dist/renderer', import.meta.url));

function pruneDisabledAvatarAssets() {
  const disabledPaths = ['avatar'];
  return {
    name: 'athena-prune-disabled-avatar-assets',
    closeBundle() {
      for (const relativePath of disabledPaths) {
        rmSync(fileURLToPath(new URL(relativePath, `file:///${rendererOutput.replace(/\\/g, '/')}/`)), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: '../../assets',
  plugins: [pruneDisabledAvatarAssets()],
  server: {
    port: 3000,
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
    },
  },
});
