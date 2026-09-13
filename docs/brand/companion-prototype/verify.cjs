// Standalone visual prototype QA. Never launches Athena or reads its configuration.
// Run from the repository: node_modules\electron\dist\electron.exe docs\brand\companion-prototype\verify.cjs
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-companion-prototype-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const evidenceDir = path.join(__dirname, 'evidence');
const report = {
  scope: 'Standalone clickable visual prototype. Canned examples only; not Athena runtime or LLM evidence.',
  startedAt: new Date().toISOString(),
  checks: [], captures: [], consoleErrors: [], blockedRemoteRequests: [],
};
let win;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
const click = selector => evaluate(selector => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.click();
}, selector);
const key = (selector, key) => evaluate((selector, key) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.focus();
  element.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
}, selector, key);
const input = value => evaluate(value => {
  const element = document.querySelector('#message-input');
  element.value = value;
  element.dispatchEvent(new Event('input', {bubbles: true}));
}, value);

async function check(name, fn) {
  try {
    const details = await fn();
    report.checks.push({name, passed: true, ...(details === undefined ? {} : {details})});
  } catch (error) {
    report.checks.push({name, passed: false, error: error.message});
  }
}

async function settle() {
  await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await wait(340);
}

async function reset(width = 1440, height = 900, theme = 'day') {
  win.setContentSize(width, height);
  await win.loadFile(path.join(__dirname, 'index.html'));
  await evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
  });
  await evaluate(theme => {
    if (document.documentElement.dataset.theme !== theme) document.querySelector('#btn-theme').click();
  }, theme);
  await settle();
}

async function capture(name) {
  await settle();
  const file = `${name}.png`;
  fs.writeFileSync(path.join(evidenceDir, file), (await win.webContents.capturePage()).toPNG());
  report.captures.push(file);
}

async function visibleGeometry(selector) {
  return evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      selector, hidden: element.hidden || style.display === 'none' || style.visibility === 'hidden',
      x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
    };
  }, selector);
}

function assertInViewport(rect) {
  assert(!rect.hidden && rect.width > 0 && rect.height > 0, `${rect.selector} is hidden or empty`);
  assert(rect.x >= -1 && rect.y >= -1 && rect.right <= rect.viewportWidth + 1 && rect.bottom <= rect.viewportHeight + 1,
    `${rect.selector} outside ${rect.viewportWidth}x${rect.viewportHeight}: ${JSON.stringify(rect)}`);
}

