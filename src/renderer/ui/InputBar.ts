export class InputBar {
  private busy = false;

  constructor(
    private readonly form: HTMLFormElement,
    private readonly input: HTMLTextAreaElement,
    private readonly button: HTMLButtonElement,
  ) {}

  onSubmit(handler: (value: string) => void | Promise<void>, canSubmitEmpty: () => boolean = () => false): void {
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = this.input.value.trim();
      // While a turn is in flight the control is a stop button, and Enter must
      // leave the draft alone: clearing here would swallow what was typed during
      // the answer, since the send itself is refused further down.
      if (this.busy) return;
      if ((!value && !canSubmitEmpty()) || this.input.disabled || this.button.disabled) return;

      this.clear();
      void handler(value);
    });
  }

  /**
   * Turns the send control into a stop control for the duration of a turn. The
   * composer itself stays live, so a reply can be read and the next message
   * drafted at the same time.
   */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.button.dataset.busy = String(busy);
    this.button.type = busy ? 'button' : 'submit';
    this.button.title = busy ? '停止生成' : '发送';
    this.button.setAttribute('aria-label', busy ? '停止生成' : '发送');
    if (busy) this.button.disabled = false;
  }

  isBusy(): boolean {
    return this.busy;
  }

  onStop(handler: () => void): void {
    this.button.addEventListener('click', () => {
      if (this.busy) handler();
    });
  }

  clear(): void {
    this.input.value = '';
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
    this.button.disabled = disabled;
  }

  setSendDisabled(disabled: boolean): void {
    this.button.disabled = disabled;
  }

  setValue(value: string): void {
    this.input.value = value;
  }

  getValue(): string {
    return this.input.value;
  }

  insertAtCursor(value: string): void {
    if (!value) return;

    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    this.input.setRangeText(value, start, end, 'end');
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  focus(): void {
    this.input.focus();
  }
}
