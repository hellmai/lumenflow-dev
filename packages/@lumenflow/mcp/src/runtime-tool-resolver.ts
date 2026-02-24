// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TOOL_HANDLER_KINDS,
  defaultRuntimeToolCapabilityResolver,
  type ExecutionContext,
  type InProcessToolFn,
  type RuntimeToolCapabilityResolver,
  type ToolOutput,
} from '@lumenflow/kernel';
import type { ListWUsOptions } from '@lumenflow/core';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { z } from 'zod';
import {
  STATE_RUNTIME_CONSTANTS,
  STATE_RUNTIME_EVENT_TYPES,
  STATE_RUNTIME_MESSAGES,
} from './runtime-tool-resolver.constants.js';
import { MetadataKeys } from './mcp-constants.js';

const DEFAULT_IN_PROCESS_INPUT_SCHEMA = z.record(z.string(), z.unknown());
const DEFAULT_IN_PROCESS_OUTPUT_SCHEMA = z.record(z.string(), z.unknown());

const RUNTIME_PROJECT_ROOT_METADATA_KEY = MetadataKeys.PROJECT_ROOT;
const UTF8_ENCODING = 'utf-8';
const DEFAULT_FILE_READ_MAX_SIZE_BYTES = 10 * 1024 * 1024;

const ORCHESTRATION_TOOL_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  ORCHESTRATE_INIT_STATUS_ERROR: 'ORCHESTRATE_INIT_STATUS_ERROR',
  ORCHESTRATE_MONITOR_ERROR: 'ORCHESTRATE_MONITOR_ERROR',
  DELEGATION_LIST_ERROR: 'DELEGATION_LIST_ERROR',
} as const;

const ORCHESTRATE_MONITOR_DEFAULT_SINCE = '30m';
const ORCHESTRATE_MONITOR_TIME_PATTERN = /^(\d+)\s*([smhd])$/i;
const ORCHESTRATE_MONITOR_TIME_MULTIPLIERS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;
const INITIATIVE_FILE_SUFFIX = '.yaml';
const STATUS_DONE = 'done';
const STATUS_IN_PROGRESS = 'in_progress';
const STATUS_BLOCKED = 'blocked';
const STATUS_READY = 'ready';
const STATUS_UNKNOWN = 'unknown';
const LOCK_POLICY_ALL = 'all';
const LOCK_POLICY_ACTIVE = 'active';
const LOCK_POLICY_NONE = 'none';
const DEFAULT_WIP_LIMIT = 1;
const DELEGATION_LIST_LOG_PREFIX = '[delegation:list]';
const INIT_STATUS_HEADER = 'Initiative:';
const INIT_STATUS_PROGRESS_HEADER = 'Progress:';
const INIT_STATUS_WUS_HEADER = 'WUs:';
const INIT_STATUS_LANE_HEADER = 'Lane Availability:';
const LANE_SECTION_KEYS = ['definitions', 'engineering', 'business'] as const;
const DEFAULT_SIGNAL_TYPE = 'unknown';
const WU_ID_PATTERN = /^WU-\d+$/;

const FILE_TOOL_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  FILE_READ_FAILED: 'FILE_READ_FAILED',
  FILE_READ_TOO_LARGE: 'FILE_READ_TOO_LARGE',
  FILE_WRITE_FAILED: 'FILE_WRITE_FAILED',
  FILE_EDIT_FAILED: 'FILE_EDIT_FAILED',
  FILE_EDIT_TARGET_NOT_FOUND: 'FILE_EDIT_TARGET_NOT_FOUND',
  FILE_EDIT_NOT_UNIQUE: 'FILE_EDIT_NOT_UNIQUE',
  FILE_DELETE_FAILED: 'FILE_DELETE_FAILED',
} as const;

const FILE_TOOL_MESSAGES = {
  FILE_WRITTEN: 'File written',
  FILE_EDITED: 'File edited',
  DELETE_COMPLETE: 'Delete complete',
  PATH_NOT_FOUND: 'Path not found',
  PARENT_DIRECTORY_MISSING: 'Parent directory does not exist',
  DIRECTORY_NOT_EMPTY:
    'Directory is not empty. Use recursive=true to delete non-empty directories.',
} as const;

const STATE_TOOL_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  BACKLOG_PRUNE_FAILED: 'BACKLOG_PRUNE_FAILED',
  STATE_BOOTSTRAP_FAILED: 'STATE_BOOTSTRAP_FAILED',
  STATE_CLEANUP_FAILED: 'STATE_CLEANUP_FAILED',
  STATE_DOCTOR_FAILED: 'STATE_DOCTOR_FAILED',
  SIGNAL_CLEANUP_FAILED: 'SIGNAL_CLEANUP_FAILED',
} as const;

const FILE_READ_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
  encoding: z.string().optional(),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  max_size: z.number().int().positive().optional(),
});

const FILE_WRITE_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.string().optional(),
  no_create_dirs: z.boolean().optional(),
});

const FILE_EDIT_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
  old_string: z.string(),
  new_string: z.string(),
  encoding: z.string().optional(),
  replace_all: z.boolean().optional(),
});

const FILE_DELETE_INPUT_SCHEMA = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  force: z.boolean().optional(),
});

const BACKLOG_PRUNE_INPUT_SCHEMA = z.object({
  execute: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  stale_days_in_progress: z.number().int().positive().optional(),
  stale_days_ready: z.number().int().positive().optional(),
  archive_days: z.number().int().positive().optional(),
});

const STATE_BOOTSTRAP_INPUT_SCHEMA = z.object({
  execute: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
  wu_dir: z.string().optional(),
  state_dir: z.string().optional(),
});

