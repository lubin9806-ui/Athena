/* Small, event-driven optical response for the prototype's glass surfaces.
   A queued frame is consumed once; there is deliberately no idle RAF loop. */
(() => {
  'use strict';

  const root = document.documentElement;
  const supported = CSS.supports('backdrop-filter', 'blur(1px)') ||
    CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const surfaces = [...document.querySelectorAll('#composer-form, #tools-popover, .drawer')];
  const records = new Map(surfaces.map(surface => [surface, {
    inside: false, pressed: false, clientX: 0, clientY: 0,
  }]));
  const pending = new Set();
  let frame = 0;
  let frameCount = 0;
  let enabled = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const unavailable = surface => surface.hidden || surface.inert || surface.getAttribute('aria-hidden') === 'true';

  function reset(surface) {
    const record = records.get(surface);
    record.inside = false;
    record.pressed = false;
    for (const property of ['--glass-x', '--glass-y', '--glass-shift-x', '--glass-shift-y', '--glass-pressure']) {
      surface.style.removeProperty(property);
    }
    surface.dataset.glassResponse = enabled ? 'idle' : 'disabled';
    pending.delete(surface);
    if (!pending.size && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      root.dataset.glassPending = 'false';
    }
  }

  function resetAll() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending.clear();
    surfaces.forEach(reset);
    root.dataset.glassPending = 'false';
  }

  function syncPreferences() {
    const solid = root.dataset.glass === 'solid' || !supported ||
      reduceTransparency.matches || forcedColors.matches;
    const reduced = reduceMotion.matches || root.dataset.reducedMotion === 'true';
    enabled = !solid && !reduced && !document.hidden;
    root.dataset.glassRenderer = solid ? 'solid' : 'backdrop';
    root.dataset.glassMotion = solid ? 'disabled' : reduced ? 'reduced' : 'enabled';
    root.dataset.glassSupport = supported ? 'backdrop' : 'solid';
    resetAll();
  }

  function paintPending() {
    frame = 0;
    root.dataset.glassPending = 'false';
    if (!enabled) return;
    for (const surface of pending) {
      const record = records.get(surface);
      if (!record.inside || unavailable(surface) || !surface.getClientRects().length) {
        reset(surface);
        continue;
      }
      const rect = surface.getBoundingClientRect();
      const x = clamp((record.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((record.clientY - rect.top) / rect.height, 0, 1);
      surface.style.setProperty('--glass-x', `${(x * 100).toFixed(2)}%`);
      surface.style.setProperty('--glass-y', `${(y * 100).toFixed(2)}%`);
      // Only a decoration moves; content and control hit targets remain exact.
      // Sub-pixel travel stays within its one-pixel inset and cannot overflow.
      surface.style.setProperty('--glass-shift-x', `${((x - .5) * .8).toFixed(3)}px`);
      surface.style.setProperty('--glass-shift-y', `${((y - .5) * .8).toFixed(3)}px`);
      surface.style.setProperty('--glass-pressure', record.pressed ? '.998' : '1');
      surface.dataset.glassResponse = record.pressed ? 'pressed' : 'tracking';
    }
    pending.clear();
    root.dataset.glassFrames = String(++frameCount);
  }

  function queue(surface, event, pressed) {
    if (!enabled || unavailable(surface)) return;
    const record = records.get(surface);
    record.inside = true;
    record.clientX = event.clientX;
    record.clientY = event.clientY;
    if (pressed !== undefined) record.pressed = pressed;
    // Semantic feedback follows the input event immediately. Only the optical
    // coordinates wait for the next frame, which may pause in a hidden window.
    surface.dataset.glassResponse = record.pressed ? 'pressed' : 'tracking';
    if (pressed !== undefined) surface.style.setProperty('--glass-pressure', pressed ? '.998' : '1');
    pending.add(surface);
    if (!frame) {
      frame = requestAnimationFrame(paintPending);
      root.dataset.glassPending = 'true';
    }
  }

  for (const surface of surfaces) {
    surface.dataset.glassSurface = surface.id === 'composer-form' ? 'composer' :
      surface.id === 'tools-popover' ? 'menu' : 'drawer';
    surface.addEventListener('pointerenter', event => queue(surface, event, event.buttons > 0), { passive: true });
    surface.addEventListener('pointermove', event => queue(surface, event), { passive: true });
    surface.addEventListener('pointerdown', event => queue(surface, event, true), { passive: true });
    surface.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') reset(surface);
      else queue(surface, event, false);
    }, { passive: true });
    surface.addEventListener('pointerleave', () => reset(surface), { passive: true });
    surface.addEventListener('pointercancel', () => reset(surface), { passive: true });
  }

  // Covers pointer release outside a surface without capturing pointer events
  // or interfering with text selection, input focus or touch scrolling.
  document.addEventListener('pointerup', () => {
    for (const [surface, record] of records) {
      if (!record.pressed) continue;
      record.pressed = false;
      if (record.inside && enabled) queue(surface, record, false);
    }
  }, { passive: true });
  window.addEventListener('blur', resetAll);
  window.addEventListener('pagehide', resetAll);
  document.addEventListener('visibilitychange', syncPreferences);
  const preferences = new MutationObserver(syncPreferences);
  preferences.observe(root, { attributes: true, attributeFilter: ['data-glass', 'data-reduced-motion'] });
  // An exiting panel becomes inert before it is hidden. Retire its decoration
  // immediately, even if no pointerleave is dispatched during the transition.
  const visibility = new MutationObserver(entries => {
    for (const entry of entries) if (unavailable(entry.target)) reset(entry.target);
  });
  surfaces.forEach(surface => visibility.observe(surface, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden'] }));
  for (const query of [reduceMotion, reduceTransparency, forcedColors]) {
    query.addEventListener('change', syncPreferences);
  }

  root.dataset.glassFrames = '0';
  syncPreferences();
  root.dataset.glassReady = 'true';
})();
