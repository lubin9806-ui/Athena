import * as fs from 'fs';
import * as path from 'path';
import type { MicrosoftStoreRuntimeConfig } from '../../shared/types/store';

let runtimeOverride: MicrosoftStoreRuntimeConfig | null | undefined;

export function isMicrosoftStoreSku(): boolean {
  return loadMicrosoftStoreRuntimeConfig() !== null;
}

export function loadMicrosoftStoreRuntimeConfig(): MicrosoftStoreRuntimeConfig | null {
  if (runtimeOverride !== undefined) return runtimeOverride;
  const configuredPath = process.env.ATHENA_STORE_RUNTIME_CONFIG?.trim();
  const filePath = configuredPath || path.join(process.resourcesPath, 'store', 'store-runtime.json');
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    runtimeOverride = validateRuntimeConfig(value);
  } catch {
    runtimeOverride = null;
  }
  return runtimeOverride;
}

export function setMicrosoftStoreRuntimeOverrideForTests(value: MicrosoftStoreRuntimeConfig | null | undefined): void {
  runtimeOverride = value;
}

function validateRuntimeConfig(value: unknown): MicrosoftStoreRuntimeConfig {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.skuId !== 'athena-microsoft-store-private-beta-v1'
    || value.storeId !== '9NT09L9504R1'
    || value.identityName !== 'AthenaL.AthenaAIcompanion'
    || value.packageFamilyName !== 'AthenaL.AthenaAIcompanion_gf9pv7kh6znee'
    || value.audience !== 'private'
    || value.updatesManagedBy !== 'microsoft-store'
    || typeof value.storePackageVersion !== 'string'
    || !/^\d+\.\d+\.\d+\.\d+$/.test(value.storePackageVersion)
    || typeof value.generatedAt !== 'string') {
    throw new Error('Microsoft Store runtime identity drift detected.');
  }
  return value as unknown as MicrosoftStoreRuntimeConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