async function checkLayout(width, height, theme) {
  const prefix = `${width}x${height}-${theme}`;
  await reset(width, height, theme);
  await check(`${prefix}: window and essential controls`, async () => {
    const documentState = await evaluate(() => ({
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth, fontStatus: document.fonts.status,
      images: Array.from(document.images, image => ({source: image.getAttribute('src'), loaded: image.naturalWidth > 0})),
      theme: document.documentElement.dataset.theme,
    }));
    assert.equal(documentState.theme, theme);
    assert(documentState.scrollWidth <= width + 1 && documentState.bodyScrollWidth <= width + 1, 'Horizontal page overflow');
    assert.equal(documentState.fontStatus, 'loaded');
    assert(documentState.images.every(image => image.loaded), 'Unloaded image');
    const rects = [];
    for (const selector of ['#btn-sidebar', '#btn-theme', '#message-input', '#btn-more', '#btn-send', '#composer-meta']) {
      const rect = await visibleGeometry(selector);
      assertInViewport(rect);
      rects.push(rect);
    }
    return {documentState, controls: rects};
  });
  await capture(`companion-${prefix}`);
  await check(`${prefix}: sidebar toggle`, async () => {
    const before = await evaluate(() => document.querySelector('#prototype-app').dataset.sidebar);
    await click('#btn-sidebar');
    const after = await evaluate(() => ({
      state: document.querySelector('#prototype-app').dataset.sidebar,
      expanded: document.querySelector('#btn-sidebar').getAttribute('aria-expanded'),
    }));
    assert.notEqual(after.state, before);
    assert.equal(after.expanded, String(after.state === 'open'));
    await click('#btn-sidebar');
    return {before, after};
  });
  await check(`${prefix}: tools menu above composer`, async () => {
    await click('#btn-more');
    await settle();
    const menu = await visibleGeometry('#tools-popover');
    const composer = await visibleGeometry('#composer-form');
    assertInViewport(menu);
    const gap = composer.y - menu.bottom;
    assert(gap >= 9.5, `Menu-to-composer gap ${gap}px is below 10px`);
    const state = await evaluate(() => ({
      expanded: document.querySelector('#btn-more').getAttribute('aria-expanded'),
      role: document.querySelector('#tools-popover').getAttribute('role'),
      focusInside: document.querySelector('#tools-popover').contains(document.activeElement),
    }));
    assert.equal(state.expanded, 'true');
    assert.equal(state.role, 'menu');
    assert(state.focusInside, 'Open menu should receive keyboard focus');
    await key('#tools-popover [role="menuitem"]', 'Escape');
    await settle();
    const closed = await evaluate(() => ({hidden: document.querySelector('#tools-popover').hidden, focus: document.activeElement.id}));
    assert(closed.hidden, 'Escape did not close menu');
    assert.equal(closed.focus, 'btn-more');
    return {gap, menu, composer};
  });
  await check(`${prefix}: drawer fits and closes`, async () => {
    await click('#btn-memory');
    await settle();
    const drawer = await visibleGeometry('#memory-drawer');
    assertInViewport(drawer);
    await key('#memory-drawer button', 'Escape');
    await settle();
    const state = await evaluate(() => ({hidden: document.querySelector('#memory-drawer').hidden, focus: document.activeElement.id}));
    assert(state.hidden);
    assert.equal(state.focus, 'btn-memory');
    return drawer;
  });
}

