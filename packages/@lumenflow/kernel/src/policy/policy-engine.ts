import type { PolicyDecision } from '../kernel.schemas.js';

export const POLICY_TRIGGERS = {
  ON_TOOL_REQUEST: 'on_tool_request',
  ON_CLAIM: 'on_claim',
  ON_COMPLETION: 'on_completion',
  ON_EVIDENCE_ADDED: 'on_evidence_added',
} as const;

export type PolicyTrigger = (typeof POLICY_TRIGGERS)[keyof typeof POLICY_TRIGGERS];
export type PolicyLayerLevel = 'workspace' | 'lane' | 'pack' | 'task';
export type PolicyEffect = 'allow' | 'deny';

export interface PolicyEvaluationContext {
  trigger: PolicyTrigger;
  run_id: string;
  tool_name?: string;
  task_id?: string;
  lane_id?: string;
  pack_id?: string;
  [key: string]: unknown;
}

export interface PolicyRule {
  id: string;
  trigger: PolicyTrigger;
  decision: PolicyEffect;
  reason?: string;
  when?: (context: PolicyEvaluationContext) => boolean;
}

export interface PolicyLayer {
  level: PolicyLayerLevel;
  default_decision?: PolicyEffect;
  allow_loosening?: boolean;
  rules: PolicyRule[];
}

export interface PolicyEngineOptions {
  layers: PolicyLayer[];
}

export interface PolicyEvaluationResult {
  decision: PolicyEffect;
  decisions: PolicyDecision[];
  warnings: string[];
}

const POLICY_LAYER_ORDER: PolicyLayerLevel[] = ['workspace', 'lane', 'pack', 'task'];

function layerOrderScore(level: PolicyLayerLevel): number {
  const index = POLICY_LAYER_ORDER.indexOf(level);
  return index < 0 ? POLICY_LAYER_ORDER.length : index;
}

function matchingRules(layer: PolicyLayer, context: PolicyEvaluationContext): PolicyRule[] {
  return layer.rules.filter((rule) => {
    if (rule.trigger !== context.trigger) {
      return false;
    }
    if (!rule.when) {
      return true;
    }
    return rule.when(context);
  });
}

function canLoosen(layer: PolicyLayer): boolean {
  return layer.allow_loosening === true;
}

export class PolicyEngine {
  private readonly layers: PolicyLayer[];

  constructor(options: PolicyEngineOptions) {
    this.layers = [...options.layers].sort(
      (left, right) => layerOrderScore(left.level) - layerOrderScore(right.level),
    );
  }

  async evaluate(context: PolicyEvaluationContext): Promise<PolicyEvaluationResult> {
    let effectiveDecision: PolicyEffect = 'deny';
    let hasInitializedDecision = false;
    let hasHardDeny = false;
    const warnings: string[] = [];
    const decisions: PolicyDecision[] = [];

    for (const layer of this.layers) {
      if (!hasInitializedDecision) {
        if (layer.default_decision) {
          effectiveDecision = layer.default_decision;
        }
        hasInitializedDecision = true;
      } else if (layer.default_decision) {
        if (effectiveDecision === 'deny' && layer.default_decision === 'allow' && !canLoosen(layer)) {
          warnings.push(
            `Policy layer "${layer.level}" attempted loosening default decision without explicit opt-in.`,
          );
        } else {
          effectiveDecision = layer.default_decision;
        }
      }

      const layerRules = matchingRules(layer, context);
      for (const rule of layerRules) {
        decisions.push({
          policy_id: rule.id,
          decision: rule.decision,
          reason: rule.reason,
        });

        if (rule.decision === 'deny') {
          hasHardDeny = true;
          effectiveDecision = 'deny';
          continue;
        }

        if (effectiveDecision === 'deny' && !canLoosen(layer)) {
          warnings.push(
            `Policy layer "${layer.level}" attempted loosening via rule "${rule.id}" without explicit opt-in.`,
          );
          continue;
        }
        effectiveDecision = 'allow';
      }
    }

    return {
      decision: hasHardDeny ? 'deny' : effectiveDecision,
      decisions,
      warnings,
    };
  }
}
