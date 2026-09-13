// Isolated UI fixture QA. No Athena runtime, config, credentials or model calls.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-atelier-qa-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('force-device-scale-factor', '1');
const dir = path.join(__dirname, 'evidence');
const report = {scope: 'Standalone ephemeral interaction fixture only. Not production theme switching or AI evidence.', startedAt: new Date().toISOString(), checks: [], captures: [], consoleErrors: [], remoteRequests: []};
let win;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
// HTMLElement.click alone does not focus a trigger as a real pointer/keyboard
// activation does. Focus first so close-to-source assertions model user input.
const click = s => evaluate(s => { const n = document.querySelector(s); if (!n) throw Error(`Missing ${s}`); n.focus(); n.click(); }, s);
const input = (s, value) => evaluate((s, value) => { const n = document.querySelector(s); n.value = value; n.dispatchEvent(new Event('input', {bubbles: true})); }, s, value);
const visibleCount = () => evaluate(() => document.querySelectorAll('.thought:not([hidden])').length);
const edgeCount = () => evaluate(() => document.querySelectorAll('#connections path').length);
const card = id => `.thought[data-id="${id}"] .thought-open`;
async function check(name, fn) { try { const details = await fn(); report.checks.push({name, passed: true, details}); } catch (e) { report.checks.push({name, passed: false, error: e.message}); } }
async function settle() { await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await wait(480); }
async function reset(w = 1440, h = 900, theme = 'day') {
  win.setContentSize(w, h); await win.loadFile(path.join(__dirname, 'index.html'));
  await evaluate(() => document.fonts.ready); if (theme === 'night') await click('#btn-theme'); await settle();
}
async function close() { await evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await settle(); }
async function capture(name) { await settle(); const file = `${name}.png`; fs.writeFileSync(path.join(dir, file), (await win.webContents.capturePage()).toPNG()); report.captures.push(file); }
async function escape() { win.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'}); win.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Escape'}); await settle(); }
async function layoutChecks(w, h, theme) {
  await reset(w, h, theme);
  await check(`${w}x${h} ${theme}: layout, visible controls, no horizontal overflow`, async () => {
    const g = await evaluate(() => {
      const rect = n => { const r = n.getBoundingClientRect(); return {id: n.id || n.dataset.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}; };
      return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        controls: ['#btn-new', '#btn-connect', '#btn-chat', '#btn-shelf', '#btn-settings'].map(s => rect(document.querySelector(s))),
        cards: [...document.querySelectorAll('.thought')].map(rect), dock: rect(document.querySelector('.tool-dock')), activeAnimations: document.getAnimations().filter(a => a.playState === 'running').length};
    });
    assert(g.scrollWidth <= w && g.bodyWidth <= w, 'Horizontal overflow');
    for (const r of g.controls) assert(r.width > 0 && r.left >= 0 && r.right <= w && r.top >= 0 && r.bottom <= h, `Offscreen control ${r.id}`);
    for (const r of g.cards) assert(r.left >= 0 && r.right <= w, `Card outside screen: ${r.id}`);
    if (w >= 1280 && h >= 800) for (const r of g.cards) assert(r.bottom <= g.dock.top - 12, `Dock covers ${r.id}`);
    assert.equal(g.activeAnimations, 0, 'Idle animations'); return g;
  });
  await capture(`atelier-${w}x${h}-${theme}`);
}
async function interactions() {
  await reset();
  await check('Initial desk has five thoughts, two edges and no old sidebar or mode tabs', async () => {
    assert.equal(await visibleCount(), 5); assert.equal(await edgeCount(), 2);
    assert.equal(await evaluate(() => !!document.querySelector('#sidebar, .mode-tabs')), false);
  });
  await check('Native modal focus, editable thought and Escape restore source', async () => {
    await click(card('week')); await settle();
    assert(await evaluate(() => document.querySelector('#focus-dialog').open && !!document.activeElement.closest('#focus-dialog')));
    await input('#focus-title', '给自己留出一个下午'); await input('#focus-body', '慢慢开始，不必排满。');
    await escape();
    assert.equal(await evaluate(() => document.querySelector('#focus-dialog').open), false);
    assert.equal(await evaluate(() => document.activeElement.closest('.thought')?.dataset.id), 'week');
    assert.equal(await evaluate(() => document.querySelector('[data-id="week"] h2').textContent), '给自己留出一个下午');
  });
  await check('New thought rejects whitespace; long content stays bounded and is editable in full', async () => {
    await click('#btn-new'); await input('#new-name', '   ');
    await evaluate(() => document.querySelector('#new-form').requestSubmit());
    assert.equal(await visibleCount(), 5); assert(await evaluate(() => !document.querySelector('#new-name').validity.valid));
    await input('#new-name', '小项目的新想法'); await input('#new-body', '长内容测试。'.repeat(200));
    await evaluate(() => document.querySelector('#new-form').requestSubmit()); await settle();
    assert.equal(await visibleCount(), 6);
    assert.equal(await evaluate(() => document.activeElement.closest('.thought')?.dataset.id), 'new-1');
    const height = await evaluate(() => document.querySelector('[data-id="new-1"]').getBoundingClientRect().height); assert(height < 370, `Card grew to ${height}`);
    await click(card('new-1')); assert.equal(await evaluate(() => document.querySelector('#focus-body').value.length), 1200); await close();
  });
  await reset();
  await check('Connect without dragging, reject self, deduplicate, disconnect', async () => {
    await click('#btn-connect'); await click(card('idea')); await click(card('idea')); await settle();
    assert.equal(await edgeCount(), 2);
    await click(card('feeling')); await settle(); assert.equal(await edgeCount(), 3);
    await click('#btn-connect'); await click(card('feeling')); await click(card('idea')); await settle(); assert.equal(await edgeCount(), 3);
    await click(card('idea')); await click('#focus-links button'); await settle(); assert.equal(await edgeCount(), 2); assert.equal(await evaluate(() => document.activeElement.id), 'btn-focus-connect'); await close();
  });
  await check('Connect from detail keeps chosen source and exits cleanly', async () => {
    await click(card('idea')); await click('#btn-focus-connect'); await settle();
    assert(await evaluate(() => !document.querySelector('#focus-dialog').open && document.querySelector('[data-id="idea"]').dataset.selected === 'true'));
    assert.notEqual(await evaluate(() => document.activeElement.closest('.thought')?.dataset.id), 'idea', 'Close event stole connection target focus');
    await click(card('quote')); await settle(); assert.equal(await edgeCount(), 3);
    await click('#btn-connect'); await escape(); assert.equal(await evaluate(() => document.querySelector('#btn-connect').getAttribute('aria-pressed')), 'false');
  });
  await check('Keyboard movement and arrange work without pointer dragging', async () => {
    const get = () => evaluate(() => document.querySelector('[data-id="idea"]').style.getPropertyValue('--x'));
    const before = await get(); await evaluate(() => { const h = document.querySelector('[data-id="idea"] .grab-handle'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true})); });
    const after = await get(); assert.equal(parseFloat(after) - parseFloat(before), 10);
    await click('#btn-arrange'); await settle(); assert.equal(await get(), before);
  });
  await check('Native pointer drag moves object; pointer release ends drag', async () => {
    const pos = await evaluate(() => { const n = document.querySelector('[data-id="idea"]'), r = n.querySelector('.grab-handle').getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: parseFloat(n.style.getPropertyValue('--x'))}; });
    win.webContents.sendInputEvent({type: 'mouseMove', x: pos.x, y: pos.y});
    win.webContents.sendInputEvent({type: 'mouseDown', button: 'left', clickCount: 1, x: pos.x, y: pos.y}); await wait(50);
    win.webContents.sendInputEvent({type: 'mouseMove', x: pos.x + 60, y: pos.y + 30}); await wait(90);
    win.webContents.sendInputEvent({type: 'mouseUp', button: 'left', clickCount: 1, x: pos.x + 60, y: pos.y + 30}); await settle();
    const after = await evaluate(() => ({x: parseFloat(document.querySelector('[data-id="idea"]').style.getPropertyValue('--x')), dragging: document.querySelector('[data-id="idea"]').dataset.dragging}));
    assert(after.x > pos.left + 40, `No drag: ${JSON.stringify(after)}`); assert.notEqual(after.dragging, 'true');
    await click('#btn-arrange'); await settle(); return {before: pos.left, after: after.x};
  });
  await check('Expand thought, keep question, preserve source edge', async () => {
    await click(card('week')); await click('#btn-expand'); assert.equal(await evaluate(() => document.querySelector('#expansion-area').hidden), false);
    await click('#btn-keep-question'); await settle(); assert.equal(await visibleCount(), 6); assert.equal(await edgeCount(), 4);
    assert(await evaluate(() => [...document.querySelectorAll('#focus-links .relation-item')].some(n => n.textContent.includes('换个角度想')))); await close();
  });
  await check('Plan is an editable, retained and retractable three-step draft', async () => {
    await click(card('week')); await click('#btn-plan'); assert.equal(await evaluate(() => document.querySelectorAll('.plan-step').length), 3);
    await input('.plan-step textarea', '周六用十五分钟整理书桌。'); await click('.plan-step input'); await close(); await click(card('week'));
    assert.equal(await evaluate(() => document.querySelector('.plan-step textarea').value), '周六用十五分钟整理书桌。');
    assert(await evaluate(() => document.querySelector('.plan-step input').checked)); await capture('atelier-plan-draft');
    await click('#btn-clear-plan'); assert(await evaluate(() => document.querySelector('#plan-area').hidden)); await close();
  });
  await reset();
  await check('Archive hides object and edges; restore retains both', async () => {
    await click(card('week')); await click('#btn-archive'); await settle(); assert.equal(await visibleCount(), 4); assert.equal(await edgeCount(), 0);
    await click('#btn-shelf'); await capture('atelier-shelf'); await click('#shelf-list button'); assert(await evaluate(() => document.activeElement.matches('#shelf-dialog [data-close]'))); await close();
    assert.equal(await visibleCount(), 5); assert.equal(await edgeCount(), 2);
  });
  await check('Search supports shortcut, query, empty state and opening a thought', async () => {
    await evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true, bubbles: true}))); await settle();
    assert.equal(await evaluate(() => document.activeElement.id), 'search-input'); await input('#search-input', '不存在的天鹅座'); assert.equal(await evaluate(() => document.querySelectorAll('#search-results button').length), 0);
    await input('#search-input', '松一点');
    await evaluate(() => document.querySelector('#search-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', isComposing: true, bubbles: true})));
    assert.equal(await evaluate(() => document.activeElement.id), 'search-input', 'IME choice moved focus away from query');
    await evaluate(() => document.querySelector('#search-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))); await settle();
    assert.equal(await evaluate(() => document.querySelector('#focus-title').value), '把这一周，过得松一点'); await close();
  });
  await check('Companion is explicit canned text; IME Enter does not submit; stop has no late reply', async () => {
    await click('#btn-chat'); await input('#chat-input', '今天有点累');
    await evaluate(() => document.querySelector('#chat-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true, bubbles: true})));
    assert.equal(await evaluate(() => document.querySelectorAll('#chat-stream .user').length), 0);
    await click('#btn-chat-send'); await click('#btn-chat-send'); await wait(850);
    assert.equal(await evaluate(() => document.querySelectorAll('[data-pending]').length), 0);
    assert(await evaluate(() => document.querySelector('#chat-stream').textContent.includes('示例回复已停止'))); await capture('atelier-companion'); await close();
  });
  await check('Search Up from query starts at final result; modal closes to its original trigger', async () => {
    await click('#btn-search'); await settle();
    await evaluate(() => document.querySelector('#search-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true})));
    assert(await evaluate(() => document.activeElement === [...document.querySelectorAll('#search-results button')].at(-1))); await escape();
    assert.equal(await evaluate(() => document.activeElement.id), 'btn-search');
  });
  await check('Archiving every object produces a reachable empty state', async () => {
    for (const id of ['idea', 'week', 'question', 'quote']) { await click(card(id)); await click('#btn-archive'); await settle(); }
    await click('#btn-search'); await input('#search-input', '今天有点累'); await click('#search-results button'); await click('#btn-archive'); await settle();
    assert.equal(await visibleCount(), 0); assert.equal(await edgeCount(), 0);
    assert(await evaluate(() => { const n = document.querySelector('#btn-empty-new'), r = n.getBoundingClientRect(); return !n.closest('[hidden]') && r.top >= 0 && r.bottom < innerHeight - 100; }));
    await capture('atelier-empty');
  });
  await reset();
  await check('Glass is event driven; solid mode and reduced motion stop visual effects', async () => {
    await evaluate(() => { const n = document.querySelector('.tool-dock'), r = n.getBoundingClientRect(); n.dispatchEvent(new PointerEvent('pointermove', {clientX: r.left + 70, clientY: r.top + 20})); }); await wait(80);
    assert(await evaluate(() => !!document.querySelector('.tool-dock').style.getPropertyValue('--glass-x')));
    await click('#btn-settings'); await click('#setting-glass'); await settle();
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.tool-dock')).backdropFilter), 'none');
    assert.equal(await evaluate(() => document.querySelector('.tool-dock').style.getPropertyValue('--glass-x')), '');
    await click('#setting-motion'); await close(); await click(card('week')); await settle();
    assert.equal(await evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0); await close();
  });
  await reset(390, 844);
  await check('Mobile objects are reachable in flow; detail modal fits viewport', async () => {
    for (const id of ['week', 'idea', 'question', 'feeling', 'quote']) {
      await evaluate(id => document.querySelector(`[data-id="${id}"]`).scrollIntoView({block: 'center'}), id); await settle();
      const r = await evaluate(id => { const r = document.querySelector(`[data-id="${id}"]`).getBoundingClientRect(); return {top: r.top, bottom: r.bottom}; }, id);
      assert(r.top >= 0 && r.bottom < 760, `Mobile card obscured: ${id} ${JSON.stringify(r)}`);
    }
    await click(card('quote')); await settle();
    const r = await evaluate(() => { const r = document.querySelector('#focus-dialog').getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom}; });
    assert(r.left >= 0 && r.right <= 390 && r.top >= 0 && r.bottom <= 844); await capture('atelier-mobile-detail'); await close(); return r;
  });
}
async function run() {
  fs.mkdirSync(dir, {recursive: true}); await app.whenReady();
  win = new BrowserWindow({show: false, width: 1440, height: 900, webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true}});
  win.webContents.setFrameRate(30);
  win.webContents.session.setPermissionRequestHandler((_w, _p, done) => done(false));
  win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']}, (d, done) => { report.remoteRequests.push(d.resourceType); done({cancel: true}); });
  win.webContents.on('console-message', (_e, d) => { if (d?.level === 'error') report.consoleErrors.push(d.message); });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  for (const [w, h] of [[1440, 900], [1280, 800], [960, 720], [390, 844]]) for (const t of ['day', 'night']) await layoutChecks(w, h, t);
  await interactions();
  await check('Approved logo and functional icon sprite are byte-for-byte unchanged', () => {
    const expected = {'athena-mark.svg': '55AA336147DF7D5FBCE9FC485AB421988DF6108301817E023B800DDFD383E578', 'icons.svg': '3852D37EF58BAFCBD6A8D3459A68F02DCDB452914D8E4DC5FD43825808318783'};
    for (const [file, hash] of Object.entries(expected)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../companion-prototype/assets', file))).digest('hex').toUpperCase(), hash); return expected;
  });
  await check('No renderer errors or remote request attempts', () => { assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.remoteRequests, []); });
  await win.loadFile(path.join(__dirname, '../theme-presets.html')); win.setContentSize(1440, 900); await capture('theme-presets-desktop');
  await check('Three presets distinguish default from optional and disclose prototype limits', async () => {
    const text = await evaluate(() => document.body.textContent); for (const word of ['日光', '经典', '随心桌面', '默认', '尚未']) assert(text.includes(word), `Missing ${word}`);
    const links = await evaluate(() => [...document.querySelectorAll('a[href]')].map(n => n.getAttribute('href'))); assert(links.some(s => s.includes('companion-prototype')) && links.some(s => s.includes('atelier-prototype'))); return links;
  });
  win.setContentSize(390, 844); await capture('theme-presets-mobile');
  await check('Theme chooser has no mobile horizontal overflow', async () => assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
  report.finishedAt = new Date().toISOString(); report.passed = report.checks.every(c => c.passed); report.summary = {passed: report.checks.filter(c => c.passed).length, failed: report.checks.filter(c => !c.passed).length, captures: report.captures.length};
  fs.writeFileSync(path.join(dir, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`ATHENA_ATELIER_${report.passed ? 'OK' : 'FAILED'} ${JSON.stringify(report.summary)}`); for (const c of report.checks.filter(c => !c.passed)) console.error(c.name, c.error);
  win.destroy(); app.exit(report.passed ? 0 : 1);
}
run().catch(e => { report.fatal = e.stack; fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, 'qa-report.json'), JSON.stringify(report, null, 2)); console.error(e); app.exit(1); });