async function testInteractions() {
  await reset();
  await check('Input: empty/whitespace disabled, prompt and typed text enabled', async () => {
    assert(await evaluate(() => document.querySelector('#btn-send').disabled));
    await input('   \n');
    assert(await evaluate(() => document.querySelector('#btn-send').disabled));
    await click('[data-prompt]');
    const prompt = await evaluate(() => ({value: document.querySelector('#message-input').value, disabled: document.querySelector('#btn-send').disabled}));
    assert(prompt.value.trim().length > 0 && !prompt.disabled);
    await input('请陪我梳理今天的想法。');
    assert.equal(await evaluate(() => document.querySelector('#btn-send').disabled), false);
    return {prompt};
  });
  await check('Keyboard: Shift+Enter does not submit; Enter starts response', async () => {
    await evaluate(() => {
      const element = document.querySelector('#message-input');
      element.focus();
      element.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true, bubbles: true, cancelable: true}));
    });
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.state), 'idle');
    await key('#message-input', 'Enter');
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.state), 'responding');
    await click('#btn-send');
    await input('请陪我梳理今天的想法。');
    return {shiftEnterPreservesDraft: true, enterSubmits: true};
  });
  await check('Demo response: submitted text, responding, finished reply', async () => {
    await click('#btn-send');
    const responding = await evaluate(() => ({state: document.querySelector('#prototype-app').dataset.state, log: document.querySelector('#chat-log').textContent}));
    assert.equal(responding.state, 'responding');
    assert(responding.log.includes('请陪我梳理今天的想法。'));
    await wait(1400);
    const completed = await evaluate(() => ({state: document.querySelector('#prototype-app').dataset.state, log: document.querySelector('#chat-log').textContent}));
    assert.equal(completed.state, 'idle');
    assert(completed.log.length > responding.log.length, 'No canned reply appeared');
    return {responding: responding.state, completed: completed.state, replyAdded: true};
  });
  await capture('companion-conversation-day');
  await check('Cancel response: stops immediately and does not append late reply', async () => {
    await input('这次先停一下。');
    await click('#btn-send');
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.state), 'responding');
    await click('#btn-send');
    const canceled = await evaluate(() => ({state: document.querySelector('#prototype-app').dataset.state, log: document.querySelector('#chat-log').textContent}));
    assert.equal(canceled.state, 'idle');
    await wait(1400);
    const later = await evaluate(() => ({state: document.querySelector('#prototype-app').dataset.state, log: document.querySelector('#chat-log').textContent}));
    assert.equal(later.state, 'idle');
    assert.equal(later.log, canceled.log, 'Canceled reply arrived later');
    return {cancelState: canceled.state, noLateReply: true};
  });
  await check('Panels: popover and drawers are mutually exclusive', async () => {
    await click('#btn-more');
    await click('#btn-settings');
    let state = await evaluate(() => ({menu: document.querySelector('#tools-popover').hidden, settings: document.querySelector('#settings-drawer').hidden, memory: document.querySelector('#memory-drawer').hidden, tools: document.querySelector('#tools-drawer').hidden, scrim: document.querySelector('#drawer-scrim').hidden}));
    assert(state.menu && !state.settings && state.memory && state.tools && !state.scrim);
    await click('#btn-memory');
    state = await evaluate(() => ({settings: document.querySelector('#settings-drawer').hidden, memory: document.querySelector('#memory-drawer').hidden}));
    assert(state.settings && !state.memory);
    await key('#memory-drawer button', 'Escape');
    await click('#btn-more');
    await click('#btn-tools');
    state = await evaluate(() => ({settings: document.querySelector('#settings-drawer').hidden, memory: document.querySelector('#memory-drawer').hidden, tools: document.querySelector('#tools-drawer').hidden}));
    assert(state.settings && state.memory && !state.tools);
    await key('#tools-drawer button', 'Escape');
    assert.equal(await evaluate(() => document.activeElement.id), 'btn-more');
    return {mutuallyExclusive: true, escapeFocus: 'btn-more', reason: 'Return to the visible menu trigger; its menu item is hidden after the drawer closes'};
  });
  await check('Drawer: focus stays inside during keyboard traversal', async () => {
    await click('#btn-settings');
    const initial = await evaluate(() => document.querySelector('#settings-drawer').contains(document.activeElement));
    assert(initial, 'Opening drawer did not move focus inside');
    const wrap = await evaluate(() => {
      const dialog = document.querySelector('#settings-drawer');
      const visible = Array.from(dialog.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')).filter(element => {
        if (element.disabled || !element.getClientRects().length || element.tabIndex < 0) return false;
        const closed = element.closest('details:not([open])');
        return !closed || element === closed.querySelector('summary');
      });
      const first = visible[0], last = visible.at(-1);
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
      const forward = document.activeElement === first;
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}));
      return {count: visible.length, forward, reverse: document.activeElement === last};
    });
    assert(wrap.count >= 2 && wrap.forward && wrap.reverse, `Drawer focus trap failed: ${JSON.stringify(wrap)}`);
    await key('#settings-drawer button', 'Escape');
    return wrap;
  });
  await check('Tabs: separate spaces, work submodes and keyboard navigation', async () => {
    const initial = await evaluate(() => ({space: document.querySelector('#prototype-app').dataset.space, mode: document.querySelector('#prototype-app').dataset.mode, workHidden: document.querySelector('#work-modes').hidden}));
    assert.deepEqual(initial, {space: 'companion', mode: 'companion', workHidden: true});
    await key('[role="tab"][data-space="companion"]', 'ArrowRight');
    const work = await evaluate(() => ({space: document.querySelector('#prototype-app').dataset.space, hidden: document.querySelector('#work-modes').hidden, focused: document.activeElement.dataset.space, selected: document.querySelector('[role="tab"][data-space="work"]').getAttribute('aria-selected')}));
    assert.equal(work.space, 'work');
    assert(!work.hidden && work.focused === 'work' && work.selected === 'true');
    await key('#work-modes [role="tab"][data-mode="create"]', 'ArrowRight');
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.mode), 'reason');
    await key('#work-modes [role="tab"][data-mode="reason"]', 'End');
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.mode), 'execute');
    await key('#work-modes [role="tab"][data-mode="execute"]', 'Home');
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.mode), 'create');
    const tablists = await evaluate(() => Array.from(document.querySelectorAll('[role="tablist"]')).map(list => ({
      tabs: list.querySelectorAll('[role="tab"]').length,
      selected: list.querySelectorAll('[role="tab"][aria-selected="true"]').length,
      tabStops: list.querySelectorAll('[role="tab"][tabindex="0"]').length,
    })));
    assert(tablists.every(list => list.selected === 1 && list.tabStops === 1), 'Roving tabindex contract failed');
    await click('[role="tab"][data-space="companion"]');
    return {initial, work, tablists};
  });
  await check('Error demo: visible retry succeeds and does not call a provider', async () => {
    await click('#btn-settings');
    await evaluate(() => {
      for (let ancestor = document.querySelector('#btn-demo-error').parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
    });
    await click('#btn-demo-error');
    await evaluate(() => {
      if (!document.querySelector('#settings-drawer').hidden) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    });
    await input('请帮我整理明天的安排。');
    await click('#btn-send');
    await wait(1400);
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.state), 'error');
    assertInViewport(await visibleGeometry('#btn-retry'));
    await click('#btn-retry');
    await wait(1400);
    assert.equal(await evaluate(() => document.querySelector('#prototype-app').dataset.state), 'idle');
    return {errorVisible: true, retryCompleted: true};
  });
  await check('New conversation clears demo conversation and composer', async () => {
    await click('#btn-new');
    const state = await evaluate(() => ({state: document.querySelector('#prototype-app').dataset.state, input: document.querySelector('#message-input').value, disabled: document.querySelector('#btn-send').disabled}));
    assert.deepEqual(state, {state: 'idle', input: '', disabled: true});
    return state;
  });
  await check('Example conversation is explicitly a local demonstration', async () => {
    await click('#btn-example');
    const state = await evaluate(() => ({log: document.querySelector('#chat-log').textContent, text: document.body.textContent}));
    assert(state.log.trim().length > 20, 'Example did not populate conversation');
    assert(/演示|示例/.test(state.text), 'No visible demo label');
    assert(/未连接|不调用|本地演示|模拟/.test(state.text), 'No visible local demo clarification');
    return {examplePopulated: true, demoLabel: true};
  });
  await capture('companion-example-day');
}

