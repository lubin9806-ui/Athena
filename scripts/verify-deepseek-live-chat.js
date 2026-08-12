const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

async function main() {
  const scratch = process.env.ATHENA_TEST_SCRATCH;
  assert(scratch, 'ATHENA_TEST_SCRATCH is required');
  assert(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required');
  assert(process.env.ATHENA_CONFIG_DIR, 'ATHENA_CONFIG_DIR is required');
  assert(process.env.ATHENA_DB_DIR, 'ATHENA_DB_DIR is required');

  const scratchPath = path.resolve(scratch);
  const tempRoot = path.resolve(os.tmpdir());
  assert(
    scratchPath.startsWith(`${tempRoot}${path.sep}`),
    `scratch directory must be inside the system temp directory: ${scratchPath}`,
  );

  let controller;
  try {
    await app.whenReady();
    const { saveSettingsBundle } = require('../dist/core/config/SettingsStore.js');
    const { AthenaController } = require('../dist/core/controller/AthenaController.js');
    const { getDatabaseFilePath } = require('../dist/memory/database/index.js');

    const expectedDbRoot = path.resolve(process.env.ATHENA_DB_DIR);
    const actualDbPath = path.resolve(getDatabaseFilePath());
    assert(
      actualDbPath.startsWith(`${expectedDbRoot}${path.sep}`),
      `database escaped scratch directory: ${actualDbPath}`,
    );

    saveSettingsBundle({
      settings: {
        conversation: { saveHistory: false, streamResponses: false },
        memory: { enabled: false, autoExtract: false },
        webSearch: { enabled: false },
        privacy: { networkConsent: { remoteModel: true, webSearch: false } },
      },
      model: {
        provider: 'deepseek',
        setupComplete: true,
        remote: {
          deepseek: {
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-v4-flash',
            temperature: 0.2,
            maxTokens: 256,
            numCtx: 8192,
          },
        },
      },
    });

    controller = new AthenaController();
    await controller.initialize();
    const system = await controller.getSystemInfo();
    assert.strictEqual(system.modelProvider, 'deepseek');
    assert.strictEqual(system.modelConnected, true, 'DeepSeek /models connection failed');

    const response = await controller.processMessage(
      'Reply in one short Chinese sentence: can you chat normally now?',
      'companion',
    );
    const content = response.content.trim();
    assert(content.length > 0, 'DeepSeek returned an empty chat response');

    console.log(JSON.stringify({
      marker: 'ATHENA_DEEPSEEK_CHAT_OK',
      provider: system.modelProvider,
      model: system.modelName,
      connected: system.modelConnected,
      responseChars: content.length,
      response: content.slice(0, 240),
    }));
  } finally {
    await controller?.shutdown();
    delete process.env.DEEPSEEK_API_KEY;
    fs.rmSync(scratchPath, { recursive: true, force: true });
    app.quit();
  }
}

main().catch(error => {
  console.error(`ATHENA_DEEPSEEK_CHAT_FAILED ${error.message}`);
  app.quit();
  process.exitCode = 1;
});
