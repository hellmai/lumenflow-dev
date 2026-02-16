import { createHash, randomUUID } from 'node:crypto';
import { intersectToolScopes } from './scope-intersection.js';
import {
  ExecutionContextSchema,
  ToolOutputSchema,
  ToolScopeSchema,
  type ExecutionContext,
  type PolicyDecision,
  type ToolCapability,
  type ToolOutput,
  type ToolScope,
} from '../kernel.schemas.js';
import { EvidenceStore } from '../evidence/evidence-store.js';
import { ToolRegistry } from './tool-registry.js';
import {
  DefaultSubprocessDispatcher,
  type SubprocessDispatcher,
} from './subprocess-dispatcher.js';
import { canonical_json } from '../canonical-json.js';

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
const DEFAULT_WORKSPACE_CONFIG_HASH = '0'.repeat(64);
const DEFAULT_RUNTIME_VERSION = 'kernel-dev';

export interface PolicyHookInput {
  capability: ToolCapability;
  input: unknown;
  context: ExecutionContext;
  scopeEnforced: ToolScope[];
}

export type PolicyHook = (input: PolicyHookInput) => Promise<PolicyDecision[]>;

export interface ToolHostOptions {
  registry: ToolRegistry;
  evidenceStore: EvidenceStore;
  subprocessDispatcher?: SubprocessDispatcher;
  policyHook?: PolicyHook;
  runtimeVersion?: string;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function resolveMetadata(context: ExecutionContext): Record<string, unknown> {
  if (!context.metadata || typeof context.metadata !== 'object') {
    return {};
  }
  return context.metadata;
}

function parseScopeList(candidate: unknown, fallback: ToolScope[]): ToolScope[] {
  const parsed = ToolScopeSchema.array().safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  return fallback;
}

function parseOptionalString(candidate: unknown): string | undefined {
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined;
}

async function allowAllPolicyHook(): Promise<PolicyDecision[]> {
  return [
    {
      policy_id: 'kernel.policy.allow-all',
      decision: 'allow',
      reason: 'Phase 2 default allow-all policy',
    },
  ];
}

export class ToolHost {
  private readonly registry: ToolRegistry;
  private readonly evidenceStore: EvidenceStore;
  private readonly subprocessDispatcher: SubprocessDispatcher;
  private readonly policyHook: PolicyHook;
  private readonly runtimeVersion: string;

  constructor(options: ToolHostOptions) {
    this.registry = options.registry;
    this.evidenceStore = options.evidenceStore;
    this.subprocessDispatcher =
      options.subprocessDispatcher ?? new DefaultSubprocessDispatcher();
    this.policyHook = options.policyHook ?? allowAllPolicyHook;
    this.runtimeVersion = options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION;
  }