async function testContrast(theme) {
  await reset(1440, 900, theme);
  await input('对比度检查');
  await check(`${theme}: text and active control contrast`, async () => {
    const values = await evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      function rgba(color) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const value = Array.from(ctx.getImageData(0, 0, 1, 1).data);
        return [value[0], value[1], value[2], value[3] / 255];
      }
      const over = (front, back) => [0, 1, 2].map(index => front[index] * front[3] + back[index] * (1 - front[3])).concat(1);
      function background(element) {
        const layers = [];
        for (let current = element; current; current = current.parentElement) layers.unshift(rgba(getComputedStyle(current).backgroundColor));
        const base = layers.reduce((result, layer) => over(layer, result), [255, 255, 255, 1]);
        // The selected space uses an opaque sliding ::before plate behind its text.
        if (element.matches('.space-tabs [aria-selected="true"]')) return over(rgba(getComputedStyle(element.parentElement, '::before').backgroundColor), base);
        return base;
      }
      const luminance = value => value.slice(0, 3).map(item => item / 255).map(item => item <= 0.04045 ? item / 12.92 : ((item + 0.055) / 1.055) ** 2.4).reduce((sum, item, index) => sum + item * [0.2126, 0.7152, 0.0722][index], 0);
      return [
        ['#message-input', null, 4.5], ['#message-input', '::placeholder', 4.5],
        ['#composer-meta', null, 4.5], ['#btn-more', null, 3], ['#btn-send', null, 3],
        ['[role="tab"][data-space="companion"]', null, 4.5],
      ].map(([selector, pseudo, threshold]) => {
        const element = document.querySelector(selector);
        const bg = background(element);
        const foreground = over(rgba(getComputedStyle(element, pseudo).color), bg);
        const first = luminance(foreground), second = luminance(bg);
        return {selector, pseudo, threshold, foreground, background: bg, ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)};
      });
    });
    for (const value of values) assert(value.ratio >= value.threshold, `${value.selector}${value.pseudo || ''} ${value.ratio.toFixed(2)} < ${value.threshold}`);
    return values.map(value => ({...value, ratio: Number(value.ratio.toFixed(2))}));
  });
}

