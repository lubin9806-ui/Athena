import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rendererOutput = fileURLToPath(new URL('./dist/renderer', import.meta.url));

function prunePrivateAvatarSources() {
  const privatePaths = [
    'avatar/athena-live2d-default/source',
    'avatar/athena-live2d-default/CUBISM_EXPORT_RUNBOOK.md',
    'avatar/athena-live2d-default/layer-map.json',
    'avatar/athena-live2d-default/README.md',
    'avatar/athena-3d-default',
  ];
  return {
    name: 'athena-prune-private-avatar-sources',
    closeBundle() {
      for (const relativePath of privatePaths) {
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
  plugins: [prunePrivateAvatarSources()],
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
        live2dPreview: fileURLToPath(new URL('./src/renderer/live2d-preview.html', import.meta.url)),
        live2dPet: fileURLToPath(new URL('./src/renderer/live2d-pet.html', import.meta.url)),
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
