// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import { access, mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { canonical_json } from '../canonical-json.js';
import {
  KERNEL_EVENT_KINDS,
  TOOL_TRACE_KINDS,
  isRunLifecycleEventKind,
  type RunLifecycleEventKind,
} from '../event-kinds.js';
import {
  EXECUTION_METADATA_KEYS,
  KERNEL_POLICY_IDS,
  KERNEL_RUNTIME_EVENTS_DIR_NAME,
  KERNEL_RUNTIME_EVENTS_FILE_NAME,
  KERNEL_RUNTIME_EVENTS_LOCK_FILE_NAME,
  KERNEL_RUNTIME_EVIDENCE_DIR_NAME,
  KERNEL_RUNTIME_ROOT_DIR_NAME,
  KERNEL_RUNTIME_TASKS_DIR_NAME,
  LUMENFLOW_DIR_NAME,
  LUMENFLOW_SCOPE_NAME,
  PACKAGES_DIR_NAME,
  PACKS_DIR_NAME,
  UTF8_ENCODING,
  WORKSPACE_CONFIG_HASH_CONTEXT_KEYS,
  WORKSPACE_FILE_NAME,
} from '../shared-constants.js';
import {
  EventStore,
  projectTaskState,
  type EventStoreOptions,
  type ReplayFilter,
} from '../event-store/index.js';
import { EvidenceStore } from '../evidence/evidence-store.js';
import {
  ExecutionContextSchema,
  RUN_STATUSES,
  RunSchema,
  TOOL_ERROR_CODES,
  TOOL_HANDLER_KINDS,
  TaskSpecSchema,
  WorkspaceSpecSchema,
  validateWorkspaceRootKeys,
  type ExecutionContext,
  type KernelEvent,
  type PolicyDecision,
  type Run,
  type TaskSpec,
  type TaskState,
  type ToolCapability,
  type ToolOutput,
  type ToolTraceEntry,
  type WorkspaceSpec,
} from '../kernel.schemas.js';
import { PackLoader, resolvePackToolEntryPath, type LoadedDomainPack } from '../pack/index.js';
import {
  POLICY_TRIGGERS,
  PolicyEngine,
  type PolicyEvaluationContext,
  type PolicyEvaluationResult,
  type PolicyLayer,
} from '../policy/index.js';
import {
  SandboxSubprocessDispatcher,
  type SandboxSubprocessDispatcherOptions,
} from '../sandbox/index.js';
import { assertTransition, type TaskStateAliases } from '../state-machine/index.js';
import {
  createBuiltinPolicyHook,
  registerBuiltinToolCapabilities,
} from '../tool-host/builtins/index.js';
import { ToolHost, type PolicyHook } from '../tool-host/tool-host.js';
import type { SubprocessDispatcher } from '../tool-host/subprocess-dispatcher.js';
import { ToolRegistry } from '../tool-host/tool-registry.js';

const DEFAULT_RUNTIME_ROOT = path.join(LUMENFLOW_DIR_NAME, KERNEL_RUNTIME_ROOT_DIR_NAME);
const DEFAULT_PACKS_ROOT_CANDIDATES = [
  PACKS_DIR_NAME,
  path.join(PACKAGES_DIR_NAME, LUMENFLOW_SCOPE_NAME, PACKS_DIR_NAME),
];
const CLI_PACKAGE_DIRECTORY_NAME = 'cli';
const CLI_PACKS_ROOT_PATH_SEGMENTS = [
  '..',
  '..',
  '..',
  CLI_PACKAGE_DIRECTORY_NAME,
  PACKS_DIR_NAME,
] as const;
const KERNEL_RUNTIME_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PACKS_ROOT_CANDIDATE = path.resolve(
  KERNEL_RUNTIME_MODULE_DIR,
  ...CLI_PACKS_ROOT_PATH_SEGMENTS,
);
const DEFAULT_PACK_TOOL_INPUT_SCHEMA = z.record(z.string(), z.unknown());
const DEFAULT_PACK_TOOL_OUTPUT_SCHEMA = z.record(z.string(), z.unknown());
const JSON_SCHEMA_MAX_DEPTH = 12;
const RUNTIME_LOAD_STAGE_ERROR_PREFIX = 'Runtime load stage failed for pack';
const RUNTIME_REGISTRATION_STAGE_ERROR_PREFIX = 'Runtime registration stage failed for tool';
const WORKSPACE_UPDATED_INIT_SUMMARY = 'Workspace config hash initialized during runtime startup.';
const SPEC_TAMPERED_ERROR_CODE = 'SPEC_TAMPERED';
const SPEC_TAMPERED_WORKSPACE_MESSAGE =
  'Workspace configuration hash mismatch detected; execution blocked.';
const SPEC_TAMPERED_WORKSPACE_MISSING_MESSAGE =
  'Workspace configuration file is missing; execution blocked.';

type RunLifecycleEvent = Extract<KernelEvent, { kind: RunLifecycleEventKind }>;

type TaskCreatedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_CREATED }>;
type TaskClaimedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_CLAIMED }>;
type TaskBlockedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_BLOCKED }>;
type TaskUnblockedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_UNBLOCKED }>;
type RunStartedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.RUN_STARTED }>;
type RunSucceededEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.RUN_SUCCEEDED }>;
type TaskCompletedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_COMPLETED }>;
type WorkspaceUpdatedEvent = Extract<
  KernelEvent,
  { kind: typeof KERNEL_EVENT_KINDS.WORKSPACE_UPDATED }
>;
type TaskWaitingEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_WAITING }>;
type TaskResumedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.TASK_RESUMED }>;
type SpecTamperedEvent = Extract<KernelEvent, { kind: typeof KERNEL_EVENT_KINDS.SPEC_TAMPERED }>;

interface PendingApproval {
  task_id: string;
  run_id: string;
  tool_name: string;
  requested_at: string;
}

