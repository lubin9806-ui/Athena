import { createHash } from 'crypto';
import { ToolRegistry, type AgentToolRegistration } from '../agent/ToolRegistry';
import { ArtifactWorkspaceService } from './ArtifactWorkspaceService';
import {
  DocumentArtifactService,
  type DocumentArtifactFormat,
  type DocumentSectionInput,
} from './DocumentArtifactService';
import {
  inspectImage,
  type ImageGenerationProvider,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageSize,
} from './OpenAIImageGenerationProvider';

export interface ArtifactAgentToolBridgeOptions {
  registry: ToolRegistry;
  workspace: ArtifactWorkspaceService;
  documents: DocumentArtifactService;
  images: ImageGenerationProvider;
  canWriteArtifacts: () => boolean;
  canGenerateImages: () => boolean;
  hasImageCredential: () => boolean;
}

export class ArtifactAgentToolBridge {
  private readonly owned = new Map<string, Readonly<AgentToolRegistration>>();

  constructor(private readonly options: ArtifactAgentToolBridgeOptions) {}

  refresh(): string[] {
    this.clearOwned();
    const pending = new Map<string, Readonly<AgentToolRegistration>>();
    try {
      if (this.options.canWriteArtifacts()) this.registerDocumentTool(pending);
      if (this.options.canWriteArtifacts() && this.options.canGenerateImages() && this.options.hasImageCredential()) {
        this.registerImageTool(pending);
      }
      for (const [name, definition] of pending) this.owned.set(name, definition);
      return Array.from(this.owned.keys()).sort();
    } catch (error) {
      for (const [name, definition] of pending) this.options.registry.unregister(name, definition);
      throw error;
    }
  }

  shutdown(): void {
    this.clearOwned();
  }