  async execute(name: string, input: unknown, ctx: ExecutionContext): Promise<ToolOutput> {
    const context = ExecutionContextSchema.parse(ctx);
    await this.evidenceStore.reconcileOrphanedStarts();

    const capability = this.registry.lookup(name);
    if (!capability) {
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool "${name}" is not registered`,
        },
      };
    }

    const metadata = resolveMetadata(context);
    const workspaceAllowed = parseScopeList(metadata.workspace_allowed_scopes, context.allowed_scopes);
    const laneAllowed = parseScopeList(metadata.lane_allowed_scopes, context.allowed_scopes);
    const taskDeclared = parseScopeList(metadata.task_declared_scopes, context.allowed_scopes);

    const scopeRequested = capability.required_scopes;
    const scopeAllowed = intersectToolScopes({
      workspaceAllowed,
      laneAllowed,
      taskDeclared,
      toolRequired: scopeRequested,
    });
    const scopeEnforced = scopeAllowed;

    const { inputHash, inputRef } = await this.evidenceStore.persistInput(input);
    const receiptId = randomUUID();
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    const workspaceConfigHashCandidate = parseOptionalString(metadata.workspace_config_hash);
    const workspaceConfigHash =
      workspaceConfigHashCandidate && SHA256_HEX_REGEX.test(workspaceConfigHashCandidate)
        ? workspaceConfigHashCandidate
        : DEFAULT_WORKSPACE_CONFIG_HASH;

    const runtimeVersion =
      parseOptionalString(metadata.runtime_version) ?? this.runtimeVersion;
    const packVersion = parseOptionalString(metadata.pack_version);
    const packIntegrity = parseOptionalString(metadata.pack_integrity);
    const packId = capability.pack ?? parseOptionalString(metadata.pack_id);

    await this.evidenceStore.appendTrace({
      schema_version: 1,
      kind: 'tool_call_started',
      receipt_id: receiptId,
      run_id: context.run_id,
      task_id: context.task_id,
      session_id: context.session_id,
      timestamp,
      tool_name: capability.name,
      execution_mode: capability.handler.kind,
      scope_requested: scopeRequested,
      scope_allowed: scopeAllowed,
      scope_enforced: scopeEnforced,
      input_hash: inputHash,
      input_ref: inputRef,
      tool_version: capability.version,
      pack_id: packId,
      pack_version: packVersion,
      pack_integrity: packIntegrity,
      workspace_config_hash: workspaceConfigHash,
      runtime_version: runtimeVersion,
    });

    if (scopeEnforced.length === 0) {
      const deniedOutput: ToolOutput = {
        success: false,
        error: {
          code: 'SCOPE_DENIED',
          message: 'Scope intersection denied: no allowed scopes remain after intersection.',
          details: {
            scope_requested: scopeRequested,
            scope_allowed: scopeAllowed,
          },
        },
      };

      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: 'tool_call_finished',
        receipt_id: receiptId,
        timestamp: new Date().toISOString(),
        result: 'denied',
        duration_ms: Date.now() - startedAt,
        scope_enforcement_note: 'Denied by hard boundary: empty scope intersection.',
        policy_decisions: [
          {
            policy_id: 'kernel.scope.boundary',
            decision: 'deny',
            reason: 'No intersecting scopes after scope resolution',
          },
        ],
        artifacts_written: [],
      });

      return deniedOutput;
    }

    const policyDecisions = await this.policyHook({
      capability,
      input,
      context,
      scopeEnforced,
    });

    if (policyDecisions.some((decision) => decision.decision === 'deny')) {
      const deniedOutput: ToolOutput = {
        success: false,
        error: {
          code: 'POLICY_DENIED',
          message: 'Policy hook denied tool execution.',
        },
      };
      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: 'tool_call_finished',
        receipt_id: receiptId,
        timestamp: new Date().toISOString(),
        result: 'denied',
        duration_ms: Date.now() - startedAt,
        scope_enforcement_note: 'Denied by policy hook decision.',
        policy_decisions: policyDecisions,
        artifacts_written: [],
      });
      return deniedOutput;
    }

    const parsedInput = capability.input_schema.safeParse(input);
    if (!parsedInput.success) {
      const invalidInputOutput: ToolOutput = {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: parsedInput.error.message,
        },
      };
      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: 'tool_call_finished',
        receipt_id: receiptId,
        timestamp: new Date().toISOString(),
        result: 'failure',
        duration_ms: Date.now() - startedAt,
        scope_enforcement_note: 'Input validation failed before dispatch.',
        policy_decisions: policyDecisions,
        artifacts_written: [],
      });
      return invalidInputOutput;
    }

    let output: ToolOutput;
    try {
      if (capability.handler.kind === 'in-process') {
        output = await capability.handler.fn(parsedInput.data, context);
      } else {
        output = await this.subprocessDispatcher.dispatch({
          capability,
          input: parsedInput.data,
          context,
          scopeEnforced,
        });
      }
    } catch (error) {
      output = {
        success: false,
        error: {
          code: 'TOOL_EXECUTION_FAILED',
          message: (error as Error).message,
        },
      };
    }

    const normalizedOutputResult = ToolOutputSchema.safeParse(output);
    if (!normalizedOutputResult.success) {
      output = {
        success: false,
        error: {
          code: 'INVALID_OUTPUT',
          message: normalizedOutputResult.error.message,
        },
      };
    } else {
      output = normalizedOutputResult.data;
    }

    if (capability.output_schema && output.success) {
      const parsedData = capability.output_schema.safeParse(output.data);
      if (!parsedData.success) {
        output = {
          success: false,
          error: {
            code: 'INVALID_OUTPUT',
            message: parsedData.error.message,
          },
        };
      }
    }

    const outputRef = output.data === undefined ? undefined : await this.evidenceStore.persistInput(output.data);
    const outputHash = outputRef?.inputHash;
    const outputReference = outputRef?.inputRef;
    const result = output.success
      ? 'success'
      : output.error?.code === 'SCOPE_DENIED'
        ? 'denied'
        : 'failure';

    await this.evidenceStore.appendTrace({
      schema_version: 1,
      kind: 'tool_call_finished',
      receipt_id: receiptId,
      timestamp: new Date().toISOString(),
      result,
      duration_ms: Date.now() - startedAt,
      output_hash: outputHash,
      output_ref: outputReference,
      scope_enforcement_note: result === 'success' ? 'Allowed by scope intersection and policy.' : 'Denied or failed during execution.',
      policy_decisions: policyDecisions,
      artifacts_written:
        Array.isArray(output.metadata?.artifacts_written) &&
        output.metadata?.artifacts_written.every((artifact) => typeof artifact === 'string')
          ? (output.metadata.artifacts_written as string[])
          : [],
    });

    return output;
  }
}