export interface RuntimeToolCapabilityResolverInput {
  workspaceSpec: WorkspaceSpec;
  loadedPack: LoadedDomainPack;
  tool: LoadedDomainPack['manifest']['tools'][number];
}

export type RuntimeToolCapabilityResolver = (
  input: RuntimeToolCapabilityResolverInput,
) => Promise<ToolCapability | null>;

export interface InitializeKernelRuntimeOptions {
  workspaceRoot: string;
  workspaceFilePath?: string;
  workspaceFileName?: string;
  packsRoot?: string;
  taskSpecRoot?: string;
  eventsFilePath?: string;
  eventLockFilePath?: string;
  evidenceRoot?: string;
  runtimeVersion?: string;
  policyLayers?: PolicyLayer[];
  toolCapabilityResolver?: RuntimeToolCapabilityResolver;
  subprocessDispatcher?: SubprocessDispatcher;
  sandboxSubprocessDispatcherOptions?: Omit<SandboxSubprocessDispatcherOptions, 'workspaceRoot'>;
  includeBuiltinTools?: boolean;
  now?: () => Date;
  runIdFactory?: (taskId: string, nextRunNumber: number) => string;
}

export interface ResolveApprovalInput {
  request_id: string;
  approved: boolean;
  approved_by: string;
  reason?: string;
}

export interface ResolveApprovalResult {
  request_id: string;
  approved: boolean;
  task_id: string;
  run_id: string;
}

export interface KernelRuntime {
  createTask(taskSpec: TaskSpec): Promise<CreateTaskResult>;
  claimTask(input: ClaimTaskInput): Promise<ClaimTaskResult>;
  blockTask(input: BlockTaskInput): Promise<BlockTaskResult>;
  unblockTask(input: UnblockTaskInput): Promise<UnblockTaskResult>;
  completeTask(input: CompleteTaskInput): Promise<CompleteTaskResult>;
  inspectTask(taskId: string): Promise<TaskInspection>;
  executeTool(name: string, input: unknown, ctx: ExecutionContext): Promise<ToolOutput>;
  resolveApproval(input: ResolveApprovalInput): Promise<ResolveApprovalResult>;
  getToolHost(): ToolHost;
  getPolicyEngine(): PolicyEngine;
}

export interface KernelRuntimeOptions {
  workspace_spec: WorkspaceSpec;
  workspace_file_path: string;
  workspace_config_hash: string;
  loaded_packs: LoadedDomainPack[];
  task_spec_root: string;
  event_store: EventStore;
  evidence_store: EvidenceStore;
  tool_host: ToolHost;
  policy_engine: PolicyEngine;
  state_aliases?: TaskStateAliases;
  now?: () => Date;
  run_id_factory?: (taskId: string, nextRunNumber: number) => string;
}

export interface CreateTaskResult {
  task: TaskSpec;
  task_spec_path: string;
  event: TaskCreatedEvent;
}

export interface ClaimTaskInput {
  task_id: string;
  by: string;
  session_id: string;
  timestamp?: string;
  domain_data?: Record<string, unknown>;
}

export interface ClaimTaskResult {
  task_id: string;
  run: Run;
  events: [TaskClaimedEvent, RunStartedEvent];
  policy: PolicyEvaluationResult;
}

export interface CompleteTaskInput {
  task_id: string;
  run_id?: string;
  timestamp?: string;
  evidence_refs?: string[];
}

export interface BlockTaskInput {
  task_id: string;
  reason: string;
  timestamp?: string;
}

export interface BlockTaskResult {
  task_id: string;
  event: TaskBlockedEvent;
}

export interface UnblockTaskInput {
  task_id: string;
  timestamp?: string;
}

export interface UnblockTaskResult {
  task_id: string;
  event: TaskUnblockedEvent;
}

export interface CompleteTaskResult {
  task_id: string;
  run_id: string;
  events: [RunSucceededEvent, TaskCompletedEvent];
  policy: PolicyEvaluationResult;
}

export interface TaskInspection {
  task_id: string;
  task: TaskSpec;
  state: TaskState;
  run_history: Run[];
  receipts: ToolTraceEntry[];
  policy_decisions: PolicyDecision[];
  events: KernelEvent[];
}

function normalizeTimestamp(now: () => Date, inputTimestamp?: string): string {
  return inputTimestamp ?? now().toISOString();
}

export function defaultRunIdFactory(taskId: string, nextRunNumber: number): string {
  const suffix = randomBytes(4).toString('hex');
  return `run-${taskId}-${nextRunNumber}-${suffix}`;
}

function isRunLifecycleEvent(event: KernelEvent): event is RunLifecycleEvent {
  return isRunLifecycleEventKind(event.kind);
}

function buildRunHistory(events: KernelEvent[]): Run[] {
  const sortedEvents = [...events].sort((left, right) => {
    return Date.parse(left.timestamp) - Date.parse(right.timestamp);
  });

  const byRun = new Map<string, Run>();
  for (const event of sortedEvents) {
    if (!isRunLifecycleEvent(event)) {
      continue;
    }

    const existing = byRun.get(event.run_id);
    if (event.kind === KERNEL_EVENT_KINDS.RUN_STARTED) {
      byRun.set(
        event.run_id,
        RunSchema.parse({
          run_id: event.run_id,
          task_id: event.task_id,
          status: RUN_STATUSES.EXECUTING,
          started_at: event.timestamp,
          by: event.by,
          session_id: event.session_id,
        }),
      );
      continue;
    }

    const fallback: Run =
      existing ??
      RunSchema.parse({
        run_id: event.run_id,
        task_id: event.task_id,
        status: RUN_STATUSES.PLANNED,
        started_at: event.timestamp,
        by: 'unknown',
        session_id: 'unknown',
      });

    if (event.kind === KERNEL_EVENT_KINDS.RUN_PAUSED) {
      byRun.set(
        event.run_id,
        RunSchema.parse({
          ...fallback,
          status: RUN_STATUSES.PAUSED,
        }),
      );
      continue;
    }

    if (event.kind === KERNEL_EVENT_KINDS.RUN_FAILED) {
      byRun.set(
        event.run_id,
        RunSchema.parse({
          ...fallback,
          status: RUN_STATUSES.FAILED,
          completed_at: event.timestamp,
        }),
      );
      continue;
    }

    byRun.set(
      event.run_id,
      RunSchema.parse({
        ...fallback,
        status: RUN_STATUSES.SUCCEEDED,
        completed_at: event.timestamp,
      }),
    );
  }

  return [...byRun.values()].sort((left, right) => {
    return Date.parse(left.started_at) - Date.parse(right.started_at);
  });
}