const STATE_CLEANUP_INPUT_SCHEMA = z.object({
  dry_run: z.boolean().optional(),
  signals_only: z.boolean().optional(),
  memory_only: z.boolean().optional(),
  events_only: z.boolean().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const STATE_DOCTOR_INPUT_SCHEMA = z.object({
  fix: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const SIGNAL_CLEANUP_INPUT_SCHEMA = z.object({
  dry_run: z.boolean().optional(),
  ttl: z.string().optional(),
  unread_ttl: z.string().optional(),
  max_entries: z.number().int().positive().optional(),
  json: z.boolean().optional(),
  quiet: z.boolean().optional(),
  base_dir: z.string().optional(),
});

const ORCHESTRATE_INIT_STATUS_INPUT_SCHEMA = z.object({
  initiative: z.string().min(1),
});

const ORCHESTRATE_MONITOR_INPUT_SCHEMA = z.object({
  threshold: z.number().positive().optional(),
  recover: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  since: z.string().optional(),
  wu: z.string().optional(),
  signals_only: z.boolean().optional(),
});

const DELEGATION_LIST_INPUT_SCHEMA = z.object({
  wu: z.string().optional(),
  initiative: z.string().optional(),
  json: z.boolean().optional(),
});

const FILE_READ_OUTPUT_SCHEMA = z.object({
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const FILE_WRITE_OUTPUT_SCHEMA = z.object({
  message: z.string(),
  path: z.string(),
  bytes_written: z.number().int().nonnegative(),
});

const FILE_EDIT_OUTPUT_SCHEMA = z.object({
  message: z.string(),
  path: z.string(),
  replacements: z.number().int().positive(),
});

const FILE_DELETE_OUTPUT_SCHEMA = z.object({
  message: z.string(),
  metadata: z
    .object({
      deleted_count: z.number().int().nonnegative(),
      was_directory: z.boolean(),
    })
    .optional(),
});

// WU-1803: Lazy module loaders to avoid eager imports (same pattern as getCore in tools-shared)
let coreModule: typeof import('@lumenflow/core') | null = null;
async function getCoreLazy() {
  if (!coreModule) coreModule = await import('@lumenflow/core');
  return coreModule;
}

type CoreModule = Awaited<ReturnType<typeof getCoreLazy>>;

interface MemorySignalsCleanupResult {
  success: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  dryRun?: boolean;
  breakdown: {
    ttlExpired: number;
    unreadTtlExpired: number;
    countLimitExceeded: number;
    activeWuProtected: number;
  };
}

interface MemoryLifecycleCleanupResult {
  success: boolean;
  removedIds: string[];
  retainedIds: string[];
  bytesFreed: number;
  compactionRatio: number;
  dryRun?: boolean;
  breakdown: {
    ephemeral: number;
    session: number;
    wu: number;
    sensitive: number;
    ttlExpired: number;
    activeSessionProtected: number;
  };
}

interface MemoryModuleLike {
  cleanupSignals: (
    baseDir: string,
    options?: {
      dryRun?: boolean;
      ttl?: string;
      unreadTtl?: string;
      maxEntries?: number;
      getActiveWuIds?: () => Promise<Set<string>>;
    },
  ) => Promise<MemorySignalsCleanupResult>;
  cleanupMemory: (
    baseDir: string,
    options?: {
      dryRun?: boolean;
    },
  ) => Promise<MemoryLifecycleCleanupResult>;
}

const MEMORY_MODULE_ID = '@lumenflow/memory';
let memoryModule: MemoryModuleLike | null = null;
async function getMemoryLazy(): Promise<MemoryModuleLike> {
  if (!memoryModule) {
    memoryModule = (await import(MEMORY_MODULE_ID)) as MemoryModuleLike;
  }
  return memoryModule;
}

// --- WU-1803: Context in-process handler implementations ---
// WU-1905: flow:bottlenecks, flow:report, metrics, and metrics:snapshot handlers
// have been migrated to pack handler implementations in
// packages/@lumenflow/packs/software-delivery/tool-impl/flow-metrics-tools.ts

/**
 * context:get handler — delegates to @lumenflow/core computeWuContext
 */
const contextGetHandler: InProcessToolFn = async () => {
  try {
    const core = await getCoreLazy();
    const context = await core.computeWuContext({ cwd: process.cwd() });
    return { success: true, data: context };
  } catch (err) {
    return {
      success: false,
      error: { code: 'CONTEXT_ERROR', message: (err as Error).message },
    };
  }
};

/**
 * wu:list handler — delegates to @lumenflow/core listWUs
 */
const wuListHandler: InProcessToolFn = async (rawInput) => {
  try {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const core = await getCoreLazy();

    const options: ListWUsOptions = { projectRoot: process.cwd() };
    if (typeof input.status === 'string') options.status = input.status;
    if (typeof input.lane === 'string') options.lane = input.lane;

    const wus = await core.listWUs(options);
    return { success: true, data: wus };
  } catch (err) {
    return {
      success: false,
      error: { code: 'WU_LIST_ERROR', message: (err as Error).message },
    };
  }
};

interface InitiativeDocLike {
  id?: string;
  slug?: string;
  title?: string;
  status?: unknown;
  phases?: unknown;
  wus?: unknown;
}

interface InitiativeStatusWUEntry {
  id: string;
  title: string;
  lane: string;
  status: string;
}

interface LanePolicyConfig {
  lockPolicy: typeof LOCK_POLICY_ALL | typeof LOCK_POLICY_ACTIVE | typeof LOCK_POLICY_NONE;
  wipLimit: number;
}

interface LaneAvailabilitySummary {
  available: boolean;
  policy: typeof LOCK_POLICY_ALL | typeof LOCK_POLICY_ACTIVE | typeof LOCK_POLICY_NONE;
  occupied_by: string | null;
  in_progress: number;
  blocked: number;
  wip_limit: number;
}

interface MonitorSignalRecord {
  timestamp: string;
  type: string;
  wuId?: string;
  message?: string;
}

interface DelegationRecordLike {
  parentWuId?: unknown;
  targetWuId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeLifecycleStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasIncompletePhase(phases: unknown): boolean {
  if (!Array.isArray(phases) || phases.length === 0) {
    return false;
  }

  return phases.some((phase) => {
    if (!isRecord(phase)) {
      return true;
    }
    return normalizeLifecycleStatus(phase.status) !== STATUS_DONE;
  });
}

function deriveInitiativeLifecycleStatus(status: unknown, phases: unknown): string {
  const normalizedStatus = normalizeLifecycleStatus(status);
  if (normalizedStatus === STATUS_DONE && hasIncompletePhase(phases)) {
    return STATUS_IN_PROGRESS;
  }
  return normalizedStatus || STATUS_IN_PROGRESS;
}

function extractInitiativeWuIds(wus: unknown): string[] {
  if (!Array.isArray(wus)) {
    return [];
  }

  const wuIds: string[] = [];
  for (const entry of wus) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      wuIds.push(entry);
      continue;
    }
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id.trim().length > 0) {
      wuIds.push(entry.id);
    }
  }
  return wuIds;
}

function countProgress(entries: InitiativeStatusWUEntry[]): {
  total: number;
  done: number;
  active: number;
  pending: number;
  blocked: number;
  percentage: number;
} {
  const progress = {
    total: entries.length,
    done: 0,
    active: 0,
    pending: 0,
    blocked: 0,
    percentage: 0,
  };

  for (const wu of entries) {
    if (wu.status === STATUS_DONE) {
      progress.done += 1;
    } else if (wu.status === STATUS_IN_PROGRESS) {
      progress.active += 1;
    } else if (wu.status === STATUS_BLOCKED) {
      progress.blocked += 1;
    } else {
      progress.pending += 1;
    }
  }

  progress.percentage = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return progress;
}

function collectLaneDefinitions(value: unknown, target: Record<string, unknown>[]): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const entry of value) {
    if (isRecord(entry)) {
      target.push(entry);
    }
  }
}

function resolveLanePolicyConfig(config: unknown): Record<string, LanePolicyConfig> {
  const laneConfigMap: Record<string, LanePolicyConfig> = {};
  if (!isRecord(config) || !isRecord(config.lanes)) {
    return laneConfigMap;
  }

  const laneDefinitions: Record<string, unknown>[] = [];
  if (Array.isArray(config.lanes)) {
    collectLaneDefinitions(config.lanes, laneDefinitions);
  } else {
    for (const key of LANE_SECTION_KEYS) {
      collectLaneDefinitions(config.lanes[key], laneDefinitions);
    }
  }

  for (const laneDefinition of laneDefinitions) {
    if (typeof laneDefinition.name !== 'string' || laneDefinition.name.trim().length === 0) {
      continue;
    }
    const lockPolicy =
      laneDefinition.lock_policy === LOCK_POLICY_ACTIVE ||
      laneDefinition.lock_policy === LOCK_POLICY_NONE
        ? laneDefinition.lock_policy
        : LOCK_POLICY_ALL;
    const wipLimit =
      typeof laneDefinition.wip_limit === 'number' ? laneDefinition.wip_limit : DEFAULT_WIP_LIMIT;
    laneConfigMap[laneDefinition.name] = { lockPolicy, wipLimit };
  }

  return laneConfigMap;
}

function computeLaneAvailability(
  wus: InitiativeStatusWUEntry[],
  laneConfigMap: Record<string, LanePolicyConfig>,
): Record<string, LaneAvailabilitySummary> {
  const groupedByLane = new Map<string, InitiativeStatusWUEntry[]>();
  for (const wu of wus) {
    if (!wu.lane) {
      continue;
    }
    const laneEntries = groupedByLane.get(wu.lane);
    if (laneEntries) {
      laneEntries.push(wu);
    } else {
      groupedByLane.set(wu.lane, [wu]);
    }
  }

  const result: Record<string, LaneAvailabilitySummary> = {};
  for (const [lane, entries] of groupedByLane) {
    const laneConfig = laneConfigMap[lane] ?? {
      lockPolicy: LOCK_POLICY_ALL,
      wipLimit: DEFAULT_WIP_LIMIT,
    };
    const inProgress = entries.filter((wu) => wu.status === STATUS_IN_PROGRESS);
    const blocked = entries.filter((wu) => wu.status === STATUS_BLOCKED);
    let available: boolean;
    let occupiedBy: string | null = null;

    if (laneConfig.lockPolicy === LOCK_POLICY_NONE) {
      available = true;
    } else if (laneConfig.lockPolicy === LOCK_POLICY_ACTIVE) {
      available = inProgress.length === 0;
      occupiedBy = inProgress[0]?.id ?? null;
    } else {
      available = inProgress.length === 0 && blocked.length === 0;
      occupiedBy = inProgress[0]?.id ?? blocked[0]?.id ?? null;
    }

    result[lane] = {
      available,
      policy: laneConfig.lockPolicy,
      occupied_by: occupiedBy,
      in_progress: inProgress.length,
      blocked: blocked.length,
      wip_limit: laneConfig.wipLimit,
    };
  }

  return result;
}

function formatInitiativeStatusMessage(input: {
  initiativeId: string;
  initiativeTitle: string;
  lifecycleStatus: string;
  rawStatus: string;
  progress: ReturnType<typeof countProgress>;
  wus: InitiativeStatusWUEntry[];
  laneAvailability: Record<string, LaneAvailabilitySummary>;
}): string {
  const lines: string[] = [];
  lines.push(`${INIT_STATUS_HEADER} ${input.initiativeId} - ${input.initiativeTitle}`);
  lines.push(`Lifecycle Status: ${input.lifecycleStatus}`);
  if (input.rawStatus && input.rawStatus !== input.lifecycleStatus) {
    lines.push(
      `Lifecycle mismatch: metadata status '${input.rawStatus}' conflicts with phase state; reporting '${input.lifecycleStatus}'.`,
    );
  }
  lines.push('');
  lines.push(INIT_STATUS_PROGRESS_HEADER);
  lines.push(
    `  Done: ${input.progress.done}/${input.progress.total} (${input.progress.percentage}%)`,
  );
  lines.push(`  Active: ${input.progress.active}`);
  lines.push(`  Pending: ${input.progress.pending}`);
  lines.push(`  Blocked: ${input.progress.blocked}`);
  lines.push('');
  lines.push(INIT_STATUS_WUS_HEADER);
  if (input.wus.length === 0) {
    lines.push('  (no WUs found for initiative)');
  } else {
    for (const wu of input.wus) {
      lines.push(`  ${wu.id}: ${wu.title} [${wu.status}]`);
    }
  }
  lines.push('');
  lines.push(INIT_STATUS_LANE_HEADER);
  const lanes = Object.keys(input.laneAvailability).sort((left, right) =>
    left.localeCompare(right),
  );
  if (lanes.length === 0) {
    lines.push('  (no lanes found)');
  } else {
    for (const lane of lanes) {
      const availability = input.laneAvailability[lane];
      if (!availability) {
        continue;
      }
      const status = availability.available ? 'available' : 'occupied';
      lines.push(
        `  ${lane}: ${status} (wip_limit=${availability.wip_limit}, lock_policy=${availability.policy}, in_progress=${availability.in_progress}, blocked=${availability.blocked}, occupied_by=${availability.occupied_by ?? 'none'})`,
      );
    }
  }
  return lines.join('\n');
}

async function resolveInitiativeDoc(
  core: CoreModule,
  projectRoot: string,
  initiativeRef: string,
): Promise<InitiativeDocLike> {
  const config = core.getConfig({ projectRoot });
  const initiativesDir = path.join(projectRoot, config.directories.initiativesDir);
  const initiativeFiles = await readdir(initiativesDir);
  const normalizedRef = normalizeToken(initiativeRef);

  for (const file of initiativeFiles) {
    if (!file.endsWith(INITIATIVE_FILE_SUFFIX)) {
      continue;
    }
    const content = await readFile(path.join(initiativesDir, file), UTF8_ENCODING);
    const parsed = core.parseYAML(content);
    if (!isRecord(parsed)) {
      continue;
    }
    const id = normalizeToken(parsed.id);
    const slug = normalizeToken(parsed.slug);
    if (id === normalizedRef || slug === normalizedRef) {
      return {
        id: typeof parsed.id === 'string' ? parsed.id : undefined,
        slug: typeof parsed.slug === 'string' ? parsed.slug : undefined,
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        status: parsed.status,
        phases: parsed.phases,
        wus: parsed.wus,
      };
    }
  }

  throw createError(ErrorCodes.INIT_NOT_FOUND, `Initiative '${initiativeRef}' not found`);
}

async function getCompletedWuIdsFromStamps(
  core: CoreModule,
  projectRoot: string,
): Promise<Set<string>> {
  const completed = new Set<string>();
  const stampsPath = path.join(projectRoot, core.LUMENFLOW_PATHS.STAMPS_DIR);

  try {
    const files = await readdir(stampsPath);
    for (const file of files) {
      if (file.endsWith('.done')) {
        completed.add(file.slice(0, -'.done'.length));
      }
    }
  } catch {
    return completed;
  }

  return completed;
}

function parseSinceInputToDate(sinceInput: string): Date {
  const relativeMatch = ORCHESTRATE_MONITOR_TIME_PATTERN.exec(sinceInput.trim());
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1] ?? '0', 10);
    const unit = (
      relativeMatch[2] ?? ''
    ).toLowerCase() as keyof typeof ORCHESTRATE_MONITOR_TIME_MULTIPLIERS;
    const multiplier = ORCHESTRATE_MONITOR_TIME_MULTIPLIERS[unit];
    if (Number.isFinite(amount) && amount > 0 && multiplier) {
      return new Date(Date.now() - amount * multiplier);
    }
  }

  const absoluteDate = new Date(sinceInput);
  if (Number.isNaN(absoluteDate.getTime())) {
    throw createError(ErrorCodes.INVALID_ARGUMENT, `Invalid time format: ${sinceInput}`);
  }
  return absoluteDate;
}

