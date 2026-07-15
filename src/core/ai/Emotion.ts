/** 情绪引擎 */

import type { Emotion, EmotionType } from '../../shared/types/emotion';

export class EmotionEngine {
  private current: Emotion = { type: 'peaceful', intensity: 0.5, label: '平静' };

  get emotion(): Emotion {
    return { ...this.current };
  }

  get type(): EmotionType {
    return this.current.type;
  }

  /** 根据时间设定基调情绪 */
  setBaseEmotion(hour: number): void {
    let type: EmotionType = 'peaceful';
    if (hour >= 6 && hour < 9) type = 'peaceful';
    else if (hour >= 9 && hour < 12) type = 'happy';
    else if (hour >= 12 && hour < 14) type = 'peaceful';
    else if (hour >= 14 && hour < 18) type = 'thoughtful';
    else if (hour >= 18 && hour < 22) type = 'playful';
    else type = 'soft';

    this.current = { type, intensity: 0.5, label: this.getLabel(type) };
  }

  /** 根据回复内容分析情绪 */
  analyzeResponse(content: string): Emotion {
    let type: EmotionType = this.current.type;

    if (content.includes('？') || content.includes('?') || content.includes('吧')) {
      type = 'thoughtful';
    }
    if (content.includes('哈哈') || content.includes('笑') || content.includes('~')) {
      if (type !== 'soft') type = 'happy';
    }
    if (content.includes('困') || content.includes('晚安') || content.includes('睡')) {
      type = 'tired';
    }
    if (content.includes('嗯？') || (content.includes('?') && content.length < 10)) {
      type = 'confused';
    }

    const intensity = 0.5 + Math.random() * 0.3;
    this.current = { type, intensity, label: this.getLabel(type) };
    return { ...this.current };
  }

  /** 设置特定情绪 */
  setEmotion(type: EmotionType, intensity: number = 0.5): void {
    this.current = { type, intensity, label: this.getLabel(type) };
  }

  private getLabel(type: EmotionType): string {
    const labels: Record<EmotionType, string> = {
      peaceful: '平静', happy: '开心', thoughtful: '思考',
      shy: '害羞', confused: '疑惑', excited: '期待',
      tired: '困', playful: '调皮', soft: '温柔',
    };
    return labels[type] || '平静';
  }
}