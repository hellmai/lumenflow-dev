// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { z, type ZodTypeAny } from 'zod';
import { KERNEL_EVENT_KINDS, TOOL_TRACE_KINDS } from './event-kinds.js';
import { SHA256_HEX_REGEX, SHA256_INTEGRITY_REGEX } from './shared-constants.js';
import type { DomainPackManifest } from './pack/manifest.js';

const ISO_DATETIME_SCHEMA = z.string().datetime();
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const SEMVER_MESSAGE = 'Expected semantic version';

export const RUN_STATUSES = {
  PLANNED: 'planned',
  EXECUTING: 'executing',
  PAUSED: 'paused',
  FAILED: 'failed',
  SUCCEEDED: 'succeeded',
} as const;

export const RUN_STATUS_VALUES = [
  RUN_STATUSES.PLANNED,
  RUN_STATUSES.EXECUTING,
  RUN_STATUSES.PAUSED,
  RUN_STATUSES.FAILED,
  RUN_STATUSES.SUCCEEDED,
] as const;

export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export const TOOL_HANDLER_KINDS = {
  IN_PROCESS: 'in-process',
  SUBPROCESS: 'subprocess',
} as const;

export const TOOL_HANDLER_KIND_VALUES = [
  TOOL_HANDLER_KINDS.IN_PROCESS,
  TOOL_HANDLER_KINDS.SUBPROCESS,
] as const;

export type ToolHandlerKind = (typeof TOOL_HANDLER_KIND_VALUES)[number];

export const TOOL_ERROR_CODES = {
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  SCOPE_DENIED: 'SCOPE_DENIED',
  POLICY_DENIED: 'POLICY_DENIED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_OUTPUT: 'INVALID_OUTPUT',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

export const ToolScopePathSchema = z.object({
  type: z.literal('path'),
  pattern: z.string().min(1),
  access: z.enum(['read', 'write']),
});

export const ToolScopeNetworkSchema = z.object({
  type: z.literal('network'),
  posture: z.enum(['off', 'full']),
});

export const ToolScopeSchema = z.discriminatedUnion('type', [
  ToolScopePathSchema,
  ToolScopeNetworkSchema,
]);

export type ToolScope = z.infer<typeof ToolScopeSchema>;

const AcceptanceSchema = z.union([
  z.array(z.string().min(1)).min(1),
  z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
]);

export const TaskSpecSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  lane_id: z.string().min(1),
  domain: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptance: AcceptanceSchema,
  declared_scopes: z.array(ToolScopeSchema),
  expected_artifacts: z.array(z.string().min(1)).optional(),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  blocks: z.array(z.string().min(1)).optional(),
  blocked_by: z.array(z.string().min(1)).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
  type: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  created: z.string().date(),
  labels: z.array(z.string().min(1)).optional(),
});

export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const RunSchema = z.object({
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  status: z.enum(RUN_STATUS_VALUES),
  started_at: ISO_DATETIME_SCHEMA,
  completed_at: ISO_DATETIME_SCHEMA.optional(),
  by: z.string().min(1),
  session_id: z.string().min(1),
});

export type Run = z.infer<typeof RunSchema>;

export const TaskStateSchema = z.object({
  task_id: z.string().min(1),
  status: z.enum(['ready', 'active', 'blocked', 'waiting', 'done']),
  claimed_at: ISO_DATETIME_SCHEMA.optional(),
  claimed_by: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  blocked_reason: z.string().min(1).optional(),
  completed_at: ISO_DATETIME_SCHEMA.optional(),
  current_run: RunSchema.optional(),
  run_count: z.number().int().nonnegative(),
  domain_state: z.record(z.string(), z.unknown()).optional(),
});

export type TaskState = z.infer<typeof TaskStateSchema>;

export const PackPinSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX, SEMVER_MESSAGE),
  integrity: z.union([
    z.literal('dev'),
    z.string().regex(SHA256_INTEGRITY_REGEX, 'Expected dev or sha256:<64-hex>'),
  ]),
  source: z.enum(['local', 'git', 'registry']),
  url: z.string().url().optional(),
  /** Registry base URL override. When omitted, uses PackLoader's defaultRegistryUrl. */
  registry_url: z.string().url().optional(),
});

export type PackPin = z.infer<typeof PackPinSchema>;

export const LaneSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  allowed_scopes: z.array(ToolScopeSchema).default([]),
  wip_limit: z.number().int().positive().optional(),
  policy_overrides: z.record(z.string(), z.unknown()).optional(),
});