async function loadRecentSignals(core: CoreModule, projectRoot: string, since: Date) {
  const signalRecords: MonitorSignalRecord[] = [];
  const memoryPath = path.join(projectRoot, core.LUMENFLOW_PATHS.MEMORY_DIR);

  let files: string[];
  try {
    files = await readdir(memoryPath);
  } catch {
    return signalRecords;
  }

  const ndjsonFiles = files.filter((file) => file.endsWith('.ndjson'));
  for (const file of ndjsonFiles) {
    const content = await readFile(path.join(memoryPath, file), UTF8_ENCODING);
    for (const line of content.split('\n')) {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmedLine);
        if (!isRecord(parsed) || typeof parsed.timestamp !== 'string') {
          continue;
        }
        const timestamp = new Date(parsed.timestamp);
        if (Number.isNaN(timestamp.getTime()) || timestamp < since) {
          continue;
        }
        signalRecords.push({
          timestamp: parsed.timestamp,
          type: typeof parsed.type === 'string' ? parsed.type : DEFAULT_SIGNAL_TYPE,
          wuId: typeof parsed.wuId === 'string' ? parsed.wuId : undefined,
          message: typeof parsed.message === 'string' ? parsed.message : undefined,
        });
      } catch {
        continue;
      }
    }
  }

  signalRecords.sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
  return signalRecords;
}

const orchestrateInitStatusInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = ORCHESTRATE_INIT_STATUS_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const initiativeDoc = await resolveInitiativeDoc(
      core,
      projectRoot,
      parsedInput.data.initiative,
    );
    const initiativeId = initiativeDoc.id ?? parsedInput.data.initiative;
    const initiativeSlug = initiativeDoc.slug ?? '';
    const allWUs = await core.listWUs({ projectRoot });
    const completedWuIds = await getCompletedWuIdsFromStamps(core, projectRoot);
    const declaredWuIds = extractInitiativeWuIds(initiativeDoc.wus);
    const declaredWuIdSet = new Set(declaredWuIds);
    const normalizedInitiativeRefs = new Set([
      normalizeToken(parsedInput.data.initiative),
      normalizeToken(initiativeId),
      normalizeToken(initiativeSlug),
    ]);
    const wuById = new Map(allWUs.map((wu) => [wu.id, wu]));
    const inferredWuIds = allWUs
      .filter((wu) => normalizedInitiativeRefs.has(normalizeToken(wu.initiative)))
      .map((wu) => wu.id);
    const orderedWuIds = declaredWuIds.length > 0 ? declaredWuIds : inferredWuIds;
    const dedupedWuIds = [...new Set(orderedWuIds)];
    const statusEntries: InitiativeStatusWUEntry[] = dedupedWuIds.map((wuId) => {
      const wu = wuById.get(wuId);
      const fallbackStatus = declaredWuIdSet.has(wuId) ? STATUS_READY : STATUS_UNKNOWN;
      return {
        id: wuId,
        title: wu?.title ?? wuId,
        lane: wu?.lane ?? '',
        status: completedWuIds.has(wuId) ? STATUS_DONE : (wu?.status ?? fallbackStatus),
      };
    });

    const progress = countProgress(statusEntries);
    const config = core.getConfig({ projectRoot });
    const laneConfigMap = resolveLanePolicyConfig(config);
    const laneAvailability = computeLaneAvailability(statusEntries, laneConfigMap);
    const lifecycleStatus = deriveInitiativeLifecycleStatus(
      initiativeDoc.status,
      initiativeDoc.phases,
    );
    const rawStatus = normalizeLifecycleStatus(initiativeDoc.status);
    const message = formatInitiativeStatusMessage({
      initiativeId,
      initiativeTitle: initiativeDoc.title ?? initiativeId,
      lifecycleStatus,
      rawStatus,
      progress,
      wus: statusEntries,
      laneAvailability,
    });

    return createSuccessOutput({
      message,
      initiative: {
        id: initiativeId,
        slug: initiativeSlug || undefined,
        title: initiativeDoc.title ?? initiativeId,
        lifecycle_status: lifecycleStatus,
        raw_status: rawStatus || undefined,
      },
      progress,
      wus: statusEntries,
      lane_availability: laneAvailability,
    });
  } catch (cause) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.ORCHESTRATE_INIT_STATUS_ERROR,
      (cause as Error).message,
    );
  }
};

const orchestrateMonitorInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = ORCHESTRATE_MONITOR_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);

    if (parsedInput.data.signals_only) {
      const sinceInput =
        parsedInput.data.since && parsedInput.data.since.trim().length > 0
          ? parsedInput.data.since
          : ORCHESTRATE_MONITOR_DEFAULT_SINCE;
      const sinceDate = parseSinceInputToDate(sinceInput);
      const allSignals = await loadRecentSignals(core, projectRoot, sinceDate);
      const filteredSignals = parsedInput.data.wu
        ? allSignals.filter((signal) => signal.wuId === parsedInput.data.wu)
        : allSignals;

      const lines = [
        `Signals since ${sinceDate.toISOString()}:`,
        `Count: ${filteredSignals.length}`,
      ];
      if (filteredSignals.length > 0) {
        for (const signal of filteredSignals) {
          lines.push(
            `${signal.timestamp} [${signal.wuId ?? 'system'}] ${signal.type}: ${signal.message ?? ''}`,
          );
        }
      } else {
        lines.push('No signals found.');
      }

      return createSuccessOutput({
        message: lines.join('\n'),
        since: sinceInput,
        signals: filteredSignals,
        total: filteredSignals.length,
      });
    }

    const thresholdMinutes = parsedInput.data.threshold ?? core.DEFAULT_THRESHOLD_MINUTES;
    const stateDir = path.join(projectRoot, core.LUMENFLOW_PATHS.STATE_DIR);
    const registryStore = new core.DelegationRegistryStore(stateDir);
    let delegations: ReturnType<typeof registryStore.getAllDelegations> = [];

    try {
      await registryStore.load();
      delegations = registryStore.getAllDelegations();
    } catch {
      delegations = [];
    }

    const analysis = core.analyzeDelegations(delegations);
    const stuckDelegations = core.detectStuckDelegations(delegations, thresholdMinutes);
    const zombieLocks = await core.checkZombieLocks({ baseDir: projectRoot });
    const suggestions = core.generateSuggestions(stuckDelegations, zombieLocks);

    const monitorResult = {
      analysis,
      stuckDelegations,
      zombieLocks,
      suggestions,
      dryRun: parsedInput.data.dry_run ?? false,
    };

    let recoveryResults: unknown[] | undefined;
    if (parsedInput.data.recover) {
      recoveryResults = await core.runRecovery(stuckDelegations, {
        baseDir: projectRoot,
        dryRun: parsedInput.data.dry_run ?? false,
      });
    }

    let monitorOutput = core.formatMonitorOutput(monitorResult);
    if (recoveryResults && recoveryResults.length > 0) {
      monitorOutput = `${monitorOutput}\n\n${core.formatRecoveryResults(
        recoveryResults as Parameters<typeof core.formatRecoveryResults>[0],
      )}`;
    }

    if (stuckDelegations.length > 0 || zombieLocks.length > 0) {
      return createFailureOutput(
        ORCHESTRATION_TOOL_ERROR_CODES.ORCHESTRATE_MONITOR_ERROR,
        monitorOutput,
      );
    }

    return createSuccessOutput({
      message: monitorOutput,
      ...monitorResult,
      recoveryResults,
    });
  } catch (cause) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.ORCHESTRATE_MONITOR_ERROR,
      (cause as Error).message,
    );
  }
};

const delegationListInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = DELEGATION_LIST_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }
  if (!parsedInput.data.wu && !parsedInput.data.initiative) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.INVALID_INPUT,
      'Either wu or initiative is required',
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const registryDir = path.join(projectRoot, config.state.stateDir);
    const wuDir = path.join(projectRoot, config.directories.wuDir);

    if (parsedInput.data.wu) {
      const wuId = parsedInput.data.wu.toUpperCase();
      if (!WU_ID_PATTERN.test(wuId)) {
        return createFailureOutput(
          ORCHESTRATION_TOOL_ERROR_CODES.INVALID_INPUT,
          `Invalid WU ID format: ${parsedInput.data.wu}. Expected format: WU-XXX`,
        );
      }

      const delegations = await core.getDelegationsByWU(wuId, registryDir);
      if (parsedInput.data.json) {
        const tree = core.buildDelegationTree(delegations, wuId);
        return createSuccessOutput(core.treeToJSON(tree));
      }

      if (delegations.length === 0) {
        return createSuccessOutput({
          message: `${DELEGATION_LIST_LOG_PREFIX} No delegations found for ${wuId}`,
          delegations,
        });
      }

      const tree = core.buildDelegationTree(delegations, wuId);
      return createSuccessOutput({
        message: `${DELEGATION_LIST_LOG_PREFIX} Delegation tree for ${wuId}:\n\n${core.formatDelegationTree(tree)}\n\nTotal: ${delegations.length} delegation(s)`,
        delegations,
      });
    }

    const initiativeId = (parsedInput.data.initiative as string).toUpperCase();
    const delegations = await core.getDelegationsByInitiative(initiativeId, registryDir, wuDir);
    if (parsedInput.data.json) {
      return createSuccessOutput(delegations);
    }

    if (delegations.length === 0) {
      return createSuccessOutput({
        message: `${DELEGATION_LIST_LOG_PREFIX} No delegations found for ${initiativeId}`,
        delegations,
      });
    }

    const typedDelegations = delegations as DelegationRecordLike[];
    const targetWuIds = new Set(
      typedDelegations
        .map((record) => record.targetWuId)
        .filter((wuId): wuId is string => typeof wuId === 'string'),
    );
    const rootWuIds = [
      ...new Set(
        typedDelegations
          .map((record) => record.parentWuId)
          .filter((wuId): wuId is string => typeof wuId === 'string'),
      ),
    ].filter((wuId) => !targetWuIds.has(wuId));

    const lines = [`${DELEGATION_LIST_LOG_PREFIX} Delegations for ${initiativeId}:`, ''];
    for (const rootWuId of rootWuIds) {
      const tree = core.buildDelegationTree(delegations, rootWuId);
      lines.push(core.formatDelegationTree(tree));
      lines.push('');
    }
    lines.push(`Total: ${delegations.length} delegation(s) across ${rootWuIds.length} root WU(s)`);

    return createSuccessOutput({
      message: lines.join('\n'),
      delegations,
      root_wu_ids: rootWuIds,
    });
  } catch (cause) {
    return createFailureOutput(
      ORCHESTRATION_TOOL_ERROR_CODES.DELEGATION_LIST_ERROR,
      (cause as Error).message,
    );
  }
};

interface RegisteredInProcessToolHandler {
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  fn: InProcessToolFn;
}

function createFailureOutput(code: string, message: string): ToolOutput {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}

function createSuccessOutput(data: unknown): ToolOutput {
  return {
    success: true,
    data,
  };
}

function resolveWorkspaceRoot(context: ExecutionContext): string {
  const root = context.metadata?.[RUNTIME_PROJECT_ROOT_METADATA_KEY];
  if (typeof root === 'string' && root.trim().length > 0) {
    return path.resolve(root);
  }
  return process.cwd();
}

function resolveTargetPath(context: ExecutionContext, inputPath: string): string {
  return path.resolve(resolveWorkspaceRoot(context), inputPath);
}

function resolveEncoding(encoding?: string): BufferEncoding {
  return (encoding ?? UTF8_ENCODING) as BufferEncoding;
}