async function testReducedMotion() {
  await reset();
  await check('Reduced motion: user control suppresses transitions and animation', async () => {
    await click('#btn-settings');
    await click('#btn-reduced-motion');
    const reduced = await evaluate(() => {
      const enabled = document.documentElement.dataset.reducedMotion;
      const duration = value => Math.max(...value.split(',').map(item => parseFloat(item) * (item.trim().endsWith('ms') ? 1 : 1000)));
      const offenders = Array.from(document.querySelectorAll('*')).filter(element => element.getClientRects().length).flatMap(element => {
        const style = getComputedStyle(element);
        if (duration(style.animationDuration) > 1 || duration(style.transitionDuration) > 1) return [{element: element.id || element.className, animation: style.animationDuration, transition: style.transitionDuration}];
        return [];
      });
      return {enabled, offenders};
    });
    assert(['true', 'on', 'reduce'].includes(reduced.enabled), 'Reduced motion attribute not active');
    assert.equal(reduced.offenders.length, 0, JSON.stringify(reduced.offenders));
    return reduced;
  });
  await check('Reduced motion: operating-system preference supported', async () => {
    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), 'No operating-system reduced-motion media rule');
    return {mediaRulePresent: true, scope: 'Source rule presence; user-control computed styles checked separately'};
  });
}

async function captureOpenPanels() {
  await reset();
  await click('#btn-more');
  await capture('companion-tools-menu-day');
  await click('#btn-memory');
  await capture('companion-memory-day');
  await click('#btn-settings');
  await capture('companion-settings-day');
  await reset(1440, 900, 'night');
  await click('#btn-more');
  await capture('companion-tools-menu-night');
}

