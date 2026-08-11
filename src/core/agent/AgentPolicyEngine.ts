import type { AgentRiskLevel, AgentTaskSpec } from '../../shared/types';
import type { AgentToolPolicyDescriptor } from './ToolRegistry';

export type AgentPolicyDecisionKind = 'allow' | 'approval' | 'deny';

export interface AgentPolicyContext {
  taskSpec: AgentTaskSpec;
  allowedCapabilities: readonly string[];
  approvalMode?: 'risk_based' | 'always';
}

export interface AgentPolicyDecision extends AgentToolPolicyDescriptor {
  kind: AgentPolicyDecisionKind;
  explanation: string;
}

const RISK_RANK: Record<AgentRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class AgentPolicyEngine {
  evaluate(policy: AgentToolPolicyDescriptor, context: AgentPolicyContext): AgentPolicyDecision {
    const declared = new Set(context.taskSpec.requiredCapabilities.map(item => item.id));
    if (!declared.has(policy.capability)) {
      return {
        ...policy,
        kind: 'deny',
        explanation: `Capability ${policy.capability} is not declared by the durable task specification`,
      };
    }
    const allowed = new Set(context.allowedCapabilities.map(item => item.trim()).filter(Boolean));
    if (!allowed.has(policy.capability)) {
      return {
        ...policy,
        kind: 'deny',
        explanation: `Capability ${policy.capability} is not granted to this run`,
      };
    }
    const requiresApproval = context.approvalMode === 'always'
      || policy.approval === 'always'
      || (policy.approval === 'risk_based' && RISK_RANK[policy.riskLevel] >= RISK_RANK.high);
    if (requiresApproval) {
      return {
        ...policy,
        kind: 'approval',
        explanation: `${policy.reason}; explicit approval is required for ${policy.riskLevel}-risk access`,
      };
    }
    return { ...policy, kind: 'allow', explanation: policy.reason };
  }
}
