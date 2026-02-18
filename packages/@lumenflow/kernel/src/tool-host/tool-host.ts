// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { intersectToolScopes } from './scope-intersection.js';
import { TOOL_TRACE_KINDS } from '../event-kinds.js';
import {
  ExecutionContextSchema,
  ToolOutputSchema,
  ToolScopeSchema,
  TOOL_ERROR_CODES,
  TOOL_HANDLER_KINDS,
  type ExecutionContext,
  type PolicyDecision,
  type ToolCapability,
  type ToolOutput,
  type ToolScope,
} from '../kernel.schemas.js';
import {
  DEFAULT_KERNEL_RUNTIME_VERSION,
  DEFAULT_WORKSPACE_CONFIG_HASH,
  EXECUTION_METADATA_KEYS,
  KERNEL_POLICY_IDS,
  RESERVED_FRAMEWORK_SCOPE_GLOB,
  RESERVED_FRAMEWORK_SCOPE_PREFIX,
  RESERVED_FRAMEWORK_SCOPE_ROOT,
  SHA256_HEX_REGEX,
} from '../shared-constants.js';
import { EvidenceStore } from '../evidence/evidence-store.js';
import { ToolRegistry } from './tool-registry.js';
import { DefaultSubprocessDispatcher, type SubprocessDispatcher } from './subprocess-dispatcher.js';

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

