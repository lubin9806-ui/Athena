const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { resolveThemePreference } = require(path.join(root, 'dist/renderer/ui/ThemeController.js'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(resolveThemePreference('day', true) === 'day', 'day preference must remain day');
assert(resolveThemePreference('night', false) === 'night', 'night preference must remain night');
assert(resolveThemePreference('system', true) === 'night', 'dark system preference must resolve to night');
assert(resolveThemePreference('system', false) === 'day', 'light system preference must resolve to day');

const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/style.css'), 'utf8');
assert(html.includes('<option value="day">日间</option>'), 'settings must expose the day theme');
assert(html.includes('<option value="night">夜间</option>'), 'settings must expose the night theme');
assert(html.includes('<option value="system">跟随系统</option>'), 'settings must expose system theme following');
assert(css.includes(':root[data-theme="night"]'), 'night design tokens must be scoped to the resolved night theme');
assert(css.includes('#app-shell[data-theme="night"]'), 'night application surfaces must have real CSS treatment');
assert(css.includes('Unified Water-Ice Glass Material'), 'day and night must share the unified glass material layer');
assert(css.includes('--glass-material-fill:'), 'unified glass material tokens must be defined');
assert(css.includes('--glass-mode-haze:'), 'mode changes must retain a restrained glass tint');
assert(css.includes('--glass-mode-text:'), 'active mode labels must retain a visible mode color');
assert(
  css.includes('#app-shell:is([data-theme="day"], [data-theme="night"]) #titlebar'),
  'the titlebar must use the same glass recipe in both resolved themes',
);
assert(
  css.includes('#app-shell:is([data-theme="day"], [data-theme="night"]) #input-form'),
  'the composer must use the same glass recipe in both resolved themes',
);

console.log('theme system OK');