function extractLineRange(content: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined && endLine === undefined) {
    return content;
  }

  const lines = content.split('\n');
  const start = (startLine ?? 1) - 1;
  const end = endLine ?? lines.length;
  return lines.slice(start, end).join('\n');
}

function countOccurrences(content: string, searchText: string): number {
  if (!searchText) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(searchText, cursor);
    if (index === -1) {
      break;
    }
    count += 1;
    cursor = index + searchText.length;
  }
  return count;
}

async function getPathInfo(targetPath: string): Promise<{ exists: boolean; isDirectory: boolean }> {
  try {
    const targetStats = await stat(targetPath);
    return { exists: true, isDirectory: targetStats.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

async function countItemsInDirectory(directoryPath: string): Promise<number> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    count += 1;
    if (entry.isDirectory()) {
      count += await countItemsInDirectory(path.join(directoryPath, entry.name));
    }
  }

  return count;
}

const fileReadInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = FILE_READ_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  const targetPath = resolveTargetPath(context, parsedInput.data.path);
  const encoding = resolveEncoding(parsedInput.data.encoding);
  const maxSize = parsedInput.data.max_size ?? DEFAULT_FILE_READ_MAX_SIZE_BYTES;

  try {
    const targetStats = await stat(targetPath);
    if (targetStats.size > maxSize) {
      return createFailureOutput(
        FILE_TOOL_ERROR_CODES.FILE_READ_TOO_LARGE,
        `File size (${targetStats.size} bytes) exceeds maximum allowed (${maxSize} bytes).`,
      );
    }

    const content = await readFile(targetPath, { encoding });
    const selectedContent = extractLineRange(
      content,
      parsedInput.data.start_line,
      parsedInput.data.end_line,
    );
    const totalLineCount = content.length === 0 ? 0 : content.split('\n').length;

    return createSuccessOutput({
      content: selectedContent,
      metadata: {
        size_bytes: targetStats.size,
        line_count: totalLineCount,
        lines_returned: selectedContent.length === 0 ? 0 : selectedContent.split('\n').length,
      },
    });
  } catch (cause) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.FILE_READ_FAILED, (cause as Error).message);
  }
};

const fileWriteInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = FILE_WRITE_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  const targetPath = resolveTargetPath(context, parsedInput.data.path);
  const encoding = resolveEncoding(parsedInput.data.encoding);
  const createDirectories = !parsedInput.data.no_create_dirs;
  const parentDirectory = path.dirname(targetPath);

  try {
    if (createDirectories) {
      await mkdir(parentDirectory, { recursive: true });
    } else {
      const parentInfo = await getPathInfo(parentDirectory);
      if (!parentInfo.exists || !parentInfo.isDirectory) {
        return createFailureOutput(
          FILE_TOOL_ERROR_CODES.FILE_WRITE_FAILED,
          `${FILE_TOOL_MESSAGES.PARENT_DIRECTORY_MISSING}: ${parentDirectory}`,
        );
      }
    }

    await writeFile(targetPath, parsedInput.data.content, { encoding });

    return createSuccessOutput({
      message: FILE_TOOL_MESSAGES.FILE_WRITTEN,
      path: targetPath,
      bytes_written: Buffer.byteLength(parsedInput.data.content, encoding),
    });
  } catch (cause) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.FILE_WRITE_FAILED, (cause as Error).message);
  }
};

const fileEditInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = FILE_EDIT_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  const targetPath = resolveTargetPath(context, parsedInput.data.path);
  const encoding = resolveEncoding(parsedInput.data.encoding);
  const replaceAll = parsedInput.data.replace_all ?? false;

  try {
    const content = await readFile(targetPath, { encoding });
    const occurrenceCount = countOccurrences(content, parsedInput.data.old_string);

    if (occurrenceCount === 0) {
      return createFailureOutput(
        FILE_TOOL_ERROR_CODES.FILE_EDIT_TARGET_NOT_FOUND,
        `old_string not found in file: ${parsedInput.data.old_string}`,
      );
    }

    if (occurrenceCount > 1 && !replaceAll) {
      return createFailureOutput(
        FILE_TOOL_ERROR_CODES.FILE_EDIT_NOT_UNIQUE,
        `old_string is not unique in file (found ${occurrenceCount} occurrences).`,
      );
    }

    const nextContent = replaceAll
      ? content.split(parsedInput.data.old_string).join(parsedInput.data.new_string)
      : content.replace(parsedInput.data.old_string, parsedInput.data.new_string);

    await writeFile(targetPath, nextContent, { encoding });

    return createSuccessOutput({
      message: FILE_TOOL_MESSAGES.FILE_EDITED,
      path: targetPath,
      replacements: replaceAll ? occurrenceCount : 1,
    });
  } catch (cause) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.FILE_EDIT_FAILED, (cause as Error).message);
  }
};

const fileDeleteInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = FILE_DELETE_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  const targetPath = resolveTargetPath(context, parsedInput.data.path);
  const recursive = parsedInput.data.recursive ?? false;
  const force = parsedInput.data.force ?? false;

  try {
    const targetInfo = await getPathInfo(targetPath);
    if (!targetInfo.exists) {
      if (force) {
        return createSuccessOutput({
          message: FILE_TOOL_MESSAGES.DELETE_COMPLETE,
          metadata: {
            deleted_count: 0,
            was_directory: false,
          },
        });
      }
      return createFailureOutput(
        FILE_TOOL_ERROR_CODES.FILE_DELETE_FAILED,
        `${FILE_TOOL_MESSAGES.PATH_NOT_FOUND}: ${targetPath}`,
      );
    }

    if (targetInfo.isDirectory && !recursive) {
      const entries = await readdir(targetPath);
      if (entries.length > 0) {
        return createFailureOutput(
          FILE_TOOL_ERROR_CODES.FILE_DELETE_FAILED,
          FILE_TOOL_MESSAGES.DIRECTORY_NOT_EMPTY,
        );
      }
    }

    let deletedCount = 1;
    if (targetInfo.isDirectory && recursive) {
      deletedCount += await countItemsInDirectory(targetPath);
    }

    await rm(targetPath, { recursive, force });

    return createSuccessOutput({
      message: FILE_TOOL_MESSAGES.DELETE_COMPLETE,
      metadata: {
        deleted_count: deletedCount,
        was_directory: targetInfo.isDirectory,
      },
    });
  } catch (cause) {
    return createFailureOutput(FILE_TOOL_ERROR_CODES.FILE_DELETE_FAILED, (cause as Error).message);
  }
};

interface WuLifecycleDocument {
  id: string;
  status: string;
  title?: string;
  lane?: string;
  created?: string;
  claimed_at?: string;
  completed?: string;
  completed_at?: string;
  updated?: string;
  filePath: string;
}

type BootstrapLifecycleEventType =
  | typeof STATE_RUNTIME_EVENT_TYPES.CLAIM
  | typeof STATE_RUNTIME_EVENT_TYPES.COMPLETE
  | typeof STATE_RUNTIME_EVENT_TYPES.BLOCK;

interface BootstrapLifecycleEvent {
  type: BootstrapLifecycleEventType;
  wuId: string;
  timestamp: string;
  lane?: string;
  title?: string;
  reason?: string;
}

function resolveCommandBaseDir(context: ExecutionContext, baseDir?: string): string {
  if (!baseDir || baseDir.trim().length === 0) {
    return resolveWorkspaceRoot(context);
  }
  return path.resolve(resolveWorkspaceRoot(context), baseDir);
}

function normalizeDryRun(execute?: boolean, dryRun?: boolean): boolean {
  if (dryRun !== undefined) {
    return dryRun;
  }
  return !execute;
}

