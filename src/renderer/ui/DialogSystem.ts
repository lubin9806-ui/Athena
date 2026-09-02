export type DialogTone = 'neutral' | 'danger';

export interface DialogField {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
}

export interface DialogRequest {
  eyebrow?: string;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  fields?: DialogField[];
}

type DialogResult = Record<string, string> | null;

export class DialogSystem {
  private readonly dialog: HTMLDialogElement;
  private readonly form: HTMLFormElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly fields: HTMLElement;
  private readonly error: HTMLElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private resolveCurrent: ((result: DialogResult) => void) | null = null;
  private activeFields: DialogField[] = [];
  private returnFocus: HTMLElement | null = null;
  private isClosing = false;

  constructor(root: ParentNode = document) {
    this.dialog = getElement<HTMLDialogElement>(root, 'ui-dialog');
    this.form = getElement<HTMLFormElement>(root, 'ui-dialog-form');
    this.eyebrow = getElement<HTMLElement>(root, 'ui-dialog-eyebrow');
    this.title = getElement<HTMLElement>(root, 'ui-dialog-title');
    this.message = getElement<HTMLElement>(root, 'ui-dialog-message');
    this.fields = getElement<HTMLElement>(root, 'ui-dialog-fields');
    this.error = getElement<HTMLElement>(root, 'ui-dialog-error');
    this.cancelButton = getElement<HTMLButtonElement>(root, 'ui-dialog-cancel');
    this.confirmButton = getElement<HTMLButtonElement>(root, 'ui-dialog-confirm');

    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.submit();
    });
    this.cancelButton.addEventListener('click', () => this.finish(null));
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.finish(null);
    });
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.finish(null);
    });
  }

  async confirm(request: Omit<DialogRequest, 'fields'>): Promise<boolean> {
    return (await this.open(request)) !== null;
  }

  async prompt(request: DialogRequest & { fields: DialogField[] }): Promise<Record<string, string> | null> {
    return this.open(request);
  }

  private open(request: DialogRequest): Promise<DialogResult> {
    if (this.resolveCurrent) this.finish(null, false, true);

    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.activeFields = request.fields ?? [];
    this.isClosing = false;
    delete this.dialog.dataset.closing;
    this.dialog.dataset.tone = request.tone ?? 'neutral';
    this.eyebrow.textContent = request.eyebrow ?? (request.tone === 'danger' ? '请确认操作' : 'Athena');
    this.title.textContent = request.title;
    this.message.textContent = request.message ?? '';
    this.message.hidden = !request.message;
    this.error.textContent = '';
    this.error.hidden = true;
    this.cancelButton.textContent = request.cancelLabel ?? '取消';
    this.confirmButton.textContent = request.confirmLabel ?? '确认';
    this.renderFields(this.activeFields);

    const result = new Promise<DialogResult>(resolve => {
      this.resolveCurrent = resolve;
    });
    this.dialog.showModal();
    requestAnimationFrame(() => {
      const firstField = this.fields.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
      if (firstField) {
        firstField.focus();
        if (!firstField.value) return;
        firstField.setSelectionRange(firstField.value.length, firstField.value.length);
      } else {
        this.confirmButton.focus();
      }
    });
    return result;
  }

  private renderFields(fields: DialogField[]): void {
    this.fields.replaceChildren();
    this.fields.hidden = fields.length === 0;
    for (const field of fields) {
      const label = document.createElement('label');
      label.className = 'ui-dialog-field';

      const caption = document.createElement('span');
      caption.className = 'ui-dialog-field-label';
      caption.textContent = field.label;

      const control = field.multiline ? document.createElement('textarea') : document.createElement('input');
      control.name = field.name;
      control.value = field.value ?? '';
      control.placeholder = field.placeholder ?? '';
      control.required = field.required ?? false;
      if (field.maxLength) control.maxLength = field.maxLength;
      if (control instanceof HTMLTextAreaElement) control.rows = 4;
      control.addEventListener('input', () => {
        this.error.textContent = '';
        this.error.hidden = true;
        control.removeAttribute('aria-invalid');
      });

      label.append(caption, control);
      if (field.hint) {
        const hint = document.createElement('span');
        hint.className = 'ui-dialog-field-hint';
        hint.textContent = field.hint;
        label.appendChild(hint);
      }
      this.fields.appendChild(label);
    }
  }

  private submit(): void {
    const values: Record<string, string> = {};
    for (const field of this.activeFields) {
      const control = this.form.elements.namedItem(field.name);
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) continue;
      const value = control.value.trim();
      if (field.required && !value) {
        control.setAttribute('aria-invalid', 'true');
        this.error.textContent = `请填写${field.label}。`;
        this.error.hidden = false;
        control.focus();
        return;
      }
      values[field.name] = value;
    }
    this.finish(values);
  }

  private finish(result: DialogResult, restoreFocus = true, immediate = false): void {
    if (!this.resolveCurrent || this.isClosing) return;
    this.isClosing = true;
    const resolve = this.resolveCurrent;
    const focusTarget = this.returnFocus;
    const finalize = (): void => {
      this.resolveCurrent = null;
      this.isClosing = false;
      delete this.dialog.dataset.closing;
      if (this.dialog.open) this.dialog.close();
      resolve(result);
      if (restoreFocus && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
      this.returnFocus = null;
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.dialog.open || immediate || reduceMotion) {
      finalize();
      return;
    }
    this.dialog.dataset.closing = 'true';
    window.setTimeout(finalize, 150);
  }
}

function getElement<T extends HTMLElement>(root: ParentNode, id: string): T {
  const element = root.querySelector(`#${id}`);
  if (!element) throw new Error(`Missing element: #${id}`);
  return element as T;
}
