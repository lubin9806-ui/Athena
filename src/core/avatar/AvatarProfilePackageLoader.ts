import fs from 'fs';
import path from 'path';
import type { AvatarCharacterProfile } from '../../shared/types/avatar';

export function loadAvatarCharacterProfile(profilePath: string): AvatarCharacterProfile {
  const resolvedProfilePath = path.resolve(profilePath);
  const packageRoot = path.dirname(resolvedProfilePath);
  const parsed = JSON.parse(fs.readFileSync(resolvedProfilePath, 'utf8')) as AvatarCharacterProfile;
  return resolveAvatarProfileModelPaths(parsed, packageRoot);
}

export function resolveAvatarProfileModelPaths(
  profile: AvatarCharacterProfile,
  packageRoot: string,
): AvatarCharacterProfile {
  const rootPath = resolvePackagePath(packageRoot, profile.model.rootPath);
  return {
    ...profile,
    model: {
      ...profile.model,
      rootPath,
      model3JsonPath: profile.model.model3JsonPath
        ? resolvePackagePath(rootPath, profile.model.model3JsonPath)
        : undefined,
      modelPath: profile.model.modelPath
        ? resolvePackagePath(rootPath, profile.model.modelPath)
        : undefined,
    },
  };
}

function resolvePackagePath(packageRoot: string, value: string): string {
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(packageRoot, value);
}
