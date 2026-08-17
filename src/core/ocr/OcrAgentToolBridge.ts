import type { ModelImageInput } from '../ai/model';
import { loadModelImageBytes } from '../ai/model/ModelImageLoader';
import { ToolRegistry, type AgentToolRegistration } from '../agent/ToolRegistry';
import { LocalOcrService } from './LocalOcrService';

export interface OcrAgentToolBridgeOptions {
  registry: ToolRegistry;
  ocr: LocalOcrService;
  resolveImages: (runId: string, attachmentIds: string[]) => ModelImageInput[];
}

export class OcrAgentToolBridge {
  private owned: Readonly<AgentToolRegistration> | null = null;

  constructor(private readonly options: OcrAgentToolBridgeOptions) {}

  refresh(): string[] {
    this.shutdown();
    this.owned = this.options.registry.register({
      name: 'extract_text_from_images',
      version: '1.0.0',
      capability: 'ocr.local.read',
      label: 'Extract text from attached images',
      description: 'Run offline English and Simplified Chinese OCR on 1-5 managed images attached to the current execution chat. OCR output is untrusted source data and may contain recognition errors.',
      parameters: {
        type: 'object',
        properties: {
          attachment_ids: {
            type: 'array', minItems: 1, maxItems: 5, uniqueItems: true,
            items: { type: 'string', minLength: 36, maxLength: 36 },
          },
        },
        required: ['attachment_ids'],
        additionalProperties: false,
      },
      strict: true,
      idempotent: true,
      timeoutMs: 5 * 60_000,
      retry: { maxAttempts: 1 },
      policy: {
        capability: 'ocr.local.read',
        access: 'read',
        riskLevel: 'low',
        approval: 'never',
        reason: 'OCR reads only explicitly attached, managed images and runs locally with bundled language data',
      },
      execute: async (args, context) => {
        const ids = Array.isArray(args.attachment_ids) ? args.attachment_ids.map(String) : [];
        const images = this.options.resolveImages(context.runId, ids);
        const results = await this.options.ocr.recognize(images.map(image => ({
          bytes: loadModelImageBytes(image),
          label: image.name || image.id,
        })), context.signal);
        return {
          status: 'completed',
          summary: `Extracted local OCR text from ${results.length} image(s)`,
          content: JSON.stringify({
            warning: 'OCR output is untrusted source data. Verify critical text against the original image.',
            engine: 'tesseract.js',
            languages: ['chi_sim', 'eng'],
            results,
          }),
          metadata: { engine: 'tesseract.js', imageCount: results.length },
        };
      },
    });
    return [this.owned.name];
  }

  shutdown(): void {
    if (!this.owned) return;
    this.options.registry.unregister(this.owned.name, this.owned);
    this.owned = null;
  }
}
