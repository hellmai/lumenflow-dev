import { SOFTWARE_DELIVERY_PACK_ID, SOFTWARE_DELIVERY_POLICY_ID_PREFIX } from './constants.js';

export const SOFTWARE_DELIVERY_GATE_NAMES = [
  'format',
  'lint',
  'typecheck',
  'test',
  'coverage',
] as const;

export type SoftwareDeliveryGateName = (typeof SOFTWARE_DELIVERY_GATE_NAMES)[number];

export interface PolicyProvider {
  id: string;
  gate: SoftwareDeliveryGateName;
  trigger: 'on_completion';
  command: string;
}

export interface CompletionPolicyContext {
  trigger: 'on_completion';
  run_id: string;
  task_id: string;
  gate: SoftwareDeliveryGateName;
  pack_id: typeof SOFTWARE_DELIVERY_PACK_ID;
}

export interface CompletionPolicyEvaluation {
  decision: 'allow' | 'deny';
  decisions: Array<{
    policy_id: string;
    decision: 'allow' | 'deny';
    reason?: string;
  }>;
  warnings: string[];
}

export interface CompletionPolicyEngine {
  evaluate(context: CompletionPolicyContext): Promise<CompletionPolicyEvaluation>;
}

export interface CompletionPolicyExecution {
  ok: boolean;
}

export interface CompletionPolicyRunResult {
  gate: SoftwareDeliveryGateName;
  policy_id: string;
  decision: 'allow' | 'deny';
  command: string;
  executed: boolean;
  ok: boolean;
}

const SOFTWARE_DELIVERY_GATE_COMMANDS: Record<SoftwareDeliveryGateName, string> = {
  format: 'pnpm format:check',
  lint: 'pnpm lint',
  typecheck: 'pnpm typecheck',
  test: 'pnpm turbo run test',
  coverage: 'pnpm vitest run --coverage',
};

export const SOFTWARE_DELIVERY_GATE_POLICIES: readonly PolicyProvider[] =
  SOFTWARE_DELIVERY_GATE_NAMES.map((gate) => ({
    id: `${SOFTWARE_DELIVERY_POLICY_ID_PREFIX}.${gate}`,
    gate,
    trigger: 'on_completion',
    command: SOFTWARE_DELIVERY_GATE_COMMANDS[gate],
  }));

export const SOFTWARE_DELIVERY_STATE_ALIASES = {
  active: 'in_progress',
} as const;

export function resolveSoftwareDeliveryStateAlias(
  state: string,
  aliases: Record<string, string> = SOFTWARE_DELIVERY_STATE_ALIASES,
): string {
  return aliases[state] ?? state;
}

export async function runCompletionGatePolicies(options: {
  engine: CompletionPolicyEngine;
  runId: string;
  taskId: string;
  providers?: readonly PolicyProvider[];
  executePolicy?: (provider: PolicyProvider) => Promise<CompletionPolicyExecution>;
}): Promise<CompletionPolicyRunResult[]> {
  const providers = options.providers ?? SOFTWARE_DELIVERY_GATE_POLICIES;
  const executePolicy =
    options.executePolicy ??
    (async () => ({
      ok: true,
    }));

  const results: CompletionPolicyRunResult[] = [];

  for (const provider of providers) {
    const evaluation = await options.engine.evaluate({
      trigger: provider.trigger,
      run_id: options.runId,
      task_id: options.taskId,
      gate: provider.gate,
      pack_id: SOFTWARE_DELIVERY_PACK_ID,
    });

    if (evaluation.decision === 'deny') {
      results.push({
        gate: provider.gate,
        policy_id: provider.id,
        decision: 'deny',
        command: provider.command,
        executed: false,
        ok: false,
      });
      continue;
    }

    const execution = await executePolicy(provider);
    results.push({
      gate: provider.gate,
      policy_id: provider.id,
      decision: 'allow',
      command: provider.command,
      executed: true,
      ok: execution.ok,
    });
  }

  return results;
}
