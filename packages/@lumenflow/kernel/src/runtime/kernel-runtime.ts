import { access, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { canonical_json } from '../canonical-json.js';
import { PACKS_DIR_NAME, UTF8_ENCODING } from '../shared-constants.js';
import {
  EventStore,
  projectTaskState,
  type EventStoreOptions,
  type ReplayFilter,
} from '../event-store/index.js';
import { EvidenceStore } from '../evidence/evidence-store.js';
import {
  ExecutionContextSchema,
  RunSchema,
  TaskSpecSchema,
  WorkspaceSpecSchema,
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
import { assertTransition, type TaskStateAliases } from '../state-machine/index.js';
import {
  createBuiltinPolicyHook,
  registerBuiltinToolCapabilities,
} from '../tool-host/builtins/index.js';
import { ToolHost, type PolicyHook } from '../tool-host/tool-host.js';
import { ToolRegistry } from '../tool-host/tool-registry.js';

const DEFAULT_WORKSPACE_FILE_NAME = 'workspace.yaml';
const DEFAULT_RUNTIME_ROOT = path.join('.lumenflow', 'kernel');
const DEFAULT_PACKS_ROOT_CANDIDATES = [
  PACKS_DIR_NAME,
  path.join('packages', '@lumenflow', PACKS_DIR_NAME),
];
const RUNTIME_POLICY_FALLBACK_ID = 'kernel.policy.runtime-fallback';
const DEFAULT_PACK_TOOL_INPUT_SCHEMA = z.record(z.string(), z.unknown());
const DEFAULT_PACK_TOOL_OUTPUT_SCHEMA = z.record(z.string(), z.unknown());
const RUNTIME_LOAD_STAGE_ERROR_PREFIX = 'Runtime load stage failed for pack';
const RUNTIME_REGISTRATION_STAGE_ERROR_PREFIX = 'Runtime registration stage failed for tool';

type RunLifecycleEvent = Extract<
  KernelEvent,
  { kind: 'run_started' | 'run_paused' | 'run_failed' | 'run_succeeded' }
>;

type TaskCreatedEvent = Extract<KernelEvent, { kind: 'task_created' }>;
type TaskClaimedEvent = Extract<KernelEvent, { kind: 'task_claimed' }>;
type RunStartedEvent = Extract<KernelEvent, { kind: 'run_started' }>;
type RunSucceededEvent = Extract<KernelEvent, { kind: 'run_succeeded' }>;
type TaskCompletedEvent = Extract<KernelEvent, { kind: 'task_completed' }>;

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
  includeBuiltinTools?: boolean;
  now?: () => Date;
  runIdFactory?: (taskId: string, nextRunNumber: number) => string;
}

export interface KernelRuntime {
  createTask(taskSpec: TaskSpec): Promise<CreateTaskResult>;
  claimTask(input: ClaimTaskInput): Promise<ClaimTaskResult>;
  completeTask(input: CompleteTaskInput): Promise<CompleteTaskResult>;
  inspectTask(taskId: string): Promise<TaskInspection>;
  executeTool(name: string, input: unknown, ctx: ExecutionContext): Promise<ToolOutput>;
  getToolHost(): ToolHost;
  getPolicyEngine(): PolicyEngine;
}

export interface KernelRuntimeOptions {
  workspace_spec: WorkspaceSpec;
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

function defaultRunIdFactory(taskId: string, nextRunNumber: number): string {
  return `run-${taskId}-${nextRunNumber}`;
}

function isRunLifecycleEvent(event: KernelEvent): event is RunLifecycleEvent {
  return (
    event.kind === 'run_started' ||
    event.kind === 'run_paused' ||
    event.kind === 'run_failed' ||
    event.kind === 'run_succeeded'
  );
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
    if (event.kind === 'run_started') {
      byRun.set(
        event.run_id,
        RunSchema.parse({
          run_id: event.run_id,
          task_id: event.task_id,
          status: 'executing',
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
        status: 'planned',
        started_at: event.timestamp,
        by: 'unknown',
        session_id: 'unknown',
      });

    if (event.kind === 'run_paused') {
      byRun.set(
        event.run_id,
        RunSchema.parse({
          ...fallback,
          status: 'paused',
        }),
      );
      continue;
    }

    if (event.kind === 'run_failed') {
      byRun.set(
        event.run_id,
        RunSchema.parse({
          ...fallback,
          status: 'failed',
          completed_at: event.timestamp,
        }),
      );
      continue;
    }

    byRun.set(
      event.run_id,
      RunSchema.parse({
        ...fallback,
        status: 'succeeded',
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
        policy_id: RUNTIME_POLICY_FALLBACK_ID,
        decision: evaluation.decision,
        reason: 'Effective policy decision without explicit matching rules.',
      },
    ];
  }

  if (evaluation.decision === 'deny') {
    const hasHardDeny = evaluation.decisions.some((decision) => decision.decision === 'deny');
    if (!hasHardDeny) {
      return [
        ...evaluation.decisions,
        {
          policy_id: RUNTIME_POLICY_FALLBACK_ID,
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

async function defaultRuntimeToolCapabilityResolver(
  input: RuntimeToolCapabilityResolverInput,
): Promise<ToolCapability | null> {
  const resolvedEntry = resolvePackToolEntryPath(input.loadedPack.packRoot, input.tool.entry);

  return {
    name: input.tool.name,
    domain: input.loadedPack.manifest.id,
    version: input.loadedPack.manifest.version,
    input_schema: DEFAULT_PACK_TOOL_INPUT_SCHEMA,
    output_schema: DEFAULT_PACK_TOOL_OUTPUT_SCHEMA,
    permission: 'admin',
    required_scopes: input.workspaceSpec.security.allowed_scopes,
    handler: {
      kind: 'subprocess',
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
  } finally {
    await fileHandle.close();
  }

  return taskSpecPath;
}

async function resolveWorkspaceSpec(
  options: InitializeKernelRuntimeOptions,
): Promise<WorkspaceSpec> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const workspaceFilePath = path.resolve(
    options.workspaceFilePath ??
      path.join(workspaceRoot, options.workspaceFileName ?? DEFAULT_WORKSPACE_FILE_NAME),
  );

  const raw = await readFile(workspaceFilePath, UTF8_ENCODING);
  return WorkspaceSpecSchema.parse(YAML.parse(raw));
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

export class DefaultKernelRuntime implements KernelRuntime {
  private readonly workspaceSpec: WorkspaceSpec;
  private readonly loadedPacks: LoadedDomainPack[];
  private readonly taskSpecRoot: string;
  private readonly eventStore: EventStore;
  private readonly evidenceStore: EvidenceStore;
  private readonly toolHost: ToolHost;
  private readonly policyEngine: PolicyEngine;
  private readonly stateAliases: TaskStateAliases;
  private readonly now: () => Date;
  private readonly runIdFactory: (taskId: string, nextRunNumber: number) => string;

  constructor(options: KernelRuntimeOptions) {
    this.workspaceSpec = options.workspace_spec;
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
    return this.toolHost.execute(name, input, context);
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
      kind: 'task_created',
      task_id: parsedTask.id,
      timestamp: normalizeTimestamp(this.now),
      spec_hash: canonical_json(parsedTask),
    };

    await this.eventStore.append(createdEvent);

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
      kind: 'task_claimed',
      task_id: task.id,
      timestamp: claimedTimestamp,
      by: input.by,
      session_id: input.session_id,
      domain_data: input.domain_data,
    };

    const runStartedEvent: RunStartedEvent = {
      schema_version: 1,
      kind: 'run_started',
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
        status: 'executing',
        started_at: runStartedEvent.timestamp,
        by: input.by,
        session_id: input.session_id,
      }),
      events: [claimedEvent, runStartedEvent],
      policy,
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
      kind: 'run_succeeded',
      task_id: task.id,
      run_id: runId,
      timestamp: completedTimestamp,
      evidence_refs: input.evidence_refs,
    };

    const taskCompletedEvent: TaskCompletedEvent = {
      schema_version: 1,
      kind: 'task_completed',
      task_id: task.id,
      timestamp: completedTimestamp,
      evidence_refs: input.evidence_refs,
    };

    await this.eventStore.appendAll([runSucceededEvent, taskCompletedEvent]);

    return {
      task_id: task.id,
      run_id: runId,
      events: [runSucceededEvent, taskCompletedEvent],
      policy,
    };
  }

  async inspectTask(taskId: string): Promise<TaskInspection> {
    const task = await this.requireTaskSpec(taskId);
    const events = await this.eventStore.replay(resolveReplayTaskFilter(taskId));
    const state = projectTaskState(task, events);
    const runHistory = buildRunHistory(events);
    const receipts = await this.readReceiptsForTask(taskId);

    const receiptDecisions = receipts.flatMap((receipt) => {
      if (receipt.kind === 'tool_call_finished') {
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

  private async requireTaskSpec(taskId: string): Promise<TaskSpec> {
    const loaded = await readTaskSpecFromDisk(this.taskSpecRoot, taskId);
    if (!loaded) {
      throw new Error(`Task spec not found for ${taskId}`);
    }
    return loaded;
  }

  private async projectTaskState(taskId: string): Promise<TaskState> {
    const task = await this.requireTaskSpec(taskId);
    const events = await this.eventStore.replay(resolveReplayTaskFilter(taskId));
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

  private async readReceiptsForTask(taskId: string): Promise<ToolTraceEntry[]> {
    const traces = await this.evidenceStore.readTraces();
    const receiptIds = new Set<string>();

    for (const trace of traces) {
      if (trace.kind !== 'tool_call_started') {
        continue;
      }
      if (trace.task_id === taskId) {
        receiptIds.add(trace.receipt_id);
      }
    }

    return traces.filter((trace) => {
      if (trace.kind === 'tool_call_started') {
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
  const workspaceSpec = await resolveWorkspaceSpec(options);
  const packsRoot = await resolvePacksRoot(options);

  const taskSpecRoot = path.resolve(
    options.taskSpecRoot ?? path.join(workspaceRoot, DEFAULT_RUNTIME_ROOT, 'tasks'),
  );
  const eventsFilePath = path.resolve(
    options.eventsFilePath ??
      path.join(workspaceRoot, DEFAULT_RUNTIME_ROOT, 'events', 'events.jsonl'),
  );
  const eventLockFilePath = path.resolve(
    options.eventLockFilePath ??
      path.join(workspaceRoot, DEFAULT_RUNTIME_ROOT, 'events', 'events.lock'),
  );
  const evidenceRoot = path.resolve(
    options.evidenceRoot ?? path.join(workspaceRoot, DEFAULT_RUNTIME_ROOT, 'evidence'),
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

  const toolHost = new ToolHost({
    registry,
    evidenceStore,
    policyHook: createRuntimePolicyHook(policyEngine),
    runtimeVersion: options.runtimeVersion,
  });

  return new DefaultKernelRuntime({
    workspace_spec: workspaceSpec,
    loaded_packs: loadedPacks,
    task_spec_root: taskSpecRoot,
    event_store: eventStore,
    evidence_store: evidenceStore,
    tool_host: toolHost,
    policy_engine: policyEngine,
    state_aliases: mergeStateAliases(loadedPacks),
    now: options.now,
    run_id_factory: options.runIdFactory,
  });
}
