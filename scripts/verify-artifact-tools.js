const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { nativeImage } = require('electron');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-artifact-tools-'));
const projectRoot = path.join(scratch, 'project');
process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
process.env.ATHENA_DB_FILENAME = 'artifacts.db';
fs.mkdirSync(projectRoot, { recursive: true });

const memory = require(path.join(root, 'dist', 'memory', 'index.js'));
const { AgentStore, ToolRegistry } = require(path.join(root, 'dist', 'core', 'agent', 'index.js'));
const {
  ArtifactAgentToolBridge,
  ArtifactWorkspaceService,
  DocumentArtifactService,
  OpenAIImageGenerationProvider,
  inspectImage,
} = require(path.join(root, 'dist', 'core', 'artifacts', 'index.js'));

(async () => {
  const project = memory.createProject({ title: 'Artifact Project', instructions: 'Keep outputs local.' });
  const store = new AgentStore(memory.getDatabase());
  let task = store.createTask({ projectId: project.id, title: 'Artifact task', goal: 'Create validated artifacts.' });
  task = store.transitionTask(task.id, 'ready', task.revision);
  let run = store.createRun({ taskId: task.id, provider: 'fixture', model: 'fixture' });
  run = store.startRun(run.id, run.revision);
  run = store.transitionRun(run.id, 'planning', run.revision);
  const documentStep = store.appendStep({ runId: run.id, kind: 'tool', title: 'Create document' });
  const imageStep = store.appendStep({ runId: run.id, kind: 'tool', title: 'Create image' });
  const editStep = store.appendStep({ runId: run.id, kind: 'tool', title: 'Edit image' });

  const png = makePng(2, 3);
  assert.deepEqual(inspectImage(png), { format: 'png', width: 2, height: 3 });
  assert.throws(() => inspectImage(Buffer.concat([png, Buffer.from('trailing')])), /invalid IEND/);

  const requests = [];
  const imageProvider = new OpenAIImageGenerationProvider({
    credentialResolver: () => 'sk-test-must-not-persist',
    decodeValidator: bytes => {
      const image = nativeImage.createFromBuffer(bytes);
      assert.equal(image.isEmpty(), false);
      return image.getSize();
    },
    fetcher: async (url, init) => {
      const multipart = init.body instanceof FormData;
      requests.push({
        url: String(url),
        headers: init.headers,
        body: multipart
          ? Array.from(init.body.entries()).map(([name, value]) => ({ name, type: value instanceof Blob ? value.type : 'text', value: value instanceof Blob ? value.size : value }))
          : JSON.parse(init.body),
      });
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 7 } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_fixture' },
      });
    },
  });
  const pdfRenderer = {
    render: async () => Buffer.from(`%PDF-1.7\n${'0'.repeat(1200)}\n%%EOF`),
  };
  const documents = new DocumentArtifactService(pdfRenderer);
  for (const format of ['html', 'docx', 'pdf']) {
    const rendered = await documents.render({ title: 'Format proof', format, sections: [{ heading: 'Evidence', body: 'Verified output.' }] }, new AbortController().signal);
    rendered.validate(rendered.bytes);
    assert(rendered.bytes.length > 0);
  }
  await assert.rejects(() => documents.render({ title: 'x', format: 'markdown', sections: [{ body: 'a'.repeat(200001) }] }, new AbortController().signal), /exceeds/);

  const registry = new ToolRegistry();
  let writeAllowed = true;
  let imageConsent = true;
  let credentialAvailable = true;
  const workspace = new ArtifactWorkspaceService({ store, resolveProjectRoots: () => [projectRoot] });
  const referencePath = path.join(scratch, 'reference.png');
  const maskPath = path.join(scratch, 'mask.png');
  fs.writeFileSync(referencePath, png);
  fs.writeFileSync(maskPath, png);
  const referenceImages = new Map([
    ['11111111-1111-4111-8111-111111111111', modelImage('11111111-1111-4111-8111-111111111111', 'reference.png', referencePath, png)],
    ['22222222-2222-4222-8222-222222222222', modelImage('22222222-2222-4222-8222-222222222222', 'mask.png', maskPath, png)],
  ]);
  const bridge = new ArtifactAgentToolBridge({
    registry,
    workspace,
    documents,
    images: imageProvider,
    canWriteArtifacts: () => writeAllowed,
    canGenerateImages: () => imageConsent,
    hasImageCredential: () => credentialAvailable,
    resolveReferenceImages: (_runId, ids) => ids.map(id => {
      const image = referenceImages.get(id);
      if (!image) throw new Error('Reference attachment is not owned by this run');
      return image;
    }),
  });
  assert.deepEqual(bridge.refresh(), ['create_document_artifact', 'edit_image_artifact', 'generate_image_artifact']);
  const imageTool = registry.list().find(tool => tool.name === 'generate_image_artifact');
  const editImageTool = registry.list().find(tool => tool.name === 'edit_image_artifact');
  assert.equal(imageTool.supportsIdempotencyKey, false);
  assert.match(imageTool.description, /adult fictional and synthetic subjects/);
  assert.match(imageTool.description, /photorealistic/);
  assert.match(imageTool.description, /petite, youthful-looking, anime-styled, long-lived species/);
  assert.match(imageTool.description, /Do not infer fictional age from appearance/);
  assert.match(imageTool.description, /provider may still enforce its own platform rules/i);
  assert.match(editImageTool.description, /user-declared fictional, synthetic, or AI-generated adult subject/);

  const document = await execute(registry, 'create_document_artifact', {
    title: 'Local report', format: 'markdown', filename: 'report', sections: [{ heading: 'Result', body: 'Done.' }],
  }, run.id, documentStep.id, 'document-key');
  assert.equal(document.status, 'completed');
  const documentPath = document.metadata.artifactPath;
  assert(fs.existsSync(documentPath));
  assert.equal(path.relative(projectRoot, documentPath).startsWith('..'), false);
  assert.match(fs.readFileSync(documentPath, 'utf8'), /# Local report/);
  const replayed = await execute(registry, 'create_document_artifact', {
    title: 'Local report', format: 'markdown', filename: 'report', sections: [{ heading: 'Result', body: 'Done.' }],
  }, run.id, documentStep.id, 'document-key');
  assert.equal(replayed.metadata.reused, true);
  assert.equal(store.listArtifacts(task.id, run.id).length, 1);

  const image = await execute(registry, 'generate_image_artifact', {
    prompt: 'A clean product concept', size: '1024x1024', quality: 'low', output_format: 'png', filename: 'concept',
  }, run.id, imageStep.id, 'image-key');
  assert.equal(image.status, 'completed');
  assert.equal(requests[0].url, 'https://api.openai.com/v1/images/generations');
  assert.equal(requests[0].headers.Authorization, 'Bearer sk-test-must-not-persist');
  assert.equal(requests[0].body.model, 'gpt-image-2');
  assert.equal(requests[0].body.output_format, 'png');
  const serializedArtifacts = JSON.stringify(store.listArtifacts(task.id, run.id));
  assert.doesNotMatch(serializedArtifacts, /sk-test-must-not-persist|A clean product concept/);
  assert.match(serializedArtifacts, /promptSha256/);

  const edited = await execute(registry, 'edit_image_artifact', {
    prompt: 'Preserve the subject and add a clean white background',
    reference_attachment_ids: ['11111111-1111-4111-8111-111111111111'],
    mask_attachment_id: '22222222-2222-4222-8222-222222222222',
    size: '1024x1024', quality: 'low', output_format: 'png', filename: 'edited-concept',
  }, run.id, editStep.id, 'edit-key');
  assert.equal(edited.status, 'completed');
  assert.equal(requests[1].url, 'https://api.openai.com/v1/images/edits');
  assert.equal(requests[1].headers.Authorization, 'Bearer sk-test-must-not-persist');
  assert.equal(Object.keys(requests[1].headers).some(key => key.toLowerCase() === 'content-type'), false, 'fetch must generate the multipart boundary');
  assert.deepEqual(requests[1].body.map(item => item.name), ['model', 'prompt', 'size', 'quality', 'output_format', 'image[]', 'mask']);
  const editedRecord = store.listArtifacts(task.id, run.id).find(item => item.id === edited.metadata.artifactId);
  assert.equal(editedRecord.metadata.operation, 'edit');
  assert.equal(editedRecord.metadata.sourceImages[0].sha256, referenceImages.get('11111111-1111-4111-8111-111111111111').sha256);
  assert.doesNotMatch(JSON.stringify(editedRecord), /Preserve the subject/);

  memory.getDatabase().prepare('UPDATE projects SET memory_state = ? WHERE id = ?').run(JSON.stringify({
    agentWorkspace: { version: 1, revision: 1, roots: [projectRoot], goals: [], updatedAt: new Date().toISOString() },
  }), project.id);
  const { AthenaController } = require(path.join(root, 'dist', 'core', 'controller', 'AthenaController.js'));
  const controller = new AthenaController();
  assert.equal(controller.resolveOpenableAgentArtifact(project.id, image.metadata.artifactId), image.metadata.artifactPath);
  const outside = path.join(scratch, 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  const outsideArtifact = store.addArtifact({
    taskId: task.id, runId: run.id, stepId: imageStep.id, kind: 'fixture', name: 'Outside', uri: outside, validationStatus: 'passed',
  });
  assert.throws(() => controller.resolveOpenableAgentArtifact(project.id, outsideArtifact.id), /outside the active Project/);

  imageConsent = false;
  const resolvedImage = registry.resolve(call('generate_image_artifact', {
    prompt: 'revoked', size: '1024x1024', quality: 'low', output_format: 'png',
  }));
  await assert.rejects(() => registry.executeResolved(call('generate_image_artifact', {
    prompt: 'revoked', size: '1024x1024', quality: 'low', output_format: 'png',
  }), resolvedImage, context(run.id, imageStep.id, 'revoked-key')), /consent was revoked/);
  credentialAvailable = false;
  assert.deepEqual(bridge.refresh(), ['create_document_artifact']);
  writeAllowed = false;
  assert.deepEqual(bridge.refresh(), []);
  bridge.shutdown();

  const privacySource = fs.readFileSync(path.join(root, 'src', 'core', 'privacy', 'PrivacyDataService.ts'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(root, 'src', 'core', 'config', 'SettingsStore.ts'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(root, 'src', 'core', 'controller', 'AthenaController.ts'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'app', 'ipc', 'index.ts'), 'utf8');
  assert.match(privacySource, /api\.openai\.com\/v1\/images\/generations/);
  assert.match(privacySource, /api\.openai\.com\/v1\/images\/edits/);
  assert.match(settingsSource, /imageGeneration:\s*false/);
  assert.match(controllerSource, /this\.artifactTools\.refresh\(\)/);
  assert.match(ipcSource, /agentArtifact:open/);
  console.log('ATHENA_ARTIFACT_TOOLS_OK documents=markdown,html,docx,pdf image=openai-gpt-image-2 edit=references-mask workspace=project-only approval=always integrity=sha256');
})().then(() => {
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}).catch(error => {
  console.error(error?.stack || error);
  try { memory.closeDatabase(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
});

function execute(registry, name, args, runId, stepId, key) {
  const modelCall = call(name, args);
  const resolved = registry.resolve(modelCall);
  assert.equal(resolved.policy.approval, 'always');
  return registry.executeResolved(modelCall, resolved, context(runId, stepId, key));
}

function call(name, args) {
  return { id: `call-${name}`, name, arguments: args, rawArguments: JSON.stringify(args) };
}

function context(runId, stepId, idempotencyKey) {
  return { runId, stepId, callId: `call-${idempotencyKey}`, attempt: 1, idempotencyKey, signal: new AbortController().signal };
}

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
    rows[start] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = start + 1 + column * 4;
      rows[pixel] = 42;
      rows[pixel + 1] = 124;
      rows[pixel + 2] = 88;
      rows[pixel + 3] = 255;
    }
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
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

function modelImage(id, name, filePath, bytes) {
  return {
    id,
    name,
    filePath,
    mimeType: 'image/png',
    bytes: bytes.length,
    sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
    detail: 'auto',
  };
}
