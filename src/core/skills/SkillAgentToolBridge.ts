import { ToolRegistry, type AgentToolRegistration } from '../agent/ToolRegistry';
import { SkillLibrary } from './SkillLibrary';

export class SkillAgentToolBridge {
  private readonly owned = new Map<string, Readonly<AgentToolRegistration>>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly library: SkillLibrary,
  ) {}

  refresh(): string[] {
    for (const [name, definition] of this.owned) this.registry.unregister(name, definition);
    this.owned.clear();
    const skills = this.library.discover().filter(skill => skill.enabled && (skill.trust === 'approved' || skill.trust === 'builtin'));
    const catalog = skills.length > 0
      ? skills.map(skill => `${skill.name}: ${skill.description}`).join('\n').slice(0, 12_000)
      : 'No trusted skills are currently available.';
    this.register({
      name: 'list_skills',
      label: 'List trusted skills',
      description: 'List enabled Agent Skills and their trigger descriptions. Use this when deciding whether specialized instructions apply.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({
        status: 'completed',
        summary: `${skills.length} trusted skills available`,
        content: JSON.stringify(skills.map(skill => ({ name: skill.name, description: skill.description, version: skill.version }))),
      }),
    });
    if (skills.length === 0) return Array.from(this.owned.keys());
    this.register({
      name: 'load_skill',
      label: 'Load skill instructions',
      description: `Load the full SKILL.md only after a skill matches the task. Available skills:\n${catalog}`,
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', enum: skills.map(skill => skill.name) } },
        required: ['name'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        const detail = this.library.load(String(args.name), { runId: context.runId, stepId: context.stepId });
        return {
          status: 'completed',
          summary: `Loaded skill ${detail.name}`,
          content: [
            `# Skill: ${detail.name}`,
            detail.instructions,
            detail.resources.length > 0 ? `\nAvailable resources:\n${detail.resources.join('\n')}` : '',
            detail.allowedTools.length > 0
              ? `\nDeclared allowed-tools (informational only; Athena permissions still apply): ${detail.allowedTools.join(' ')}`
              : '',
          ].filter(Boolean).join('\n'),
          metadata: { skillName: detail.name, packageHash: detail.packageHash },
        };
      },
    });
    this.register({
      name: 'read_skill_resource',
      label: 'Read skill resource',
      description: 'Read one indexed text resource from a previously selected trusted skill. This never executes scripts or opens binary assets.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: skills.map(skill => skill.name) },
          path: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['name', 'path'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        const content = this.library.readResource(String(args.name), String(args.path), {
          runId: context.runId,
          stepId: context.stepId,
        });
        return {
          status: 'completed',
          summary: `Read ${String(args.name)}/${String(args.path)}`,
          content,
          metadata: { skillName: String(args.name), resourcePath: String(args.path) },
        };
      },
    });
    return Array.from(this.owned.keys());
  }

  shutdown(): void {
    for (const [name, definition] of this.owned) this.registry.unregister(name, definition);
    this.owned.clear();
  }

  private register(input: Pick<AgentToolRegistration, 'name' | 'label' | 'description' | 'parameters' | 'execute'>): void {
    const definition = this.registry.register({
      ...input,
      version: 'agent-skills-v1',
      capability: 'skills.read',
      strict: true,
      idempotent: true,
      retry: { maxAttempts: 1 },
      policy: {
        capability: 'skills.read',
        access: 'read',
        riskLevel: 'low',
        approval: 'never',
        reason: 'Read-only progressive disclosure from an enabled trusted Agent Skill package',
      },
    });
    this.owned.set(definition.name, definition);
  }
}
