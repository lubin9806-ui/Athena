import fs from 'fs';
import path from 'path';
import type {
  AvatarModelAssetInventory,
  AvatarModelSource,
} from '../../shared/types/avatar';

export interface Live2DManifestScanInput {
  rootPath: string;
  model3JsonPath?: string;
}

export interface Live2DManifestReferencedFile {
  kind: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  insideRoot: boolean;
}

export interface Live2DManifestScanResult {
  source: AvatarModelSource;
  inventory: AvatarModelAssetInventory;
  referencedFiles: Live2DManifestReferencedFile[];
  warnings: string[];
}

type JsonObject = Record<string, unknown>;

interface FileReference {
  kind: string;
  name: string;
  relativePath: string;
}

export function scanLive2DModelPackage(input: Live2DManifestScanInput): Live2DManifestScanResult {
  const rootPath = path.resolve(input.rootPath);
  const model3JsonPath = input.model3JsonPath
    ? path.resolve(input.model3JsonPath)
    : findSingleModel3Json(rootPath);
  if (!isPathInside(rootPath, model3JsonPath)) {
    throw new Error('Live2D model3.json must be inside the selected model root.');
  }
  const manifest = readJsonObject(model3JsonPath);
  const fileReferences = asObject(manifest.FileReferences);
  const groups = asArray(manifest.Groups);
  const hitAreas = asArray(manifest.HitAreas);
  const warnings: string[] = [];

  const expressionNames = readExpressions(fileReferences).map(item => item.name);
  const motionGroups = readMotionGroups(fileReferences);
  const referenced = collectReferencedFiles(fileReferences, rootPath, path.dirname(model3JsonPath), warnings);

  return {
    source: {
      source: 'localDirectory',
      rootPath,
      model3JsonPath,
    },
    inventory: {
      expressions: expressionNames,
      motionGroups,
      parameters: [],
      lipSyncParameters: readGroupIds(groups, 'LipSync'),
      eyeBlinkParameters: readGroupIds(groups, 'EyeBlink'),
      hitAreas: hitAreas.map(item => readNameOrId(asObject(item))).filter(Boolean),
      physicsFile: readOptionalString(fileReferences.Physics),
      poseFile: readOptionalString(fileReferences.Pose),
      userDataFile: readOptionalString(fileReferences.UserData),
    },
    referencedFiles: referenced,
    warnings,
  };
}

function findSingleModel3Json(rootPath: string): string {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new Error(`Live2D model root does not exist or is not a directory: ${rootPath}`);
  }
  const candidates = fs.readdirSync(rootPath)
    .filter(name => name.toLowerCase().endsWith('.model3.json'))
    .map(name => path.join(rootPath, name));
  if (candidates.length === 0) throw new Error('No .model3.json file was found in the selected directory.');
  if (candidates.length > 1) throw new Error('Multiple .model3.json files were found. Select one explicitly.');
  return candidates[0];
}

function readJsonObject(filePath: string): JsonObject {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Live2D manifest does not exist: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Live2D manifest must be a JSON object.');
  }
  return parsed as JsonObject;
}

function readExpressions(fileReferences: JsonObject): FileReference[] {
  return asArray(fileReferences.Expressions).map((item, index) => {
    const expression = asObject(item);
    const file = readOptionalString(expression.File);
    if (!file) return null;
    return {
      kind: 'expression',
      name: readOptionalString(expression.Name) || path.basename(file),
      relativePath: file,
    };
  }).filter((item): item is FileReference => item !== null);
}

function readMotionGroups(fileReferences: JsonObject): Record<string, string[]> {
  const motions = asObject(fileReferences.Motions);
  const result: Record<string, string[]> = {};
  for (const [group, entries] of Object.entries(motions)) {
    const files = asArray(entries)
      .map(item => readOptionalString(asObject(item).File))
      .filter((file): file is string => Boolean(file));
    result[group] = files;
  }
  return result;
}

function collectReferencedFiles(
  fileReferences: JsonObject,
  rootPath: string,
  manifestDir: string,
  warnings: string[],
): Live2DManifestReferencedFile[] {
  const references: FileReference[] = [];
  for (const key of ['Moc', 'Physics', 'Pose', 'UserData', 'DisplayInfo'] as const) {
    const file = readOptionalString(fileReferences[key]);
    if (file) references.push({ kind: key.toLowerCase(), name: path.basename(file), relativePath: file });
  }
  references.push(...readTextures(fileReferences));
  references.push(...readExpressions(fileReferences));
  for (const [group, files] of Object.entries(readMotionGroups(fileReferences))) {
    files.forEach((file, index) => references.push({
      kind: 'motion',
      name: `${group}:${index}`,
      relativePath: file,
    }));
  }

  return references.map(reference => {
    const absolutePath = path.resolve(manifestDir, reference.relativePath);
    const insideRoot = isPathInside(rootPath, absolutePath);
    const exists = insideRoot && fs.existsSync(absolutePath);
    if (!insideRoot) warnings.push(`Referenced ${reference.kind} escapes the model root: ${reference.relativePath}`);
    else if (!exists) warnings.push(`Referenced ${reference.kind} is missing: ${reference.relativePath}`);
    return {
      ...reference,
      absolutePath,
      exists,
      insideRoot,
    };
  });
}

function readTextures(fileReferences: JsonObject): FileReference[] {
  return asArray(fileReferences.Textures)
    .map((value, index) => {
      const file = typeof value === 'string' ? value : '';
      if (!file) return null;
      return {
        kind: 'texture',
        name: `texture:${index}`,
        relativePath: file,
      };
    })
    .filter((item): item is FileReference => item !== null);
}

function readGroupIds(groups: unknown[], target: string): string[] {
  const group = groups.map(asObject).find(item => readOptionalString(item.Target) === target);
  return asArray(group?.Ids)
    .map(value => (typeof value === 'string' ? value : ''))
    .filter(Boolean);
}

function readNameOrId(value: JsonObject): string {
  return readOptionalString(value.Name) || readOptionalString(value.Id) || '';
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
