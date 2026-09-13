const root = document.documentElement;
const demo = document.querySelector('.app-demo');
const input = document.querySelector('#demo-input');
const send = document.querySelector('#send-demo');
const statePicker = document.querySelector('#state-picker');
const panel = document.querySelector('#settings-panel');
const settingsToggle = document.querySelector('#settings-toggle');
let currentMode = 'create';
const copy = {
  companion: ['从你正在想的事情开始。', '不必一次说完整，我们可以一起把它理清楚。'],
  create: ['让一个想法，逐渐完整。', '从草稿出发，整理结构，再推敲具体表达。'],
  reason: ['先把问题看清楚。', '分清事实与假设，对照依据，比较不同选择。'],
  execute: ['明确目标，再开始行动。', '执行空间沿用同一套视觉。本页仅为界面样例，不调用电脑工具。'],
};
function updateSwatches() {
  const style = getComputedStyle(root);
  document.querySelectorAll('.swatch').forEach(swatch => {
    const value = style.getPropertyValue(`--athena-${swatch.dataset.token}`).trim();
    swatch.querySelector('div').style.background = value;
    swatch.querySelector('code').textContent = value.toUpperCase();
  });
}
function toggleTheme() {
  const night = root.dataset.theme !== 'night';
  root.dataset.theme = night ? 'night' : 'day';
  const toggle = document.querySelector('#theme-toggle');
  toggle.textContent = night ? '切换日光' : '切换夜色';
  toggle.setAttribute('aria-pressed', String(night));
  document.querySelector('#panel-theme-toggle').textContent = night ? '切换为日光' : '切换为夜色';
  updateSwatches();
}
function updateSend() {
  send.disabled = demo.dataset.state !== 'working' && !input.value.trim();
}
function setState(state) {
  demo.dataset.state = state;
  statePicker.value = state;
  const labels = {idle:'初始 · 设计样例', working:'正在处理 · 状态样例', success:'已完成 · 状态样例', error:'连接失败 · 状态样例，可重试'};
  document.querySelector('#demo-status').textContent = labels[state];
  send.textContent = state === 'working' ? '停止预览' : state === 'error' ? '预览重试' : '预览提交';
  const result = document.querySelector('#sample-result');
  result.hidden = state !== 'success';
  result.textContent = '完成态样例：结果应当清楚说明完成了什么，并给出可继续的下一步。';
  updateSend();
}
function setSpace(space) {
  demo.dataset.space = space;
  document.querySelectorAll('.space-switch button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.space === space)));
  document.querySelector('.work-switch').hidden = space !== 'work';
  const activeCopy = copy[space === 'companion' ? 'companion' : currentMode];
  document.querySelector('#demo-title').textContent = activeCopy[0];
  document.querySelector('#demo-description').textContent = activeCopy[1];
}
function closeSettings() {
  panel.hidden = true;
  settingsToggle.setAttribute('aria-expanded', 'false');
  settingsToggle.focus({preventScroll:true});
}
document.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
document.querySelector('#panel-theme-toggle').addEventListener('click', toggleTheme);
document.querySelector('#solid-toggle').addEventListener('change', event => root.dataset.solid = String(event.target.checked));
document.querySelectorAll('.space-switch button').forEach(button => button.addEventListener('click', () => setSpace(button.dataset.space)));
document.querySelectorAll('.work-switch button').forEach(button => button.addEventListener('click', () => {
  currentMode = button.dataset.mode;
  document.querySelectorAll('.work-switch button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  setSpace('work');
}));
statePicker.addEventListener('change', () => setState(statePicker.value));
input.addEventListener('input', updateSend);
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  input.value = button.dataset.prompt;
  input.dispatchEvent(new Event('input'));
  input.focus({preventScroll:true});
}));
document.querySelector('#demo-form').addEventListener('submit', event => {
  event.preventDefault();
  if (demo.dataset.state === 'working') setState('idle');
  else if (input.value.trim()) setState('working');
});
document.querySelector('#new-demo').addEventListener('click', () => {
  input.value = '';
  setState('idle');
  input.focus({preventScroll:true});
});
settingsToggle.addEventListener('click', () => {
  if (!panel.hidden) return closeSettings();
  panel.hidden = false;
  settingsToggle.setAttribute('aria-expanded', 'true');
  document.querySelector('#settings-close').focus({preventScroll:true});
});
document.querySelector('#settings-close').addEventListener('click', closeSettings);
document.addEventListener('keydown', event => {if(event.key === 'Escape' && !panel.hidden) closeSettings();});
updateSwatches();
setState('idle');