  private registerDocumentTool(pending: Map<string, Readonly<AgentToolRegistration>>): void {
    const definition = this.options.registry.register({
      name: 'create_document_artifact',
      version: '1.0.0',
      capability: 'artifact.document.files',
      label: 'Create document artifact',
      description: 'Create a real Markdown, HTML, DOCX, or PDF document inside the active Project artifact directory. Use structured sections and choose the format the user actually needs. The file is validated and recorded as a durable task artifact.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          format: { type: 'string', enum: ['markdown', 'html', 'docx', 'pdf'] },
          filename: { type: 'string', minLength: 1, maxLength: 120 },
          sections: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                heading: { type: 'string', maxLength: 500 },
                body: { type: 'string', minLength: 1, maxLength: 200000 },
              },
              required: ['body'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'format', 'sections'],
        additionalProperties: false,
      },
      strict: true,
      idempotent: false,
      timeoutMs: 120_000,
      retry: { maxAttempts: 1 },
      policy: {
        capability: 'artifact.document.files',
        access: 'write',
        riskLevel: 'high',
        approval: 'always',
        reason: 'Document generation persistently writes a validated file inside the active Project workspace',
      },
      execute: async (args, context) => {
        this.requireWritePermission();
        const format = args.format as DocumentArtifactFormat;
        const title = String(args.title);
        const rendered = await this.options.documents.render({
          title,
          format,
          sections: args.sections as DocumentSectionInput[],
        }, context.signal);
        const artifact = this.options.workspace.persist({
          runId: context.runId,
          stepId: context.stepId,
          idempotencyKey: context.idempotencyKey,
          kind: `document.${format}`,
          name: title,
          filename: typeof args.filename === 'string' ? args.filename : title,
          extension: rendered.extension,
          contentType: rendered.contentType,
          bytes: rendered.bytes,
          validate: rendered.validate,
          metadata: { format, generator: 'athena-native-document' },
        });
        return artifactResult(artifact, `Created ${format.toUpperCase()} document ${artifact.record.name}`);
      },
    });
    pending.set(definition.name, definition);
  }

  private registerImageTool(pending: Map<string, Readonly<AgentToolRegistration>>): void {
    const definition = this.options.registry.register({
      name: 'generate_image_artifact',
      version: '1.0.0',
      capability: 'artifact.image.network',
      label: 'Generate image artifact',
      description: 'Generate one image with the configured OpenAI GPT Image provider, then validate and save it inside the active Project artifact directory. The prompt leaves the device and the API request can incur charges, so every call requires approval.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 32000 },
          filename: { type: 'string', minLength: 1, maxLength: 120 },
          size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', 'auto'] },
          quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'] },
          output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
          output_compression: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['prompt', 'size', 'quality', 'output_format'],
        additionalProperties: false,
      },
      strict: true,
      idempotent: false,
      timeoutMs: 10 * 60_000,
      retry: { maxAttempts: 1 },
      policy: {
        capability: 'artifact.image.network',
        access: 'network',
        riskLevel: 'high',
        approval: 'always',
        reason: 'Image generation sends the approved prompt to api.openai.com, can incur charges, and writes the result into the Project workspace',
      },
      execute: async (args, context) => {
        this.requireWritePermission();
        this.requireImageAccess();
        const prompt = String(args.prompt);
        const generated = await this.options.images.generate({
          prompt,
          size: args.size as ImageSize,
          quality: args.quality as ImageQuality,
          outputFormat: args.output_format as ImageOutputFormat,
          ...(typeof args.output_compression === 'number' ? { outputCompression: args.output_compression } : {}),
        }, context.signal);
        const artifact = this.options.workspace.persist({
          runId: context.runId,
          stepId: context.stepId,
          idempotencyKey: context.idempotencyKey,
          kind: `image.${generated.format}`,
          name: typeof args.filename === 'string' ? args.filename : 'Generated image',
          filename: typeof args.filename === 'string' ? args.filename : 'generated-image',
          extension: generated.format === 'jpeg' ? 'jpg' : generated.format,
          contentType: generated.format === 'jpeg' ? 'image/jpeg' : `image/${generated.format}`,
          bytes: generated.bytes,
          validate: bytes => {
            const inspected = inspectImage(bytes);
            if (inspected.format !== generated.format || inspected.width !== generated.width || inspected.height !== generated.height) {
              throw new Error('Persisted image metadata does not match the generated image');
            }
          },
          metadata: {
            provider: generated.provider,
            model: generated.model,
            requestId: generated.requestId,
            width: generated.width,
            height: generated.height,
            format: generated.format,
            promptSha256: createHash('sha256').update(prompt).digest('hex'),
            ...(generated.usage ? { usage: generated.usage } : {}),
          },
        });
        return artifactResult(artifact, `Generated ${generated.width}x${generated.height} ${generated.format.toUpperCase()} image`);
      },
    });
    pending.set(definition.name, definition);
  }

  private requireWritePermission(): void {
    if (!this.options.canWriteArtifacts()) throw new Error('Artifact file permission was revoked before execution');
  }

  private requireImageAccess(): void {
    if (!this.options.canGenerateImages()) throw new Error('Image-generation network consent was revoked before execution');
    if (!this.options.hasImageCredential()) throw new Error('OpenAI image credential was removed before execution');
  }

  private clearOwned(): void {
    for (const [name, definition] of this.owned) this.options.registry.unregister(name, definition);
    this.owned.clear();
  }
}

function artifactResult(
  artifact: ReturnType<ArtifactWorkspaceService['persist']>,
  summary: string,
) {
  return {
    status: 'completed' as const,
    summary,
    content: JSON.stringify({
      artifactId: artifact.record.id,
      name: artifact.record.name,
      kind: artifact.record.kind,
      path: artifact.path,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      validationStatus: artifact.record.validationStatus,
      reused: artifact.reused,
    }),
    metadata: {
      artifactId: artifact.record.id,
      artifactPath: artifact.path,
      sha256: artifact.sha256,
      reused: artifact.reused,
    },
    validations: [{
      id: 'artifact.integrity',
      status: 'passed' as const,
      evidence: `${artifact.record.validationStatus}: sha256=${artifact.sha256}`,
    }],
  };
}
