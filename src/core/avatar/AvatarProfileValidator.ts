import type {
  AvatarCharacterProfile,
  AvatarExternalCommand,
  AvatarHotZoneAction,
  AvatarLayoutMode,
} from '../../shared/types/avatar';

export interface AvatarValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface AvatarValidationResult {
  ok: boolean;
  issues: AvatarValidationIssue[];
}

const LAYOUT_MODES = new Set<AvatarLayoutMode>([
  'chat_right',
  'chat_background',
  'draggable_overlay',
  'desktop_pet',
]);

const HOT_ZONE_ACTIONS = new Set([
  'none',
  'athenaReply',
  'playMotion',
  'setExpression',
  'setState',
  'composite',
]);

const COMMAND_TYPE_PATTERN = /^avatar\.(?:state|motion|expression|parameter|pointer|hotZone)\.[a-z][a-zA-Z0-9_:-]{0,80}$/;

export function validateAvatarProfile(profile: AvatarCharacterProfile): AvatarValidationResult {
  const issues: AvatarValidationIssue[] = [];
  requireText(issues, 'id', profile.id);
  requireText(issues, 'displayName', profile.displayName);
  if (profile.provider === 'none') issue(issues, 'provider', 'A character profile must use a concrete avatar provider.', 'error');
  if (profile.provider === 'live2d' && !profile.model.model3JsonPath) {
    issue(issues, 'model.model3JsonPath', 'Live2D profiles must point to a .model3.json file.', 'error');
  }
  requireText(issues, 'model.rootPath', profile.model.rootPath);
  if (!LAYOUT_MODES.has(profile.layout.mode)) issue(issues, 'layout.mode', 'Unknown avatar layout mode.', 'error');
  validateRange(issues, 'layout.transform.scale', profile.layout.transform.scale, 0.1, 4);
  validateRange(issues, 'layout.transform.opacity', profile.layout.transform.opacity, 0, 1);
  validateRange(issues, 'layout.transform.rotationDeg', profile.layout.transform.rotationDeg, -45, 45);
  validateRange(issues, 'lipSync.sensitivity', profile.lipSync.sensitivity, 0, 4);
  validateRange(issues, 'lipSync.smoothing', profile.lipSync.smoothing, 0, 1);
  validateRange(issues, 'lipSync.gain', profile.lipSync.gain, 0, 8);
  validateRange(issues, 'lipSync.attackMs', profile.lipSync.attackMs, 1, 1000);
  validateRange(issues, 'lipSync.releaseMs', profile.lipSync.releaseMs, 1, 2000);
  if (profile.lipSync.enabled && profile.lipSync.parameterIds.length === 0) {
    issue(issues, 'lipSync.parameterIds', 'Enabled lip sync must bind at least one model parameter.', 'error');
  }
  if (profile.lipSync.minValue > profile.lipSync.maxValue) {
    issue(issues, 'lipSync', 'Lip-sync minValue cannot be greater than maxValue.', 'error');
  }
  validateRange(issues, 'pointerTracking.strength', profile.pointerTracking.strength, 0, 1);
  validateRange(issues, 'pointerTracking.smoothing', profile.pointerTracking.smoothing, 0, 1);
  validateRange(issues, 'idle.idleDelayMs', profile.idle.idleDelayMs, 1_000, 24 * 60 * 60 * 1000);
  validateRange(issues, 'idle.sleepyDelayMs', profile.idle.sleepyDelayMs, 1_000, 24 * 60 * 60 * 1000);
  validateRange(issues, 'idle.awayDelayMs', profile.idle.awayDelayMs, 1_000, 7 * 24 * 60 * 60 * 1000);
  if (profile.idle.sleepyDelayMs < profile.idle.idleDelayMs) {
    issue(issues, 'idle.sleepyDelayMs', 'Sleepy delay should not be shorter than idle delay.', 'warning');
  }
  if (profile.idle.awayDelayMs < profile.idle.sleepyDelayMs) {
    issue(issues, 'idle.awayDelayMs', 'Away delay should not be shorter than sleepy delay.', 'warning');
  }
  profile.hotZones.forEach((hotZone, index) => {
    const prefix = `hotZones[${index}]`;
    requireText(issues, `${prefix}.id`, hotZone.id);
    requireText(issues, `${prefix}.label`, hotZone.label);
    validateRange(issues, `${prefix}.cooldownMs`, hotZone.cooldownMs, 0, 60 * 60 * 1000);
    validateHotZoneAction(issues, `${prefix}.action`, hotZone.action);
  });
  validateExternalControl(issues, profile);
  return { ok: !issues.some(item => item.severity === 'error'), issues };
}

