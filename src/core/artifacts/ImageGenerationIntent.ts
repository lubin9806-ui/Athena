import type { ImageQuality, ImageSize } from './OpenAIImageGenerationProvider';

export interface DirectImageGenerationIntent {
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
}

export interface ImageGenerationHistoryItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function resolveDirectImageGenerationIntent(
  message: string,
  recentMessages: readonly ImageGenerationHistoryItem[] = [],
): DirectImageGenerationIntent | null {
  const direct = parseDirectImageGenerationIntent(message);
  if (!isContextualImageCommand(message)) return direct;

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const candidate = recentMessages[index];
    if (candidate.role !== 'user' || isContextualImageCommand(candidate.content)) continue;
    const previousIntent = parseDirectImageGenerationIntent(candidate.content);
    if (previousIntent && isDescriptivePrompt(previousIntent.prompt)) return previousIntent;
  }

  return direct;
}

export function parseDirectImageGenerationIntent(message: string): DirectImageGenerationIntent | null {
  const text = message.trim();
  if (!text || text.length > 32_000) return null;
  if (/(?:如何|怎么|怎样|为什么|能不能介绍|教程|原理|方案|接口|api|how (?:do|does|to)|tutorial|explain).{0,18}(?:生图|生成图片|画图|image generation)/i.test(text)) return null;
  const chineseIntent = /(?:^|[，。！？\s])(?:(?:请|帮我|给我|替我|麻烦|现在|直接)\s*)*(?:生成|生|画|绘制|制作|做|创建|设计|出)[^。！？!?\n]{0,48}(?:图|图片|图像|插画|海报|壁纸|头像|封面|概念图)/i;
  const compactIntent = /(?:^|[，。！？、；：,.!?;:\s])(?:生图|出图)(?:[：:，,。.!！?？\s]|$)/i;
  const terminalIntent = /(?:^|[，。！？、；：,.!?;:\s])(?:(?:请|现在|直接|开始|给我)\s*)?(?:生图|出图|生成)(?:一张|一下|吧|看看)?[。.!！?？\s]*$/i;
  const englishIntent = /\b(?:generate|create|draw|make|render|design)\b.{0,28}\b(?:an?\s+)?(?:image|picture|illustration|poster|wallpaper|avatar|concept art)\b/i;
  if (!chineseIntent.test(text) && !compactIntent.test(text) && !terminalIntent.test(text) && !englishIntent.test(text)) return null;
  // A bare command carries no subject. Sending "生成图片" to the engine as the prompt
  // produces a confidently unrelated picture, which is worse than asking what to
  // draw, so report no intent and let the conversation resolve it (ATH-IMG-002).
  if (!isDescriptivePrompt(stripTerminalImageCommand(text))) return null;
  const size: ImageSize = /(?:横图|横版|宽屏|landscape|16\s*[:：]\s*9)/i.test(text)
    ? '1536x1024'
    : /(?:竖图|竖版|手机壁纸|portrait|9\s*[:：]\s*16)/i.test(text)
      ? '1024x1536'
      : '1024x1024';
  const quality: ImageQuality = /(?:高清|高质量|精细|细节丰富|high[- ]?quality|high detail|4k|8k)/i.test(text) ? 'high' : 'low';
  return { prompt: stripTerminalImageCommand(text), size, quality };
}

function isContextualImageCommand(message: string): boolean {
  return /^(?:(?:请|帮我|给我|现在|直接|开始|再|重新|重新再|继续|换个?|重)\s*)*(?:生成(?:图片|图像|一张图?)?|生图|出图|画图|重做|重画|重出(?:一张|一版)?|再来一张|换一张)(?:一张|一版|一下|吧|看看)?[。.!！?？\s]*$/i.test(message.trim());
}

function isDescriptivePrompt(prompt: string): boolean {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length >= 12 && !isContextualImageCommand(compact);
}

function stripTerminalImageCommand(message: string): string {
  const stripped = message.replace(/(?:(?:请|现在|直接|开始|给我)\s*)?(?:生图|出图|生成)(?:一张|一下|吧|看看)?[。!！?？\s]*$/i, '').trim();
  return stripped || message;
}