export type LaneSpec = z.infer<typeof LaneSpecSchema>;

export const WorkspaceControlPlanePolicyModeSchema = z.enum([
  'authoritative',
  'tighten-only',
  'dev-override',
]);

const CONTROL_PLANE_AUTH_TOKEN_ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const WorkspaceControlPlaneAuthConfigSchema = z
  .object({
    token_env: z
      .string()
      .regex(CONTROL_PLANE_AUTH_TOKEN_ENV_PATTERN, 'Expected uppercase environment variable name'),
  })
  .strict();

export const WorkspaceControlPlaneConfigSchema = z
  .object({
    endpoint: z.string().url(),
    org_id: z.string().min(1),
    project_id: z.string().min(1),
    sync_interval: z.number().int().positive(),
    policy_mode: WorkspaceControlPlanePolicyModeSchema,
    auth: WorkspaceControlPlaneAuthConfigSchema,
  })
  .strict();

export const WorkspaceSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  packs: z.array(PackPinSchema),
  lanes: z.array(LaneSpecSchema),
  policies: z.record(z.string(), z.unknown()).optional(),
  security: z.object({
    allowed_scopes: z.array(ToolScopeSchema),
    network_default: z.enum(['off', 'full']),
    deny_overlays: z.array(z.string().min(1)),
  }),
  software_delivery: z.record(z.string(), z.unknown()).optional(),
  control_plane: WorkspaceControlPlaneConfigSchema.optional(),
  memory_namespace: z.string().min(1),
  event_namespace: z.string().min(1),
});

export type WorkspaceSpec = z.infer<typeof WorkspaceSpecSchema>;
export type WorkspaceControlPlanePolicyMode = z.infer<typeof WorkspaceControlPlanePolicyModeSchema>;
export type WorkspaceControlPlaneConfig = z.infer<typeof WorkspaceControlPlaneConfigSchema>;
export type WorkspaceControlPlaneAuthConfig = z.infer<typeof WorkspaceControlPlaneAuthConfigSchema>;

/**
 * Root keys owned by the kernel itself. These are always valid in a workspace spec
 * regardless of which packs are pinned.
 *
 * NOTE: `software_delivery` is NOT in this list. It is a pack config_key declared
 * by the software-delivery pack manifest. Any pack can declare a config_key in its
 * manifest, and that key becomes a valid workspace root key when the pack is pinned.
 */
export const KERNEL_OWNED_ROOT_KEYS = [
  'id',
  'name',
  'packs',
  'lanes',
  'policies',
  'security',
  'control_plane',
  'memory_namespace',
  'event_namespace',
] as const;

export type KernelOwnedRootKey = (typeof KERNEL_OWNED_ROOT_KEYS)[number];

/**
 * Well-known pack config_keys that have a dedicated migration error message.
 * When a workspace has one of these keys but no corresponding pack is pinned,
 * the error should guide the user to pin the pack instead of showing the generic
 * "Unknown workspace root key" message.
 */
const KNOWN_PACK_CONFIG_KEY_MIGRATIONS: Record<string, { packId: string; packLabel: string }> = {
  software_delivery: {
    packId: 'software-delivery',
    packLabel: 'software-delivery',
  },
};

/**
 * Two-phase workspace root key validation result.
 */
export interface WorkspaceRootKeyValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Two-phase workspace root key validation.
 *
 * Phase 1: Validate that all root keys are either kernel-owned root keys
 *          or declared pack config_keys.
 * Phase 2: Resolve pack manifests and collect their config_key declarations
 *          to build the set of valid pack root keys.
 *
 * Unknown root keys are rejected hard -- no passthrough, no silent acceptance.
 *
 * @param workspaceData - The raw workspace data object (parsed from YAML)
 * @param packManifests - Loaded pack manifests for all pinned packs
 * @param availableManifests - All available pack manifests (including non-pinned) for version lookup in migration errors
 * @returns Validation result with errors for unknown root keys
 */