async function testMotionAndMaterial() {
  await reset();
  await check('Motion: closing surfaces are immediately inert, then hidden; rapid reopening is safe', async () => {
    await click('#btn-more'); await settle();
    await click('#btn-more');
    const exit = await evaluate(() => {
      const p = document.querySelector('#tools-popover');
      return {inert: p.inert, ariaHidden: p.getAttribute('aria-hidden'), focus: document.activeElement.id};
    });
    assert(exit.inert && exit.ariaHidden === 'true' && exit.focus === 'btn-more');
    await click('#btn-more'); await settle();
    assert(await evaluate(() => !document.querySelector('#tools-popover').hidden && !document.querySelector('#tools-popover').inert));
    await click('#btn-memory'); await click('#btn-memory'); await click('#btn-settings'); await settle();
    const drawer = await evaluate(() => ({memoryHidden: document.querySelector('#memory-drawer').hidden, settingsOpen: !document.querySelector('#settings-drawer').hidden, workspaceInert: document.querySelector('#workspace').inert, focusInside: document.querySelector('#settings-drawer').contains(document.activeElement)}));
    assert(drawer.memoryHidden && drawer.settingsOpen && drawer.workspaceInert && drawer.focusInside);
    await key('#settings-drawer button', 'Escape'); await settle();
    return {exit, drawer};
  });
  await check('Layout motion: two-level navigation stays anchored; rapid sidebar toggles retain draft', async () => {
    const before = await visibleGeometry('.space-tabs');
    await click('#space-work'); await settle();
    const after = await visibleGeometry('.space-tabs');
    assert(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, 'Primary navigation jumped when opening work submodes');
    await input('侧栏展开与收起时保留的草稿');
    await click('#btn-sidebar'); await wait(65); await click('#btn-sidebar'); await wait(65); await click('#btn-sidebar'); await settle();
    const closed = await evaluate(() => ({inert: document.querySelector('#sidebar').inert, visibility: getComputedStyle(document.querySelector('#sidebar')).visibility, draft: document.querySelector('#message-input').value, overflow: document.documentElement.scrollWidth > innerWidth}));
    assert(closed.inert && closed.visibility === 'hidden' && closed.draft.includes('保留') && !closed.overflow);
    assertInViewport(await visibleGeometry('#composer-form'));
    await click('#btn-sidebar'); await settle(); await click('#space-companion');
    return {navigationStable: true, closed};
  });
  await reset(960, 720);
  await check('Messages: old nodes persist and incoming reply does not pull a reader to the bottom', async () => {
    await click('#btn-example'); await settle();
    await evaluate(() => { window.__qaFirstMessage = document.querySelector('#chat-log .message'); });
    await input('继续整理这周的安排。'); await click('#btn-send'); await wait(120);
    await evaluate(() => { document.querySelector('#conversation-stage').scrollTop = 0; });
    await wait(1100);
    const result = await evaluate(() => {
      const stage = document.querySelector('#conversation-stage');
      const value = {sameNode: window.__qaFirstMessage === document.querySelector('#chat-log .message'), scrollTop: stage.scrollTop, overflow: stage.scrollHeight > stage.clientHeight + 200, latestVisible: !document.querySelector('#btn-latest').hidden};
      delete window.__qaFirstMessage; return value;
    });
    assert(result.sameNode && result.overflow && result.scrollTop < 3 && result.latestVisible, JSON.stringify(result));
    await click('#btn-latest'); await wait(650);
    assert(await evaluate(() => { const s = document.querySelector('#conversation-stage'); return s.scrollHeight - s.clientHeight - s.scrollTop < 3; }));
    return result;
  });
  await check('Layout: growing composer keeps menu above input and bottom metadata visible', async () => {
    await input(Array.from({length: 12}, (_, i) => `第 ${i + 1} 行内容`).join('\n'));
    await click('#btn-more'); await settle();
    const menu = await visibleGeometry('#tools-popover'); const composer = await visibleGeometry('#composer-form');
    assertInViewport(menu); assertInViewport(await visibleGeometry('#composer-meta'));
    assert(composer.y - menu.bottom >= 10);
    await key('#tools-popover button', 'Escape'); await settle();
    return {gap: composer.y - menu.bottom, composerHeight: composer.height};
  });
  await reset();
  await check('Glass: pointer response, pressure and idle reset; no idle animation loop', async () => {
    const renderer = await evaluate(() => document.documentElement.dataset.glassRenderer);
    assert.equal(renderer, 'backdrop', 'Expected supported Electron backdrop renderer');
    await evaluate(() => {
      const s = document.querySelector('#composer-form'), r = s.getBoundingClientRect();
      s.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerType: 'mouse', clientX: r.left + r.width * .7, clientY: r.top + 20}));
    });
    await wait(65);
    const tracking = await evaluate(() => document.querySelector('#composer-form').dataset.glassResponse);
    assert.equal(tracking, 'tracking');
    await evaluate(() => { const s = document.querySelector('#composer-form'), r = s.getBoundingClientRect(); s.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'mouse', clientX: r.left + 100, clientY: r.top + 20, pressure: .5})); });
    await wait(65);
    assert.equal(await evaluate(() => document.querySelector('#composer-form').dataset.glassResponse), 'pressed');
    await evaluate(() => { const s = document.querySelector('#composer-form'); s.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerType: 'mouse'})); s.dispatchEvent(new PointerEvent('pointerleave', {pointerType: 'mouse'})); });
    await wait(500);
    const idle = await evaluate(() => ({response: document.querySelector('#composer-form').dataset.glassResponse, running: document.getAnimations().filter(a => a.playState === 'running').length, frames: document.documentElement.dataset.glassFrames, pending: document.documentElement.dataset.glassPending}));
    assert.equal(idle.response, 'idle'); assert.equal(idle.running, 0);
    await wait(350);
    assert.equal(await evaluate(() => document.documentElement.dataset.glassFrames), idle.frames, 'Glass kept rendering at idle');
    assert.equal(idle.pending, 'false');
    return {renderer, tracking, idle};
  });
  await capture('companion-glass-day');
  await check('Glass: solid fallback removes transparency and backdrop filtering', async () => {
    await click('#btn-settings'); await click('#btn-glass'); await settle();
    const solid = await evaluate(() => ({renderer: document.documentElement.dataset.glassRenderer, motion: document.documentElement.dataset.glassMotion, filter: getComputedStyle(document.querySelector('#composer-form')).backdropFilter, checked: document.querySelector('#btn-glass').getAttribute('aria-checked'), response: document.querySelector('#composer-form').dataset.glassResponse}));
    assert.equal(solid.renderer, 'solid'); assert.equal(solid.filter, 'none'); assert.equal(solid.checked, 'false'); assert.equal(solid.response, 'disabled');
    await click('#btn-glass'); await settle();
    assert.equal(await evaluate(() => document.documentElement.dataset.glassRenderer), 'backdrop');
    await click('#btn-reduced-motion'); await settle();
    const reduced = await evaluate(() => ({motion: document.documentElement.dataset.glassMotion, running: document.getAnimations().filter(a => a.playState === 'running').length}));
    assert.equal(reduced.motion, 'reduced'); assert.equal(reduced.running, 0);
    await key('#settings-drawer button', 'Escape');
    assert(await evaluate(() => document.querySelector('#settings-drawer').hidden), 'Reduced-motion exit should complete immediately');
    return {solid, reduced};
  });
  await reset(390, 844);
  await check('Narrow layout: sidebar traps focus, makes content inert, Escape restores reading', async () => {
    await click('#btn-sidebar'); await settle();
    const modal = await evaluate(() => {
      const controls = Array.from(document.querySelectorAll('#sidebar button, #sidebar select')).filter(n => !n.disabled && n.getClientRects().length);
      controls.at(-1).focus(); controls.at(-1).dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
      return {mainInert: document.querySelector('#main-stage').inert, focus: document.activeElement.id};
    });
    assert(modal.mainInert && modal.focus === 'btn-sidebar');
    await key('#btn-sidebar', 'Escape'); await settle();
    assert.equal(await evaluate(() => document.querySelector('#main-stage').inert), false);
    assertInViewport(await visibleGeometry('#composer-form'));
    return modal;
  });
}

