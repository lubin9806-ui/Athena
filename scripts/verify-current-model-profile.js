const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

async function main() {
  await app.whenReady();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-current-model-profile-'));
  let controller;
  try {
    // Read the person's selected provider before isolating mutable test state.
    const settingsModule = require('../dist/core/config/SettingsStore.js');
    const selectedModel = settingsModule.getModelSettings();
    const selectedApp = settingsModule.getAppSettings();
    assert.notStrictEqual(selectedModel.provider, 'ollama', 'live profile requires the selected remote provider');
    assert.strictEqual(selectedApp.privacy.networkConsent.remoteModel, true, 'live profile requires the existing remote-model consent');

    process.env.ATHENA_CONFIG_DIR = path.join(scratch, 'config');
    process.env.ATHENA_DB_DIR = path.join(scratch, 'database');
    process.env.ATHENA_USE_LOCAL_SETTINGS = '0';
    settingsModule.saveSettingsBundle({
      settings: {
        conversation: { saveHistory: false, streamResponses: false, semanticRouting: false },
        memory: { enabled: false, autoExtract: false },
        webSearch: { enabled: false },
        privacy: { networkConsent: { remoteModel: true, webSearch: false } },
      },
      model: selectedModel,
    });

    const credentials = require('../dist/core/ai/CredentialStore.js');
    const status = credentials.getModelCredentialStatus(selectedModel.provider);
    assert.strictEqual(status.configured, true, `saved ${selectedModel.provider} credential is unavailable`);

    const { AthenaController } = require('../dist/core/controller/AthenaController.js');
    controller = new AthenaController();
    await controller.initialize();
    const system = await controller.getSystemInfo({ checkModel: true, timeoutMs: 10_000 });

    const ordinaryStarted = Date.now();
    const ordinary = await controller.processMessage('只用一句中文回答：现在连接正常吗？', 'companion');
    const ordinaryMs = Date.now() - ordinaryStarted;
    assert(ordinary.content.trim().length > 0, 'ordinary reply was empty');

    const creativeStarted = Date.now();
    const creative = await controller.processMessage('把画面环境改成雨后的黄昏街道，保留其他已经确定的内容。', 'create');
    const creativeMs = Date.now() - creativeStarted;
    assert(creative.content.trim().length > 0, 'creative turn reply was empty');

    console.log(JSON.stringify({
      marker: 'ATHENA_CURRENT_MODEL_PROFILE_OK',
      provider: system.modelProvider,
      mainModel: system.modelName,
      assistModel: selectedModel.assistModel || system.modelName,
      modelsEndpointConnected: system.modelConnected,
      ordinaryMs,
      creativeMs,
      ordinaryChars: ordinary.content.trim().length,
      creativeChars: creative.content.trim().length,
    }));
  } finally {
    await controller?.shutdown();
    fs.rmSync(scratch, { recursive: true, force: true });
    app.quit();
  }
}

main().catch(error => {
  console.error(`ATHENA_CURRENT_MODEL_PROFILE_FAILED ${error.message}`);
  app.exit(1);
});
