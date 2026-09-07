/**
 * Whether a message is plausibly about a picture at all.
 *
 * The gate this replaces admitted every message over 300 characters outside
 * Execute mode, so an ordinary long discussion paid for a creative extraction it
 * had no use for - and that extraction sits in series ahead of the real reply.
 * This is rules-only and costs nothing, which is the point: the expensive step
 * should be reached by messages that could actually want it (ATH-PERF-001).
 *
 * It is deliberately allowed to miss. A false negative means the description is
 * not updated from this message, which is what already happened below 300
 * characters; a false positive means ten to twenty seconds of dead wait.
 */

/** Words that earn their place: rare in conversation, ordinary in a visual brief. */
const VISUAL_TERMS = [
  '画面', '镜头', '光影', '光线', '逆光', '侧光', '顺光', '光源', '阴影', '高光',
  '构图', '色调', '色彩', '配色', '饱和度', '对比度', '景深', '虚化', '焦段',
  '质感', '肌理', '写实', '超写实', '渲染', '分辨率', '画质', '摄影', '画风',
  '插画', '油画', '水彩', '素描', '厚涂', '赛博朋克', '二次元',
  '特写', '全身', '半身', '近景', '远景', '中景', '视角', '俯拍', '仰拍', '正面', '侧脸',
  '五官', '发型', '发饰', '服装', '穿着', '服饰', '姿势', '姿态', '神态',
  '背景', '场景', '氛围', '材质', '细节',
  'lighting', 'backlight', 'portrait', 'photorealistic', 'photo-realistic',
  'depth of field', 'bokeh', 'cinematic', 'render', 'rendering', 'composition',
  'close-up', 'closeup', 'full body', 'wide shot', 'camera', 'lens',
  'film grain', 'texture', 'shading', 'illustration', 'painting', 'watercolor',
  'aesthetic', 'art style', '8k', '4k', '35mm', '50mm', '85mm',
];

/** An outright request for a picture needs no corroboration. */
const IMAGE_REQUEST = /(?:画(?:一|个|张|幅|下)|生成(?:一)?(?:张|幅|个)?\s*(?:图|图片|图像|插画)|出(?:一)?张图|做(?:一)?张图|来(?:一)?张(?:图|图片)|画个图|图片生成|文生图|重新画|再画|再来(?:一)?张)|(?:\b(?:draw|render|generate|create|make)\b[^.\n]{0,24}\b(?:image|picture|portrait|illustration|photo)\b)/i;

/** Enough distinct visual vocabulary that the message is describing a picture. */
const MIN_VISUAL_TERMS = 3;

export function isCreativeCandidate(message: string): boolean {
  const text = typeof message === 'string' ? message : '';
  if (!text.trim()) return false;
  if (IMAGE_REQUEST.test(text)) return true;
  return countVisualTerms(text) >= MIN_VISUAL_TERMS;
}

/** Exposed so the regression can assert on the count, not just the verdict. */
export function countVisualTerms(message: string): number {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  let found = 0;
  for (const term of VISUAL_TERMS) {
    if (text.includes(term)) found += 1;
  }
  return found;
}