async function run() {
  assert(fs.existsSync(path.join(__dirname, 'index.html')), 'Prototype index.html has not been created');
  fs.mkdirSync(evidenceDir, {recursive: true});
  await app.whenReady();
  win = new BrowserWindow({show: false, width: 1440, height: 900, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true,
  }});
  // A merely hidden native window may suspend its compositor timeline even
  // with backgroundThrottling disabled. Offscreen painting advances real
  // animations while keeping the test entirely out of the user's desktop.
  win.webContents.setFrameRate(30);
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']}, (details, callback) => {
    report.blockedRemoteRequests.push({scheme: details.url.split(':')[0], resourceType: details.resourceType});
    callback({cancel: true});
  });
  win.webContents.on('console-message', (_event, details) => {
    if (details && typeof details === 'object' && details.level === 'error') report.consoleErrors.push(details.message);
  });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  for (const [width, height] of [[1440, 900], [1280, 800], [960, 720], [390, 844]]) {
    for (const theme of ['day', 'night']) await checkLayout(width, height, theme);
  }
  await testInteractions();
  for (const theme of ['day', 'night']) await testContrast(theme);
  await testReducedMotion();
  await testMotionAndMaterial();
  await captureOpenPanels();
  await check('No renderer errors or remote requests', async () => {
    assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join('\n'));
    assert.equal(report.blockedRemoteRequests.length, 0, 'Prototype attempted remote requests');
    return {rendererErrors: 0, remoteRequests: 0, permissionRequests: 'denied by isolated harness'};
  });
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.every(check => check.passed);
  report.summary = {passed: report.checks.filter(check => check.passed).length, failed: report.checks.filter(check => !check.passed).length, captures: report.captures.length};
  fs.writeFileSync(path.join(evidenceDir, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.passed ? 'ATHENA_COMPANION_PROTOTYPE_OK' : 'ATHENA_COMPANION_PROTOTYPE_FAILED'} ${JSON.stringify(report.summary)}`);
  for (const check of report.checks.filter(check => !check.passed)) console.error(`${check.name}: ${check.error}`);
  win.destroy();
  app.exit(report.passed ? 0 : 1);
}

run().catch(error => {
  report.passed = false;
  report.fatal = error.stack || error.message;
  fs.mkdirSync(evidenceDir, {recursive: true});
  fs.writeFileSync(path.join(evidenceDir, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(error);
  app.exit(1);
});