function toIsoTimestamp(timestamp?: string, fallback?: string): string {
  const candidate = timestamp ?? fallback;
  if (!candidate) {
    return new Date().toISOString();
  }
  if (candidate.includes('T')) {
    return candidate;
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function calculateDaysSince(dateString?: string): number | null {
  if (!dateString) {
    return null;
  }
  const parsedDate = new Date(dateString);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return Math.floor((Date.now() - parsedDate.getTime()) / STATE_RUNTIME_CONSTANTS.ONE_DAY_MS);
}

async function loadWuLifecycleDocuments(
  core: CoreModule,
  wuDir: string,
): Promise<WuLifecycleDocument[]> {
  const directoryInfo = await getPathInfo(wuDir);
  if (!directoryInfo.exists || !directoryInfo.isDirectory) {
    return [];
  }

  const files = await readdir(wuDir);
  const documents: WuLifecycleDocument[] = [];

  for (const fileName of files) {
    if (
      !fileName.startsWith(STATE_RUNTIME_CONSTANTS.WU_FILE_PREFIX) ||
      !fileName.endsWith(STATE_RUNTIME_CONSTANTS.YAML_EXTENSION)
    ) {
      continue;
    }

    const filePath = path.join(wuDir, fileName);
    try {
      const rawDoc = core.readWURaw(filePath) as Record<string, unknown>;
      if (!rawDoc || typeof rawDoc.id !== 'string' || typeof rawDoc.status !== 'string') {
        continue;
      }

      documents.push({
        id: rawDoc.id,
        status: rawDoc.status,
        title: typeof rawDoc.title === 'string' ? rawDoc.title : undefined,
        lane: typeof rawDoc.lane === 'string' ? rawDoc.lane : undefined,
        created: typeof rawDoc.created === 'string' ? rawDoc.created : undefined,
        claimed_at: typeof rawDoc.claimed_at === 'string' ? rawDoc.claimed_at : undefined,
        completed: typeof rawDoc.completed === 'string' ? rawDoc.completed : undefined,
        completed_at: typeof rawDoc.completed_at === 'string' ? rawDoc.completed_at : undefined,
        updated: typeof rawDoc.updated === 'string' ? rawDoc.updated : undefined,
        filePath,
      });
    } catch {
      continue;
    }
  }

  return documents;
}

function inferBootstrapEvents(
  core: CoreModule,
  wu: WuLifecycleDocument,
): BootstrapLifecycleEvent[] {
  const readyLikeStatuses = new Set([
    core.WU_STATUS.READY,
    core.WU_STATUS.BACKLOG,
    core.WU_STATUS.TODO,
  ]);
  const doneStatuses = new Set([core.WU_STATUS.DONE, core.WU_STATUS.COMPLETED]);
  const normalizedStatus = wu.status;

  if (readyLikeStatuses.has(normalizedStatus)) {
    return [];
  }

  const claimTimestamp = toIsoTimestamp(wu.claimed_at, wu.created);
  const events: BootstrapLifecycleEvent[] = [
    {
      type: STATE_RUNTIME_EVENT_TYPES.CLAIM,
      wuId: wu.id,
      lane: wu.lane ?? STATE_RUNTIME_CONSTANTS.UNKNOWN_LANE,
      title: wu.title ?? STATE_RUNTIME_CONSTANTS.UNTITLED_WU,
      timestamp: claimTimestamp,
    },
  ];

  if (normalizedStatus === core.WU_STATUS.BLOCKED) {
    const blockedAt = new Date(claimTimestamp);
    blockedAt.setSeconds(blockedAt.getSeconds() + 1);
    events.push({
      type: STATE_RUNTIME_EVENT_TYPES.BLOCK,
      wuId: wu.id,
      timestamp: blockedAt.toISOString(),
      reason: STATE_RUNTIME_CONSTANTS.BOOTSTRAP_BLOCK_REASON,
    });
    return events;
  }

  if (doneStatuses.has(normalizedStatus)) {
    events.push({
      type: STATE_RUNTIME_EVENT_TYPES.COMPLETE,
      wuId: wu.id,
      timestamp: toIsoTimestamp(wu.completed_at ?? wu.completed, claimTimestamp),
    });
  }

  return events;
}

async function listActiveWuIds(projectRoot: string): Promise<Set<string>> {
  const core = await getCoreLazy();
  const activeStatuses = new Set([core.WU_STATUS.IN_PROGRESS, core.WU_STATUS.BLOCKED]);
  const wus = await core.listWUs({ projectRoot });
  return new Set(wus.filter((wu) => activeStatuses.has(wu.status)).map((wu) => wu.id));
}

async function readNdjsonRecords(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(filePath, UTF8_ENCODING);
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((line): line is Record<string, unknown> => line !== null);
  } catch {
    return [];
  }
}

function buildStateDoctorDeps(core: CoreModule, projectRoot: string) {
  const config = core.getConfig({ projectRoot });
  const wuDir = path.join(projectRoot, config.directories.wuDir);
  const stampsDir = path.join(projectRoot, config.state.stampsDir);
  const stateDir = path.join(projectRoot, config.state.stateDir);
  const signalsPath = path.join(projectRoot, core.LUMENFLOW_PATHS.MEMORY_SIGNALS);
  const eventsPath = path.join(projectRoot, core.LUMENFLOW_PATHS.WU_EVENTS);

  return {
    listWUs: async () => {
      const documents = await loadWuLifecycleDocuments(core, wuDir);
      return documents.map((document) => ({
        id: document.id,
        status: document.status,
        lane: document.lane,
        title: document.title,
      }));
    },
    listStamps: async () => {
      try {
        const files = await readdir(stampsDir);
        return files
          .filter((file) => file.endsWith(STATE_RUNTIME_CONSTANTS.DONE_STAMP_EXTENSION))
          .map((file) => file.slice(0, -1 * STATE_RUNTIME_CONSTANTS.DONE_STAMP_EXTENSION.length));
      } catch {
        return [];
      }
    },
    listSignals: async () => {
      const signals = await readNdjsonRecords(signalsPath);
      return signals
        .filter((signal) => typeof signal.id === 'string')
        .map((signal) => ({
          id: String(signal.id),
          wuId:
            typeof signal.wuId === 'string'
              ? signal.wuId
              : typeof signal.wu_id === 'string'
                ? signal.wu_id
                : undefined,
          timestamp: typeof signal.timestamp === 'string' ? signal.timestamp : undefined,
          message: typeof signal.message === 'string' ? signal.message : undefined,
        }));
    },
    listEvents: async () => {
      const events = await readNdjsonRecords(eventsPath);
      return events
        .filter(
          (event) =>
            (typeof event.wuId === 'string' || typeof event.wu_id === 'string') &&
            typeof event.type === 'string',
        )
        .map((event) => ({
          wuId:
            typeof event.wuId === 'string'
              ? event.wuId
              : typeof event.wu_id === 'string'
                ? event.wu_id
                : '',
          type: String(event.type),
          timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
        }));
    },
    removeSignal: async (signalId: string) => {
      const signals = await readNdjsonRecords(signalsPath);
      const retainedSignals = signals.filter((signal) => signal.id !== signalId);
      const payload =
        retainedSignals.map((signal) => JSON.stringify(signal)).join('\n') +
        (retainedSignals.length > 0 ? '\n' : '');
      await writeFile(signalsPath, payload, UTF8_ENCODING);
    },
    removeEvent: async (wuId: string) => {
      const events = await readNdjsonRecords(eventsPath);
      const retainedEvents = events.filter((event) => event.wuId !== wuId && event.wu_id !== wuId);
      const payload =
        retainedEvents.map((event) => JSON.stringify(event)).join('\n') +
        (retainedEvents.length > 0 ? '\n' : '');
      await writeFile(eventsPath, payload, UTF8_ENCODING);
    },
    createStamp: async (wuId: string, title: string) => {
      await mkdir(stampsDir, { recursive: true });
      const stampPath = path.join(
        stampsDir,
        `${wuId}${STATE_RUNTIME_CONSTANTS.DONE_STAMP_EXTENSION}`,
      );
      const completedDate = new Date().toISOString().slice(0, 10);
      const stampContent = `WU ${wuId} — ${title}\nCompleted: ${completedDate}\n`;
      await writeFile(stampPath, stampContent, UTF8_ENCODING);
    },
    emitEvent: async (event: {
      wuId: string;
      type: typeof STATE_RUNTIME_EVENT_TYPES.RELEASE | typeof STATE_RUNTIME_EVENT_TYPES.COMPLETE;
      reason?: string;
    }) => {
      const stateStore = new core.WUStateStore(stateDir);
      await stateStore.load();
      if (event.type === STATE_RUNTIME_EVENT_TYPES.RELEASE) {
        await stateStore.release(
          event.wuId,
          event.reason ?? STATE_RUNTIME_CONSTANTS.STATE_DOCTOR_FIX_REASON,
        );
        return;
      }
      await stateStore.complete(event.wuId);
    },
  };
}

const backlogPruneInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = BACKLOG_PRUNE_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(STATE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  try {
    const core = await getCoreLazy();
    const workspaceRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot: workspaceRoot });
    const wuDir = path.join(workspaceRoot, config.directories.wuDir);
    const wuDocuments = await loadWuLifecycleDocuments(core, wuDir);
    const dryRun = normalizeDryRun(parsedInput.data.execute, parsedInput.data.dry_run);
    const staleDaysInProgress =
      parsedInput.data.stale_days_in_progress ??
      STATE_RUNTIME_CONSTANTS.DEFAULT_STALE_DAYS_IN_PROGRESS;
    const staleDaysReady =
      parsedInput.data.stale_days_ready ?? STATE_RUNTIME_CONSTANTS.DEFAULT_STALE_DAYS_READY;
    const archiveDays =
      parsedInput.data.archive_days ?? STATE_RUNTIME_CONSTANTS.DEFAULT_ARCHIVE_DAYS;

    const doneStatuses = new Set([core.WU_STATUS.DONE, core.WU_STATUS.COMPLETED]);
    const staleCandidates: WuLifecycleDocument[] = [];
    const archivableCandidates: WuLifecycleDocument[] = [];
    const healthyCandidates: WuLifecycleDocument[] = [];

    for (const wu of wuDocuments) {
      if (doneStatuses.has(wu.status)) {
        const completedAge = calculateDaysSince(wu.completed ?? wu.completed_at);
        if (completedAge !== null && completedAge > archiveDays) {
          archivableCandidates.push(wu);
        } else {
          healthyCandidates.push(wu);
        }
        continue;
      }

      if (wu.status === core.WU_STATUS.BLOCKED) {
        healthyCandidates.push(wu);
        continue;
      }

      const lastActivity = wu.updated ?? wu.created;
      const daysSinceActivity = calculateDaysSince(lastActivity);
      if (daysSinceActivity === null) {
        healthyCandidates.push(wu);
        continue;
      }

      const isInProgressStale =
        wu.status === core.WU_STATUS.IN_PROGRESS && daysSinceActivity > staleDaysInProgress;
      const isReadyLikeStale =
        (wu.status === core.WU_STATUS.READY ||
          wu.status === core.WU_STATUS.BACKLOG ||
          wu.status === core.WU_STATUS.TODO) &&
        daysSinceActivity > staleDaysReady;

      if (isInProgressStale || isReadyLikeStale) {
        staleCandidates.push(wu);
      } else {
        healthyCandidates.push(wu);
      }
    }

    let taggedCount = 0;
    if (!dryRun) {
      const noteDate = new Date().toISOString().slice(0, 10);
      for (const staleWu of staleCandidates) {
        try {
          const wuDoc = core.readWURaw(staleWu.filePath);
          core.appendNote(wuDoc, `[${noteDate}] ${STATE_RUNTIME_CONSTANTS.STALE_NOTE_TEMPLATE}`);
          core.writeWU(staleWu.filePath, wuDoc);
          taggedCount += 1;
        } catch {
          continue;
        }
      }
    }

    return createSuccessOutput({
      dry_run: dryRun,
      total_wus: wuDocuments.length,
      stale_count: staleCandidates.length,
      stale_ids: staleCandidates.map((wu) => wu.id),
      archivable_count: archivableCandidates.length,
      archivable_ids: archivableCandidates.map((wu) => wu.id),
      healthy_count: healthyCandidates.length,
      tagged_count: taggedCount,
    });
  } catch (cause) {
    return createFailureOutput(
      STATE_TOOL_ERROR_CODES.BACKLOG_PRUNE_FAILED,
      (cause as Error).message,
    );
  }
};

const stateBootstrapInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = STATE_BOOTSTRAP_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(STATE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  try {
    const core = await getCoreLazy();
    const workspaceRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot: workspaceRoot });
    const wuDir = parsedInput.data.wu_dir
      ? path.resolve(workspaceRoot, parsedInput.data.wu_dir)
      : path.join(workspaceRoot, config.directories.wuDir);
    const stateDir = parsedInput.data.state_dir
      ? path.resolve(workspaceRoot, parsedInput.data.state_dir)
      : path.join(workspaceRoot, config.state.stateDir);
    const dryRun = normalizeDryRun(parsedInput.data.execute, parsedInput.data.dry_run);
    const force = parsedInput.data.force ?? false;
    const eventsFilePath = path.join(stateDir, STATE_RUNTIME_CONSTANTS.WU_EVENTS_FILE_NAME);

    const wuDocuments = await loadWuLifecycleDocuments(core, wuDir);
    const bootstrapEvents = wuDocuments
      .flatMap((wu) => inferBootstrapEvents(core, wu))
      .sort((left, right) => {
        return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
      });

    if (!dryRun) {
      const existingStateFile = await getPathInfo(eventsFilePath);
      if (existingStateFile.exists && !force) {
        return createFailureOutput(
          STATE_TOOL_ERROR_CODES.STATE_BOOTSTRAP_FAILED,
          `State file already exists: ${eventsFilePath}. Use --force to overwrite.`,
        );
      }

      await mkdir(stateDir, { recursive: true });
      const payload =
        bootstrapEvents.map((event) => JSON.stringify(event)).join('\n') +
        (bootstrapEvents.length > 0 ? '\n' : '');
      await writeFile(eventsFilePath, payload, UTF8_ENCODING);
    }

    return createSuccessOutput({
      dry_run: dryRun,
      events_generated: bootstrapEvents.length,
      events_written: dryRun ? 0 : bootstrapEvents.length,
      skipped: 0,
      warnings:
        wuDocuments.length === 0 ? [STATE_RUNTIME_MESSAGES.WU_DIRECTORY_EMPTY_OR_MISSING] : [],
    });
  } catch (cause) {
    return createFailureOutput(
      STATE_TOOL_ERROR_CODES.STATE_BOOTSTRAP_FAILED,
      (cause as Error).message,
    );
  }
};

const stateCleanupInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = STATE_CLEANUP_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(STATE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  const exclusiveFlags = [
    parsedInput.data.signals_only,
    parsedInput.data.memory_only,
    parsedInput.data.events_only,
  ].filter(Boolean);
  if (exclusiveFlags.length > 1) {
    return createFailureOutput(
      STATE_TOOL_ERROR_CODES.INVALID_INPUT,
      STATE_RUNTIME_MESSAGES.MUTUALLY_EXCLUSIVE_CLEANUP_FLAGS,
    );
  }

  try {
    const core = await getCoreLazy();
    const memory = await getMemoryLazy();
    const projectRoot = resolveCommandBaseDir(context, parsedInput.data.base_dir);

    const result = await core.cleanupState(projectRoot, {
      dryRun: parsedInput.data.dry_run,
      signalsOnly: parsedInput.data.signals_only,
      memoryOnly: parsedInput.data.memory_only,
      eventsOnly: parsedInput.data.events_only,
      cleanupSignals: async (dir, options) =>
        memory.cleanupSignals(dir, {
          dryRun: options.dryRun,
          getActiveWuIds: () => listActiveWuIds(dir),
        }),
      cleanupMemory: async (dir, options) =>
        memory.cleanupMemory(dir, {
          dryRun: options.dryRun,
        }),
      archiveEvents: async (dir, options) =>
        core.archiveWuEvents(dir, {
          dryRun: options.dryRun,
        }),
    });

    return createSuccessOutput(result);
  } catch (cause) {
    return createFailureOutput(
      STATE_TOOL_ERROR_CODES.STATE_CLEANUP_FAILED,
      (cause as Error).message,
    );
  }
};

const stateDoctorInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = STATE_DOCTOR_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(STATE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveCommandBaseDir(context, parsedInput.data.base_dir);
    const deps = buildStateDoctorDeps(core, projectRoot);
    const diagnosis = await core.diagnoseState(projectRoot, deps, {
      fix: parsedInput.data.fix,
      dryRun: parsedInput.data.dry_run,
    });
    return createSuccessOutput(diagnosis);
  } catch (cause) {
    return createFailureOutput(
      STATE_TOOL_ERROR_CODES.STATE_DOCTOR_FAILED,
      (cause as Error).message,
    );
  }
};

const signalCleanupInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = SIGNAL_CLEANUP_INPUT_SCHEMA.safeParse(rawInput);
  if (!parsedInput.success) {
    return createFailureOutput(STATE_TOOL_ERROR_CODES.INVALID_INPUT, parsedInput.error.message);
  }

  try {
    const memory = await getMemoryLazy();
    const projectRoot = resolveCommandBaseDir(context, parsedInput.data.base_dir);
    const result = await memory.cleanupSignals(projectRoot, {
      dryRun: parsedInput.data.dry_run,
      ttl: parsedInput.data.ttl,
      unreadTtl: parsedInput.data.unread_ttl,
      maxEntries: parsedInput.data.max_entries,
      getActiveWuIds: () => listActiveWuIds(projectRoot),
    });

    return createSuccessOutput(result);
  } catch (cause) {
    return createFailureOutput(
      STATE_TOOL_ERROR_CODES.SIGNAL_CLEANUP_FAILED,
      (cause as Error).message,
    );
  }
};

// --- WU-1802: Validation/Lane in-process handler implementations ---

const VALIDATION_TOOL_ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATE_ERROR: 'VALIDATE_ERROR',
  VALIDATE_AGENT_SKILLS_ERROR: 'VALIDATE_AGENT_SKILLS_ERROR',
  VALIDATE_AGENT_SYNC_ERROR: 'VALIDATE_AGENT_SYNC_ERROR',
  VALIDATE_BACKLOG_SYNC_ERROR: 'VALIDATE_BACKLOG_SYNC_ERROR',
  VALIDATE_SKILLS_SPEC_ERROR: 'VALIDATE_SKILLS_SPEC_ERROR',
  LUMENFLOW_VALIDATE_ERROR: 'LUMENFLOW_VALIDATE_ERROR',
  LANE_HEALTH_ERROR: 'LANE_HEALTH_ERROR',
  LANE_SUGGEST_ERROR: 'LANE_SUGGEST_ERROR',
  WU_STATUS_ERROR: 'WU_STATUS_ERROR',
  WU_CREATE_ERROR: 'WU_CREATE_ERROR',
  WU_CLAIM_ERROR: 'WU_CLAIM_ERROR',
  WU_PROTO_ERROR: 'WU_PROTO_ERROR',
  WU_DONE_ERROR: 'WU_DONE_ERROR',
  WU_PREP_ERROR: 'WU_PREP_ERROR',
  WU_SANDBOX_ERROR: 'WU_SANDBOX_ERROR',
  WU_PRUNE_ERROR: 'WU_PRUNE_ERROR',
  WU_DELETE_ERROR: 'WU_DELETE_ERROR',
  WU_CLEANUP_ERROR: 'WU_CLEANUP_ERROR',
  WU_BRIEF_ERROR: 'WU_BRIEF_ERROR',
  WU_DELEGATE_ERROR: 'WU_DELEGATE_ERROR',
  WU_UNLOCK_LANE_ERROR: 'WU_UNLOCK_LANE_ERROR',
  AGENT_SESSION_ERROR: 'AGENT_SESSION_ERROR',
  AGENT_SESSION_END_ERROR: 'AGENT_SESSION_END_ERROR',
  AGENT_LOG_ISSUE_ERROR: 'AGENT_LOG_ISSUE_ERROR',
  AGENT_ISSUES_QUERY_ERROR: 'AGENT_ISSUES_QUERY_ERROR',
  LUMENFLOW_INIT_ERROR: 'LUMENFLOW_INIT_ERROR',
  LUMENFLOW_DOCTOR_ERROR: 'LUMENFLOW_DOCTOR_ERROR',
  LUMENFLOW_INTEGRATE_ERROR: 'LUMENFLOW_INTEGRATE_ERROR',
  LUMENFLOW_UPGRADE_ERROR: 'LUMENFLOW_UPGRADE_ERROR',
  LUMENFLOW_RELEASE_ERROR: 'LUMENFLOW_RELEASE_ERROR',
  DOCS_SYNC_ERROR: 'DOCS_SYNC_ERROR',
  SYNC_TEMPLATES_ALIAS_ERROR: 'SYNC_TEMPLATES_ALIAS_ERROR',
  PLAN_CREATE_ERROR: 'PLAN_CREATE_ERROR',
  PLAN_EDIT_ERROR: 'PLAN_EDIT_ERROR',
  PLAN_LINK_ERROR: 'PLAN_LINK_ERROR',
  PLAN_PROMOTE_ERROR: 'PLAN_PROMOTE_ERROR',
  GATES_ERROR: 'GATES_ERROR',
  INITIATIVE_LIST_ERROR: 'INITIATIVE_LIST_ERROR',
  INITIATIVE_STATUS_ERROR: 'INITIATIVE_STATUS_ERROR',
  INITIATIVE_CREATE_ERROR: 'INITIATIVE_CREATE_ERROR',
  INITIATIVE_EDIT_ERROR: 'INITIATIVE_EDIT_ERROR',
  INITIATIVE_ADD_WU_ERROR: 'INITIATIVE_ADD_WU_ERROR',
  INITIATIVE_REMOVE_WU_ERROR: 'INITIATIVE_REMOVE_WU_ERROR',
  INITIATIVE_BULK_ASSIGN_ERROR: 'INITIATIVE_BULK_ASSIGN_ERROR',
  INITIATIVE_PLAN_ERROR: 'INITIATIVE_PLAN_ERROR',
  INIT_PLAN_ERROR: 'INIT_PLAN_ERROR',
  ORCHESTRATE_INITIATIVE_ERROR: 'ORCHESTRATE_INITIATIVE_ERROR',
  MEM_INIT_ERROR: 'MEM_INIT_ERROR',
  MEM_START_ERROR: 'MEM_START_ERROR',
  MEM_READY_ERROR: 'MEM_READY_ERROR',
  MEM_CHECKPOINT_ERROR: 'MEM_CHECKPOINT_ERROR',
  MEM_CLEANUP_ERROR: 'MEM_CLEANUP_ERROR',
  MEM_CONTEXT_ERROR: 'MEM_CONTEXT_ERROR',
  MEM_CREATE_ERROR: 'MEM_CREATE_ERROR',
  MEM_DELETE_ERROR: 'MEM_DELETE_ERROR',
  MEM_EXPORT_ERROR: 'MEM_EXPORT_ERROR',
  MEM_INBOX_ERROR: 'MEM_INBOX_ERROR',
  MEM_SIGNAL_ERROR: 'MEM_SIGNAL_ERROR',
  MEM_SUMMARIZE_ERROR: 'MEM_SUMMARIZE_ERROR',
  MEM_TRIAGE_ERROR: 'MEM_TRIAGE_ERROR',
  MEM_RECOVER_ERROR: 'MEM_RECOVER_ERROR',
  WU_BLOCK_ERROR: 'WU_BLOCK_ERROR',
  WU_UNBLOCK_ERROR: 'WU_UNBLOCK_ERROR',
  WU_EDIT_ERROR: 'WU_EDIT_ERROR',
  WU_RELEASE_ERROR: 'WU_RELEASE_ERROR',
  WU_RECOVER_ERROR: 'WU_RECOVER_ERROR',
  WU_REPAIR_ERROR: 'WU_REPAIR_ERROR',
  WU_DEPS_ERROR: 'WU_DEPS_ERROR',
  WU_PREFLIGHT_ERROR: 'WU_PREFLIGHT_ERROR',
  WU_VALIDATE_ERROR: 'WU_VALIDATE_ERROR',
  WU_INFER_LANE_ERROR: 'WU_INFER_LANE_ERROR',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
} as const;

const VALIDATION_TOOL_MESSAGES = {
  VALIDATE_PASSED: 'Validation passed',
  VALIDATE_INVALID_WU: 'Invalid WU',
  NO_WU_DIR: 'No WU directory found, skipping',
  NO_SKILLS_DIR: 'No skills directory found, skipping',
  NO_AGENTS_DIR: 'No agents directory found, skipping',
  AGENT_SKILLS_FAILED: 'Agent skills validation failed',
  AGENT_SYNC_FAILED: 'Agent sync validation failed',
  EMPTY_FILE: 'empty file',
  EMPTY_AGENT_CONFIG: 'empty agent config',
  EMPTY_SKILLS_SPEC: 'empty skills spec',
  BACKLOG_SYNC_VALID: 'Backlog sync valid',
  BACKLOG_SYNC_FAILED: 'Backlog sync validation failed',
  SKILLS_SPEC_FAILED: 'Skills spec validation failed',
  LANE_HEALTH_PASSED: 'Lane health check complete',
  WU_BLOCK_PASSED: 'WU blocked successfully',
  WU_UNBLOCK_PASSED: 'WU unblocked successfully',
  WU_EDIT_PASSED: 'WU edited successfully',
  WU_RELEASE_PASSED: 'WU released successfully',
  WU_RELEASE_NO_REASON: 'No reason provided',
} as const;

