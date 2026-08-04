interface SelectBinding {
  select: HTMLSelectElement;
  trigger: HTMLButtonElement;
  observer: MutationObserver;
}

export class SelectControlManager {
  private readonly menu: HTMLDivElement;
  private readonly bindings: SelectBinding[] = [];
  private activeBinding: SelectBinding | null = null;
  private activeIndex = -1;
  private closeTimer: number | null = null;

  constructor(private readonly shell: HTMLElement) {
    this.menu = document.createElement('div');
    this.menu.className = 'athena-select-menu';
    this.menu.setAttribute('role', 'listbox');
    this.menu.setAttribute('aria-hidden', 'true');
    this.menu.dataset.open = 'false';
    shell.appendChild(this.menu);

    document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
    document.addEventListener('scroll', this.handleViewportChange, true);
    window.addEventListener('resize', this.handleViewportChange);
  }

  enhance(root: ParentNode = document): void {
    root.querySelectorAll<HTMLSelectElement>('select:not(.visually-hidden-select):not([multiple])').forEach((select) => {
      if (select.dataset.enhanced === 'true') return;
      this.bind(select);
    });
  }

  sync(): void {
    for (const binding of this.bindings) this.syncBinding(binding);
  }

  dispose(): void {
    this.close(false);
    for (const binding of this.bindings) binding.observer.disconnect();
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    document.removeEventListener('scroll', this.handleViewportChange, true);
    window.removeEventListener('resize', this.handleViewportChange);
    this.menu.remove();
  }

  private bind(select: HTMLSelectElement): void {
    const wrapper = document.createElement('span');
    wrapper.className = 'athena-select';
    select.parentNode?.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add('athena-select-native');
    select.dataset.enhanced = 'true';

    const trigger = document.createElement('button');
    trigger.className = 'athena-select-trigger';
    trigger.type = 'button';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || select.id);
    wrapper.appendChild(trigger);

    const observer = new MutationObserver(() => this.syncBinding(binding));
    const binding: SelectBinding = { select, trigger, observer };
    observer.observe(select, { childList: true, subtree: true, attributes: true });
    this.bindings.push(binding);
    this.syncBinding(binding);

