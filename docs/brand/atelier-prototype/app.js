(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const root = document.documentElement, desk = $('#desk'), board = $('#thoughts');
  const narrow = matchMedia('(max-width: 1100px)'), osMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => root.dataset.reducedMotion === 'true' || osMotion.matches;
  const kinds = {idea: '一个念头', anchor: '正在想的事', prompt: '延伸提问', mood: '此刻的感受', quote: '一段摘录', plan: '下一步草稿'};
  const thoughts = [
    {id: 'idea', kind: 'idea', title: '一个还没想好的念头', body: '给下一个小项目，\n留一点空间。', x: .023, y: .21, tilt: -4},
    {id: 'week', kind: 'anchor', title: '把这一周，过得松一点', body: '先为自己留出一个下午。', x: .44, y: .41, tilt: 3},
    {id: 'question', kind: 'prompt', title: '换个角度', body: '如果今天只做一件事，\n什么会让你轻松一点？', x: .933, y: .015, tilt: 3},
    {id: 'feeling', kind: 'mood', title: '今天有点累', body: '先聊聊，不急着解决。', x: .072, y: .882, tilt: -5},
    {id: 'quote', kind: 'quote', title: '读到的一句话', body: '不必完整，也值得开始。', x: .895, y: .918, tilt: 4},
  ];
  thoughts.forEach(t => { t.home = {x: t.x, y: t.y}; t.archived = false; t.steps = []; });
  const edges = [['week', 'question'], ['week', 'quote']];
  const nodes = new Map(), animations = new Map();
  let active = null, connectSource = null, connecting = false, counter = 0, drag = null;
  let lineFrame = 0, lineUntil = 0, toastTimer = null, chatTimer = null, chatContext = null;
  const dialogTriggers = new WeakMap();
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const thought = id => thoughts.find(t => t.id === id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `../companion-prototype/assets/icons.svg#icon-${name}`); svg.append(use); return svg;
  }
  $$('[data-icon]').forEach(n => n.replaceWith(icon(n.dataset.icon)));
  function button(label, cls, action, glyph) { const n = el('button', cls); n.type = 'button'; if (glyph) n.append(icon(glyph)); n.append(el('span', '', label)); n.addEventListener('click', action); return n; }
  function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3000); }
  function animate(n, frames, duration = 280) {
    const old = animations.get(n); if (old) { old.a.cancel(); clearTimeout(old.timer); }
    if (reduced()) { animations.delete(n); return; }
    const a = n.animate(frames, {duration, easing: 'cubic-bezier(.2,.8,.2,1)'});
    const record = {a, timer: null}; animations.set(n, record);
    const finish = () => { if (animations.get(n) !== record) return; clearTimeout(record.timer); a.cancel(); animations.delete(n); };
    a.finished.then(finish).catch(() => {}); record.timer = setTimeout(finish, duration + 120);
  }
  function stopMotion() {
    if (!reduced()) return;
    animations.forEach(r => { r.a.cancel(); clearTimeout(r.timer); }); animations.clear();
    lineUntil = 0; delete desk.dataset.arranging;
  }
  osMotion.addEventListener('change', stopMotion);
  function openDialog(id, trigger = document.activeElement) {
    cancelConnect();
    const dialog = $(id);
    $$('dialog[open]').forEach(d => {
      if (d.id === 'focus-dialog') { saveFocus(); active = null; }
      d.close();
    });
    dialogTriggers.set(dialog, trigger);
    dialog.showModal();
    animate(dialog, [{opacity: .2, transform: 'translateY(12px) scale(.985)'}, {opacity: 1, transform: 'translateY(0) scale(1)'}]);
  }
  function restoreFocus(dialog) {
    const target = dialogTriggers.get(dialog);
    const safe = target?.isConnected && !target.closest('[hidden], [inert]') && target.getClientRects().length && !target.closest('dialog:not([open])');
    (safe ? target : $('#btn-new')).focus({preventScroll: true});
  }
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('click', e => { if (e.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); });
    dialog.addEventListener('close', () => {
      if (dialog.id === 'focus-dialog' && !dialog.open) { saveFocus(); active = null; if (!connecting) nodes.forEach(n => n.dataset.selected = 'false'); }
      if (dialog.id === 'chat-dialog') stopReply();
      // Opening a different dialog must not steal its focus on this queued event.
      if (!document.querySelector('dialog[open]') && !connecting) restoreFocus(dialog);
    });
  });
  $$('[data-close]').forEach(n => n.addEventListener('click', () => n.closest('dialog').close()));

  function makeCard(t) {
    const n = el('article', `thought ${t.kind}`); n.dataset.id = t.id; n.dataset.kind = t.kind; n.dataset.selected = 'false';
    const handle = button('移动', 'grab-handle', () => {}, 'more');
    handle.setAttribute('aria-label', `移动 ${t.title}，方向键调整位置`); handle.title = '拖动摆放；方向键移动，Shift 加速';
    handle.addEventListener('pointerdown', e => startDrag(e, t)); handle.addEventListener('keydown', e => keyMove(e, t));
    const open = button('', 'thought-open', () => connecting ? pickConnection(t.id) : t.kind === 'mood' ? openChat(t.id, open) : openThought(t.id, open));
    open.replaceChildren(el('span', 'thought-kind', kinds[t.kind]), el('h2', '', t.title), el('p', '', t.body));
    const label = el('span', 'thought-open-label', t.kind === 'anchor' ? '打开这个想法' : t.kind === 'prompt' ? '一起展开' : t.kind === 'mood' ? '先聊一会儿' : '点击展开'); label.append(icon('arrow')); open.append(label);
    const link = button('连接', 'thought-link', () => beginConnect(t.id), 'pin'); link.setAttribute('aria-label', `从 ${t.title} 开始连接`);
    n.append(handle, open, link); nodes.set(t.id, n); return n;
  }
  function updateCard(t) {
    const n = nodes.get(t.id); if (!n) return;
    n.querySelector('h2').textContent = t.title;
    n.querySelector('.thought-open > p').textContent = t.steps.length ? `${t.steps.filter(s => s.done).length} / ${t.steps.length} 步已勾选 · 示例草稿` : t.body;
    n.querySelector('.grab-handle').setAttribute('aria-label', `移动 ${t.title}，方向键调整位置`);
    n.querySelector('.thought-link').setAttribute('aria-label', `从 ${t.title} 开始连接`);
  }
  function renderDesk() {
    thoughts.forEach(t => { if (!nodes.has(t.id)) board.append(makeCard(t)); nodes.get(t.id).hidden = t.archived; updateCard(t); });
    $('#desk-empty').hidden = thoughts.some(t => !t.archived);
    const count = thoughts.filter(t => t.archived).length; $('#shelf-count').textContent = count; $('#shelf-count').hidden = !count;
    layout();
  }
  function layout() {
    thoughts.forEach(t => {
      const n = nodes.get(t.id); if (!n || t.archived) return;
      const maxX = Math.max(0, desk.clientWidth - n.offsetWidth - 12), maxY = Math.max(0, desk.clientHeight - n.offsetHeight - 12);
      n.style.setProperty('--x', `${Math.round(6 + t.x * maxX)}px`); n.style.setProperty('--y', `${Math.round(6 + t.y * maxY)}px`); n.style.setProperty('--tilt', `${t.tilt}deg`);
    });
    requestLines();
  }
  function drawLines() {
    const svg = $('#connections'); svg.replaceChildren(); if (narrow.matches) return;
    const r = desk.getBoundingClientRect(); svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    edges.forEach(([a, b]) => {
      if (thought(a)?.archived || thought(b)?.archived) return;
      const start = nodes.get(a)?.getBoundingClientRect(), end = nodes.get(b)?.getBoundingClientRect(); if (!start || !end) return;
      const forward = start.left < end.left;
      const x1 = (forward ? start.right - 10 : start.left + 10) - r.left, x2 = (forward ? end.left + 8 : end.right - 8) - r.left;
      const y1 = start.top + start.height * .48 - r.top, y2 = end.top + end.height * .44 - r.top;
      const bend = Math.max(45, Math.abs(x2 - x1) * .55) * (forward ? 1 : -1);
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`); path.dataset.edge = `${a}:${b}`; svg.append(path);
      for (const [x, y] of [[x1, y1], [x2, y2]]) { const dot = document.createElementNS(svg.namespaceURI, 'circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', '4'); svg.append(dot); }
    });
  }
  function requestLines(until = 0) {
    lineUntil = Math.max(lineUntil, until);
    if (lineFrame) return;
    const frame = () => { lineFrame = 0; drawLines(); if (performance.now() < lineUntil && !reduced()) lineFrame = requestAnimationFrame(frame); };
    lineFrame = requestAnimationFrame(frame);
  }
  function arrange() {
    cancelConnect(); cancelDrag();
    desk.dataset.arranging = 'true'; thoughts.forEach(t => { t.x = t.home.x; t.y = t.home.y; }); layout();
    requestLines(reduced() ? 0 : performance.now() + 450); setTimeout(() => { delete desk.dataset.arranging; }, 460); toast('念头已经各就各位。');
  }
  function startDrag(e, t) {
    if (narrow.matches || e.button !== 0 || connecting) return;
    e.preventDefault(); cancelDrag(); const n = nodes.get(t.id), handle = e.currentTarget;
    drag = {id: t.id, pointer: e.pointerId, handle, x: e.clientX, y: e.clientY, originX: t.x, originY: t.y};
    n.dataset.dragging = 'true'; handle.setPointerCapture(e.pointerId); handle.focus({preventScroll: true});
    handle.addEventListener('pointermove', moveDrag); handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', cancelDrag);
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const t = thought(drag.id), n = nodes.get(t.id);
    t.x = clamp(drag.originX + (e.clientX - drag.x) / Math.max(1, desk.clientWidth - n.offsetWidth - 12), 0, 1);
    t.y = clamp(drag.originY + (e.clientY - drag.y) / Math.max(1, desk.clientHeight - n.offsetHeight - 12), 0, 1); layout();
  }
  function endDrag() {
    if (!drag) return;
    const {handle, pointer, id} = drag; drag = null; delete nodes.get(id).dataset.dragging;
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    handle.removeEventListener('pointermove', moveDrag); handle.removeEventListener('pointerup', endDrag); handle.removeEventListener('pointercancel', cancelDrag); requestLines();
  }
  function cancelDrag() { if (drag) { const t = thought(drag.id); t.x = drag.originX; t.y = drag.originY; endDrag(); layout(); } }
  function keyMove(e, t) {
    const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key]; if (!delta || narrow.matches) return;
    e.preventDefault(); const step = e.shiftKey ? 32 : 10, n = nodes.get(t.id);
    t.x = clamp(t.x + delta[0] * step / Math.max(1, desk.clientWidth - n.offsetWidth - 12), 0, 1);
    t.y = clamp(t.y + delta[1] * step / Math.max(1, desk.clientHeight - n.offsetHeight - 12), 0, 1); layout();
  }
  function beginConnect(source = null) {
    cancelDrag(); if ($('#focus-dialog').open) $('#focus-dialog').close();
    connecting = true; connectSource = source; $('#btn-connect').setAttribute('aria-pressed', 'true'); $('#connection-status').hidden = false;
    $('#connection-instruction').textContent = source ? `已选「${thought(source).title}」，再选一个想法。` : '选两个想法，把它们连起来。';
    nodes.forEach((n, id) => { n.dataset.connecting = 'true'; n.dataset.selected = String(id === source); });
    const next = thoughts.find(t => !t.archived && t.id !== source); if (next) nodes.get(next.id).querySelector('.thought-open').focus({preventScroll: true});
  }
  function cancelConnect() {
    connecting = false; connectSource = null; $('#connection-status').hidden = true; $('#btn-connect').setAttribute('aria-pressed', 'false');
    nodes.forEach(n => { n.dataset.connecting = 'false'; n.dataset.selected = 'false'; });
  }
  function pickConnection(id) {
    if (!connectSource) { beginConnect(id); return; }
    if (connectSource === id) { toast('选另一张想法，就能连起来。'); return; }
    const exists = edges.some(([a, b]) => a === id && b === connectSource || a === connectSource && b === id);
    if (!exists) edges.push([connectSource, id]); cancelConnect(); requestLines(); toast(exists ? '这两个想法已经连在一起。' : '两条思绪，连起来了。展开卡片可以查看或移除关联。');
  }
  function openNew() { $('#new-form').reset(); openDialog('#new-dialog'); $('#new-name').focus(); }
  function addThought(title, body, kind = 'idea') {
    const t = {id: `new-${++counter}`, title, body, kind, archived: false, x: .18 + (counter % 4) * .18, y: .1 + (counter % 3) * .25, tilt: counter % 2 ? -2 : 3, steps: []};
    t.home = {x: t.x, y: t.y}; thoughts.push(t); renderDesk(); animate(nodes.get(t.id), [{opacity: 0}, {opacity: 1}], 320); return t;
  }
  $('#new-form').addEventListener('submit', e => {
    e.preventDefault(); const title = $('#new-name').value.trim(); if (!title) { $('#new-name').setCustomValidity('先写下一个词，也可以。'); $('#new-name').reportValidity(); return; }
    const t = addThought(title, $('#new-body').value.trim() || '这个念头，还可以慢慢展开。'); dialogTriggers.set($('#new-dialog'), nodes.get(t.id).querySelector('.thought-open')); $('#new-dialog').close(); nodes.get(t.id).querySelector('.thought-open').focus({preventScroll: true}); toast('念头放好了。点开它，继续展开。');
  });
  $('#new-name').addEventListener('input', () => $('#new-name').setCustomValidity(''));
  function saveFocus() {
    const t = thought(active); if (!t) return;
    t.title = $('#focus-title').value.trim() || t.title; t.body = $('#focus-body').value; updateCard(t);
  }
  function openThought(id, trigger) {
    const t = thought(id); if (!t) return;
    if (t.archived) { t.archived = false; renderDesk(); }
    openDialog('#focus-dialog', trigger || nodes.get(id).querySelector('.thought-open'));
    active = id; nodes.get(id).dataset.selected = 'true'; $('#focus-kind').textContent = kinds[t.kind];
    $('#focus-title').value = t.title; $('#focus-body').value = t.body; $('#expansion-area').hidden = true; renderPlan(); renderRelations();
  }
  ['#focus-title', '#focus-body'].forEach(id => $(id).addEventListener('input', saveFocus));
  function renderRelations() {
    const list = $('#focus-links'); list.replaceChildren(); const links = edges.filter(e => e.includes(active));
    if (!links.length) list.append(el('p', 'settings-note', '暂时还没有关联。可以和另一条想法连起来。'));
    links.forEach((edge, index) => {
      const id = edge.find(id => id !== active), t = thought(id), row = el('div', 'relation-item');
      row.append(el('span', '', `${t.title}${t.archived ? ' · 已收纳' : ''}`), button('断开', 'text-button', () => { edges.splice(edges.indexOf(edge), 1); renderRelations(); requestLines(); const remaining = [...list.querySelectorAll('button')]; (remaining[Math.min(index, remaining.length - 1)] || $('#btn-focus-connect')).focus(); toast('已断开关联，两个想法都还在。'); }, 'close')); list.append(row);
    });
  }
  function renderPlan() {
    const t = thought(active); if (!t) return; $('#plan-area').hidden = !t.steps.length; const list = $('#plan-steps'); list.replaceChildren();
    t.steps.forEach((step, index) => {
      const row = el('div', 'plan-step'), check = el('input'), text = el('textarea'); check.type = 'checkbox'; check.checked = step.done; check.setAttribute('aria-label', `标记第 ${index + 1} 步`);
      text.value = step.text; text.rows = 2; text.maxLength = 500; text.setAttribute('aria-label', `编辑第 ${index + 1} 步`);
      check.addEventListener('change', () => { step.done = check.checked; updateCard(t); }); text.addEventListener('input', () => { step.text = text.value; }); row.append(check, text); list.append(row);
    });
  }
  $('#btn-expand').addEventListener('click', () => {
    saveFocus(); $('#expansion-copy').textContent = `关于「${thought(active).title}」，如果暂时不考虑“应该怎样”，你真正想保留的是什么？`;
    $('#expansion-area').hidden = false; animate($('#expansion-area'), [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0)'}]); $('#expansion-area').scrollIntoView({block: 'nearest'});
  });
  $('#btn-keep-question').addEventListener('click', () => {
    const source = active, text = $('#expansion-copy').textContent; const t = addThought('换个角度想', text, 'prompt'); edges.push([source, t.id]); renderRelations(); requestLines(); toast('这个问题已经放到桌上，并和原想法相连。');
  });
  $('#btn-plan').addEventListener('click', () => {
    const t = thought(active); if (t.steps.length) { $('#plan-area').scrollIntoView({block: 'nearest'}); return; }
    t.steps = [{text: '用一句话写下：这件事里，我最在意什么。', done: false}, {text: '选一个 15 分钟能开始的小动作，把它写具体。', done: false}, {text: '做完后留一句记录，再决定是否继续。', done: false}];
    renderPlan(); updateCard(t); $('#plan-area').scrollIntoView({block: 'nearest'}); toast('留下三步示例草稿，可以改，也可以撤回；没有执行任何操作。');
  });
  $('#btn-clear-plan').addEventListener('click', () => { const t = thought(active); t.steps = []; renderPlan(); updateCard(t); $('#btn-plan').focus(); });
  $('#btn-focus-connect').addEventListener('click', () => { saveFocus(); beginConnect(active); });
  $('#btn-archive').addEventListener('click', () => { const t = thought(active); saveFocus(); t.archived = true; $('#focus-dialog').close(); renderDesk(); toast('已经收好，可以从底部“收纳”取回。'); });
  function openShelf() {
    const list = $('#shelf-list'); list.replaceChildren(); const saved = thoughts.filter(t => t.archived);
    if (!saved.length) list.append(el('p', 'settings-note', '这里还空着。展开一张卡片，选择“先收起来”，它就会留在这里。'));
    saved.forEach((t, index) => { const row = el('div', 'shelf-item'); row.append(el('h3', '', t.title), el('p', '', t.body.slice(0, 100)), button('放回桌面', 'secondary-button', () => { t.archived = false; renderDesk(); openShelf(); const remaining = [...list.querySelectorAll('button')]; (remaining[Math.min(index, remaining.length - 1)] || $('#shelf-dialog [data-close]')).focus(); toast('已经取回桌面，原来的关联还在。'); }, 'arrow')); list.append(row); });
    if (!$('#shelf-dialog').open) openDialog('#shelf-dialog');
  }
  function addChat(text, role) { const turn = el('div', `chat-turn ${role}`); turn.append(el('span', 'dialog-kicker', role === 'user' ? '你' : 'Athena · 示例回复'), el('p', '', text)); $('#chat-stream').append(turn); animate(turn, [{opacity: 0}, {opacity: 1}], 220); $('#chat-stream').scrollTop = $('#chat-stream').scrollHeight; return turn; }
  function openChat(id = null, trigger = document.activeElement) {
    if ($('#focus-dialog').open) saveFocus(); chatContext = id; openDialog('#chat-dialog', trigger); $('#chat-stream').replaceChildren();
    $('#chat-context').textContent = id ? `从「${thought(id).title}」聊起，不必急着把它变成计划。` : '没有要完成的任务，也可以聊。';
    addChat(id ? '这个念头里，哪一部分最想多说一点？不用一下子讲清楚。' : '我在。今天有没有一件小事，让你想多说几句？', 'assistant'); $('#chat-input').value = ''; syncChat(); $('#chat-input').focus();
  }
  function syncChat() { $('#btn-chat-send').disabled = !chatTimer && !$('#chat-input').value.trim(); }
  function stopReply() {
    if (!chatTimer) return; clearTimeout(chatTimer); chatTimer = null;
    const pending = $('#chat-stream [data-pending]'); if (pending) { pending.querySelector('p').textContent = '示例回复已停止。'; delete pending.dataset.pending; }
    $('#btn-chat-send').replaceChildren(icon('send')); $('#btn-chat-send').setAttribute('aria-label', '发送示例消息'); syncChat();
  }
  $('#chat-form').addEventListener('submit', e => {
    e.preventDefault(); if (chatTimer) { stopReply(); return; }
    const text = $('#chat-input').value.trim(); if (!text) return; addChat(text, 'user'); $('#chat-input').value = '';
    const pending = addChat('正在展示示例回复…', 'assistant'); pending.dataset.pending = 'true'; $('#btn-chat-send').replaceChildren(icon('stop')); $('#btn-chat-send').setAttribute('aria-label', '停止示例回复');
    chatTimer = setTimeout(() => { chatTimer = null; delete pending.dataset.pending; pending.querySelector('p').textContent = /累|压力|烦|忙/.test(text) ? '听起来，你现在更需要一点余地。不急着解决，我们可以先说说最让你耗神的那一件事。' : '可以慢慢说。先从这件事里最在意的部分开始，想不完整也没有关系。'; $('#btn-chat-send').replaceChildren(icon('send')); $('#btn-chat-send').setAttribute('aria-label', '发送示例消息'); syncChat(); $('#chat-stream').scrollTop = $('#chat-stream').scrollHeight; }, 700);
    syncChat();
  });
  $('#chat-input').addEventListener('input', syncChat);
  $('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('#chat-form').requestSubmit(); } });
  function openSearch() { openDialog('#search-dialog'); $('#search-input').value = ''; renderSearch(); $('#search-input').focus(); }
  function renderSearch() {
    const q = $('#search-input').value.trim().toLocaleLowerCase(), list = $('#search-results'); list.replaceChildren();
    const actions = [['记个念头', openNew, 'plus'], ['整理桌面', arrange, 'sliders'], ['一起聊', () => openChat(), 'chat'], ['打开收纳', openShelf, 'folder']];
    actions.filter(([label]) => !q || label.includes(q)).forEach(([label, fn, glyph]) => list.append(button(label, 'search-result', () => { $('#search-dialog').close(); fn(); }, glyph)));
    thoughts.filter(t => !q || `${t.title} ${t.body}`.toLocaleLowerCase().includes(q)).forEach(t => list.append(button(`${t.title}${t.archived ? ' · 已收纳，点击取回' : ''}`, 'search-result', () => { $('#search-dialog').close(); openThought(t.id); }, t.archived ? 'folder' : 'file')));
    if (!list.children.length) list.append(el('p', 'settings-note', '没有找到。换一个词，或者把它记成新的念头。'));
  }
  $('#search-input').addEventListener('input', renderSearch);
  $('#search-dialog').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const results = [...$('#search-results').querySelectorAll('button')]; if (!results.length) return;
    const i = results.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : results.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; results[next].focus(); }
    if (e.key === 'Enter' && document.activeElement === $('#search-input') && !e.isComposing) { e.preventDefault(); results[0].click(); }
  });
  $('#btn-new').addEventListener('click', openNew); $('#btn-empty-new').addEventListener('click', openNew);
  $('#btn-arrange').addEventListener('click', arrange); $('#btn-connect').addEventListener('click', () => connecting ? cancelConnect() : beginConnect());
  $('#btn-cancel-connect').addEventListener('click', () => { cancelConnect(); $('#btn-connect').focus(); });
  $('#btn-chat').addEventListener('click', () => openChat()); $('#btn-focus-chat').addEventListener('click', () => openChat(active, nodes.get(active).querySelector('.thought-open')));
  $('#btn-shelf').addEventListener('click', openShelf); $('#btn-search').addEventListener('click', openSearch); $('#btn-search-dock').addEventListener('click', openSearch);
  $('#btn-settings').addEventListener('click', () => openDialog('#settings-dialog'));
  $('#btn-theme').addEventListener('click', () => { const night = root.dataset.theme !== 'night'; root.dataset.theme = night ? 'night' : 'day'; $('#btn-theme').replaceChildren(icon(night ? 'moon' : 'sun')); $('#btn-theme').setAttribute('aria-label', night ? '切换日光' : '切换夜色'); });
  $('#setting-glass').addEventListener('change', e => { root.dataset.glass = e.target.checked ? 'liquid' : 'solid'; });
  $('#setting-motion').addEventListener('change', e => { root.dataset.reducedMotion = String(e.target.checked); stopMotion(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { if (drag) cancelDrag(); else if (connecting) { cancelConnect(); $('#btn-connect').focus(); } }
  });
  new ResizeObserver(() => { if (drag) cancelDrag(); layout(); }).observe(desk);
  narrow.addEventListener('change', () => { cancelDrag(); layout(); });
  window.addEventListener('blur', cancelDrag);

  // Web glass approximation: one paint for coalesced pointer events, no idle loop.
  const surfaces = $$('.glass'), transparency = matchMedia('(prefers-reduced-transparency: reduce)'), forced = matchMedia('(forced-colors: active)');
  let glassFrame = 0; const glassPending = new Map();
  function glassEnabled() { return CSS.supports('backdrop-filter', 'blur(1px)') && root.dataset.glass !== 'solid' && !reduced() && !transparency.matches && !forced.matches; }
  function resetGlass(n) { glassPending.delete(n); delete n.dataset.pressed; n.style.removeProperty('--glass-x'); n.style.removeProperty('--glass-y'); if (!glassPending.size && glassFrame) { cancelAnimationFrame(glassFrame); glassFrame = 0; } }
  function resetAllGlass() { surfaces.forEach(resetGlass); }
  surfaces.forEach(n => {
    n.addEventListener('pointermove', e => {
      if (!glassEnabled()) return; glassPending.set(n, {x: e.clientX, y: e.clientY});
      if (!glassFrame) glassFrame = requestAnimationFrame(() => { glassFrame = 0; glassPending.forEach((p, surface) => { const r = surface.getBoundingClientRect(); surface.style.setProperty('--glass-x', `${clamp((p.x - r.left) / r.width * 100, 0, 100)}%`); surface.style.setProperty('--glass-y', `${clamp((p.y - r.top) / r.height * 100, 0, 100)}%`); }); glassPending.clear(); });
    }, {passive: true});
    n.addEventListener('pointerdown', () => { if (glassEnabled()) n.dataset.pressed = 'true'; }, {passive: true});
    ['pointerleave', 'pointercancel', 'pointerup'].forEach(type => n.addEventListener(type, () => resetGlass(n), {passive: true}));
  });
  new MutationObserver(resetAllGlass).observe(root, {attributes: true, attributeFilter: ['data-glass', 'data-reduced-motion']});
  [osMotion, transparency, forced].forEach(q => q.addEventListener('change', resetAllGlass)); window.addEventListener('blur', resetAllGlass);
  renderDesk();
})();
