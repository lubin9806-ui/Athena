(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const root = document.documentElement;
  const app = $('#prototype-app');
  const input = $('#message-input');
  const composer = $('#composer-form');
  const log = $('#chat-log');
  const smallScreen = matchMedia('(max-width: 720px)');
  const systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => root.dataset.reducedMotion === 'true' || systemReducedMotion.matches;
  const motion = new Map();
  let ready = false;
  let renderedConversation = null;
  let renderedMessages = [];
  const scrollPositions = new Map();
  const state = {
    theme: 'day', mode: 'companion', workMode: 'create', drawer: null, drawerTrigger: null,
    menu: false, project: '个人空间', active: 'draft-1', counter: 1, web: false,
    attachments: [], pending: null, nextFailure: false, memoryTab: 'window',
    projectInstructions: new Map(), memories: [], toastTimer: null,
  };

  const conversations = [
    { id: 'draft-1', title: '新对话', date: '现在', project: '个人空间', messages: [], temporary: false, draft: '' },
    { id: 'week', title: '把这一周，过得松一点', date: '今天', project: '个人空间', draft: '', messages: [
      { role: 'user', content: '最近每一天都很满，但又说不清自己忙出了什么。我想把这一周过得松一点。' },
      { role: 'assistant', content: '听起来，你想要的不是再挤出一点效率，而是给自己留一点余地。\n\n我们先从这周的事情里，选出真正重要的一件。其他事情暂时不用一起解决。\n\n你可以想想：如果这周只推进一件事，哪一件会让你觉得轻松一些？', cue: '不用一下子安排好整周。我们先看今天。' },
      { role: 'user', content: '我想把积压的资料整理好，但一想到全部要整理，就不想开始。' },
      { role: 'assistant', content: '那我们把“全部整理好”，换成一个更小的起点。\n\n今天只选一个文件夹，花 15 分钟，把资料分成“正在用”和“以后再看”。不需要同时建立一套完美的分类。\n\n做到时间就停，剩下的留给下一次。', cue: '现在最容易开始的是哪个文件夹？' },
    ] },
    { id: 'idea', title: '一个还没想好的念头', date: '昨天', project: '个人空间', draft: '', messages: [
      { role: 'user', content: '我想开始一个小项目，但还没有完整的计划。' },
      { role: 'assistant', content: '没有完整计划也可以先聊。\n\n你最想通过这个项目解决什么问题？先用一句不那么准确的话描述就好，我们再一起把它理清。' },
    ] },
    { id: 'reading', title: '读书时留下的问题', date: '周一', project: '个人空间', draft: '', messages: [
      { role: 'user', content: '读完一篇文章，怎样判断自己真的理解了？' },
      { role: 'assistant', content: '可以试着离开原文，用自己的话回答三个问题：\n\n它想解决什么问题？\n它用什么理由支撑结论？\n这个结论在什么情况下可能不成立？\n\n说不清的地方，就是适合回到原文再看一次的地方。' },
    ] },
  ];
  const modeCopy = {
    companion: { note: '不用急着得出答案。', title: '在这里，想法可以慢慢成形。', description: '可以聊聊今天，也可以一起把问题理清。', placeholder: '和 Athena 说点什么…', label: '陪伴', prompts: ['聊聊今天', '整理一下心情', '继续上次的话题'], icons: ['chat', 'heart', 'bookmark'] },
    create: { note: '从一个不完整的想法开始。', title: '把心里的想法，写下来。', description: '一起搭框架、找方向，慢慢形成第一稿。', placeholder: '描述想做的文字、画面或方案…', label: '创作', prompts: ['搭一个创作框架', '扩写三个方向', '开始一版初稿'], icons: ['file', 'sliders', 'plus'] },
    reason: { note: '留一点时间，看清问题。', title: '把判断依据，摆出来。', description: '检查假设，比较选择，看看还有什么没被想到。', placeholder: '把问题、条件和目标告诉 Athena…', label: '推理', prompts: ['拆解关键假设', '比较两个方案', '检查遗漏与矛盾'], icons: ['search', 'sliders', 'check'] },
    execute: { placeholder: '用自然语言描述要在电脑上完成的任务…', label: '执行' },
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `assets/icons.svg#icon-${name}`); svg.append(use); return svg;
  }
  const current = () => conversations.find(c => c.id === state.active);
  function animate(node, frames, duration = 260, complete = () => {}) {
    const previous = motion.get(node);
    if (previous) { motion.delete(node); clearTimeout(previous.timer); previous.animation.cancel(); }
    if (reducedMotion() || !ready) { complete(); return; }
    const animation = node.animate(frames, {duration, easing: 'cubic-bezier(.2,.8,.2,1)'});
    const record = {animation, complete, timer: null}; motion.set(node, record);
    const finish = () => {
      if (motion.get(node) !== record) return;
      motion.delete(node); clearTimeout(record.timer); animation.cancel(); complete();
    };
    animation.finished.then(finish).catch(() => {});
    // Background or occluded windows may suspend the compositor timeline.
    // Interaction state must never depend on a future paint to finish closing.
    record.timer = setTimeout(finish, duration + 120);
  }
  function finishMotion() {
    if (!reducedMotion()) return;
    for (const [node, record] of motion) { motion.delete(node); clearTimeout(record.timer); record.animation.cancel(); record.complete(); }
  }
  systemReducedMotion.addEventListener('change', finishMotion);
  function surface(node, open, kind, animated = true) {
    const previous = motion.get(node);
    if (previous) { motion.delete(node); clearTimeout(previous.timer); previous.animation.cancel(); }
    node.inert = !open;
    node.setAttribute('aria-hidden', String(!open));
    const finish = () => { node.hidden = !open; delete node.dataset.transition; };
    if (!animated || reducedMotion() || !ready || (!open && node.hidden)) { finish(); return; }
    node.hidden = false;
    node.dataset.transition = open ? 'opening' : 'closing';
    // Clip reveal keeps a fixed edge inside the viewport without scaling text.
    const frames = kind === 'drawer'
      ? [{opacity: 0, clipPath: 'inset(0 0 0 12% round 14px 0 0 14px)'}, {opacity: 1, clipPath: 'inset(0 round 0px)'}]
      : kind === 'menu'
        ? [{opacity: 0, transform: 'translateY(-6px)'}, {opacity: 1, transform: 'translateY(0)'}]
        : [{opacity: 0}, {opacity: 1}];
    animate(node, open ? frames : [...frames].reverse(), open ? (kind === 'drawer' ? 280 : 180) : 140, finish);
  }
  function toast(text) {
    clearTimeout(state.toastTimer);
    $('#toast').textContent = text; $('#toast').hidden = false;
    state.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
  }
  function setTheme(theme) {
    state.theme = theme; root.dataset.theme = theme;
    $('#btn-theme').setAttribute('aria-label', theme === 'day' ? '切换到夜色主题' : '切换到日光主题');
    $('#btn-theme').replaceChildren(icon(theme === 'day' ? 'moon' : 'sun'));
    $$('[data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme)));
  }
  function sidebar(open) {
    closeMenu(false);
    const stage = $('#main-stage');
    const targets = [$('.space-navigation'), $('.composer-wrap'), $('.empty-content'), log];
    const before = ready && !smallScreen.matches ? targets.map(n => n.getBoundingClientRect().left) : [];
    app.dataset.sidebar = open ? 'open' : 'closed';
    $('#btn-sidebar').setAttribute('aria-expanded', String(open));
    $('#sidebar-scrim').hidden = !(open && smallScreen.matches);
    $('#sidebar').inert = !open;
    $('#sidebar').setAttribute('aria-hidden', String(!open));
    stage.inert = open && smallScreen.matches;
    if (!open && $('#sidebar').contains(document.activeElement)) $('#btn-sidebar').focus();
    if (before.length) targets.forEach((node, index) => {
      const shift = before[index] - node.getBoundingClientRect().left;
      if (Math.abs(shift) > 1 && node.getClientRects().length) animate(node, [{transform: `translateX(${shift}px)`}, {transform: 'translateX(0)'}], 300);
    });
  }
  function renderHistory() {
    const list = $('#conversation-list'); list.replaceChildren();
    conversations.filter(c => c.project === state.project).forEach(c => {
      const b = element('button', 'conversation-link'); b.dataset.conversation = c.id;
      b.setAttribute('aria-current', String(c.id === state.active));
      b.append(element('span', '', c.title), element('span', 'conversation-date', c.temporary ? '临时' : c.date));
      b.addEventListener('click', () => selectConversation(c.id)); list.append(b);
    });
    $('#context-title').textContent = current().title;
    $('#context-project').textContent = state.project;
    $('#execution-project').textContent = state.project;
  }
  function selectConversation(id) {
    if (state.active === id) return;
    cancelReply(); current().draft = input.value; state.active = id;
    input.value = current().draft || ''; state.attachments = []; renderAttachments();
    closeMenu(false); closeDrawer(false); renderHistory(); renderConversation(); syncInput();
    if (smallScreen.matches) sidebar(false);
  }
  function newConversation(temporary = false) {
    cancelReply(); current().draft = input.value;
    const c = { id: `draft-${++state.counter}`, title: temporary ? '临时聊天' : '新对话', temporary, project: state.project, date: '现在', draft: '', messages: [] };
    conversations.unshift(c); state.active = c.id; input.value = ''; state.attachments = [];
    closeMenu(false); closeDrawer(false); renderHistory(); renderConversation(); renderAttachments(); syncInput();
    if (smallScreen.matches) sidebar(false);
    input.focus();
  }
  function renderConversation() {
    const messages = current().messages;
    const stage = $('#conversation-stage');
    const changed = renderedConversation !== state.active;
    const follow = state.followNext || stage.scrollHeight - stage.clientHeight - stage.scrollTop < 96;
    const scrollTop = stage.scrollTop;
    state.followNext = false;
    const isExecute = state.mode === 'execute';
    $('#execution-preview').hidden = !isExecute;
    $('#empty-scene').hidden = isExecute || messages.length > 0;
    log.hidden = isExecute || messages.length === 0;
    $('#temporary-note').hidden = !current().temporary;
    if (changed) { log.replaceChildren(); renderedMessages = []; renderedConversation = state.active; }
    messages.forEach((message, index) => {
      if (renderedMessages[index]?.message === message) return;
      const article = renderMessage(message, index);
      const previous = renderedMessages[index]?.node;
      if (previous) previous.replaceWith(article); else log.append(article);
      renderedMessages[index] = {message, node: article};
      if (!changed) animate(article, [{opacity: .3, transform: 'translateY(6px)'}, {opacity: 1, transform: 'translateY(0)'}], 220);
    });
    while (renderedMessages.length > messages.length) renderedMessages.pop().node.remove();
    // Layout reads already reflect the new DOM. Do not defer this assignment:
    // a delayed frame could otherwise overwrite a user's subsequent scroll.
    if (!isExecute) {
      stage.scrollTop = changed ? (scrollPositions.get(state.active) ?? stage.scrollHeight) : follow ? stage.scrollHeight : scrollTop;
      updateScrollAffordance();
    }
  }
  function updateScrollAffordance() {
    const stage = $('#conversation-stage');
    const away = stage.scrollHeight - stage.clientHeight - stage.scrollTop > 120;
    $('#btn-latest').hidden = !away || log.hidden;
    if (renderedConversation === state.active && !log.hidden) scrollPositions.set(state.active, stage.scrollTop);
  }
  function renderMessage(message, index) {
    const article = element('article', `message ${message.role}`);
    article.dataset.message = String(index);
    if (message.role === 'assistant') {
      const label = element('div', 'message-label', 'Athena'); label.append(element('span', '', '示例回复')); article.append(label);
    }
    if (message.kind === 'pending') {
      const status = element('div', 'thinking-label'); status.append(element('i'), element('span', '', '正在展示示例回复…')); article.append(status); return article;
    }
    if (message.kind === 'error') {
      const box = element('div', 'message-error'); box.append(element('p', '', '这次示例回复没有完成。内容还在，可以重试。'));
      const retry = element('button', 'secondary-button', '重试'); retry.id = 'btn-retry'; retry.addEventListener('click', () => startReply(index, false)); box.append(retry); article.append(box); return article;
    }
    const body = element('div', 'message-body', message.content); article.append(body);
    if (message.attachments?.length) article.append(element('div', 'message-meta', `附件名称预览：${message.attachments.join('、')}`));
    if (message.cue) article.append(element('div', 'reply-cue', message.cue));
    if (message.role === 'assistant' && !message.stopped) {
      const actions = element('div', 'message-actions');
      const copy = element('button', 'icon-button'); copy.setAttribute('aria-label', '复制这条示例回复'); copy.title = '复制回复'; copy.append(icon('copy'));
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(message.content); toast('已复制示例回复。'); }
        catch { toast('当前预览环境不允许写入剪贴板，可选中文字复制。'); }
      });
      const remember = element('button', 'icon-button'); remember.setAttribute('aria-label', '将这条回复加入示例记忆'); remember.title = '加入示例记忆'; remember.append(icon('bookmark'));
      remember.addEventListener('click', () => { if (!state.memories.includes(message.content)) state.memories.push(message.content); toast('已加入本页示例记忆，刷新后清除。'); });
      actions.append(copy, remember); article.append(actions);
    }
    return article;
  }
  function setResponding(value) {
    app.dataset.state = value ? 'responding' : 'idle';
    $('#btn-send').replaceChildren(icon(value ? 'stop' : 'send'));
    $('#btn-send').setAttribute('aria-label', value ? '停止示例回复' : '发送示例消息');
    syncInput();
  }
  function responseFor(text) {
    if (state.mode === 'create') return { content: '我们可以先整理成三个部分：\n\n1. 这份内容想表达什么。\n2. 谁会看到它，对方最关心什么。\n3. 看完之后，希望对方记住哪一句话。\n\n先写一个不求完整的版本，再逐步调整语气和结构。', cue: '这是创作模式的预设示例，正式版本会由所选模型回答。' };
    if (state.mode === 'reason') return { content: '先把问题拆成三个层次：\n\n已知条件：哪些信息已经确定？\n关键假设：结论依赖哪些尚未验证的条件？\n比较标准：你更在意时间、成本，还是结果质量？\n\n明确这三项后，两个方案的差异会更容易看清。', cue: '这是推理模式的预设示例。' };
    if (/累|满|整理|忙|心情|压力|难/.test(text)) return { content: '听起来，你想先把手边的事情理顺一点。\n\n不用一下子处理完。我们可以先选一件最占心思的事，看看它到底需要一个决定、一个具体动作，还是一点休息。\n\n你最想先放下哪一件？', cue: '先从一件小事开始，也很好。' };
    if (/今天|聊聊|上次/.test(text)) return { content: '我在。\n\n今天有没有一件小事，让你想多说几句？开心的、烦心的，或只是一个还没想清楚的念头，都可以。' };
    return { content: '可以，我们慢慢来。\n\n先说说这件事里你最在意的部分。你希望先把想法讲清楚，还是想一起找一个可以开始的小步骤？', cue: '此处为交互样板的预设回复，尚未连接模型。' };
  }
  function startReply(index, shouldFail) {
    if (state.pending) return;
    const c = current();
    const lastUser = [...c.messages].reverse().find(m => m.role === 'user');
    c.messages[index] = { role: 'assistant', kind: 'pending' };
    const response = responseFor(lastUser?.content || '');
    const pending = { conversation: c, index, timer: null };
    state.pending = pending; setResponding(true); renderConversation();
    pending.timer = setTimeout(() => {
      if (state.pending !== pending) return;
      c.messages[index] = shouldFail ? { role: 'assistant', kind: 'error' } : { role: 'assistant', ...response };
      state.pending = null; setResponding(false);
      if (shouldFail) app.dataset.state = 'error';
      if (current() === c) renderConversation();
    }, 850);
  }
  function cancelReply() {
    if (!state.pending) return;
    const p = state.pending; clearTimeout(p.timer);
    p.conversation.messages[p.index] = { role: 'assistant', content: '示例回复已停止。你可以接着补充。', stopped: true };
    state.pending = null; setResponding(false); renderConversation();
  }
  function submit(event) {
    event.preventDefault();
    if (state.pending) { cancelReply(); return; }
    const text = input.value.trim();
    if (!text && !state.attachments.length) return;
    if (state.mode === 'execute') {
      $('#execution-goal').textContent = text || '查看附件';
      input.value = ''; syncInput(); closeMenu(false);
      toast('目标已显示在样板中。电脑工具仍为关闭，没有执行操作。'); return;
    }
    const c = current();
    c.messages.push({ role: 'user', content: text || '看看这些附件。', attachments: state.attachments.map(a => a.name) });
    if (c.title === '新对话') c.title = text.slice(0, 16) || '附件预览';
    input.value = ''; c.draft = ''; state.attachments = []; state.web = false;
    renderAttachments(); updateWeb(); closeMenu(false); renderHistory();
    const fail = state.nextFailure; state.nextFailure = false; $('#demo-error-state').textContent = '';
    state.followNext = true;
    startReply(c.messages.length, fail); input.focus();
  }
  function syncInput() {
    input.style.height = 'auto';
    const max = smallScreen.matches ? 130 : 170;
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 43), max)}px`;
    input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
    $('#btn-send').disabled = !state.pending && !input.value.trim() && !state.attachments.length;
    if (state.menu) positionMenu();
  }
  function setMode(mode) {
    cancelReply(); closeMenu(false);
    state.mode = mode;
    if (mode !== 'companion') state.workMode = mode;
    app.dataset.mode = mode; app.dataset.space = mode === 'companion' ? 'companion' : 'work';
    $$('[data-space][role="tab"]').forEach(b => selectTab(b, b.dataset.space === app.dataset.space));
    $('#work-modes').hidden = mode === 'companion';
    $$('#work-modes [role="tab"]').forEach(b => selectTab(b, b.dataset.mode === state.workMode));
    const copy = modeCopy[mode]; input.placeholder = copy.placeholder;
    $('#mode-caption').textContent = mode === 'execute' ? '执行权限 · 关闭' : `${copy.label} · 纯聊天`;
    if (mode !== 'execute') {
      $('#welcome-note').textContent = copy.note;
      const phrase = copy.title.indexOf('，');
      $('#welcome-title').replaceChildren(element('span', 'heading-phrase', copy.title.slice(0, phrase + 1)), element('span', 'heading-phrase', copy.title.slice(phrase + 1)));
      $('#welcome-description').textContent = copy.description;
      $('#prompt-actions').replaceChildren(...copy.prompts.map((text, index) => {
        const b = element('button'); b.dataset.prompt = text; b.append(icon(copy.icons[index]), element('span', '', text));
        b.addEventListener('click', () => { input.value = text; syncInput(); input.focus(); }); return b;
      }));
    }
    renderConversation(); syncInput();
    if (!$('#empty-scene').hidden) animate($('.empty-content'), [{opacity: .3, transform: 'translateY(5px)'}, {opacity: 1, transform: 'translateY(0)'}], 220);
    if (mode !== 'companion') animate($('#work-modes'), [{opacity: .4, transform: 'translateY(-3px)'}, {opacity: 1, transform: 'translateY(0)'}], 180);
  }
  function selectTab(button, selected) {
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    if (selected) button.parentElement.style.setProperty('--selected-index', [...button.parentElement.querySelectorAll('[role="tab"]')].indexOf(button));
  }
  function positionMenu() {
    if (!state.menu) return;
    const popup = $('#tools-popover'); const box = composer.getBoundingClientRect();
    const headerBottom = $('.titlebar').getBoundingClientRect().bottom;
    popup.style.maxHeight = `${Math.max(72, box.top - headerBottom - 26)}px`;
    popup.style.left = `${Math.max(8, Math.min(box.left + 12, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(headerBottom + 8, box.top - popup.offsetHeight - 12)}px`;
  }
  function openMenu() {
    closeDrawer(false); state.menu = true; surface($('#tools-popover'), true, 'menu');
    $('#btn-more').setAttribute('aria-expanded', 'true'); positionMenu();
    $('#tools-popover [role="menuitem"]').focus();
  }
  function closeMenu(restore = true) {
    const wasOpen = state.menu; state.menu = false; surface($('#tools-popover'), false, 'menu', restore && wasOpen);
    $('#btn-more').setAttribute('aria-expanded', 'false');
    if (wasOpen && restore) $('#btn-more').focus();
  }
  function openDrawer(name, trigger) {
    if (state.drawer === name) { closeDrawer(); return; }
    closeMenu(false); closeDrawer(false);
    state.drawer = name; state.drawerTrigger = trigger;
    surface($(`#${name}-drawer`), true, 'drawer'); surface($('#drawer-scrim'), true, 'scrim');
    if (name === 'memory') renderMemory();
    const mainTrigger = $(`#btn-${name}`); if (mainTrigger) mainTrigger.setAttribute('aria-expanded', 'true');
    $('#workspace').inert = true;
    $(`#${name}-drawer [data-close-drawer]`).focus();
  }
  function closeDrawer(restore = true) {
    const old = state.drawer; const trigger = state.drawerTrigger;
    if (!old) {
      if (!restore) { $$('.drawer').forEach(node => surface(node, false, 'drawer', false)); surface($('#drawer-scrim'), false, 'scrim', false); }
      return;
    }
    surface($(`#${old}-drawer`), false, 'drawer', restore); surface($('#drawer-scrim'), false, 'scrim', restore);
    const b = $(`#btn-${old}`); if (b) b.setAttribute('aria-expanded', 'false');
    state.drawer = null; state.drawerTrigger = null; $('#workspace').inert = false;
    if (restore && trigger) {
      const target = trigger.closest('#tools-popover') ? $('#btn-more') : trigger;
      target.focus();
    }
  }
  function memoryBlock(title, body) { const node = element('section', 'memory-block'); node.append(element('h3', '', title), element('p', '', body)); return node; }
  function renderMemory() {
    const content = $('#memory-content'); content.replaceChildren();
    $$('#memory-tabs [role="tab"]').forEach(b => selectTab(b, b.dataset.memory === state.memoryTab));
    if (state.memoryTab === 'window') {
      content.append(memoryBlock('当前目标', current().messages.length ? '把正在聊的事情，拆成可以开始的一步。' : '当前对话还没有目标。'), memoryBlock('已确认结论', '在实际产品中，这里显示已确认的对话结论。'), memoryBlock('待办事项', '暂无待办事项。'), memoryBlock('Project 文档', '此样板未读取 Project 文档。'));
    } else if (state.memoryTab === 'review') {
      const block = memoryBlock('一条待确认的示例', '喜欢把大的任务拆成小步骤。'); const actions = element('div', 'review-actions');
      ['确认', '忽略'].forEach(label => { const b = element('button', 'secondary-button', label); b.addEventListener('click', () => { if (label === '确认') state.memories.push('喜欢把大的任务拆成小步骤。'); content.replaceChildren(memoryBlock('已处理', '本页示例已处理，没有修改实际记忆。')); }); actions.append(b); });
      block.append(actions); content.append(block);
    } else if (state.memoryTab === 'manage') {
      if (!state.memories.length) content.append(memoryBlock('还没有示例记忆', '点击回复下方的书签按钮，可以体验加入本页记忆。'));
      state.memories.forEach((m, i) => content.append(memoryBlock(`示例 ${i + 1}`, m)));
    } else if (state.memoryTab === 'search') {
      const search = element('input', 'memory-search'); search.placeholder = '检索本页示例记忆'; search.setAttribute('aria-label', '检索示例记忆');
      const result = element('div', 'memory-search-empty', '输入关键词，检索本页添加的示例。');
      search.addEventListener('input', () => { const matches = state.memories.filter(m => m.includes(search.value.trim())); result.textContent = search.value.trim() ? (matches.join('\n\n') || '没有匹配的示例记忆。') : '输入关键词，检索本页添加的示例。'; });
      content.append(search, result);
    } else {
      content.append(memoryBlock('导入记忆', '原型仅展示导入入口。实际记忆导入会有预览与确认步骤。'));
      const b = element('button', 'secondary-button', '查看示例预览'); b.addEventListener('click', () => { state.memoryTab = 'review'; renderMemory(); }); content.append(b);
    }
  }
  function updateWeb() {
    $('#web-caption').hidden = !state.web;
    $('[data-tool="web"]').setAttribute('aria-checked', String(state.web));
  }
  function renderAttachments() {
    const chips = $('#attachment-chips'); chips.replaceChildren(); chips.hidden = !state.attachments.length;
    state.attachments.forEach((a, i) => { const chip = element('div', 'attachment-chip'); const remove = element('button'); remove.type = 'button'; remove.setAttribute('aria-label', `移除附件 ${a.name}`); remove.append(icon('close')); remove.addEventListener('click', () => { state.attachments.splice(i, 1); renderAttachments(); syncInput(); }); chip.append(icon('file'), element('span', '', a.name), remove); chips.append(chip); });
  }
  function openDialog(id) {
    closeMenu(false); closeDrawer(false); $(id).showModal();
  }
  function editProject(create) {
    $('#project-dialog').dataset.creating = String(create);
    $('#project-dialog-title').textContent = create ? '新建 Project' : 'Project 指令';
    $('#project-name').value = create ? '' : state.project;
    $('#project-instructions').value = create ? '' : (state.projectInstructions.get(state.project) || '');
    openDialog('#project-dialog');
  }

  $('#btn-theme').addEventListener('click', () => setTheme(state.theme === 'day' ? 'night' : 'day'));
  $$('[data-theme-choice]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));
  $('#btn-sidebar').addEventListener('click', () => sidebar(app.dataset.sidebar !== 'open'));
  $('#sidebar-scrim').addEventListener('click', () => { sidebar(false); $('#btn-sidebar').focus(); });
  smallScreen.addEventListener('change', () => sidebar(!smallScreen.matches));
  $('#btn-new').addEventListener('click', () => newConversation());
  $('#btn-temporary').addEventListener('click', () => newConversation(true));
  $('#btn-example').addEventListener('click', () => { state.project = '个人空间'; $('#project-select').value = state.project; selectConversation('week'); });
  $('#btn-more').addEventListener('click', () => state.menu ? closeMenu() : openMenu());
  ['memory', 'settings'].forEach(name => $(`#btn-${name}`).addEventListener('click', event => openDrawer(name, event.currentTarget)));
  $$('[data-close-drawer]').forEach(b => b.addEventListener('click', () => closeDrawer()));
  $('#drawer-scrim').addEventListener('click', () => closeDrawer());
  $$('[data-space][role="tab"]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.space === 'companion' ? 'companion' : state.workMode)));
  $$('#work-modes [role="tab"]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#memory-tabs [role="tab"]').forEach(b => b.addEventListener('click', () => { state.memoryTab = b.dataset.memory; renderMemory(); }));
  $$('[role="tablist"]').forEach(tablist => tablist.addEventListener('keydown', event => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')]; const index = tabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  }));
  composer.addEventListener('submit', submit);
  input.addEventListener('input', () => { current().draft = input.value; syncInput(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); composer.requestSubmit(); }
  });
  $('#tools-popover').addEventListener('keydown', event => {
    const items = [...$('#tools-popover').querySelectorAll('button')]; const index = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next].focus();
    } else if (event.key === 'Tab') closeMenu(false);
  });
  $$('[data-tool]').forEach(b => b.addEventListener('click', () => {
    const tool = b.dataset.tool;
    if (tool === 'tools') { openDrawer('tools', b); return; }
    if (tool === 'web') { state.web = !state.web; updateWeb(); closeMenu(); toast(state.web ? '本轮联网的视觉状态已开启，不发起真实搜索。' : '已关闭本轮联网预览。'); return; }
    if (['file', 'document', 'ocr'].includes(tool)) {
      closeMenu(); $('#attachment-input').accept = tool === 'ocr' ? '.pdf' : '';
      $('#attachment-input').click(); return;
    }
    openDialog('#voice-dialog');
    $('#voice-title').textContent = tool === 'read' ? '朗读回复预览' : tool === 'voice' ? '语音对话预览' : '语音输入预览';
  }));
  $('#attachment-input').addEventListener('change', event => {
    state.attachments.push(...[...event.target.files].slice(0, 8 - state.attachments.length).map(file => ({ name: file.name })));
    event.target.value = ''; renderAttachments(); syncInput(); toast('仅显示附件名称，不读取或上传文件。'); input.focus();
  });
  $('#btn-mic').addEventListener('click', () => { $('#voice-title').textContent = '语音输入预览'; openDialog('#voice-dialog'); });
  $('#btn-voice-example').addEventListener('click', () => { $('#voice-dialog').close(); input.value = '今天有点忙，想一起整理一下接下来的安排。'; syncInput(); input.focus(); });
  $('#btn-about').addEventListener('click', () => openDialog('#about-dialog'));
  $$('[data-close-dialog]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#btn-project-new').addEventListener('click', () => editProject(true));
  $('#btn-project-edit').addEventListener('click', () => editProject(false));
  $('#project-form').addEventListener('submit', event => {
    event.preventDefault(); const name = $('#project-name').value.trim(); if (!name) return;
    const creating = $('#project-dialog').dataset.creating === 'true';
    if (creating && [...$('#project-select').options].some(o => o.value === name)) { $('#project-name').setCustomValidity('已有同名 Project，请换一个名称。'); $('#project-name').reportValidity(); return; }
    if (creating) $('#project-select').add(new Option(name, name));
    else if (name !== state.project) { const old = state.project; [...$('#project-select').options].find(o => o.value === old).remove(); $('#project-select').add(new Option(name, name)); conversations.filter(c => c.project === old).forEach(c => { c.project = name; }); }
    state.project = name; $('#project-select').value = name;
    state.projectInstructions.set(name, $('#project-instructions').value); $('#project-dialog').close();
    if (creating) newConversation(); else renderHistory();
    toast('Project 已更新，仅保存在当前页面。');
  });
  $('#project-name').addEventListener('input', event => event.target.setCustomValidity(''));
  $('#project-select').addEventListener('change', event => {
    cancelReply(); current().draft = input.value; state.project = event.target.value;
    const candidate = conversations.find(c => c.project === state.project);
    if (candidate) selectConversation(candidate.id); else newConversation();
    renderHistory();
  });
  $('#font-size').addEventListener('input', event => { root.style.setProperty('--reading-size', `${event.target.value}px`); $('#font-size-value').textContent = `${event.target.value} px`; });
  $('#btn-reduced-motion').addEventListener('click', () => {
    const reduced = $('#btn-reduced-motion').getAttribute('aria-checked') !== 'true'; root.dataset.reducedMotion = String(reduced); $('#btn-reduced-motion').setAttribute('aria-checked', String(reduced));
    finishMotion();
  });
  $('#btn-glass').addEventListener('click', () => {
    const enabled = root.dataset.glass === 'solid';
    root.dataset.glass = enabled ? 'liquid' : 'solid';
    $('#btn-glass').setAttribute('aria-checked', String(enabled));
  });
  $('#conversation-stage').addEventListener('scroll', updateScrollAffordance, {passive: true});
  $('#btn-latest').addEventListener('click', () => {
    const stage = $('#conversation-stage'); stage.scrollTo({top: stage.scrollHeight, behavior: reducedMotion() ? 'instant' : 'smooth'});
    input.focus({preventScroll: true});
  });
  $('#btn-demo-error').addEventListener('click', () => { state.nextFailure = true; $('#demo-error-state').textContent = '下一条示例回复将展示失败状态。'; toast('已准备失败状态。发送一条消息即可体验重试。'); });
  ['#btn-open-execute', '#btn-tools-execute'].forEach(selector => $(selector).addEventListener('click', () => { closeDrawer(false); setMode('execute'); input.focus(); }));
  $$('[data-notice]').forEach(b => b.addEventListener('click', () => toast(b.dataset.notice)));
  $('#btn-reset').addEventListener('click', () => { cancelReply(); location.reload(); });
  document.addEventListener('pointerdown', event => { if (state.menu && !event.target.closest('#tools-popover') && !event.target.closest('#btn-more')) closeMenu(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.menu) { event.preventDefault(); closeMenu(); }
      else if (state.drawer) { event.preventDefault(); closeDrawer(); }
      else if (smallScreen.matches && app.dataset.sidebar === 'open') { sidebar(false); $('#btn-sidebar').focus(); }
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]')) { event.preventDefault(); newConversation(); }
    if (event.key === 'Tab' && state.drawer) {
      const drawer = $(`#${state.drawer}-drawer`);
      const focusable = [...drawer.querySelectorAll('button:not(:disabled),a[href],input,textarea,select,summary,[tabindex="0"]')].filter(n => {
        if (!n.getClientRects().length || n.tabIndex < 0) return false;
        const closed = n.closest('details:not([open])');
        return !closed || n === closed.querySelector('summary');
      });
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    if (event.key === 'Tab' && !state.drawer && smallScreen.matches && app.dataset.sidebar === 'open') {
      const controls = [$('#btn-sidebar'), ...$$('#sidebar button, #sidebar select').filter(n => !n.disabled && n.getClientRects().length)];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  addEventListener('resize', positionMenu);
  new ResizeObserver(() => { if (state.menu) positionMenu(); }).observe(composer);
  sidebar(!smallScreen.matches); setTheme('day'); setMode('companion'); renderHistory(); syncInput();
  ready = true;
})();
