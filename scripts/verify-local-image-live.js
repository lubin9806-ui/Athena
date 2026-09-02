const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');

(async () => {
  await app.whenReady();
  const artifacts = require(path.join(root, 'dist', 'core', 'artifacts', 'index.js'));
  const { DEFAULT_SETTINGS } = require(path.join(root, 'dist', 'core', 'config', 'SettingsStore.js'));
  const imageSettings = structuredClone(DEFAULT_SETTINGS.imageGeneration);
  imageSettings.provider = 'local';
  imageSettings.local.engine = 'comfyui';
  imageSettings.local.autoDiscover = true;
  imageSettings.local.profile = 'fast';
  const router = new artifacts.ImageGenerationRouter({
    settingsResolver: () => imageSettings,
    decodeValidator: bytes => {
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('Electron could not decode the local image result');
      return image.getSize();
    },
  });
  const discovery = await router.refreshLocalDiscovery(AbortSignal.timeout(10_000));
  const hasSupportedWorkflow = discovery.comfyui.checkpoints.length > 0
    || discovery.comfyui.workflows.includes('z-image-turbo');
  if (!discovery.comfyui.connected || !hasSupportedWorkflow) {
    throw new Error('Live local proof requires a running ComfyUI with a checkpoint or supported split-model workflow');
  }
  const generated = await router.generate({
    prompt: 'A quiet midnight observatory above a luminous futuristic city, clean cinematic concept art, no text',
    size: '1024x1024',
    quality: 'low',
    outputFormat: 'png',
  }, AbortSignal.timeout(10 * 60_000));
  const proofRoot = path.join(root, 'artifacts', 'image-generation');
  fs.mkdirSync(proofRoot, { recursive: true });
  const proofPath = path.join(proofRoot, 'local-comfyui-live-proof.png');
  fs.writeFileSync(proofPath, generated.bytes);
  console.log(`ATHENA_LOCAL_IMAGE_LIVE_OK engine=${generated.usage?.engine} model=${generated.model} size=${generated.width}x${generated.height} output=${proofPath}`);
})().then(() => {
  app.quit();
}).catch(error => {
  console.error(error?.stack || error);
  app.exit(1);
});
