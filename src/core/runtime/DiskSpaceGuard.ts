import * as fs from 'fs';
import * as path from 'path';

export class InsufficientDiskSpaceError extends Error {
  readonly code = 'ATHENA_DISK_FULL';
  constructor(readonly requiredBytes: number, readonly availableBytes: number) {
    super(`可用磁盘空间不足（需要 ${formatBytes(requiredBytes)}，当前约 ${formatBytes(availableBytes)}）。请释放空间后重试。`);
    this.name = 'InsufficientDiskSpaceError';
  }
}

export function ensureSufficientDiskSpace(targetPath: string, requiredBytes: number, availableOverride?: number): void {
  const availableBytes = availableOverride ?? readAvailableBytes(targetPath);
  if (availableBytes < requiredBytes) throw new InsufficientDiskSpaceError(requiredBytes, availableBytes);
}

function readAvailableBytes(targetPath: string): number {
  let probe = path.resolve(targetPath);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return Number.MAX_SAFE_INTEGER;
    probe = parent;
  }
  try {
    const stats = fs.statfsSync(probe);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // An unsupported statfs probe must not break older Windows builds. Actual
    // writes still fail normally and are captured by crash diagnostics.
    return Number.MAX_SAFE_INTEGER;
  }
}

function formatBytes(value: number): string { return `${Math.max(0, value / (1024 * 1024)).toFixed(1)} MB`; }