export function validateWorkspaceRootKeys(
  workspaceData: Record<string, unknown>,
  packManifests: ReadonlyArray<Pick<DomainPackManifest, 'config_key' | 'id' | 'version'>>,
  availableManifests: ReadonlyArray<Pick<DomainPackManifest, 'id' | 'version'>> = [],
): WorkspaceRootKeyValidationResult {
  const kernelKeys = new Set<string>(KERNEL_OWNED_ROOT_KEYS);

  // Phase 2: Collect config_keys from pack manifests
  const packConfigKeys = new Set<string>();
  for (const manifest of packManifests) {
    if (manifest.config_key) {
      packConfigKeys.add(manifest.config_key);
    }
  }

  // Validate all root keys in the workspace data
  const errors: string[] = [];
  for (const key of Object.keys(workspaceData)) {
    if (kernelKeys.has(key)) {
      continue;
    }
    if (packConfigKeys.has(key)) {
      continue;
    }

    // Check if this is a known pack config_key that needs a migration-specific error
    const migration = KNOWN_PACK_CONFIG_KEY_MIGRATIONS[key];
    if (migration) {
      // Look up the real version from available manifests instead of hardcoding
      const availableManifest =
        availableManifests.find((m) => m.id === migration.packId) ??
        packManifests.find((m) => m.id === migration.packId);
      const versionFlag = availableManifest
        ? `--version ${availableManifest.version}`
        : '--version latest';
      errors.push(
        `Your workspace has a "${key}" config block but the ${migration.packLabel} pack is not pinned. ` +
          `Since LumenFlow 3.x, pack config keys require explicit pack pinning. ` +
          `Add the ${migration.packLabel} pack to your workspace:\n\n` +
          `  pnpm pack:install --id ${migration.packId} --source registry ${versionFlag}`,
      );
      continue;
    }

    errors.push(
      `Unknown workspace root key "${key}". ` +
        'Only kernel-owned keys and pack-declared config_keys are allowed. ' +
        'If this key belongs to a pack, ensure the pack is pinned and declares config_key in its manifest.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

const KernelEventBaseSchema = z.object({
  schema_version: z.literal(1),
  timestamp: ISO_DATETIME_SCHEMA,
});

const TaskEventBaseSchema = KernelEventBaseSchema.extend({
  task_id: z.string().min(1),
});

const RunEventBaseSchema = TaskEventBaseSchema.extend({
  run_id: z.string().min(1),
});

const TaskCreatedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_CREATED),
  spec_hash: z.string().regex(SHA256_HEX_REGEX),
});

const TaskClaimedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_CLAIMED),
  by: z.string().min(1),
  session_id: z.string().min(1),
  domain_data: z.record(z.string(), z.unknown()).optional(),
});

const TaskBlockedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_BLOCKED),
  reason: z.string().min(1),
});

const TaskUnblockedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_UNBLOCKED),
});

const TaskWaitingEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_WAITING),
  reason: z.string().min(1),
  wait_for: z.string().min(1).optional(),
});

const TaskResumedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_RESUMED),
});

const TaskCompletedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_COMPLETED),
  evidence_refs: z.array(z.string().min(1)).optional(),
});

const TaskReleasedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_RELEASED),
  reason: z.string().min(1),
});

const TaskDelegatedEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.TASK_DELEGATED),
  parent_task_id: z.string().min(1),
  delegation_id: z.string().min(1),
});

const RunStartedEventSchema = RunEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.RUN_STARTED),
  by: z.string().min(1),
  session_id: z.string().min(1),
});

const RunPausedEventSchema = RunEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.RUN_PAUSED),
  reason: z.string().min(1),
});

const RunFailedEventSchema = RunEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.RUN_FAILED),
  reason: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)).optional(),
});

const RunSucceededEventSchema = RunEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.RUN_SUCCEEDED),
  evidence_refs: z.array(z.string().min(1)).optional(),
});

const WorkspaceUpdatedEventSchema = KernelEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.WORKSPACE_UPDATED),
  config_hash: z.string().regex(SHA256_HEX_REGEX),
  changes_summary: z.string().min(1),
});

const WorkspaceWarningEventSchema = KernelEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.WORKSPACE_WARNING),
  message: z.string().min(1),
});

const SpecTamperedEventSchema = KernelEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.SPEC_TAMPERED),
  spec: z.enum(['task', 'workspace']),
  id: z.string().min(1),
  expected_hash: z.string().regex(SHA256_HEX_REGEX),
  actual_hash: z.string().regex(SHA256_HEX_REGEX),
});

const CheckpointEventSchema = TaskEventBaseSchema.extend({
  kind: z.literal(KERNEL_EVENT_KINDS.CHECKPOINT),
  run_id: z.string().min(1).optional(),
  note: z.string().min(1),
  progress: z.string().min(1).optional(),
});

