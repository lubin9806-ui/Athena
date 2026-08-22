import type { AvatarModelSource } from '../../../shared/types/avatar';

export interface Live2DResolvedModelSource {
  rootPath: string;
  model3JsonPath: string;
  rootUrl: string;
  modelUrl: string;
}

export function resolveLive2DModelSource(source: AvatarModelSource): Live2DResolvedModelSource {
  if (!source.model3JsonPath) throw new Error('Live2D profile is missing model3JsonPath.');
  const rootPath = resolvePortablePath(source.rootPath, currentWorkingDirectory());
  const model3JsonPath = resolvePortablePath(source.model3JsonPath, rootPath);
  if (!isPathInside(rootPath, model3JsonPath)) {
    throw new Error('Live2D model3JsonPath must stay inside the selected model root.');
  }
  return {
    rootPath,
    model3JsonPath,
    rootUrl: portablePathToUrl(withTrailingSeparator(rootPath)),
    modelUrl: portablePathToUrl(model3JsonPath),
  };
}

function withTrailingSeparator(value: string): string {
  return /[\\/]$/.test(value) ? value : `${value}/`;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = comparisonPath(rootPath).replace(/\/$/, '');
  const candidate = comparisonPath(candidatePath);
  if (root === '.') return candidate !== '..' && !candidate.startsWith('../') && !isAbsolutePath(candidate);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function currentWorkingDirectory(): string {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') return process.cwd();
  return '.';
}

function resolvePortablePath(value: string, base: string): string {
  const normalizedValue = normalizeSeparators(value || '.');
  if (isAbsolutePath(normalizedValue)) return collapseSegments(normalizedValue);
  const normalizedBase = normalizeSeparators(base || '.');
  if (normalizedBase === '.') return collapseSegments(normalizedValue);
  return collapseSegments(`${normalizedBase}/${normalizedValue}`);
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function collapseSegments(value: string): string {
  const normalized = normalizeSeparators(value);
  const drive = /^[A-Za-z]:/.exec(normalized)?.[0] ?? '';
  const absolute = drive !== '' || normalized.startsWith('/');
  const body = drive ? normalized.slice(drive.length) : normalized;
  const segments: string[] = [];
  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (!absolute) segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  if (drive) return `${drive}/${segments.join('/')}`.replace(/\/$/, '');
  if (absolute) return `/${segments.join('/')}` || '/';
  return segments.join('/') || '.';
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith('/');
}

function comparisonPath(value: string): string {
  const normalized = collapseSegments(value).replace(/\/$/, '');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function portablePathToUrl(value: string): string {
  const normalized = normalizeSeparators(value);
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodePath(normalized)}`;
  }
  if (normalized.startsWith('/')) return `file://${encodePath(normalized)}`;
  if (typeof document !== 'undefined') return new URL(normalized, document.baseURI).href;
  const absolute = resolvePortablePath(normalized, currentWorkingDirectory());
  return portablePathToUrl(absolute);
}

function encodePath(value: string): string {
  return value.split('/').map((segment, index) => index === 0 && /^[A-Za-z]:$/.test(segment)
    ? segment
    : encodeURIComponent(segment)).join('/');
}
