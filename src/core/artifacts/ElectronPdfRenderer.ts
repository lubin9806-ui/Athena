import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import type { PdfRenderer } from './DocumentArtifactService';

export class ElectronPdfRenderer implements PdfRenderer {
  async render(html: string, signal: AbortSignal): Promise<Buffer> {
    if (signal.aborted) throw abortError(signal);
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        images: false,
        partition: `artifact-pdf-${randomUUID()}`,
      },
    });
    const onAbort = () => window.destroy();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      if (signal.aborted) throw abortError(signal);
      return await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (!window.isDestroyed()) window.destroy();
    }
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('PDF generation was cancelled');
}
