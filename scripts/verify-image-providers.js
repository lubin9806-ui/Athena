const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const { nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-image-providers-'));
process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
process.env.ATHENA_CREDENTIALS_DIR = path.join(scratch, 'credentials');

const artifacts = require(path.join(root, 'dist', 'core', 'artifacts', 'index.js'));
const { DEFAULT_SETTINGS } = require(path.join(root, 'dist', 'core', 'config', 'SettingsStore.js'));
const png = makePng(3, 2);
const request = { prompt: 'A low-cost provider contract fixture', size: '1024x1024', quality: 'low', outputFormat: 'png' };
const decodeValidator = bytes => nativeImage.createFromBuffer(bytes).getSize();
const credentials = () => 'fixture-key-never-persist';

(async () => {
  assert.equal(DEFAULT_SETTINGS.imageGeneration.provider, 'local');
  assert.equal(DEFAULT_SETTINGS.imageGeneration.cloudFallback, 'never');
  assert.deepEqual(artifacts.IMAGE_PROVIDER_DESCRIPTORS.map(item => item.id), [
    'local', 'openai', 'google', 'stability', 'bfl', 'volcengine', 'dashscope', 'replicate', 'fal', 'custom',
  ]);
  assert.equal(artifacts.IMAGE_PROVIDER_DESCRIPTORS.find(item => item.id === 'local').credentialRequired, false);

  const runtimeArchive = await new JSZip()
    .file('stable-diffusion.cpp/bin/sd-cli.exe', Buffer.from('MZ-athena-runtime-fixture'))
    .file('stable-diffusion.cpp/bin/runtime.dll', Buffer.from('fixture-dll'))
    .generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const runtimeManifestPath = path.join(scratch, 'runtime-manifest.json');
  const runtimeInstallBase = path.join(scratch, 'runtime-install');
  fs.writeFileSync(runtimeManifestPath, JSON.stringify({
    schemaVersion: 1,
    engine: 'stable-diffusion.cpp',
    executable: 'sd-cli.exe',
    releaseTag: 'fixture-release',
    variants: [{
      id: 'cpu',
      label: 'CPU fixture',
      backend: 'cpu',
      archiveName: 'fixture-runtime.zip',
      downloadUrl: 'https://github.com/leejet/stable-diffusion.cpp/releases/download/fixture/fixture-runtime.zip',
      downloadBytes: runtimeArchive.length,
      sha256: crypto.createHash('sha256').update(runtimeArchive).digest('hex'),
      releaseTag: 'fixture-release',
      recommendedFor: 'fixture',
    }],
  }));
  const runtimeProgress = [];
  const runtimeManager = new artifacts.LocalImageRuntimeManager({
    manifestPath: runtimeManifestPath,
    installBase: runtimeInstallBase,
    fetcher: async () => new Response(runtimeArchive, { status: 200 }),
  });
  assert.deepEqual(runtimeManager.variants().map(item => item.id), ['cpu']);
  const installedRuntime = await runtimeManager.install('cpu', progress => runtimeProgress.push(progress.phase), signal());
  assert.equal(installedRuntime.reused, false);
  assert.equal(fs.existsSync(installedRuntime.runtimePath), true);
  assert(runtimeProgress.includes('verifying'));
  assert(runtimeProgress.includes('extracting'));
  assert.equal(runtimeProgress.at(-1), 'complete');
  const reusedRuntime = await runtimeManager.install('cpu', () => undefined, signal());
  assert.equal(reusedRuntime.reused, true);
  fs.appendFileSync(reusedRuntime.runtimePath, Buffer.from('tampered'));
  const repairedRuntime = await runtimeManager.install('cpu', () => undefined, signal());
  assert.equal(repairedRuntime.reused, false);
  assert.equal(fs.readFileSync(repairedRuntime.runtimePath, 'utf8'), 'MZ-athena-runtime-fixture');

  const google = new artifacts.GoogleImageGenerationProvider(options('google', 'gemini-image', 'https://google.example/interactions', async () => (
    json({ id: 'google-1', output: [{ type: 'image', data: png.toString('base64') }] })
  )));
  assert.equal((await google.generate(request, signal())).provider, 'google');

  const stability = new artifacts.StabilityImageGenerationProvider(options('stability', 'core', 'https://stability.example/generate', async (_url, init) => {
    assert(init.body instanceof FormData);
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  }));
  assert.equal((await stability.generate(request, signal())).format, 'png');

  let bflPolls = 0;
  const bfl = new artifacts.BflImageGenerationProvider(options('bfl', 'flux-2-klein-4b', 'https://api.bfl.ai/v1', async (url, init) => {
    if (String(url).includes('/flux-2-klein-4b')) return json({ id: 'bfl-1', polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-1' });
    if (String(url).includes('get_result')) { bflPolls += 1; return json({ status: 'Ready', result: { sample: 'https://delivery.test.bfl.ai/image.png' } }); }
    if (String(url).includes('delivery.test.bfl.ai')) return new Response(png, { status: 200 });
    throw new Error(`Unexpected BFL URL ${url} ${init?.method}`);
  }));
  assert.equal((await bfl.generate(request, signal())).requestId, 'bfl-1');
  assert.equal(bflPolls, 1);

  const compatible = new artifacts.OpenAICompatibleImageGenerationProvider(options('volcengine', 'seedream-fixture', 'https://ark.example/api/v3/images/generations', async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.response_format, 'url');
    return json({ data: [{ b64_json: png.toString('base64') }] });
  }));
  assert.equal((await compatible.generate(request, signal())).provider, 'volcengine');

  const dashscope = new artifacts.DashScopeImageGenerationProvider(options('dashscope', 'wanx-v1', 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', async url => {
    const value = String(url);
    if (value.includes('image-synthesis')) return json({ request_id: 'ds-submit', output: { task_id: 'ds-1', task_status: 'PENDING' } });
    if (value.includes('/tasks/ds-1')) return json({ request_id: 'ds-result', output: { task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/image.png' }] } });
    if (value.includes('oss-cn-shanghai')) return new Response(png, { status: 200 });
    throw new Error(`Unexpected DashScope URL ${url}`);
  }));
  assert.equal((await dashscope.generate(request, signal())).requestId, 'ds-result');

  const replicate = new artifacts.ReplicateImageGenerationProvider(options('replicate', 'black-forest-labs/flux-schnell', 'https://api.replicate.com/v1/models', async url => {
    if (String(url).includes('/predictions')) return json({ id: 'rep-1', status: 'succeeded', output: ['https://replicate.delivery/image.png'], metrics: { predict_time: 1.2 } });
    if (String(url).includes('replicate.delivery')) return new Response(png, { status: 200 });
    throw new Error(`Unexpected Replicate URL ${url}`);
  }));
  assert.equal((await replicate.generate(request, signal())).provider, 'replicate');

  const fal = new artifacts.FalImageGenerationProvider(options('fal', 'fal-ai/flux/schnell', 'https://queue.fal.run', async url => {
    const value = String(url);
    if (value === 'https://queue.fal.run/fal-ai/flux/schnell') return json({ request_id: 'fal-1', status_url: 'https://queue.fal.run/status/fal-1', response_url: 'https://queue.fal.run/result/fal-1' });
    if (value.includes('/status/')) return json({ status: 'COMPLETED' });
    if (value.includes('/result/')) return json({ images: [{ url: 'https://fal.media/image.png' }] });
    if (value.includes('fal.media')) return new Response(png, { status: 200 });
    throw new Error(`Unexpected fal URL ${url}`);
  }));
  assert.equal((await fal.generate(request, signal())).requestId, 'fal-1');

  const comfy = new artifacts.ComfyUIImageGenerationProvider({
    baseUrl: 'http://127.0.0.1:8188',
    checkpoint: '',
    discoveryResolver: async () => ({
      scannedAt: new Date().toISOString(),
      models: [],
      comfyui: {
        connected: true,
        baseUrl: 'http://127.0.0.1:8188',
        checkpoints: ['fixture.safetensors'],
        diffusionModels: [],
        textEncoders: [],
        vaes: [],
        workflows: ['checkpoint'],
      },
    }),
    decodeValidator,
    fetcher: async (url, init) => {
      const value = String(url);
      if (value.endsWith('/prompt')) {
        const body = JSON.parse(init.body);
        assert.equal(body.prompt['4'].inputs.ckpt_name, 'fixture.safetensors');
        return json({ prompt_id: 'comfy-1' });
      }
      if (value.includes('/history/comfy-1')) return json({ 'comfy-1': { outputs: { '9': { images: [{ filename: 'fixture.png', subfolder: '', type: 'output' }] } } } });
      if (value.includes('/view?')) return new Response(png, { status: 200 });
      throw new Error(`Unexpected ComfyUI URL ${url}`);
    },
  });
  const comfyResult = await comfy.generate(request, signal());
  assert.equal(comfyResult.provider, 'local');
  assert.equal(comfyResult.usage.engine, 'comfyui');

  const zImage = new artifacts.ComfyUIImageGenerationProvider({
    baseUrl: 'http://127.0.0.1:8188',
    checkpoint: '',
    discoveryResolver: async () => ({
      scannedAt: new Date().toISOString(),
      models: [],
      comfyui: {
        connected: true,
        baseUrl: 'http://127.0.0.1:8188',
        checkpoints: ['incomplete.safetensors'],
        diffusionModels: ['z_image_turbo_bf16.safetensors'],
        textEncoders: ['qwen_3_4b.safetensors'],
        vaes: ['ae.safetensors'],
        workflows: ['checkpoint', 'z-image-turbo'],
      },
    }),
    decodeValidator,
    fetcher: async (url, init) => {
      const value = String(url);
      if (value.endsWith('/prompt')) {
        const body = JSON.parse(init.body);
        assert.equal(body.prompt['1'].class_type, 'UNETLoader');
        assert.equal(body.prompt['2'].inputs.type, 'lumina2');
        assert.equal(body.prompt['8'].inputs.sampler_name, 'res_multistep');
        assert.equal(body.prompt['6'].inputs.width, 512);
        return json({ prompt_id: 'z-image-1', node_errors: {} });
      }
      if (value.includes('/history/z-image-1')) return json({ 'z-image-1': { status: { status_str: 'success' }, outputs: { '10': { images: [{ filename: 'z.png', subfolder: '', type: 'output' }] } } } });
      if (value.includes('/view?')) return new Response(png, { status: 200 });
      throw new Error(`Unexpected Z-Image ComfyUI URL ${url}`);
    },
  });
  const zImageResult = await zImage.generate(request, signal());
  assert.equal(zImageResult.model, 'Z-Image Turbo (split components)');
  assert.equal(zImageResult.usage.workflow, 'z-image-turbo');

  const fixtureModel = path.join(scratch, 'fixture-model.safetensors');
  fs.writeFileSync(fixtureModel, Buffer.alloc(1024 * 1024 + 1, 7));
  const discoveredModels = artifacts.discoverLocalModels(fixtureModel, signal());
  assert(discoveredModels.some(model => model.path === fixtureModel));

  const fallbackSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.imageGeneration));
  fallbackSettings.provider = 'custom';
  fallbackSettings.cloudFallback = 'ask';
  fallbackSettings.remote.custom = { model: 'fixture-model', baseUrl: 'https://custom.example/v1/images/generations' };
  process.env.ATHENA_CUSTOM_IMAGE_API_KEY = 'fixture-key-never-persist';
  const router = new artifacts.ImageGenerationRouter({
    settingsResolver: () => fallbackSettings,
    decodeValidator,
    fetcher: async () => json({ error: { message: 'fixture failure' } }, 503),
  });
  await assert.rejects(
    router.generate(request, signal()),
    error => /没有自动切换或重试付费通道/.test(String(error?.message)),
  );
  delete process.env.ATHENA_CUSTOM_IMAGE_API_KEY;

  const localStatus = artifacts.getLocalImageRuntimeStatus(DEFAULT_SETTINGS.imageGeneration);
  assert.equal(localStatus.ready, false);
  assert.match(localStatus.message, /独立生图引擎/);
  assert.match(localStatus.message, /ComfyUI/);

  console.log('ATHENA_IMAGE_PROVIDERS_OK channels=10 local=stable-diffusion-cpp+comfyui discovery=bounded cloud=openai,google,stability,bfl,volcengine,dashscope,replicate,fal,custom fallback=never');
})().then(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}).catch(error => {
  console.error(error?.stack || error);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
});

function options(provider, model, baseUrl, fetcher) {
  return { provider, settingsResolver: () => ({ model, baseUrl }), credentialResolver: credentials, decodeValidator, fetcher };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function signal() { return new AbortController().signal; }

function makePng(width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 4);
    for (let column = 0; column < width; column += 1) {
      const pixel = start + 1 + column * 4;
      rows[pixel] = 42; rows[pixel + 1] = 124; rows[pixel + 2] = 88; rows[pixel + 3] = 255;
    }
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