export const KernelEventSchema = z.discriminatedUnion('kind', [
  TaskCreatedEventSchema,
  TaskClaimedEventSchema,
  TaskBlockedEventSchema,
  TaskUnblockedEventSchema,
  TaskWaitingEventSchema,
  TaskResumedEventSchema,
  TaskCompletedEventSchema,
  TaskReleasedEventSchema,
  TaskDelegatedEventSchema,
  RunStartedEventSchema,
  RunPausedEventSchema,
  RunFailedEventSchema,
  RunSucceededEventSchema,
  WorkspaceUpdatedEventSchema,
  WorkspaceWarningEventSchema,
  SpecTamperedEventSchema,
  CheckpointEventSchema,
]);

export type KernelEvent = z.infer<typeof KernelEventSchema>;

export const PolicyDecisionSchema = z.object({
  policy_id: z.string().min(1),
  decision: z.enum(['allow', 'deny', 'approval_required']),
  reason: z.string().min(1).optional(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const ToolCallStartedSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal(TOOL_TRACE_KINDS.TOOL_CALL_STARTED),
  receipt_id: z.string().min(1),
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  session_id: z.string().min(1),
  timestamp: ISO_DATETIME_SCHEMA,
  tool_name: z.string().min(1),
  execution_mode: z.enum(TOOL_HANDLER_KIND_VALUES),
  scope_requested: z.array(ToolScopeSchema),
  scope_allowed: z.array(ToolScopeSchema),
  scope_enforced: z.array(ToolScopeSchema),
  input_hash: z.string().regex(SHA256_HEX_REGEX),
  input_ref: z.string().min(1),
  tool_version: z.string().regex(SEMVER_REGEX, SEMVER_MESSAGE),
  pack_id: z.string().min(1).optional(),
  pack_version: z.string().regex(SEMVER_REGEX, SEMVER_MESSAGE).optional(),
  pack_integrity: z.string().optional(),
  workspace_config_hash: z.string().regex(SHA256_HEX_REGEX),
  runtime_version: z.string().min(1),
});

export const ToolCallFinishedSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal(TOOL_TRACE_KINDS.TOOL_CALL_FINISHED),
  receipt_id: z.string().min(1),
  timestamp: ISO_DATETIME_SCHEMA,
  result: z.enum(['success', 'failure', 'denied', 'crashed']),
  duration_ms: z.number().int().nonnegative(),
  output_hash: z.string().regex(SHA256_HEX_REGEX).optional(),
  output_ref: z.string().min(1).optional(),
  redaction_summary: z.string().min(1).optional(),
  scope_enforcement_note: z.string().min(1).optional(),
  policy_decisions: z.array(PolicyDecisionSchema),
  artifacts_written: z.array(z.string().min(1)).optional(),
});

export const ToolTraceEntrySchema = z.discriminatedUnion('kind', [
  ToolCallStartedSchema,
  ToolCallFinishedSchema,
]);

export type ToolTraceEntry = z.infer<typeof ToolTraceEntrySchema>;

export const ToolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ToolError = z.infer<typeof ToolErrorSchema>;

export const ToolOutputSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: ToolErrorSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ToolOutput = z.infer<typeof ToolOutputSchema>;

export const ExecutionContextSchema = z.object({
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  session_id: z.string().min(1),
  allowed_scopes: z.array(ToolScopeSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export type InProcessToolFn = (input: unknown, ctx: ExecutionContext) => Promise<ToolOutput>;

const ZodSchemaSchema = z.custom<ZodTypeAny>((value) => value instanceof z.ZodType, {
  message: 'Expected a Zod schema',
});

export const InProcessToolHandlerSchema = z.object({
  kind: z.literal(TOOL_HANDLER_KINDS.IN_PROCESS),
  fn: z.custom<InProcessToolFn>((value) => typeof value === 'function', {
    message: 'Expected an async tool function',
  }),
});

export const SubprocessToolHandlerSchema = z.object({
  kind: z.literal(TOOL_HANDLER_KINDS.SUBPROCESS),
  entry: z.string().min(1),
});

export const ToolHandlerSchema = z.discriminatedUnion('kind', [
  InProcessToolHandlerSchema,
  SubprocessToolHandlerSchema,
]);

export type ToolHandler = z.infer<typeof ToolHandlerSchema>;

export const ToolCapabilitySchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX, SEMVER_MESSAGE),
  input_schema: ZodSchemaSchema,
  output_schema: ZodSchemaSchema.optional(),
  permission: z.enum(['read', 'write', 'admin']),
  required_scopes: z.array(ToolScopeSchema),
  handler: ToolHandlerSchema,
  description: z.string().min(1),
  pack: z.string().min(1).optional(),
});

export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export function toMcpJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
