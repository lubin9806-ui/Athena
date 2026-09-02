export type ToastTone = 'neutral' | 'success' | 'error';

export class ToastSystem {
  constructor(private readonly region: HTMLElement) {}

  show(message: string, tone: ToastTone = 'neutral', duration = 3200): void {
    const toast = document.createElement('div');
    toast.className = 'ui-toast';
    toast.dataset.tone = tone;

    const text = document.createElement('span');
    text.textContent = message;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.title = '关闭提示';
    dismiss.setAttribute('aria-label', '关闭提示');
    dismiss.textContent = '×';
    toast.append(text, dismiss);

    const remove = (): void => {
      if (!toast.isConnected || toast.dataset.leaving === 'true') return;
      toast.dataset.leaving = 'true';
      const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170;
      window.setTimeout(() => toast.remove(), delay);
    };
    dismiss.addEventListener('click', remove);
    this.region.appendChild(toast);
    window.setTimeout(remove, duration);
  }
}
