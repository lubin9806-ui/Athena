import type { InterfacePreset } from './types/settings';

export type ReadyInterfacePreset = Exclude<InterfacePreset, 'atelier'>;

export interface InterfacePresetDefinition {
  readonly id: InterfacePreset;
  readonly label: string;
  readonly description: string;
  readonly status: 'ready' | 'prototype';
}

export const DEFAULT_INTERFACE_PRESET: ReadyInterfacePreset = 'daylight';

/** These presets share one application state and the same approved brand assets. */
export const INTERFACE_PRESETS: readonly InterfacePresetDefinition[] = [
  { id: 'daylight', label: '日光', description: '柔和日光与克制玻璃，新用户的默认界面。', status: 'ready' },
  { id: 'classic', label: '经典', description: '保留原有界面和熟悉的操作布局。', status: 'ready' },
  { id: 'atelier', label: '随心桌面', description: '想法桌面交互原型，尚未接入正式运行时。', status: 'prototype' },
];

export function normalizeInterfacePreset(value: unknown, fallback: InterfacePreset = DEFAULT_INTERFACE_PRESET): InterfacePreset {
  return typeof value === 'string' && INTERFACE_PRESETS.some(preset => preset.id === value)
    ? value as InterfacePreset
    : fallback;
}

/** Keep the stored choice intact while a not-yet-implemented layout falls back safely. */
export function resolveInterfacePreset(value: unknown): {
  requested: InterfacePreset;
  effective: ReadyInterfacePreset;
  available: boolean;
} {
  const requested = normalizeInterfacePreset(value);
  return requested === 'atelier'
    ? { requested, effective: DEFAULT_INTERFACE_PRESET, available: false }
    : { requested, effective: requested, available: true };
}
