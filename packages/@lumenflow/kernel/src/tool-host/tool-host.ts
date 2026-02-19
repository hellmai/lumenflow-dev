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
  policyHook: PolicyHook;
  runtimeVersion?: string;
  now?: () => Date;
  /** Optional callback invoked when trace recording fails. Provides observability into silent catch blocks. */
  onTraceError?: (error: Error) => void;
}

interface ScopeResolution {
  scopeRequested: ToolScope[];
  scopeAllowed: ToolScope[];
  scopeEnforced: ToolScope[];
  reservedFrameworkWriteScopes: string[];
}

type AuthorizeResult =
  | { denied: true; output: ToolOutput }
  | { denied: false; policyDecisions: PolicyDecision[] };

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

export async function allowAllPolicyHook(): Promise<PolicyDecision[]> {
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
  private readonly now: () => Date;
  private readonly onTraceError?: (error: Error) => void;

  constructor(options: ToolHostOptions) {
    if (!options.policyHook) {
      throw new Error(
        'ToolHost requires an explicit policyHook. ' +
          'Use allowAllPolicyHook for development or provide a production policy.',
      );
    }
    this.registry = options.registry;
    this.evidenceStore = options.evidenceStore;
    this.subprocessDispatcher = options.subprocessDispatcher ?? new DefaultSubprocessDispatcher();
    this.policyHook = options.policyHook;
    this.runtimeVersion = options.runtimeVersion ?? DEFAULT_KERNEL_RUNTIME_VERSION;
    this.now = options.now ?? (() => new Date());
    this.onTraceError = options.onTraceError;
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
    const { scopeRequested, scopeAllowed, scopeEnforced, reservedFrameworkWriteScopes } =
      this.resolveScope(capability, context, metadata);

    const { dataHash: inputHash, dataRef: inputRef } = await this.evidenceStore.persistData(input);
    const receiptId = randomUUID();
    const startedAt = this.now().getTime();
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

    try {
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
    } catch (error) {
      // Started trace failure must not prevent tool execution.
      this.onTraceError?.(error as Error);
    }

    const authResult = await this.authorize({
      receiptId,
      startedAt,
      capability,
      input,
      context,
      scopeRequested,
      scopeAllowed,
      scopeEnforced,
      reservedFrameworkWriteScopes,
    });
    if (authResult.denied) {
      return authResult.output;
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
      try {
        await this.recordDeniedTrace({
          receiptId,
          startedAt,
          result: 'failure',
          scopeEnforcementNote: 'Input validation failed before dispatch.',
          policyDecisions: authResult.policyDecisions,
        });
      } catch (error) {
        // Denied trace failure must not suppress the denial output.
        this.onTraceError?.(error as Error);
      }
      return invalidInputOutput;
    }

    let output = await this.dispatch(capability, parsedInput.data, context, scopeEnforced);
    output = this.normalizeOutput(output, capability);

    try {
      await this.recordTrace({
        receiptId,
        startedAt,
        output,
        policyDecisions: authResult.policyDecisions,
      });
    } catch (error) {
      // Trace recording failure must not swallow the tool execution result.
      // The tool output is more important to the caller than the audit trail.
      this.onTraceError?.(error as Error);
    }

    return output;
  }

  private resolveScope(
    capability: ToolCapability,
    context: ExecutionContext,
    metadata: Record<string, unknown>,
  ): ScopeResolution {
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

    return { scopeRequested, scopeAllowed, scopeEnforced, reservedFrameworkWriteScopes };
  }

  private async authorize(params: {
    receiptId: string;
    startedAt: number;
    capability: ToolCapability;
    input: unknown;
    context: ExecutionContext;
    scopeRequested: ToolScope[];
    scopeAllowed: ToolScope[];
    scopeEnforced: ToolScope[];
    reservedFrameworkWriteScopes: string[];
  }): Promise<AuthorizeResult> {
    const {
      receiptId,
      startedAt,
      capability,
      input,
      context,
      scopeRequested,
      scopeAllowed,
      scopeEnforced,
      reservedFrameworkWriteScopes,
    } = params;

    if (reservedFrameworkWriteScopes.length > 0) {
      const output: ToolOutput = {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.SCOPE_DENIED,
          message: `Reserved scope violation: pack/tool write scopes under ${RESERVED_FRAMEWORK_SCOPE_GLOB} are not allowed.`,
          details: {
            reserved_scopes: reservedFrameworkWriteScopes,
          },
        },
      };
      try {
        await this.recordDeniedTrace({
          receiptId,
          startedAt,
          result: 'denied',
          scopeEnforcementNote: `Denied by reserved framework boundary: ${RESERVED_FRAMEWORK_SCOPE_GLOB} is framework-owned.`,
          policyDecisions: [
            {
              policy_id: KERNEL_POLICY_IDS.SCOPE_RESERVED_PATH,
              decision: 'deny',
              reason: `Pack/tool declared write scope targets reserved ${RESERVED_FRAMEWORK_SCOPE_GLOB} namespace`,
            },
          ],
        });
      } catch (error) {
        // Denied trace failure must not suppress the denial output.
        this.onTraceError?.(error as Error);
      }
      return { denied: true, output };
    }

    if (scopeEnforced.length === 0) {
      const output: ToolOutput = {
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
      try {
        await this.recordDeniedTrace({
          receiptId,
          startedAt,
          result: 'denied',
          scopeEnforcementNote: 'Denied by hard boundary: empty scope intersection.',
          policyDecisions: [
            {
              policy_id: KERNEL_POLICY_IDS.SCOPE_BOUNDARY,
              decision: 'deny',
              reason: 'No intersecting scopes after scope resolution',
            },
          ],
        });
      } catch (error) {
        // Denied trace failure must not suppress the denial output.
        this.onTraceError?.(error as Error);
      }
      return { denied: true, output };
    }

    const policyDecisions = await this.policyHook({
      capability,
      input,
      context,
      scopeEnforced,
    });

    if (policyDecisions.some((decision) => decision.decision === 'deny')) {
      const output: ToolOutput = {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.POLICY_DENIED,
          message: 'Policy hook denied tool execution.',
        },
      };
      try {
        await this.recordDeniedTrace({
          receiptId,
          startedAt,
          result: 'denied',
          scopeEnforcementNote: 'Denied by policy hook decision.',
          policyDecisions,
        });
      } catch (error) {
        // Denied trace failure must not suppress the denial output.
        this.onTraceError?.(error as Error);
      }
      return { denied: true, output };
    }

    return { denied: false, policyDecisions };
  }

  private async dispatch(
    capability: ToolCapability,
    input: unknown,
    context: ExecutionContext,
    scopeEnforced: ToolScope[],
  ): Promise<ToolOutput> {
    try {
      if (capability.handler.kind === TOOL_HANDLER_KINDS.IN_PROCESS) {
        return await capability.handler.fn(input, context);
      }
      return await this.subprocessDispatcher.dispatch({
        capability,
        input,
        context,
        scopeEnforced,
      });
    } catch (error) {
      return {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.TOOL_EXECUTION_FAILED,
          message: (error as Error).message,
        },
      };
    }
  }

  private normalizeOutput(output: ToolOutput, capability: ToolCapability): ToolOutput {
    const normalizedOutputResult = ToolOutputSchema.safeParse(output);
    if (!normalizedOutputResult.success) {
      return {
        success: false,
        error: {
          code: TOOL_ERROR_CODES.INVALID_OUTPUT,
          message: normalizedOutputResult.error.message,
        },
      };
    }

    let normalized = normalizedOutputResult.data;

    if (capability.output_schema && normalized.success) {
      const parsedData = capability.output_schema.safeParse(normalized.data);
      if (!parsedData.success) {
        normalized = {
          success: false,
          error: {
            code: TOOL_ERROR_CODES.INVALID_OUTPUT,
            message: parsedData.error.message,
          },
        };
      }
    }

    return normalized;
  }

  private async recordDeniedTrace(params: {
    receiptId: string;
    startedAt: number;
    result: 'denied' | 'failure';
    scopeEnforcementNote: string;
    policyDecisions: PolicyDecision[];
  }): Promise<void> {
    const finishedAt = this.now();
    await this.evidenceStore.appendTrace({
      schema_version: 1,
      kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
      receipt_id: params.receiptId,
      timestamp: finishedAt.toISOString(),
      result: params.result,
      duration_ms: finishedAt.getTime() - params.startedAt,
      scope_enforcement_note: params.scopeEnforcementNote,
      policy_decisions: params.policyDecisions,
      artifacts_written: [],
    });
  }

  private async recordTrace(params: {
    receiptId: string;
    startedAt: number;
    output: ToolOutput;
    policyDecisions: PolicyDecision[];
  }): Promise<void> {
    const { receiptId, startedAt, output, policyDecisions } = params;

    const outputRef =
      output.data === undefined ? undefined : await this.evidenceStore.persistData(output.data);
    const outputHash = outputRef?.dataHash;
    const outputReference = outputRef?.dataRef;
    const result = output.success
      ? 'success'
      : output.error?.code === TOOL_ERROR_CODES.SCOPE_DENIED
        ? 'denied'
        : 'failure';

    const finishedAt = this.now();
    await this.evidenceStore.appendTrace({
      schema_version: 1,
      kind: TOOL_TRACE_KINDS.TOOL_CALL_FINISHED,
      receipt_id: receiptId,
      timestamp: finishedAt.toISOString(),
      result,
      duration_ms: finishedAt.getTime() - startedAt,
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
  }
}
