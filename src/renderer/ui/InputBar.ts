export class InputBar {
  constructor(
    private readonly form: HTMLFormElement,
    private readonly input: HTMLTextAreaElement,
    private readonly button: HTMLButtonElement,
  ) {}

  onSubmit(handler: (value: string) => void | Promise<void>): void {
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = this.input.value.trim();
      if (!value || this.input.disabled || this.button.disabled) return;

      this.input.value = '';
      void handler(value);
    });
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