/** WU-1856: Single function replaces PREFIX/SUFFIX constant fragmentation. */
function validationCountMsg(label: string, count: number): string {
  return `${label}: ${count} checked`;
}

const VALIDATION_TOOL_FILE_EXTENSIONS = ['.md', '.yaml', '.yml'] as const;
const WU_FILE_EXTENSIONS = ['.yaml', '.yml'] as const;

const VALIDATE_INPUT_SCHEMA = z.object({
  id: z.string().optional(),
  strict: z.boolean().optional(),
  done_only: z.boolean().optional(),
});

const VALIDATE_AGENT_SKILLS_INPUT_SCHEMA = z.object({
  skill: z.string().optional(),
});

const VALIDATE_AGENT_SYNC_INPUT_SCHEMA = z.object({});

const VALIDATE_BACKLOG_SYNC_INPUT_SCHEMA = z.object({});

const VALIDATE_SKILLS_SPEC_INPUT_SCHEMA = z.object({});

const LANE_HEALTH_INPUT_SCHEMA = z.object({
  json: z.boolean().optional(),
  verbose: z.boolean().optional(),
  no_coverage: z.boolean().optional(),
});

const LANE_SUGGEST_INPUT_SCHEMA = z.object({
  dry_run: z.boolean().optional(),
  interactive: z.boolean().optional(),
  output: z.string().optional(),
  json: z.boolean().optional(),
  no_llm: z.boolean().optional(),
  include_git: z.boolean().optional(),
});

/** Helper: filter files by validation-relevant extensions */
function hasValidationExtension(filename: string): boolean {
  return VALIDATION_TOOL_FILE_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

/** Helper: filter files by WU YAML extensions */
function hasWUExtension(filename: string): boolean {
  return WU_FILE_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

/** Helper: extract Zod issue messages from safeParse error */
function formatZodIssues(zodError: { issues?: ReadonlyArray<{ message: string }> }): string {
  return (
    zodError.issues?.map((i) => i.message).join('; ') ??
    VALIDATION_TOOL_MESSAGES.VALIDATE_INVALID_WU
  );
}

/**
 * validate handler — delegates to @lumenflow/core validateWU per file
 */
const validateInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = VALIDATE_INPUT_SCHEMA.safeParse(rawInput ?? {});
  if (!parsedInput.success) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const wuDir = path.join(projectRoot, config.directories.wuDir);

    if (parsedInput.data.id) {
      const wuPath = path.join(wuDir, `${parsedInput.data.id}.yaml`);
      const result = core.validateWU(core.parseYAML(await readFile(wuPath, UTF8_ENCODING)));
      return result.success
        ? createSuccessOutput({
            message: `${parsedInput.data.id} ${VALIDATION_TOOL_MESSAGES.VALIDATE_PASSED}`,
          })
        : createFailureOutput(
            VALIDATION_TOOL_ERROR_CODES.VALIDATE_ERROR,
            formatZodIssues(result.error),
          );
    }

    // validateAllWUs is not exported from core — inline the aggregation
    let files: string[];
    try {
      files = (await readdir(wuDir)).filter(hasWUExtension);
    } catch {
      return createSuccessOutput({ message: VALIDATION_TOOL_MESSAGES.NO_WU_DIR });
    }

    let totalValid = 0;
    let totalInvalid = 0;
    const errors: string[] = [];
    const STATUS_DONE = 'done';
    for (const file of files) {
      const content = await readFile(path.join(wuDir, file), UTF8_ENCODING);
      const parsed = core.parseYAML(content);
      if (parsedInput.data.done_only) {
        if (
          parsed &&
          typeof parsed === 'object' &&
          'status' in parsed &&
          parsed.status !== STATUS_DONE
        )
          continue;
      }
      const result = core.validateWU(parsed);
      if (result.success) {
        totalValid++;
      } else {
        totalInvalid++;
        errors.push(`${file}: ${formatZodIssues(result.error)}`);
      }
    }

    if (totalInvalid === 0) {
      return createSuccessOutput({
        message: `${VALIDATION_TOOL_MESSAGES.VALIDATE_PASSED}: ${totalValid} valid`,
        totalValid,
      });
    }
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.VALIDATE_ERROR,
      `${totalInvalid} invalid of ${totalValid + totalInvalid} total\n${errors.join('\n')}`,
    );
  } catch (err) {
    return createFailureOutput(VALIDATION_TOOL_ERROR_CODES.VALIDATE_ERROR, (err as Error).message);
  }
};

/**
 * validate:agent-skills handler — scans configured skill YAML files for required fields
 */
const validateAgentSkillsInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = VALIDATE_AGENT_SKILLS_INPUT_SCHEMA.safeParse(rawInput ?? {});
  if (!parsedInput.success) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const skillsDir = path.join(projectRoot, config.directories.skillsDir);

    let skillFiles: string[];
    try {
      skillFiles = (await readdir(skillsDir)).filter(hasValidationExtension);
    } catch {
      return createSuccessOutput({ message: VALIDATION_TOOL_MESSAGES.NO_SKILLS_DIR, valid: true });
    }

    if (parsedInput.data.skill) {
      skillFiles = skillFiles.filter((f) => f.includes(parsedInput.data.skill as string));
    }

    const issues: string[] = [];
    for (const file of skillFiles) {
      const content = await readFile(path.join(skillsDir, file), UTF8_ENCODING);
      if (content.trim().length === 0) {
        issues.push(`${file}: ${VALIDATION_TOOL_MESSAGES.EMPTY_FILE}`);
      }
    }

    if (issues.length > 0) {
      return createFailureOutput(
        VALIDATION_TOOL_ERROR_CODES.VALIDATE_AGENT_SKILLS_ERROR,
        `${VALIDATION_TOOL_MESSAGES.AGENT_SKILLS_FAILED}:\n${issues.join('\n')}`,
      );
    }
    return createSuccessOutput({
      message: validationCountMsg('Agent skills valid', skillFiles.length),
      valid: true,
      count: skillFiles.length,
    });
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.VALIDATE_AGENT_SKILLS_ERROR,
      (err as Error).message,
    );
  }
};

/**
 * validate:agent-sync handler — checks agent config files are in sync
 */
const validateAgentSyncInProcess: InProcessToolFn = async (_rawInput, context) => {
  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const agentsDir = path.join(projectRoot, config.directories.agentsDir);

    let agentFiles: string[];
    try {
      agentFiles = (await readdir(agentsDir)).filter(hasValidationExtension);
    } catch {
      return createSuccessOutput({ message: VALIDATION_TOOL_MESSAGES.NO_AGENTS_DIR, valid: true });
    }

    const issues: string[] = [];
    for (const file of agentFiles) {
      const content = await readFile(path.join(agentsDir, file), UTF8_ENCODING);
      if (content.trim().length === 0) {
        issues.push(`${file}: ${VALIDATION_TOOL_MESSAGES.EMPTY_AGENT_CONFIG}`);
      }
    }

    if (issues.length > 0) {
      return createFailureOutput(
        VALIDATION_TOOL_ERROR_CODES.VALIDATE_AGENT_SYNC_ERROR,
        `${VALIDATION_TOOL_MESSAGES.AGENT_SYNC_FAILED}:\n${issues.join('\n')}`,
      );
    }
    return createSuccessOutput({
      message: validationCountMsg('Agent sync valid', agentFiles.length),
      valid: true,
      count: agentFiles.length,
    });
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.VALIDATE_AGENT_SYNC_ERROR,
      (err as Error).message,
    );
  }
};

/**
 * validate:backlog-sync handler — delegates to @lumenflow/core validateBacklogSync
 */
const validateBacklogSyncInProcess: InProcessToolFn = async (_rawInput, context) => {
  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const backlogFilePath = path.join(projectRoot, config.directories.backlogPath);

    const result = core.validateBacklogSync(backlogFilePath);
    if (result.valid) {
      return createSuccessOutput({
        message: VALIDATION_TOOL_MESSAGES.BACKLOG_SYNC_VALID,
        ...result,
      });
    }
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.VALIDATE_BACKLOG_SYNC_ERROR,
      result.errors?.join('\n') ?? VALIDATION_TOOL_MESSAGES.BACKLOG_SYNC_FAILED,
    );
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.VALIDATE_BACKLOG_SYNC_ERROR,
      (err as Error).message,
    );
  }
};

/**
 * validate:skills-spec handler — validates configured skills specification YAML files
 */
const validateSkillsSpecInProcess: InProcessToolFn = async (_rawInput, context) => {
  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const skillsDir = path.join(projectRoot, config.directories.skillsDir);

    let skillFiles: string[];
    try {
      skillFiles = (await readdir(skillsDir)).filter(hasValidationExtension);
    } catch {
      return createSuccessOutput({ message: VALIDATION_TOOL_MESSAGES.NO_SKILLS_DIR, valid: true });
    }

    const issues: string[] = [];
    for (const file of skillFiles) {
      const filePath = path.join(skillsDir, file);
      const fileStat = await stat(filePath);
      if (fileStat.size === 0) {
        issues.push(`${file}: ${VALIDATION_TOOL_MESSAGES.EMPTY_SKILLS_SPEC}`);
      }
    }

    if (issues.length > 0) {
      return createFailureOutput(
        VALIDATION_TOOL_ERROR_CODES.VALIDATE_SKILLS_SPEC_ERROR,
        `${VALIDATION_TOOL_MESSAGES.SKILLS_SPEC_FAILED}:\n${issues.join('\n')}`,
      );
    }
    return createSuccessOutput({
      message: validationCountMsg('Skills spec valid', skillFiles.length),
      valid: true,
      count: skillFiles.length,
    });
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.VALIDATE_SKILLS_SPEC_ERROR,
      (err as Error).message,
    );
  }
};

/**
 * lane:health handler — delegates to @lumenflow/core lane checker
 */
const laneHealthInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = LANE_HEALTH_INPUT_SCHEMA.safeParse(rawInput ?? {});
  if (!parsedInput.success) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const laneConfigMap = resolveLanePolicyConfig(config);
    const allWUs = await core.listWUs({ projectRoot });

    const laneOccupancy: Record<string, { in_progress: string[]; blocked: string[] }> = {};
    for (const wu of allWUs) {
      if (!wu.lane) continue;
      const existing = laneOccupancy[wu.lane];
      const entry = existing ?? { in_progress: [], blocked: [] };
      if (!existing) {
        laneOccupancy[wu.lane] = entry;
      }
      if (wu.status === STATUS_IN_PROGRESS) {
        entry.in_progress.push(wu.id);
      } else if (wu.status === STATUS_BLOCKED) {
        entry.blocked.push(wu.id);
      }
    }

    const overlaps: string[] = [];
    const lanes = Object.keys(laneConfigMap);
    for (const lane of lanes) {
      const occupancy = laneOccupancy[lane];
      const lanePolicy = laneConfigMap[lane];
      if (!occupancy || !lanePolicy) continue;
      if (
        lanePolicy.lockPolicy !== LOCK_POLICY_NONE &&
        occupancy.in_progress.length > lanePolicy.wipLimit
      ) {
        overlaps.push(
          `${lane}: ${occupancy.in_progress.length} in-progress (limit ${lanePolicy.wipLimit})`,
        );
      }
    }

    const healthResult = {
      lanes: Object.keys(laneConfigMap).length,
      occupied: Object.keys(laneOccupancy).length,
      overlaps,
      lane_details: Object.entries(laneConfigMap).map(([name, cfg]) => ({
        name,
        policy: cfg.lockPolicy,
        wip_limit: cfg.wipLimit,
        in_progress: laneOccupancy[name]?.in_progress.length ?? 0,
        blocked: laneOccupancy[name]?.blocked.length ?? 0,
      })),
    };

    if (overlaps.length > 0) {
      return createFailureOutput(
        VALIDATION_TOOL_ERROR_CODES.LANE_HEALTH_ERROR,
        overlaps.join('\n'),
      );
    }
    return createSuccessOutput({
      message: VALIDATION_TOOL_MESSAGES.LANE_HEALTH_PASSED,
      ...healthResult,
    });
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.LANE_HEALTH_ERROR,
      (err as Error).message,
    );
  }
};

/**
 * lane:suggest handler — generates lane suggestions from codebase context
 */
const laneSuggestInProcess: InProcessToolFn = async (rawInput, context) => {
  const parsedInput = LANE_SUGGEST_INPUT_SCHEMA.safeParse(rawInput ?? {});
  if (!parsedInput.success) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.INVALID_INPUT,
      parsedInput.error.message,
    );
  }

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);
    const config = core.getConfig({ projectRoot });
    const laneConfigMap = resolveLanePolicyConfig(config);
    const existingLanes = Object.keys(laneConfigMap);

    // WU-1856: Use core's real filesystem scanner instead of empty stub.
    // Override existingLanes with policy-resolved lanes (more authoritative).
    const projectContext = core.gatherProjectContext(projectRoot);
    projectContext.existingLanes = existingLanes;
    const suggestions = core.getDefaultSuggestions(projectContext);

    return createSuccessOutput({
      message: validationCountMsg('Lane suggestions generated', suggestions.length),
      suggestions,
      existing_lanes: existingLanes,
    });
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.LANE_SUGGEST_ERROR,
      (err as Error).message,
    );
  }
};

/**
 * WU-1805: WU query in-process handlers
 */
const WU_QUERY_MESSAGES = {
  ID_REQUIRED: 'id parameter is required',
  RUNTIME_CLI_FALLBACK: 'Runtime in-process path not available; falling back to CLI',
  STATUS_FAILED: 'wu:status failed',
  PREFLIGHT_PASSED: 'Preflight checks passed',
  PREFLIGHT_FAILED: 'wu:preflight failed',
  VALIDATE_PASSED: 'WU is valid',
  VALIDATE_FAILED: 'wu:validate failed',
  INFER_LANE_FAILED: 'wu:infer-lane failed',
} as const;

const lumenflowInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.LUMENFLOW_INIT_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const lumenflowDoctorInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.LUMENFLOW_DOCTOR_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const lumenflowIntegrateInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.LUMENFLOW_INTEGRATE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const lumenflowUpgradeInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.LUMENFLOW_UPGRADE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const lumenflowReleaseInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.LUMENFLOW_RELEASE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const docsSyncInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.DOCS_SYNC_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const syncTemplatesInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.SYNC_TEMPLATES_ALIAS_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const planCreateInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.PLAN_CREATE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const planEditInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.PLAN_EDIT_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const planLinkInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.PLAN_LINK_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const planPromoteInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.PLAN_PROMOTE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeListInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_LIST_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeStatusInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_STATUS_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeCreateInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_CREATE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeEditInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_EDIT_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeAddWuInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_ADD_WU_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeRemoveWuInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_REMOVE_WU_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativeBulkAssignInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_BULK_ASSIGN_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initiativePlanInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INITIATIVE_PLAN_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const initPlanInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.INIT_PLAN_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const orchestrateInitiativeInProcess: InProcessToolFn = async () =>
  createFailureOutput(
    VALIDATION_TOOL_ERROR_CODES.ORCHESTRATE_INITIATIVE_ERROR,
    WU_QUERY_MESSAGES.RUNTIME_CLI_FALLBACK,
  );

const wuInferLaneInProcess: InProcessToolFn = async (rawInput, context) => {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  try {
    const core = await getCoreLazy();
    const projectRoot = resolveWorkspaceRoot(context);

    let codePaths: string[] = [];
    let description = '';

    if (Array.isArray(input.paths)) {
      codePaths = input.paths.filter((p): p is string => typeof p === 'string');
    }
    if (typeof input.desc === 'string') {
      description = input.desc;
    }

    // If id provided and no explicit paths, read from WU YAML
    if (typeof input.id === 'string' && codePaths.length === 0) {
      const config = core.getConfig({ projectRoot });
      const wuFile = path.join(projectRoot, config.directories.wuDir, `${input.id}.yaml`);
      try {
        const content = await readFile(wuFile, UTF8_ENCODING);
        const parsed = core.parseYAML(content);
        if (parsed && typeof parsed === 'object') {
          const wuData = parsed as Record<string, unknown>;
          if (Array.isArray(wuData.code_paths)) {
            codePaths = wuData.code_paths.filter((p): p is string => typeof p === 'string');
          }
          if (!description && typeof wuData.description === 'string') {
            description = wuData.description;
          }
        }
      } catch {
        // WU file not found or unreadable — continue with provided inputs
      }
    }

    const result = core.inferSubLane(codePaths, description);
    return createSuccessOutput({ lane: result.lane, confidence: result.confidence });
  } catch (err) {
    return createFailureOutput(
      VALIDATION_TOOL_ERROR_CODES.WU_INFER_LANE_ERROR,
      (err as Error).message,
    );
  }
};

// WU-1897: These in-process implementations are retained temporarily for
// reference parity but are intentionally removed from resolver registration.
const retiredWu1897InProcessHandlers = [
  lumenflowInProcess,
  lumenflowDoctorInProcess,
  lumenflowIntegrateInProcess,
  lumenflowUpgradeInProcess,
  lumenflowReleaseInProcess,
  docsSyncInProcess,
  syncTemplatesInProcess,
  planCreateInProcess,
  planEditInProcess,
  planLinkInProcess,
  planPromoteInProcess,
  initiativeListInProcess,
  initiativeStatusInProcess,
  initiativeCreateInProcess,
  initiativeEditInProcess,
  initiativeAddWuInProcess,
  initiativeRemoveWuInProcess,
  initiativeBulkAssignInProcess,
  initiativePlanInProcess,
  initPlanInProcess,
  orchestrateInitiativeInProcess,
  orchestrateInitStatusInProcess,
  orchestrateMonitorInProcess,
  delegationListInProcess,
] as const;
void retiredWu1897InProcessHandlers;

// WU-1890: Remaining file/git/state/validation/lane surfaces are now migrated to
// pack handler implementations. Keep legacy implementations for reference parity.
const retiredWu1890InProcessHandlers = [
  wuInferLaneInProcess,
  fileReadInProcess,
  fileWriteInProcess,
  fileEditInProcess,
  fileDeleteInProcess,
  backlogPruneInProcess,
  stateBootstrapInProcess,
  stateCleanupInProcess,
  stateDoctorInProcess,
  signalCleanupInProcess,
  validateInProcess,
  validateAgentSkillsInProcess,
  validateAgentSyncInProcess,
  validateBacklogSyncInProcess,
  validateSkillsSpecInProcess,
  laneHealthInProcess,
  laneSuggestInProcess,
] as const;
void retiredWu1890InProcessHandlers;

const retiredWu1890InProcessSchemas = [
  DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
  VALIDATE_INPUT_SCHEMA,
  FILE_READ_INPUT_SCHEMA,
  FILE_READ_OUTPUT_SCHEMA,
  FILE_WRITE_INPUT_SCHEMA,
  FILE_WRITE_OUTPUT_SCHEMA,
  FILE_EDIT_INPUT_SCHEMA,
  FILE_EDIT_OUTPUT_SCHEMA,
  FILE_DELETE_INPUT_SCHEMA,
  FILE_DELETE_OUTPUT_SCHEMA,
  BACKLOG_PRUNE_INPUT_SCHEMA,
  STATE_BOOTSTRAP_INPUT_SCHEMA,
  STATE_CLEANUP_INPUT_SCHEMA,
  STATE_DOCTOR_INPUT_SCHEMA,
  SIGNAL_CLEANUP_INPUT_SCHEMA,
  VALIDATE_AGENT_SKILLS_INPUT_SCHEMA,
  VALIDATE_AGENT_SYNC_INPUT_SCHEMA,
  VALIDATE_BACKLOG_SYNC_INPUT_SCHEMA,
  VALIDATE_SKILLS_SPEC_INPUT_SCHEMA,
  LANE_HEALTH_INPUT_SCHEMA,
  LANE_SUGGEST_INPUT_SCHEMA,
] as const;
void retiredWu1890InProcessSchemas;

const registeredInProcessToolHandlers = new Map<string, RegisteredInProcessToolHandler>([
  // WU-1905: flow:bottlenecks, flow:report, metrics:snapshot, metrics, and lumenflow:metrics
  // have been migrated to pack handler implementations. Their resolver registrations
  // are removed; they now execute through the pack handler path.
  [
    'context:get',
    {
      description: 'Get current LumenFlow context via in-process computation',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: contextGetHandler,
    },
  ],
  [
    'wu:list',
    {
      description: 'List WUs via in-process state store + YAML merge',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: wuListHandler,
    },
  ],
]);

export function isInProcessPackToolRegistered(toolName: string): boolean {
  return registeredInProcessToolHandlers.has(toolName);
}

export function listInProcessPackTools(): string[] {
  return [...registeredInProcessToolHandlers.keys()].sort();
}

export const packToolCapabilityResolver: RuntimeToolCapabilityResolver = async (input) => {
  const registeredHandler = registeredInProcessToolHandlers.get(input.tool.name);
  if (!registeredHandler) {
    return defaultRuntimeToolCapabilityResolver(input);
  }

  return {
    name: input.tool.name,
    domain: input.loadedPack.manifest.id,
    version: input.loadedPack.manifest.version,
    input_schema: registeredHandler.inputSchema,
    output_schema: registeredHandler.outputSchema,
    permission: input.tool.permission,
    required_scopes: input.tool.required_scopes,
    handler: {
      kind: TOOL_HANDLER_KINDS.IN_PROCESS,
      fn: registeredHandler.fn,
    },
    description: registeredHandler.description,
    pack: input.loadedPack.pin.id,
  };
};
