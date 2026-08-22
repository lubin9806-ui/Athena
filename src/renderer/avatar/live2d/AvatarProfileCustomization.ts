import type {
  AvatarCharacterProfile,
  AvatarLayoutMode,
  AvatarLipSyncSettings,
  AvatarTransform,
} from '../../../shared/types/avatar';
import type { EmotionType } from '../../../shared/types/emotion';

export interface AvatarEmotionBindingOverride {
  expressionId: string;
  intensityScale?: number;
}

export interface AvatarProfileCustomization {
  version: 1;
  layout?: {
    mode?: AvatarLayoutMode;
    transform?: Partial<AvatarTransform>;
  };
  lipSync?: Partial<AvatarLipSyncSettings>;
  emotionBindings?: Partial<Record<EmotionType, AvatarEmotionBindingOverride>>;
}

export function applyAvatarProfileCustomization(
  profile: AvatarCharacterProfile,
  customization: AvatarProfileCustomization,
): AvatarCharacterProfile {
  const result = structuredClone(profile);
  if (customization.layout?.mode) result.layout.mode = customization.layout.mode;
  if (customization.layout?.transform) {
    result.layout.transform = { ...result.layout.transform, ...customization.layout.transform };
  }
  if (customization.lipSync) {
    result.lipSync = {
      ...result.lipSync,
      ...customization.lipSync,
      parameterIds: customization.lipSync.parameterIds
        ? [...customization.lipSync.parameterIds]
        : [...result.lipSync.parameterIds],
    };
  }
  if (customization.emotionBindings) {
    result.expressions = result.expressions.map(mapping => {
      const override = customization.emotionBindings?.[mapping.emotion];
      return override ? {
        ...mapping,
        expressionId: override.expressionId,
        intensityScale: override.intensityScale ?? mapping.intensityScale,
      } : mapping;
    });
  }
  return result;
}

export function readAvatarProfileCustomization(value: string | null): AvatarProfileCustomization {
  if (!value) return { version: 1 };
  try {
    const parsed = JSON.parse(value) as Partial<AvatarProfileCustomization>;
    if (parsed.version !== 1) return { version: 1 };
    return parsed as AvatarProfileCustomization;
  } catch {
    return { version: 1 };
  }
}
