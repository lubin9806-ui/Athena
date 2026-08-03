import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

type ProcessWithResourcesPath = NodeJS.Process & { resourcesPath?: string };

function resourcesPath(): string | undefined {
  return (process as ProcessWithResourcesPath).resourcesPath;
}

function packagedUserDataPath(): string | undefined {
  try {
    const requireFromHere = createRequire(__filename);
    const electron = requireFromHere('electron') as {
      app?: { isPackaged?: boolean; getPath?: (name: string) => string };
    };
    if (electron.app?.isPackaged && electron.app.getPath) {
      return electron.app.getPath('userData');
    }
  } catch {
    // Node-only scripts keep using the workspace configuration directory.
  }
  return undefined;
}

export function resolveProjectRoot(): string {
  const candidates = [
    process.env.ATHENA_APP_ROOT,
    path.resolve(__dirname, '../../..'),
    process.cwd(),
    resourcesPath(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'package.json')))
    || candidates.find(candidate => fs.existsSync(path.join(candidate, 'config')))
    || process.cwd();
}

export function resolveExistingFile(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveConfigFile(fileName: string): string | null {
  const projectRoot = resolveProjectRoot();
  const packagedResources = resourcesPath();
  const packagedUserData = packagedUserDataPath();
  const explicitFile = fileName === 'model.json' ? process.env.ATHENA_MODEL_CONFIG : undefined;
  if (explicitFile) return path.resolve(explicitFile);
  if (process.env.ATHENA_CONFIG_DIR) {
    return path.join(path.resolve(process.env.ATHENA_CONFIG_DIR), fileName);
  }
  return resolveExistingFile([
    packagedUserData ? path.join(packagedUserData, 'config', fileName) : undefined,
    path.join(projectRoot, 'config', fileName),
    packagedResources ? path.join(packagedResources, 'config', fileName) : undefined,
  ]);
}

export function resolveWritableConfigFile(fileName: string): string {
  const explicitFile = fileName === 'model.json' ? process.env.ATHENA_MODEL_CONFIG : undefined;
  if (explicitFile) return path.resolve(explicitFile);
  if (process.env.ATHENA_CONFIG_DIR) {
    return path.join(path.resolve(process.env.ATHENA_CONFIG_DIR), fileName);
  }

  const packagedUserData = packagedUserDataPath();
  if (packagedUserData) return path.join(packagedUserData, 'config', fileName);
  return path.join(resolveProjectRoot(), 'config', fileName);
}

export function resolveSkillsFile(fileName: string): string | null {
  const projectRoot = resolveProjectRoot();
  const packagedResources = resourcesPath();
  return resolveExistingFile([
    process.env.ATHENA_SKILLS_DIR ? path.join(process.env.ATHENA_SKILLS_DIR, fileName) : undefined,
    path.join(projectRoot, 'skills', fileName),
    packagedResources ? path.join(packagedResources, 'skills', fileName) : undefined,
  ]);
}

export function resolveVoiceRootCandidates(): string[] {
  const projectRoot = resolveProjectRoot();
  const packagedResources = resourcesPath();
  return [
    process.env.ATHENA_VOICE_SCRIPT_DIR,
    packagedResources ? path.join(packagedResources, 'voice') : undefined,
    path.join(projectRoot, 'resources', 'voice-runtime'),
    projectRoot,
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));
}
