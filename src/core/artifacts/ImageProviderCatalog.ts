import type { ImageCloudProvider, ImageProviderDescriptor, ImageProviderId } from '../../shared/types';

export const IMAGE_PROVIDER_DESCRIPTORS: readonly ImageProviderDescriptor[] = [
  { id: 'local', label: 'Athena 本地引擎', kind: 'local', credentialRequired: false, supportsEdit: false, defaultModel: '', defaultBaseUrl: '', costHint: 'local' },
  { id: 'openai', label: 'OpenAI GPT Image', kind: 'direct', credentialRequired: true, supportsEdit: true, defaultModel: 'gpt-image-2', defaultBaseUrl: 'https://api.openai.com/v1/images', costHint: 'variable' },
  { id: 'google', label: 'Google Gemini Image', kind: 'direct', credentialRequired: true, supportsEdit: true, defaultModel: 'gemini-3.1-flash-lite-image', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/interactions', costHint: 'low' },
  { id: 'stability', label: 'Stability AI', kind: 'direct', credentialRequired: true, supportsEdit: false, defaultModel: 'stable-image-core', defaultBaseUrl: 'https://api.stability.ai/v2beta/stable-image/generate/core', costHint: 'variable' },
  { id: 'bfl', label: 'Black Forest Labs FLUX', kind: 'direct', credentialRequired: true, supportsEdit: false, defaultModel: 'flux-2-klein-4b', defaultBaseUrl: 'https://api.bfl.ai/v1', costHint: 'low' },
  { id: 'volcengine', label: '火山方舟 Seedream', kind: 'direct', credentialRequired: true, supportsEdit: false, defaultModel: 'doubao-seedream-4-0-250828', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', costHint: 'low' },
  { id: 'dashscope', label: '阿里云通义万相', kind: 'direct', credentialRequired: true, supportsEdit: false, defaultModel: 'wanx-v1', defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', costHint: 'low' },
  { id: 'replicate', label: 'Replicate', kind: 'aggregator', credentialRequired: true, supportsEdit: false, defaultModel: 'black-forest-labs/flux-schnell', defaultBaseUrl: 'https://api.replicate.com/v1/models', costHint: 'variable' },
  { id: 'fal', label: 'fal.ai', kind: 'aggregator', credentialRequired: true, supportsEdit: false, defaultModel: 'fal-ai/flux/schnell', defaultBaseUrl: 'https://queue.fal.run', costHint: 'variable' },
  { id: 'custom', label: '自定义 OpenAI-compatible', kind: 'compatible', credentialRequired: true, supportsEdit: false, defaultModel: '', defaultBaseUrl: '', costHint: 'variable' },
] as const;

export function imageProviderDescriptor(id: ImageProviderId): ImageProviderDescriptor {
  const descriptor = IMAGE_PROVIDER_DESCRIPTORS.find(item => item.id === id);
  if (!descriptor) throw new Error(`Unsupported image provider: ${id}`);
  return descriptor;
}

export function isImageCloudProvider(value: unknown): value is ImageCloudProvider {
  return typeof value === 'string' && value !== 'local' && IMAGE_PROVIDER_DESCRIPTORS.some(item => item.id === value);
}
