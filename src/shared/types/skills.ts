export type SkillSourceKind = 'builtin' | 'project' | 'user' | 'external';
export type SkillTrustStatus = 'builtin' | 'approved' | 'untrusted' | 'quarantined';

export interface AgentSkillSummary {
  name: string;
  description: string;
  version: string | null;
  license: string | null;
  compatibility: string | null;
  allowedTools: string[];
  metadata: Record<string, string>;
  source: SkillSourceKind;
  rootPath: string;
  manifestHash: string;
  packageHash: string;
  trust: SkillTrustStatus;
  enabled: boolean;
  hasScripts: boolean;
  resourceCount: number;
  warnings: string[];
}

export interface AgentSkillDetail extends AgentSkillSummary {
  instructions: string;
  resources: string[];
}

export interface AgentSkillInvocationRecord {
  id: string;
  skillName: string;
  packageHash: string;
  runId: string;
  stepId: string;
  resourcePath: string;
  loadedAt: string;
}

export interface AgentSkillLibrarySnapshot {
  skills: AgentSkillSummary[];
  invocations: AgentSkillInvocationRecord[];
  roots: Array<{ source: SkillSourceKind; path: string }>;
  diagnostics: Array<{ source: SkillSourceKind; path: string; error: string }>;
}