function dedupePolicyDecisions(decisions: PolicyDecision[]): PolicyDecision[] {
  const byKey = new Map<string, PolicyDecision>();
  for (const decision of decisions) {
    const key = `${decision.policy_id}|${decision.decision}|${decision.reason ?? ''}`;
    if (!byKey.has(key)) {
      byKey.set(key, decision);
    }
  }
  return [...byKey.values()];
}

function toPolicyHookDecisions(evaluation: PolicyEvaluationResult): PolicyDecision[] {
  if (evaluation.decisions.length === 0) {
    return [
      {
        policy_id: KERNEL_POLICY_IDS.RUNTIME_FALLBACK,
        decision: evaluation.decision,
        reason: 'Effective policy decision without explicit matching rules.',
      },
    ];
  }

  if (evaluation.decision === 'approval_required') {
    const hasApprovalRequired = evaluation.decisions.some(
      (decision) => decision.decision === 'approval_required',
    );
    if (!hasApprovalRequired) {
      return [
        ...evaluation.decisions,
        {
          policy_id: KERNEL_POLICY_IDS.APPROVAL_REQUIRED,
          decision: 'approval_required',
          reason: 'Effective policy decision is approval_required.',
        },
      ];
    }
  }

  if (evaluation.decision === 'deny') {
    const hasHardDeny = evaluation.decisions.some((decision) => decision.decision === 'deny');
    if (!hasHardDeny) {
      return [
        ...evaluation.decisions,
        {
          policy_id: KERNEL_POLICY_IDS.RUNTIME_FALLBACK,
          decision: 'deny',
          reason: 'Effective policy decision is deny.',
        },
      ];
    }
  }

  return evaluation.decisions;
}

function mergeStateAliases(loadedPacks: LoadedDomainPack[]): TaskStateAliases {
  const aliases: TaskStateAliases = {};
  const validStates = new Set(['ready', 'active', 'blocked', 'waiting', 'done']);

  for (const loadedPack of loadedPacks) {
    for (const [state, alias] of Object.entries(loadedPack.manifest.state_aliases)) {
      if (!validStates.has(state)) {
        continue;
      }
      aliases[state as keyof TaskStateAliases] = alias;
    }
  }

  return aliases;
}

function formatRuntimeLoadStageError(packId: string): string {
  return `${RUNTIME_LOAD_STAGE_ERROR_PREFIX} "${packId}"`;
}

function formatRuntimeRegistrationStageError(toolName: string, packId: string): string {
  return `${RUNTIME_REGISTRATION_STAGE_ERROR_PREFIX} "${toolName}" in pack "${packId}"`;
}

function buildPackToolDescription(toolName: string, packId: string): string {
  return `Pack tool ${toolName} declared by ${packId}`;
}

function ensureJsonSchemaObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON Schema object`);
  }
  return value as Record<string, unknown>;
}

function parseJsonSchemaType(schema: Record<string, unknown>, context: string): string {
  const schemaType = schema.type;
  if (typeof schemaType !== 'string') {
    throw new Error(`${context}.type must be a string`);
  }
  return schemaType;
}

function isJsonLiteral(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function buildEnumSchema(enumValues: unknown[], context: string): z.ZodTypeAny {
  if (enumValues.length === 0) {
    throw new Error(`${context}.enum must not be empty`);
  }
  if (enumValues.every((value) => typeof value === 'string')) {
    const [firstValue, ...restValues] = enumValues as string[];
    if (typeof firstValue !== 'string') {
      throw new Error(`${context}.enum must include at least one string value`);
    }
    return z.enum([firstValue, ...restValues]);
  }
  if (enumValues.length === 1) {
    const singleValue = enumValues[0];
    if (!isJsonLiteral(singleValue)) {
      throw new Error(`${context}.enum values must be JSON literal values`);
    }
    return z.literal(singleValue);
  }
  if (!enumValues.every((value) => isJsonLiteral(value))) {
    throw new Error(`${context}.enum values must be JSON literal values`);
  }
  const literals = enumValues.map((value) => z.literal(value));
  const [firstLiteral, ...restLiterals] = literals;
  if (!firstLiteral) {
    throw new Error(`${context}.enum must include at least one value`);
  }
  return z.union([firstLiteral, ...restLiterals]);
}

function buildStringSchema(schema: Record<string, unknown>, context: string): z.ZodTypeAny {
  let resolved = z.string();
  if (typeof schema.minLength === 'number') {
    resolved = resolved.min(schema.minLength);
  }
  if (typeof schema.maxLength === 'number') {
    resolved = resolved.max(schema.maxLength);
  }
  if (typeof schema.pattern === 'string') {
    try {
      resolved = resolved.regex(new RegExp(schema.pattern));
    } catch {
      throw new Error(`${context}.pattern must be a valid regular expression`);
    }
  }
  return resolved;
}

function buildNumberSchema(
  schema: Record<string, unknown>,
  _context: string,
  integerOnly: boolean,
): z.ZodTypeAny {
  let resolved = integerOnly ? z.number().int() : z.number();
  if (typeof schema.minimum === 'number') {
    resolved = resolved.gte(schema.minimum);
  }
  if (typeof schema.maximum === 'number') {
    resolved = resolved.lte(schema.maximum);
  }
  if (typeof schema.exclusiveMinimum === 'number') {
    resolved = resolved.gt(schema.exclusiveMinimum);
  }
  if (typeof schema.exclusiveMaximum === 'number') {
    resolved = resolved.lt(schema.exclusiveMaximum);
  }
  return resolved;
}

function buildObjectSchema(
  schema: Record<string, unknown>,
  context: string,
  depth: number,
): z.ZodTypeAny {
  const propertiesValue = schema.properties ?? {};
  if (!propertiesValue || typeof propertiesValue !== 'object' || Array.isArray(propertiesValue)) {
    throw new Error(`${context}.properties must be an object when provided`);
  }
  const properties = propertiesValue as Record<string, unknown>;

  const requiredValue = schema.required ?? [];
  if (!Array.isArray(requiredValue)) {
    throw new Error(`${context}.required must be an array when provided`);
  }
  const requiredKeys = new Set(
    requiredValue.filter((entry): entry is string => typeof entry === 'string'),
  );

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, childSchemaValue] of Object.entries(properties)) {
    const childContext = `${context}.properties.${key}`;
    const childSchema = buildZodSchemaFromJsonSchema(childSchemaValue, childContext, depth + 1);
    shape[key] = requiredKeys.has(key) ? childSchema : childSchema.optional();
  }

  const additionalProperties = schema.additionalProperties;
  if (additionalProperties === true) {
    return z.object(shape).passthrough();
  }
  return z.object(shape).strict();
}

function buildArraySchema(
  schema: Record<string, unknown>,
  context: string,
  depth: number,
): z.ZodTypeAny {
  if (!('items' in schema)) {
    throw new Error(`${context}.items is required for array schemas`);
  }
  const itemSchema = buildZodSchemaFromJsonSchema(schema.items, `${context}.items`, depth + 1);
  let resolved = z.array(itemSchema);
  if (typeof schema.minItems === 'number') {
    resolved = resolved.min(schema.minItems);
  }
  if (typeof schema.maxItems === 'number') {
    resolved = resolved.max(schema.maxItems);
  }
  return resolved;
}

function buildZodSchemaFromJsonSchema(
  schemaValue: unknown,
  context: string,
  depth: number,
): z.ZodTypeAny {
  if (depth > JSON_SCHEMA_MAX_DEPTH) {
    throw new Error(`${context} exceeded maximum schema depth (${JSON_SCHEMA_MAX_DEPTH})`);
  }

  const schema = ensureJsonSchemaObject(schemaValue, context);

  if ('const' in schema) {
    if (!isJsonLiteral(schema.const)) {
      throw new Error(`${context}.const must be a JSON literal value`);
    }
    return z.literal(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return buildEnumSchema(schema.enum, context);
  }

  const schemaType = parseJsonSchemaType(schema, context);
  if (schemaType === 'object') {
    return buildObjectSchema(schema, context, depth);
  }
  if (schemaType === 'array') {
    return buildArraySchema(schema, context, depth);
  }
  if (schemaType === 'string') {
    return buildStringSchema(schema, context);
  }
  if (schemaType === 'number') {
    return buildNumberSchema(schema, context, false);
  }
  if (schemaType === 'integer') {
    return buildNumberSchema(schema, context, true);
  }
  if (schemaType === 'boolean') {
    return z.boolean();
  }

  throw new Error(`${context}.type "${schemaType}" is not supported`);
}

function parsePackToolJsonSchema(
  schemaValue: unknown,
  toolName: string,
  schemaField: 'input_schema' | 'output_schema',
): z.ZodTypeAny {
  const context = `${schemaField} for tool "${toolName}"`;
  try {
    return buildZodSchemaFromJsonSchema(schemaValue, context, 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown schema parsing error';
    throw new Error(`Invalid ${context}: ${message}`, {
      cause: error,
    });
  }
}

export async function defaultRuntimeToolCapabilityResolver(
  input: RuntimeToolCapabilityResolverInput,
): Promise<ToolCapability | null> {
  const resolvedEntry = resolvePackToolEntryPath(input.loadedPack.packRoot, input.tool.entry);
  const resolvedInputSchema = input.tool.input_schema
    ? parsePackToolJsonSchema(input.tool.input_schema, input.tool.name, 'input_schema')
    : DEFAULT_PACK_TOOL_INPUT_SCHEMA;
  const resolvedOutputSchema = input.tool.output_schema
    ? parsePackToolJsonSchema(input.tool.output_schema, input.tool.name, 'output_schema')
    : DEFAULT_PACK_TOOL_OUTPUT_SCHEMA;

  return {
    name: input.tool.name,
    domain: input.loadedPack.manifest.id,
    version: input.loadedPack.manifest.version,
    input_schema: resolvedInputSchema,
    output_schema: resolvedOutputSchema,
    permission: input.tool.permission,
    required_scopes: input.tool.required_scopes,
    handler: {
      kind: TOOL_HANDLER_KINDS.SUBPROCESS,
      entry: resolvedEntry,
    },
    description: buildPackToolDescription(input.tool.name, input.loadedPack.manifest.id),
    pack: input.loadedPack.pin.id,
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function resolvePacksRoot(options: InitializeKernelRuntimeOptions): Promise<string> {
  if (options.packsRoot) {
    return path.resolve(options.packsRoot);
  }

  const workspaceRoot = path.resolve(options.workspaceRoot);
  for (const candidate of DEFAULT_PACKS_ROOT_CANDIDATES) {
    const absoluteCandidate = path.resolve(workspaceRoot, candidate);
    if (await fileExists(absoluteCandidate)) {
      return absoluteCandidate;
    }
  }

  if (await fileExists(CLI_PACKS_ROOT_CANDIDATE)) {
    return CLI_PACKS_ROOT_CANDIDATE;
  }

  const fallbackCandidate = DEFAULT_PACKS_ROOT_CANDIDATES[0];
  if (!fallbackCandidate) {
    throw new Error('No default packs root candidates are configured.');
  }
  return path.resolve(workspaceRoot, fallbackCandidate);
}

function resolveTaskSpecPath(taskSpecRoot: string, taskId: string): string {
  return path.join(taskSpecRoot, `${taskId}.yaml`);
}

async function readTaskSpecFromDisk(
  taskSpecRoot: string,
  taskId: string,
): Promise<TaskSpec | null> {
  const taskSpecPath = resolveTaskSpecPath(taskSpecRoot, taskId);

  try {
    const yamlText = await readFile(taskSpecPath, UTF8_ENCODING);
    return TaskSpecSchema.parse(YAML.parse(yamlText));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeTaskSpecImmutable(taskSpecRoot: string, task: TaskSpec): Promise<string> {
  await mkdir(taskSpecRoot, { recursive: true });

  const taskSpecPath = resolveTaskSpecPath(taskSpecRoot, task.id);
  const fileHandle = await open(taskSpecPath, 'wx');
  try {
    await fileHandle.writeFile(YAML.stringify(task), UTF8_ENCODING);
  } catch (writeError) {
    await fileHandle.close();
    await rm(taskSpecPath, { force: true });
    throw writeError;
  }
  await fileHandle.close();

  return taskSpecPath;
}

interface ResolvedWorkspaceSpec {
  workspace_file_path: string;
  workspace_spec: WorkspaceSpec;
  workspace_config_hash: string;
  /** Raw parsed YAML data before Zod stripping, used for root-key validation. */
  raw_workspace_data: Record<string, unknown>;
}

async function resolveWorkspaceSpec(
  options: InitializeKernelRuntimeOptions,
): Promise<ResolvedWorkspaceSpec> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceFilePath = path.resolve(
    options.workspaceFilePath ??
      path.join(workspaceRoot, options.workspaceFileName ?? WORKSPACE_FILE_NAME),
  );

  const raw = await readFile(workspaceFilePath, UTF8_ENCODING);
  const rawWorkspaceData = YAML.parse(raw) as Record<string, unknown>;
  const workspaceSpec = WorkspaceSpecSchema.parse(rawWorkspaceData);

  return {
    workspace_file_path: workspaceFilePath,
    workspace_spec: workspaceSpec,
    workspace_config_hash: canonical_json(raw),
    raw_workspace_data: rawWorkspaceData,
  };
}

function buildDefaultPolicyLayers(loadedPacks: LoadedDomainPack[]): PolicyLayer[] {
  const packRules = loadedPacks.flatMap((loadedPack) => {
    return loadedPack.manifest.policies.map((policy) => ({
      id: policy.id,
      trigger: policy.trigger,
      decision: policy.decision,
      reason: policy.reason,
    }));
  });

  return [
    {
      level: 'workspace',
      default_decision: 'allow',
      allow_loosening: true,
      rules: [],
    },
    {
      level: 'lane',
      rules: [],
    },
    {
      level: 'pack',
      rules: packRules,
    },
    {
      level: 'task',
      rules: [],
    },
  ];
}

function createRuntimePolicyHook(policyEngine: PolicyEngine): PolicyHook {
  const builtinPolicyHook = createBuiltinPolicyHook();

  return async (input) => {
    const builtinDecisions = await builtinPolicyHook(input);
    if (builtinDecisions.some((decision) => decision.decision === 'deny')) {
      return builtinDecisions;
    }

    const context: PolicyEvaluationContext = {
      trigger: POLICY_TRIGGERS.ON_TOOL_REQUEST,
      run_id: input.context.run_id,
      task_id: input.context.task_id,
      tool_name: input.capability.name,
      pack_id: input.capability.pack,
    };

    const evaluation = await policyEngine.evaluate(context);
    return [...builtinDecisions, ...toPolicyHookDecisions(evaluation)];
  };
}

function resolveReplayTaskFilter(taskId: string): ReplayFilter {
  return {
    taskId,
  };
}

function resolveExecutionMetadata(context: ExecutionContext): Record<string, unknown> {
  if (!context.metadata || typeof context.metadata !== 'object') {
    return {};
  }
  return context.metadata;
}

export class DefaultKernelRuntime implements KernelRuntime {
  private readonly workspaceSpec: WorkspaceSpec;
  private readonly workspaceFilePath: string;
  private readonly workspaceConfigHash: string;
  private readonly loadedPacks: LoadedDomainPack[];
  private readonly taskSpecRoot: string;
  private readonly eventStore: EventStore;
  private readonly evidenceStore: EvidenceStore;
  private readonly toolHost: ToolHost;
  private readonly policyEngine: PolicyEngine;
  private readonly stateAliases: TaskStateAliases;
  private readonly now: () => Date;
  private readonly runIdFactory: (taskId: string, nextRunNumber: number) => string;
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(options: KernelRuntimeOptions) {
    this.workspaceSpec = options.workspace_spec;
    this.workspaceFilePath = options.workspace_file_path;
    this.workspaceConfigHash = options.workspace_config_hash;
    this.loadedPacks = options.loaded_packs;
    this.taskSpecRoot = options.task_spec_root;
    this.eventStore = options.event_store;
    this.evidenceStore = options.evidence_store;
    this.toolHost = options.tool_host;
    this.policyEngine = options.policy_engine;
    this.stateAliases = options.state_aliases ?? {};
    this.now = options.now ?? (() => new Date());
    this.runIdFactory = options.run_id_factory ?? defaultRunIdFactory;
  }

  getToolHost(): ToolHost {
    return this.toolHost;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  async executeTool(name: string, input: unknown, ctx: ExecutionContext): Promise<ToolOutput> {
    const context = ExecutionContextSchema.parse(ctx);
    const metadata = resolveExecutionMetadata(context);
    const expectedHash = this.workspaceConfigHash;

    let actualHash: string;
    let missingWorkspaceFile = false;
    try {
      actualHash = await this.computeWorkspaceConfigHash();
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error;
      }
      missingWorkspaceFile = true;
      actualHash = canonical_json({
        [WORKSPACE_CONFIG_HASH_CONTEXT_KEYS.WORKSPACE_FILE_MISSING]: this.workspaceFilePath,
      });
    }

    if (actualHash !== expectedHash) {
      const tamperedEvent: SpecTamperedEvent = {
        schema_version: 1,
        kind: KERNEL_EVENT_KINDS.SPEC_TAMPERED,
        spec: 'workspace',
        id: this.workspaceSpec.id,
        expected_hash: expectedHash,
        actual_hash: actualHash,
        timestamp: normalizeTimestamp(this.now),
      };
      await this.eventStore.append(tamperedEvent);

      return {
        success: false,
        error: {
          code: SPEC_TAMPERED_ERROR_CODE,
          message: missingWorkspaceFile
            ? SPEC_TAMPERED_WORKSPACE_MISSING_MESSAGE
            : SPEC_TAMPERED_WORKSPACE_MESSAGE,
          details: {
            workspace_id: this.workspaceSpec.id,
            workspace_file_path: this.workspaceFilePath,
            [WORKSPACE_CONFIG_HASH_CONTEXT_KEYS.WORKSPACE_FILE_MISSING]: missingWorkspaceFile,
            expected_hash: expectedHash,
            actual_hash: actualHash,
          },
        },
      };
    }

    const runtimeContext = ExecutionContextSchema.parse({
      ...context,
      metadata: {
        ...metadata,
        [EXECUTION_METADATA_KEYS.WORKSPACE_CONFIG_HASH]: actualHash,
      },
    });

    const output = await this.toolHost.execute(name, input, runtimeContext);

    if (output.error?.code === TOOL_ERROR_CODES.APPROVAL_REQUIRED) {
      const details = output.error.details as Record<string, unknown> | undefined;
      const requestId = typeof details?.request_id === 'string' ? details.request_id : undefined;
      if (requestId) {
        this.pendingApprovals.set(requestId, {
          task_id: context.task_id,
          run_id: context.run_id,
          tool_name: name,
          requested_at: normalizeTimestamp(this.now),
        });

        const waitingEvent: TaskWaitingEvent = {
          schema_version: 1,
          kind: KERNEL_EVENT_KINDS.TASK_WAITING,
          task_id: context.task_id,
          timestamp: normalizeTimestamp(this.now),
          reason: `Approval required for tool "${name}"`,
          wait_for: requestId,
        };
        await this.eventStore.append(waitingEvent);
      }
    }

    return output;
  }

  async createTask(taskSpec: TaskSpec): Promise<CreateTaskResult> {
    const parsedTask = TaskSpecSchema.parse(taskSpec);

    if (parsedTask.workspace_id !== this.workspaceSpec.id) {
      throw new Error(
        `Task workspace mismatch: expected ${this.workspaceSpec.id}, got ${parsedTask.workspace_id}`,
      );
    }

    const laneExists = this.workspaceSpec.lanes.some((lane) => lane.id === parsedTask.lane_id);
    if (!laneExists) {
      throw new Error(`Task lane "${parsedTask.lane_id}" is not declared in workspace lanes.`);
    }

    let taskSpecPath: string;
    try {
      taskSpecPath = await writeTaskSpecImmutable(this.taskSpecRoot, parsedTask);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EEXIST') {
        throw new Error(`Task spec already exists for ${parsedTask.id} and is immutable.`, {
          cause: error,
        });
      }
      throw error;
    }

    const createdEvent: TaskCreatedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_CREATED,
      task_id: parsedTask.id,
      timestamp: normalizeTimestamp(this.now),
      spec_hash: canonical_json(parsedTask),
    };

    try {
      await this.eventStore.append(createdEvent);
    } catch (eventError) {
      // Clean up the spec file if event emission fails (crash recovery).
      // Without this, a spec file exists on disk with no corresponding event,
      // and the task cannot be retried because 'wx' open will fail with EEXIST.
      await rm(taskSpecPath, { force: true });
      throw eventError;
    }

    return {
      task: parsedTask,
      task_spec_path: taskSpecPath,
      event: createdEvent,
    };
  }

  async claimTask(input: ClaimTaskInput): Promise<ClaimTaskResult> {
    const task = await this.requireTaskSpec(input.task_id);
    const projected = await this.projectTaskState(task.id);

    assertTransition(projected.status, 'active', task.id, this.stateAliases);

    const runId = this.runIdFactory(task.id, projected.run_count + 1);
    const policy = await this.policyEngine.evaluate({
      trigger: POLICY_TRIGGERS.ON_CLAIM,
      run_id: runId,
      task_id: task.id,
      lane_id: task.lane_id,
      pack_id: task.domain,
    });

    if (policy.decision === 'deny') {
      throw new Error(`Policy denied claim for ${task.id}.`);
    }

    const claimedTimestamp = normalizeTimestamp(this.now, input.timestamp);
    const claimedEvent: TaskClaimedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_CLAIMED,
      task_id: task.id,
      timestamp: claimedTimestamp,
      by: input.by,
      session_id: input.session_id,
      domain_data: input.domain_data,
    };

    const runStartedEvent: RunStartedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.RUN_STARTED,
      task_id: task.id,
      run_id: runId,
      timestamp: claimedTimestamp,
      by: input.by,
      session_id: input.session_id,
    };

    await this.eventStore.appendAll([claimedEvent, runStartedEvent]);

    return {
      task_id: task.id,
      run: RunSchema.parse({
        run_id: runId,
        task_id: task.id,
        status: RUN_STATUSES.EXECUTING,
        started_at: runStartedEvent.timestamp,
        by: input.by,
        session_id: input.session_id,
      }),
      events: [claimedEvent, runStartedEvent],
      policy,
    };
  }

  async blockTask(input: BlockTaskInput): Promise<BlockTaskResult> {
    const task = await this.requireTaskSpec(input.task_id);
    const projected = await this.projectTaskState(task.id);

    assertTransition(projected.status, 'blocked', task.id, this.stateAliases);

    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new Error(`Cannot block ${task.id}: reason is required.`);
    }

    const blockedEvent: TaskBlockedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_BLOCKED,
      task_id: task.id,
      timestamp: normalizeTimestamp(this.now, input.timestamp),
      reason,
    };

    await this.eventStore.append(blockedEvent);
    return {
      task_id: task.id,
      event: blockedEvent,
    };
  }

  async unblockTask(input: UnblockTaskInput): Promise<UnblockTaskResult> {
    const task = await this.requireTaskSpec(input.task_id);
    const projected = await this.projectTaskState(task.id);

    assertTransition(projected.status, 'active', task.id, this.stateAliases);

    const unblockedEvent: TaskUnblockedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_UNBLOCKED,
      task_id: task.id,
      timestamp: normalizeTimestamp(this.now, input.timestamp),
    };

    await this.eventStore.append(unblockedEvent);
    return {
      task_id: task.id,
      event: unblockedEvent,
    };
  }

  async completeTask(input: CompleteTaskInput): Promise<CompleteTaskResult> {
    const task = await this.requireTaskSpec(input.task_id);
    const projected = await this.projectTaskState(task.id);

    assertTransition(projected.status, 'done', task.id, this.stateAliases);

    const runId = input.run_id ?? projected.current_run?.run_id;
    if (!runId) {
      throw new Error(`Cannot complete ${task.id}: no active run found.`);
    }

    const policy = await this.policyEngine.evaluate({
      trigger: POLICY_TRIGGERS.ON_COMPLETION,
      run_id: runId,
      task_id: task.id,
      lane_id: task.lane_id,
      pack_id: task.domain,
    });

    if (policy.decision === 'deny') {
      throw new Error(`Policy denied completion for ${task.id}.`);
    }

    const completedTimestamp = normalizeTimestamp(this.now, input.timestamp);

    const runSucceededEvent: RunSucceededEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.RUN_SUCCEEDED,
      task_id: task.id,
      run_id: runId,
      timestamp: completedTimestamp,
      evidence_refs: input.evidence_refs,
    };

    const taskCompletedEvent: TaskCompletedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_COMPLETED,
      task_id: task.id,
      timestamp: completedTimestamp,
      evidence_refs: input.evidence_refs,
    };

    await this.eventStore.appendAll([runSucceededEvent, taskCompletedEvent]);
    await this.evidenceStore.pruneTask(task.id);

    return {
      task_id: task.id,
      run_id: runId,
      events: [runSucceededEvent, taskCompletedEvent],
      policy,
    };
  }

  async inspectTask(taskId: string): Promise<TaskInspection> {
    const task = await this.requireTaskSpec(taskId);
    const replayResult = await this.eventStore.replay(resolveReplayTaskFilter(taskId));
    const events = replayResult.events;
    const state = projectTaskState(task, events);
    const runHistory = buildRunHistory(events);
    const receipts = await this.readReceiptsForTask(taskId);

    const receiptDecisions = receipts.flatMap((receipt) => {
      if (receipt.kind === TOOL_TRACE_KINDS.TOOL_CALL_FINISHED) {
        return receipt.policy_decisions;
      }
      return [];
    });

    const completionDecisions =
      state.status === 'done' ? await this.evaluateCompletionPolicy(task, state) : [];

    return {
      task_id: taskId,
      task,
      state,
      run_history: runHistory,
      receipts,
      policy_decisions: dedupePolicyDecisions([...receiptDecisions, ...completionDecisions]),
      events,
    };
  }

  async resolveApproval(input: ResolveApprovalInput): Promise<ResolveApprovalResult> {
    const pending = this.pendingApprovals.get(input.request_id);
    if (!pending) {
      throw new Error(`No pending approval found for request_id "${input.request_id}"`);
    }

    this.pendingApprovals.delete(input.request_id);

    const resumedEvent: TaskResumedEvent = {
      schema_version: 1,
      kind: KERNEL_EVENT_KINDS.TASK_RESUMED,
      task_id: pending.task_id,
      timestamp: normalizeTimestamp(this.now),
    };
    await this.eventStore.append(resumedEvent);

    return {
      request_id: input.request_id,
      approved: input.approved,
      task_id: pending.task_id,
      run_id: pending.run_id,
    };
  }

  private async requireTaskSpec(taskId: string): Promise<TaskSpec> {
    const loaded = await readTaskSpecFromDisk(this.taskSpecRoot, taskId);
    if (!loaded) {
      throw new Error(`Task spec not found for ${taskId}`);
    }
    return loaded;
  }

  private async projectTaskState(taskId: string): Promise<TaskState> {
    const task = await this.requireTaskSpec(taskId);
    const { events } = await this.eventStore.replay(resolveReplayTaskFilter(taskId));
    return projectTaskState(task, events);
  }

  private async evaluateCompletionPolicy(
    task: TaskSpec,
    state: TaskState,
  ): Promise<PolicyDecision[]> {
    const runId = state.current_run?.run_id;
    if (!runId) {
      return [];
    }

    const evaluation = await this.policyEngine.evaluate({
      trigger: POLICY_TRIGGERS.ON_COMPLETION,
      run_id: runId,
      task_id: task.id,
      lane_id: task.lane_id,
      pack_id: task.domain,
    });

    return evaluation.decisions;
  }

  private async computeWorkspaceConfigHash(): Promise<string> {
    const raw = await readFile(this.workspaceFilePath, UTF8_ENCODING);
    return canonical_json(raw);
  }

  private async readReceiptsForTask(taskId: string): Promise<ToolTraceEntry[]> {
    const indexed = await this.evidenceStore.readTracesByTaskId(taskId);
    if (indexed.length > 0) {
      return indexed;
    }

    // After pruneTask (called during completeTask), the in-memory index is
    // cleared but traces remain in orderedTraces.  Fall back to a full scan
    // so inspectTask still returns receipts for completed tasks.
    const traces = await this.evidenceStore.readTraces();
    const receiptIds = new Set<string>();

    for (const trace of traces) {
      if (trace.kind !== TOOL_TRACE_KINDS.TOOL_CALL_STARTED) {
        continue;
      }
      if (trace.task_id === taskId) {
        receiptIds.add(trace.receipt_id);
      }
    }

    return traces.filter((trace) => {
      if (trace.kind === TOOL_TRACE_KINDS.TOOL_CALL_STARTED) {
        return trace.task_id === taskId;
      }
      return receiptIds.has(trace.receipt_id);
    });
  }
}

export async function initializeKernelRuntime(
  options: InitializeKernelRuntimeOptions,
): Promise<DefaultKernelRuntime> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const resolvedWorkspace = await resolveWorkspaceSpec(options);
  const workspaceSpec = resolvedWorkspace.workspace_spec;
  const packsRoot = await resolvePacksRoot(options);
  const now = options.now ?? (() => new Date());

  const taskSpecRoot = path.resolve(
    options.taskSpecRoot ??
      path.join(workspaceRoot, DEFAULT_RUNTIME_ROOT, KERNEL_RUNTIME_TASKS_DIR_NAME),
  );
  const eventsFilePath = path.resolve(
    options.eventsFilePath ??
      path.join(
        workspaceRoot,
        DEFAULT_RUNTIME_ROOT,
        KERNEL_RUNTIME_EVENTS_DIR_NAME,
        KERNEL_RUNTIME_EVENTS_FILE_NAME,
      ),
  );
  const eventLockFilePath = path.resolve(
    options.eventLockFilePath ??
      path.join(
        workspaceRoot,
        DEFAULT_RUNTIME_ROOT,
        KERNEL_RUNTIME_EVENTS_DIR_NAME,
        KERNEL_RUNTIME_EVENTS_LOCK_FILE_NAME,
      ),
  );
  const evidenceRoot = path.resolve(
    options.evidenceRoot ??
      path.join(workspaceRoot, DEFAULT_RUNTIME_ROOT, KERNEL_RUNTIME_EVIDENCE_DIR_NAME),
  );

  const packLoader = new PackLoader({ packsRoot });
  const loadedPacks: LoadedDomainPack[] = [];

  for (const pin of workspaceSpec.packs) {
    let loadedPack: LoadedDomainPack;
    try {
      loadedPack = await packLoader.load({
        workspaceSpec,
        packId: pin.id,
      });
    } catch (error) {
      throw new Error(formatRuntimeLoadStageError(pin.id), { cause: error });
    }
    loadedPacks.push(loadedPack);
  }

  // Two-phase workspace root-key validation: validate raw YAML keys against
  // kernel-owned keys + pack-declared config_keys. Unknown keys are rejected
  // hard to prevent silent misconfiguration from Zod's non-strict stripping.
  const rootKeyValidation = validateWorkspaceRootKeys(
    resolvedWorkspace.raw_workspace_data,
    loadedPacks.map((lp) => lp.manifest),
  );
  if (!rootKeyValidation.valid) {
    const keyList = rootKeyValidation.errors.join('\n  - ');
    throw new Error(
      `Workspace root-key validation failed:\n  - ${keyList}`,
    );
  }

  const registry = new ToolRegistry();
  if (options.includeBuiltinTools !== false) {
    registerBuiltinToolCapabilities(registry, {
      declaredScopes: workspaceSpec.security.allowed_scopes,
    });
  }

  const toolCapabilityResolver =
    options.toolCapabilityResolver ?? defaultRuntimeToolCapabilityResolver;
  for (const loadedPack of loadedPacks) {
    for (const tool of loadedPack.manifest.tools) {
      let capability: ToolCapability | null;
      try {
        capability = await toolCapabilityResolver({
          workspaceSpec,
          loadedPack,
          tool,
        });
      } catch (error) {
        throw new Error(formatRuntimeRegistrationStageError(tool.name, loadedPack.pin.id), {
          cause: error,
        });
      }

      if (capability) {
        registry.register(capability);
      }
    }
  }

  const policyEngine = new PolicyEngine({
    layers: options.policyLayers ?? buildDefaultPolicyLayers(loadedPacks),
  });
  const evidenceStore = new EvidenceStore({ evidenceRoot });

  const eventStoreOptions: EventStoreOptions = {
    eventsFilePath,
    lockFilePath: eventLockFilePath,
    taskSpecLoader: async (taskId) => readTaskSpecFromDisk(taskSpecRoot, taskId),
  };
  const eventStore = new EventStore(eventStoreOptions);
  const workspaceUpdatedEvent: WorkspaceUpdatedEvent = {
    schema_version: 1,
    kind: KERNEL_EVENT_KINDS.WORKSPACE_UPDATED,
    timestamp: normalizeTimestamp(now),
    config_hash: resolvedWorkspace.workspace_config_hash,
    changes_summary: WORKSPACE_UPDATED_INIT_SUMMARY,
  };
  await eventStore.append(workspaceUpdatedEvent);

  const toolHost = new ToolHost({
    registry,
    evidenceStore,
    subprocessDispatcher:
      options.subprocessDispatcher ||
      new SandboxSubprocessDispatcher({
        workspaceRoot,
        ...options.sandboxSubprocessDispatcherOptions,
      }),
    policyHook: createRuntimePolicyHook(policyEngine),
    runtimeVersion: options.runtimeVersion,
  });
  await toolHost.onStartup();

  return new DefaultKernelRuntime({
    workspace_spec: workspaceSpec,
    workspace_file_path: resolvedWorkspace.workspace_file_path,
    workspace_config_hash: resolvedWorkspace.workspace_config_hash,
    loaded_packs: loadedPacks,
    task_spec_root: taskSpecRoot,
    event_store: eventStore,
    evidence_store: evidenceStore,
    tool_host: toolHost,
    policy_engine: policyEngine,
    state_aliases: mergeStateAliases(loadedPacks),
    now,
    run_id_factory: options.runIdFactory,
  });
}