export function validateAvatarExternalCommand(command: AvatarExternalCommand, profile: AvatarCharacterProfile): AvatarValidationResult {
  const issues: AvatarValidationIssue[] = [];
  requireText(issues, 'type', command.type);
  requireText(issues, 'characterId', command.characterId);
  if (command.characterId !== profile.id) issue(issues, 'characterId', 'Command characterId does not match the active profile.', 'error');
  if (!profile.externalControl.enabled) issue(issues, 'externalControl.enabled', 'External avatar control is disabled.', 'error');
  if (!profile.externalControl.allowedCommandTypes.includes(command.type)) {
    issue(issues, 'type', 'Command type is not allowed by the active profile.', 'error');
  }
  if (!COMMAND_TYPE_PATTERN.test(command.type)) {
    issue(issues, 'type', 'Command type must stay inside the avatar command namespace.', 'error');
  }
  if (command.ttlMs !== undefined) validateRange(issues, 'ttlMs', command.ttlMs, 1, 60_000);
  if (command.priority !== undefined) validateRange(issues, 'priority', command.priority, 0, 100);
  return { ok: !issues.some(item => item.severity === 'error'), issues };
}

function validateHotZoneAction(issues: AvatarValidationIssue[], path: string, action: AvatarHotZoneAction): void {
  if (!HOT_ZONE_ACTIONS.has(action.type)) issue(issues, `${path}.type`, 'Unknown hot zone action type.', 'error');
  if (action.type === 'athenaReply') requireText(issues, `${path}.promptTemplate`, action.promptTemplate);
  if (action.type === 'playMotion') requireText(issues, `${path}.motionGroup`, action.motionGroup);
  if (action.type === 'setExpression') requireText(issues, `${path}.expressionId`, action.expressionId);
  if (action.type === 'setState') requireText(issues, `${path}.state`, action.state);
  if (action.type === 'composite' && (!action.actions || action.actions.length === 0)) {
    issue(issues, `${path}.actions`, 'Composite hot zone actions must contain at least one action.', 'error');
  }
  action.actions?.forEach((child, index) => validateHotZoneAction(issues, `${path}.actions[${index}]`, child));
}

function validateExternalControl(issues: AvatarValidationIssue[], profile: AvatarCharacterProfile): void {
  const settings = profile.externalControl;
  if (settings.host !== '127.0.0.1') issue(issues, 'externalControl.host', 'External avatar control must bind only to 127.0.0.1.', 'error');
  if (settings.enabled) {
    if (settings.transport !== 'localWebSocket') issue(issues, 'externalControl.transport', 'Enabled external control must use localWebSocket.', 'error');
    validateRange(issues, 'externalControl.port', settings.port, 1024, 65535);
    if (!settings.requireToken) issue(issues, 'externalControl.requireToken', 'External control must require a token.', 'error');
    if (!settings.auditEnabled) issue(issues, 'externalControl.auditEnabled', 'External control audit should stay enabled.', 'warning');
    if (settings.allowedCommandTypes.length === 0) {
      issue(issues, 'externalControl.allowedCommandTypes', 'Enabled external control needs an explicit command allowlist.', 'error');
    }
  }
  settings.allowedCommandTypes.forEach((type, index) => {
    if (!COMMAND_TYPE_PATTERN.test(type)) {
      issue(issues, `externalControl.allowedCommandTypes[${index}]`, 'Allowed command type must stay inside the avatar command namespace.', 'error');
    }
  });
}

function requireText(issues: AvatarValidationIssue[], path: string, value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) issue(issues, path, 'Value is required.', 'error');
}

function validateRange(issues: AvatarValidationIssue[], path: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    issue(issues, path, `Value must be between ${min} and ${max}.`, 'error');
  }
}

function issue(issues: AvatarValidationIssue[], path: string, message: string, severity: AvatarValidationIssue['severity']): void {
  issues.push({ path, message, severity });
}

