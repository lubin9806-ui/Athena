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
        explanation: `这项操作需要的能力 ${policy.capability} 不在这个任务的授权范围内，没有执行`,
      };
    }
    const allowed = new Set(context.allowedCapabilities.map(item => item.trim()).filter(Boolean));
    if (!allowed.has(policy.capability)) {
      return {
        ...policy,
        kind: 'deny',
        explanation: `这次运行没有获得 ${policy.capability} 能力，没有执行`,
      };
    }
    const requiresApproval = context.approvalMode === 'always'
      || policy.approval === 'always'
      || (policy.approval === 'risk_based' && RISK_RANK[policy.riskLevel] >= RISK_RANK.high);
    if (requiresApproval) {
      // The explanation is what the approval card shows. It used to append an English
      // clause to a Chinese reason; the risk level has its own label on the card.
      return { ...policy, kind: 'approval', explanation: policy.reason };
    }
    return { ...policy, kind: 'allow', explanation: policy.reason };
  }
}
