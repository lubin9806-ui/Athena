export interface DropZoneHandlers {
  /**
   * Local paths for the dropped files. Electron removed File.path, so the caller
   * injects a resolver backed by webUtils.getPathForFile in the preload bridge.
   */
  resolveFilePath: (file: File) => string;
  onFiles: (paths: string[]) => void | Promise<void>;
  onText: (text: string) => void | Promise<void>;
  onImageUrl: (url: string) => void | Promise<void>;
  /** Whether the current chat can take attachments at all; a refusal explains itself. */
  canAccept: () => boolean;
  onRefused: (reason: string) => void;
}

const OVERLAY_ID = 'drop-overlay';
const TEXT_AS_ATTACHMENT_CHARS = 2_000;

/**
 * A window-wide drop target: anywhere in the app accepts a file, because that is
 * where people aim. The overlay only appears for drags that actually carry
 * something — a text selection dragged inside the app must not paint the screen.
 *
 * The counter exists because dragenter/dragleave fire for every child element
 * the pointer crosses; tracking depth is what keeps the overlay from flickering
 * as the cursor moves over the composer, the message list, the sidebar.
 */
export class DropZone {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private depth = 0;
  private internalDrag = false;
  private detach: Array<() => void> = [];

  constructor(private readonly handlers: DropZoneHandlers) {
    this.overlay = document.getElementById(OVERLAY_ID) || this.createOverlay();
    this.title = this.overlay.querySelector('.drop-overlay-title') as HTMLElement;
    this.hint = this.overlay.querySelector('.drop-overlay-hint') as HTMLElement;
  }

  start(): void {
    // Text dragged from one part of the app to another is not a drop to accept;
    // without this, selecting a message and dragging it would paint the overlay
    // and swallow the gesture.
    this.bind('dragstart', () => { this.internalDrag = true; });
    this.bind('dragenter', event => this.onDragEnter(event as DragEvent));
    this.bind('dragover', event => this.onDragOver(event as DragEvent));
    this.bind('dragleave', event => this.onDragLeave(event as DragEvent));
    this.bind('drop', event => void this.onDrop(event as DragEvent));
    // A drag that ends outside the window never delivers drop or dragleave.
    this.bind('dragend', () => { this.internalDrag = false; this.hide(); });
    this.bind('blur', () => this.hide());
  }

  stop(): void {
    for (const remove of this.detach.splice(0)) remove();
    this.hide();
  }

  private bind(type: string, handler: (event: Event) => void): void {
    window.addEventListener(type, handler, true);
    this.detach.push(() => window.removeEventListener(type, handler, true));
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.dataset.visible = 'false';
    overlay.setAttribute('aria-hidden', 'true');

    const card = document.createElement('div');
    card.className = 'drop-overlay-card';
    const title = document.createElement('div');
    title.className = 'drop-overlay-title';
    title.textContent = '松开添加到对话';
    const hint = document.createElement('div');
    hint.className = 'drop-overlay-hint';
    hint.textContent = '图片、文档、表格、代码、音频都可以';
    card.append(title, hint);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return overlay;
  }

  private onDragEnter(event: DragEvent): void {
    if (!this.accepts(event)) return;
    event.preventDefault();
    this.depth += 1;
    this.show(describeDrag(event));
  }

  private onDragOver(event: DragEvent): void {
    if (!this.accepts(event)) return;
    // Without both of these the drop never fires and the window navigates to the
    // dropped file instead.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  private onDragLeave(event: DragEvent): void {
    if (!this.accepts(event)) return;
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.hide();
  }

  private async onDrop(event: DragEvent): Promise<void> {
    const accepted = this.accepts(event);
    this.internalDrag = false;
    if (!accepted) return;
    event.preventDefault();
    this.hide();
    const transfer = event.dataTransfer;
    if (!transfer) return;
    if (!this.handlers.canAccept()) {
      this.handlers.onRefused('当前聊天不能添加附件。');
      return;
    }

    const files = Array.from(transfer.files || []);
    if (files.length > 0) {
      const paths = files.map(file => this.handlers.resolveFilePath(file)).filter(Boolean);
      if (paths.length === 0) {
        // Directories arrive as entries with no readable path on some platforms;
        // saying so beats appearing to accept the drop and doing nothing.
        this.handlers.onRefused('没能读取拖入的文件路径，请改用输入框左侧的加号添加。');
        return;
      }
      await this.handlers.onFiles(paths);
      return;
    }

    const url = readImageUrl(transfer);
    if (url) {
      await this.handlers.onImageUrl(url);
      return;
    }

    const text = (transfer.getData('text/plain') || '').trim();
    if (text) await this.handlers.onText(text);
  }

  /**
   * Files are always worth taking, wherever the drag began — a file cannot
   * originate inside the app. Text and URLs only count when they came from
   * somewhere else.
   */
  private accepts(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types || []);
    if (types.includes('Files')) return true;
    if (this.internalDrag) return false;
    return types.includes('text/uri-list') || types.includes('text/plain');
  }

  private show(description: string): void {
    this.title.textContent = '松开添加到对话';
    this.hint.textContent = description;
    this.overlay.dataset.visible = 'true';
    this.overlay.setAttribute('aria-hidden', 'false');
  }

  private hide(): void {
    this.depth = 0;
    this.overlay.dataset.visible = 'false';
    this.overlay.setAttribute('aria-hidden', 'true');
  }
}

/** Whether a text payload is long enough to belong in a file rather than the composer. */
export function shouldStoreTextAsAttachment(text: string): boolean {
  return text.length >= TEXT_AS_ATTACHMENT_CHARS;
}

function describeDrag(event: DragEvent): string {
  const types = Array.from(event.dataTransfer?.types || []);
  if (types.includes('Files')) return '图片、文档、表格、代码、音频都可以';
  if (types.includes('text/uri-list')) return '网页图片会下载后作为附件';
  return '文字会进输入框，长文会存成附件';
}

function readImageUrl(transfer: DataTransfer): string | null {
  const list = transfer.getData('text/uri-list') || '';
  const candidate = list.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'))
    || (transfer.getData('text/plain') || '').trim();
  if (!/^https?:\/\//i.test(candidate)) return null;
  return /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(candidate) ? candidate : null;
}
