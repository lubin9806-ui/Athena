import { pathToFileURL } from 'url';
import path from 'path';
import type { AvatarModelSource } from '../../../shared/types/avatar';

export interface Live2DResolvedModelSource {
  rootPath: string;
  model3JsonPath: string;
  rootUrl: string;
  modelUrl: string;
}

export function resolveLive2DModelSource(source: AvatarModelSource): Live2DResolvedModelSource {
  const rootPath = path.resolve(source.rootPath);
  const model3JsonPath = path.resolve(source.model3JsonPath || '');
  if (!source.model3JsonPath) throw new Error('Live2D profile is missing model3JsonPath.');
  if (!isPathInside(rootPath, model3JsonPath)) {
    throw new Error('Live2D model3JsonPath must stay inside the selected model root.');
  }
  return {
    rootPath,
    model3JsonPath,
    rootUrl: pathToFileURL(withTrailingSeparator(rootPath)).href,
    modelUrl: pathToFileURL(model3JsonPath).href,
  };
}

function withTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

