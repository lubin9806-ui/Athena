import { createRequire } from 'module';
import { resolveSkillsFile } from '../runtime/Paths';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface DesktopAction {
  type: 'search' | 'open' | 'openfile' | 'folder' | 'weather' | 'news' | string;
  param: string;
}

interface DesktopActionModule {
  detectAction(text: string): DesktopAction | null;
  executeAction(type: string, param: string): Promise<string> | string;
}

let desktopActions: DesktopActionModule | null = null;

export function detectDesktopAction(text: string): DesktopAction | null {
  const module = loadDesktopActions();
  if (!module) return null;

  const action = module.detectAction(text);
  if (!action) return null;

  return {
    type: action.type,
    param: typeof action.param === 'string' ? action.param : '',
  };
}

export async function executeDesktopAction(action: DesktopAction): Promise<string> {
  const module = loadDesktopActions();
  if (!module) {
    return 'Desktop action module is not available yet.';
  }

  return String(await module.executeAction(action.type, action.param || ''));
}

function loadDesktopActions(): DesktopActionModule | null {
  if (desktopActions) return desktopActions;

  try {
    const requireFromHere = createRequire(__filename);
    const actionsPath = resolveSkillsFile('actions.js');
    if (!actionsPath) {
      console.warn('[ToolCall] Desktop actions file was not found.');
      return null;
    }
    desktopActions = requireFromHere(actionsPath) as DesktopActionModule;
    return desktopActions;
  } catch (error) {
    console.warn('[ToolCall] Failed to load desktop actions:', error);
    return null;
  }
}
