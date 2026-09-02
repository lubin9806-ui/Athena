import type { ImageQuality, ImageSize } from './OpenAIImageGenerationProvider';

export interface DirectImageGenerationIntent {
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
}

export function parseDirectImageGenerationIntent(message: string): DirectImageGenerationIntent | null {
  const text = message.trim();
  if (!text || text.length > 32_000) return null;
  if (/(?:如何|怎么|怎样|为什么|能不能介绍|教程|原理|方案|接口|api|how (?:do|does|to)|tutorial|explain).{0,18}(?:生图|生成图片|画图|image generation)/i.test(text)) return null;
  const chineseIntent = /(?:^|[，。！？\s])(?:(?:请|帮我|给我|替我|麻烦|现在|直接)\s*)*(?:生成|生|画|绘制|制作|做|创建|设计|出)[^。！？!?\n]{0,48}(?:图|图片|图像|插画|海报|壁纸|头像|封面|概念图)/i;
  const compactIntent = /(?:^|[，。！？\s])(?:生图|出图)(?:[：:，,\s]|$)/i;
  const englishIntent = /\b(?:generate|create|draw|make|render|design)\b.{0,28}\b(?:an?\s+)?(?:image|picture|illustration|poster|wallpaper|avatar|concept art)\b/i;
  if (!chineseIntent.test(text) && !compactIntent.test(text) && !englishIntent.test(text)) return null;
  const size: ImageSize = /(?:横图|横版|宽屏|landscape|16\s*[:：]\s*9)/i.test(text)
    ? '1536x1024'
    : /(?:竖图|竖版|手机壁纸|portrait|9\s*[:：]\s*16)/i.test(text)
      ? '1024x1536'
      : '1024x1024';
  const quality: ImageQuality = /(?:高清|高质量|精细|细节丰富|high[- ]?quality|high detail|4k|8k)/i.test(text) ? 'high' : 'low';
  return { prompt: text, size, quality };
}
