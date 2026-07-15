/** 技能管理器 */

import { Skill, SkillMetadata } from './Skill';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill): void {
    this.skills.set(skill.metadata.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  async initializeAll(): Promise<void> {
    for (const [name, skill] of this.skills) {
      if (skill.metadata.autoLoad) {
        await skill.initialize();
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const [, skill] of this.skills) {
      await skill.shutdown();
    }
  }
}