    trigger.addEventListener('click', () => {
      if (this.activeBinding === binding) this.close();
      else this.open(binding);
    });
    trigger.addEventListener('keydown', (event) => this.handleTriggerKeyDown(event, binding));
    select.addEventListener('change', () => this.syncBinding(binding));
  }

  private syncBinding(binding: SelectBinding): void {
    const selected = binding.select.selectedOptions[0];
    binding.trigger.textContent = selected?.label || selected?.textContent || '';
    binding.trigger.disabled = binding.select.disabled;
    binding.trigger.dataset.placeholder = String(!binding.select.value);
    if (this.activeBinding === binding) this.renderOptions(binding);
  }

  private open(binding: SelectBinding): void {
    if (binding.select.disabled) return;
    this.close(false);
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.activeBinding = binding;
    const navigable = this.navigableOptionIndexes(binding.select);
    this.activeIndex = navigable.includes(binding.select.selectedIndex)
      ? binding.select.selectedIndex
      : navigable[0] ?? -1;
    binding.trigger.setAttribute('aria-expanded', 'true');
    binding.trigger.dataset.open = 'true';
    this.menu.dataset.open = 'true';
    this.menu.setAttribute('aria-hidden', 'false');
    this.renderOptions(binding);
    this.positionMenu(binding.trigger);
  }

  private close(animate = true): void {
    if (!this.activeBinding) return;
    const binding = this.activeBinding;
    this.activeBinding = null;
    binding.trigger.setAttribute('aria-expanded', 'false');
    binding.trigger.removeAttribute('aria-activedescendant');
    binding.trigger.dataset.open = 'false';
    this.menu.dataset.open = 'false';
    this.menu.setAttribute('aria-hidden', 'true');
    if (!animate) this.menu.replaceChildren();
    else {
      this.closeTimer = window.setTimeout(() => {
        if (!this.activeBinding) this.menu.replaceChildren();
        this.closeTimer = null;
      }, 180);
    }
  }

  private renderOptions(binding: SelectBinding): void {
    this.menu.replaceChildren();
    Array.from(binding.select.options).forEach((option, index) => {
      const item = document.createElement('button');
      item.className = 'athena-select-option';
      item.type = 'button';
      item.id = `athena-select-option-${binding.select.id}-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === binding.select.selectedIndex));
      item.dataset.active = String(index === this.activeIndex);
      item.disabled = option.disabled;
      item.hidden = option.hidden;
      item.textContent = option.label || option.textContent;
      item.addEventListener('pointerenter', () => {
        this.activeIndex = index;
        this.updateActiveOption();
      });
      item.addEventListener('click', () => this.selectOption(index));
      this.menu.appendChild(item);
    });
    this.updateActiveOption();
  }

  private updateActiveOption(): void {
    const binding = this.activeBinding;
    if (!binding) return;
    this.menu.querySelectorAll<HTMLElement>('.athena-select-option').forEach((option, index) => {
      option.dataset.active = String(index === this.activeIndex && !option.hidden);
    });
    binding.trigger.setAttribute('aria-activedescendant', `athena-select-option-${binding.select.id}-${this.activeIndex}`);
    this.menu.querySelector<HTMLElement>('.athena-select-option[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  private selectOption(index: number): void {
    const binding = this.activeBinding;
    if (!binding || binding.select.options[index]?.disabled) return;
    binding.select.selectedIndex = index;
    binding.select.dispatchEvent(new Event('input', { bubbles: true }));
    binding.select.dispatchEvent(new Event('change', { bubbles: true }));
    this.syncBinding(binding);
    this.close();
    binding.trigger.focus({ preventScroll: true });
  }

  private positionMenu(trigger: HTMLElement): void {
    const rect = trigger.getBoundingClientRect();
    const gap = 7;
    const viewportPadding = 10;
    const width = Math.max(rect.width, 168);
    const estimatedHeight = Math.min(this.menu.scrollHeight || 260, 320);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const openAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - estimatedHeight - gap)
      : Math.min(window.innerHeight - estimatedHeight - viewportPadding, rect.bottom + gap);
    this.menu.style.setProperty('--select-origin-y', openAbove ? '100%' : '0%');
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${Math.max(viewportPadding, top)}px`;
    this.menu.style.width = `${width}px`;
    this.menu.style.maxHeight = `${Math.max(120, openAbove ? rect.top - gap - viewportPadding : spaceBelow)}px`;
  }

  private handleTriggerKeyDown(event: KeyboardEvent, binding: SelectBinding): void {
    const navigable = this.navigableOptionIndexes(binding.select);
    if (!navigable.length) return;
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.activeBinding === binding) this.selectOption(this.activeIndex);
      else this.open(binding);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (this.activeBinding !== binding) this.open(binding);
    if (event.key === 'Home') this.activeIndex = navigable[0];
    else if (event.key === 'End') this.activeIndex = navigable[navigable.length - 1];
    else {
      const currentPosition = Math.max(0, navigable.indexOf(this.activeIndex));
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = navigable[(currentPosition + offset + navigable.length) % navigable.length];
    }
    this.updateActiveOption();
  }

  private navigableOptionIndexes(select: HTMLSelectElement): number[] {
    return Array.from(select.options)
      .map((option, index) => (!option.disabled && !option.hidden ? index : -1))
      .filter(index => index >= 0);
  }

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.activeBinding) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!this.menu.contains(target) && !this.activeBinding.trigger.contains(target)) this.close();
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.activeBinding) this.close();
  };

  private readonly handleViewportChange = (): void => {
    if (this.activeBinding) this.close(false);
  };
}
