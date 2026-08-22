import { pathToFileURL } from 'url';
import path from 'path';
import type { AvatarModelSource, AvatarProvider } from '../../../shared/types/avatar';

export interface ThreeAvatarResolvedModelSource {
  rootPath: string;
  modelPath: string;
  rootUrl: string;
  modelUrl: string;
  format: Extract<AvatarProvider, 'gltf' | 'vrm'>;
}

export function resolveThreeAvatarModelSource(
  source: AvatarModelSource,
  provider: AvatarProvider,
): ThreeAvatarResolvedModelSource {
  if (provider !== 'gltf' && provider !== 'vrm') {
    throw new Error(`Three avatar resolver cannot load provider: ${provider}`);
  }
  if (!source.modelPath) throw new Error('3D avatar profile is missing modelPath.');

  const rootPath = path.resolve(source.rootPath);
  const modelPath = path.resolve(source.modelPath);
  if (!isPathInside(rootPath, modelPath)) {
    throw new Error('3D avatar modelPath must stay inside the selected model root.');
  }

  const extension = path.extname(modelPath).toLowerCase();
  if (provider === 'gltf' && extension !== '.gltf' && extension !== '.glb') {
    throw new Error('GLTF avatar profiles must point to a .gltf or .glb file.');
  }
  if (provider === 'vrm' && extension !== '.vrm') {
    throw new Error('VRM avatar profiles must point to a .vrm file.');
  }

  return {
    rootPath,
    modelPath,
    rootUrl: pathToFileURL(withTrailingSeparator(rootPath)).href,
    modelUrl: pathToFileURL(modelPath).href,
    format: provider,
  };
}

function withTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