function normalizeScopePattern(pattern: string): string {
  return pattern.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isReservedFrameworkWriteScope(
  scope: ToolScope,
): scope is Extract<ToolScope, { type: 'path' }> {
  if (scope.type !== 'path' || scope.access !== 'write') {
    return false;
  }

  const normalized = normalizeScopePattern(scope.pattern);
  return (
    normalized === RESERVED_FRAMEWORK_SCOPE_ROOT ||
    normalized.startsWith(RESERVED_FRAMEWORK_SCOPE_PREFIX)
  );
}

function collectReservedFrameworkWriteScopes(scopes: ToolScope[]): string[] {
  const blocked = scopes
    .filter((scope) => isReservedFrameworkWriteScope(scope))
    .map((scope) => normalizeScopePattern(scope.pattern));
  return [...new Set(blocked)];
}

async function allowAllPolicyHook(): Promise<PolicyDecision[]> {
  return [
    {
      policy_id: KERNEL_POLICY_IDS.ALLOW_ALL,
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
    this.subprocessDispatcher = options.subprocessDispatcher ?? new DefaultSubprocessDispatcher();
    this.policyHook = options.policyHook ?? allowAllPolicyHook;
    this.runtimeVersion = options.runtimeVersion ?? DEFAULT_KERNEL_RUNTIME_VERSION;
  }

  async onStartup(): Promise<number> {
    return this.evidenceStore.reconcileOrphanedStarts();
  }

  async onShutdown(): Promise<number> {
    return this.evidenceStore.reconcileOrphanedStarts();
  }

  async execute(name: string, input: unknown, ctx: ExecutionContext): Promise<ToolOutput> {
    const context = ExecutionContextSchema.parse(ctx);

    const capability = this.registry.lookup(name);
    if (!capability) {
      return {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.TOOL_NOT_FOUND,
          message: `Tool "${name}" is not registered`,
        },
      };
    }

    const metadata = resolveMetadata(context);
    const workspaceAllowed = parseScopeList(
      metadata[EXECUTION_METADATA_KEYS.WORKSPACE_ALLOWED_SCOPES],
      context.allowed_scopes,
    );
    const laneAllowed = parseScopeList(
      metadata[EXECUTION_METADATA_KEYS.LANE_ALLOWED_SCOPES],
      context.allowed_scopes,
    );
    const taskDeclared = parseScopeList(
      metadata[EXECUTION_METADATA_KEYS.TASK_DECLARED_SCOPES],
      context.allowed_scopes,
    );

    const scopeRequested = capability.required_scopes;
    const reservedFrameworkWriteScopes = collectReservedFrameworkWriteScopes(scopeRequested);
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

    const workspaceConfigHashCandidate = parseOptionalString(
      metadata[EXECUTION_METADATA_KEYS.WORKSPACE_CONFIG_HASH],
    );
    const workspaceConfigHash =
      workspaceConfigHashCandidate && SHA256_HEX_REGEX.test(workspaceConfigHashCandidate)
        ? workspaceConfigHashCandidate
        : DEFAULT_WORKSPACE_CONFIG_HASH;

    const runtimeVersion =
      parseOptionalString(metadata[EXECUTION_METADATA_KEYS.RUNTIME_VERSION]) ?? this.runtimeVersion;
    const packVersion = parseOptionalString(metadata[EXECUTION_METADATA_KEYS.PACK_VERSION]);
    const packIntegrity = parseOptionalString(metadata[EXECUTION_METADATA_KEYS.PACK_INTEGRITY]);
    const packId =
      capability.pack ?? parseOptionalString(metadata[EXECUTION_METADATA_KEYS.PACK_ID]);

    await this.evidenceStore.appendTrace({
      schema_version: 1,
      kind: TOOL_TRACE_KINDS.TOOL_CALL_STARTED,
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

    if (reservedFrameworkWriteScopes.length > 0) {
      const deniedOutput: ToolOutput = {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.SCOPE_DENIED,
          message: `Reserved scope violation: pack/tool write scopes under ${RESERVED_FRAMEWORK_SCOPE_GLOB} are not allowed.`,
          details: {
            reserved_scopes: reservedFrameworkWriteScopes,
          },
        },
      };

      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
        receipt_id: receiptId,
        timestamp: new Date().toISOString(),
        result: 'denied',
        duration_ms: Date.now() - startedAt,
        scope_enforcement_note: `Denied by reserved framework boundary: ${RESERVED_FRAMEWORK_SCOPE_GLOB} is framework-owned.`,
        policy_decisions: [
          {
            policy_id: KERNEL_POLICY_IDS.SCOPE_RESERVED_PATH,
            decision: 'deny',
            reason: `Pack/tool declared write scope targets reserved ${RESERVED_FRAMEWORK_SCOPE_GLOB} namespace`,
          },
        ],
        artifacts_written: [],
      });

      return deniedOutput;
    }

    if (scopeEnforced.length === 0) {
      const deniedOutput: ToolOutput = {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.SCOPE_DENIED,
          message: 'Scope intersection denied: no allowed scopes remain after intersection.',
          details: {
            scope_requested: scopeRequested,
            scope_allowed: scopeAllowed,
          },
        },
      };

      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
        receipt_id: receiptId,
        timestamp: new Date().toISOString(),
        result: 'denied',
        duration_ms: Date.now() - startedAt,
        scope_enforcement_note: 'Denied by hard boundary: empty scope intersection.',
        policy_decisions: [
          {
            policy_id: KERNEL_POLICY_IDS.SCOPE_BOUNDARY,
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
          code: TOOL_ERROR_CODES.POLICY_DENIED,
          message: 'Policy hook denied tool execution.',
        },
      };
      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
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
          code: TOOL_ERROR_CODES.INVALID_INPUT,
          message: parsedInput.error.message,
        },
      };
      await this.evidenceStore.appendTrace({
        schema_version: 1,
        kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
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
      if (capability.handler.kind === TOOL_HANDLER_KINDS.IN_PROCESS) {
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
          code: TOOL_ERROR_CODES.TOOL_EXECUTION_FAILED,
          message: (error as Error).message,
        },
      };
    }

    const normalizedOutputResult = ToolOutputSchema.safeParse(output);
    if (!normalizedOutputResult.success) {
      output = {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.INVALID_OUTPUT,
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
            code: TOOL_ERROR_CODES.INVALID_OUTPUT,
            message: parsedData.error.message,
          },
        };
      }
    }

    const outputRef =
      output.data === undefined ? undefined : await this.evidenceStore.persistInput(output.data);
    const outputHash = outputRef?.inputHash;
    const outputReference = outputRef?.inputRef;
    const result = output.success
      ? 'success'
      : output.error?.code === TOOL_ERROR_CODES.SCOPE_DENIED
        ? 'denied'
        : 'failure';

    await this.evidenceStore.appendTrace({
      schema_version: 1,
      kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
      receipt_id: receiptId,
      timestamp: new Date().toISOString(),
      result,
      duration_ms: Date.now() - startedAt,
      output_hash: outputHash,
      output_ref: outputReference,
      scope_enforcement_note:
        result === 'success'
          ? 'Allowed by scope intersection and policy.'
          : 'Denied or failed during execution.',
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
