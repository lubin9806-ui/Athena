import { INTERFACE_PRESETS, DEFAULT_INTERFACE_PRESET, resolveInterfacePreset } from '../../shared/interfacePresets';
import type { InterfacePreset } from '../../shared/types/settings';

/** Only changes presentation attributes. Never recreates chat, tasks or inputs. */
export class InterfacePresetController {
  private requested: InterfacePreset = DEFAULT_INTERFACE_PRESET;
  private pending: Promise<void> | null = null;
  private readonly buttons = new Map<InterfacePreset, HTMLButtonElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly shell: HTMLElement,
    private readonly host: HTMLElement,
    private readonly feedback: HTMLElement,
    private readonly persist: (preset: InterfacePreset) => Promise<InterfacePreset>,
  ) {
    for (const preset of INTERFACE_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'interface-preset-option';
      button.dataset.preset = preset.id; button.setAttribute('role', 'radio');
      const label = document.createElement('strong'); label.textContent = preset.label;
      const description = document.createElement('span'); description.textContent = preset.description;
      const badge = document.createElement('small');
      badge.textContent = preset.status === 'prototype' ? '开发中 · 尚不可应用' : preset.id === DEFAULT_INTERFACE_PRESET ? '默认' : '可选';
      button.append(label, badge, description);
      button.disabled = preset.status !== 'ready';
      button.addEventListener('click', () => { void this.select(preset.id); });
      button.addEventListener('keydown', event => {
        if (event.isComposing || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const enabled = [...this.buttons.values()].filter(n => !n.disabled);
        const i = enabled.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
          : (i + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next]?.focus(); enabled[next]?.click();
      });
      host.append(button); this.buttons.set(preset.id, button);
    }
    this.apply(DEFAULT_INTERFACE_PRESET);
  }

  get preference(): InterfacePreset { return this.requested; }
  whenIdle(): Promise<void> { return this.pending || Promise.resolve(); }

  apply(value: unknown): void {
    const resolved = resolveInterfacePreset(value);
    this.requested = resolved.requested;
    for (const target of [this.root, this.shell]) {
      target.dataset.interfacePreset = resolved.effective;
      target.dataset.interfacePreference = resolved.requested;
    }
    for (const [id, button] of this.buttons) {
      button.setAttribute('aria-checked', String(id === resolved.effective));
      button.tabIndex = id === resolved.effective ? 0 : -1;
    }
    this.feedback.textContent = resolved.available
      ? '选择后单独保存。不会修改本页其他设置，也不会重开当前对话。'
      : '随心桌面尚未接入真实数据，暂用日光界面。原选择已保留，可改选其他方案。';
  }

  select(value: InterfacePreset): Promise<void> {
    if (this.pending) return this.pending;
    const resolution = resolveInterfacePreset(value);
    if (!resolution.available || value === this.requested) return Promise.resolve();
    const previous = this.requested;
    this.host.setAttribute('aria-busy', 'true');
    for (const button of this.buttons.values()) button.disabled = true;
    this.feedback.textContent = '正在保存界面方案…';
    // The old scheme remains visible until the durable write succeeds.
    this.pending = this.persist(value).then(saved => {
      this.apply(saved);
      this.feedback.textContent = `已应用${INTERFACE_PRESETS.find(p => p.id === saved)?.label || '日光'}。对话和草稿保留在原处。`;
    }).catch(() => {
      this.apply(previous);
      this.feedback.textContent = '主题保存失败，已保留原界面。请重试。';
    }).finally(() => {
      this.pending = null; this.host.setAttribute('aria-busy', 'false');
      for (const definition of INTERFACE_PRESETS) this.buttons.get(definition.id)!.disabled = definition.status !== 'ready';
      if (this.host.getClientRects().length && !this.host.closest('[inert], [aria-hidden="true"]')) {
        this.buttons.get(resolveInterfacePreset(this.requested).effective)?.focus({preventScroll: true});
      }
    });
    return this.pending;
  }
}
