export type EmotionType =
  | 'peaceful'
  | 'happy'
  | 'thoughtful'
  | 'shy'
  | 'confused'
  | 'excited'
  | 'tired'
  | 'playful'
  | 'soft';

export interface Emotion {
  type: EmotionType;
  intensity: number;
  label: string;
}

export const EMOTION_LABELS: Record<EmotionType, string> = {
  peaceful: '平静',
  happy: '开心',
  thoughtful: '思考',
  shy: '害羞',
  confused: '疑惑',
  excited: '期待',
  tired: '困',
  playful: '调皮',
  soft: '温柔',
};