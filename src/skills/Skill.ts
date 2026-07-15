/** 技能基类 */

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  autoLoad: boolean;
}

export abstract class Skill {
  public abstract metadata: SkillMetadata;

  abstract initialize(): Promise<void>;
  abstract shutdown(): Promise<void>;
}