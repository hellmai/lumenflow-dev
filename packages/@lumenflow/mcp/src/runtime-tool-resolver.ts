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
import type {
  DependencyGraph as MetricsDependencyGraph,
  GateTelemetryEvent,
  LLMTelemetryEvent,
  MetricsSnapshotType,
  WUMetrics,
} from '@lumenflow/metrics';
import type { ListWUsOptions } from '@lumenflow/core';
import { z } from 'zod';
import {
  STATE_RUNTIME_CONSTANTS,
  STATE_RUNTIME_EVENT_TYPES,
  STATE_RUNTIME_MESSAGES,
} from './runtime-tool-resolver.constants.js';

const DEFAULT_IN_PROCESS_INPUT_SCHEMA = z.record(z.string(), z.unknown());
const DEFAULT_IN_PROCESS_OUTPUT_SCHEMA = z.record(z.string(), z.unknown());

const RUNTIME_TOOL_NOT_MIGRATED_CODE = 'RUNTIME_TOOL_NOT_MIGRATED';
const RUNTIME_TOOL_NOT_MIGRATED_MESSAGE =
  'Tool is registered for runtime migration but in-process implementation has not landed yet.';
const RUNTIME_PROJECT_ROOT_METADATA_KEY = 'project_root';
const UTF8_ENCODING = 'utf-8';
const DEFAULT_FILE_READ_MAX_SIZE_BYTES = 10 * 1024 * 1024;

const IN_PROCESS_TOOL_NAMES = {
  WU_STATUS: 'wu:status',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_EDIT: 'file:edit',
  FILE_DELETE: 'file:delete',
  BACKLOG_PRUNE: 'backlog:prune',
  STATE_BOOTSTRAP: 'state:bootstrap',
  STATE_CLEANUP: 'state:cleanup',
  STATE_DOCTOR: 'state:doctor',
  SIGNAL_CLEANUP: 'signal:cleanup',
} as const;

const IN_PROCESS_TOOL_DESCRIPTIONS = {
  WU_STATUS: 'In-process runtime placeholder for wu:status',
  FILE_READ: 'Read file content directly via runtime in-process handler',
  FILE_WRITE: 'Write file content directly via runtime in-process handler',
  FILE_EDIT: 'Edit file content directly via runtime in-process handler',
  FILE_DELETE: 'Delete file content directly via runtime in-process handler',
  BACKLOG_PRUNE: 'Prune backlog WUs via in-process filesystem operations',
  STATE_BOOTSTRAP: 'Bootstrap WU events via in-process filesystem operations',
  STATE_CLEANUP: 'Cleanup state/memory/signal files via in-process core handlers',
  STATE_DOCTOR: 'Diagnose state integrity via in-process core handlers',
  SIGNAL_CLEANUP: 'Cleanup stale signals via in-process memory handlers',
} as const;

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
let metricsModule: typeof import('@lumenflow/metrics') | null = null;
async function getMetrics() {
  if (!metricsModule) metricsModule = await import('@lumenflow/metrics');
  return metricsModule;
}

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

/**
 * Load WU list entries and convert to WUMetrics shape for @lumenflow/metrics functions.
 */
async function loadWUMetricsFromCore(projectRoot: string): Promise<WUMetrics[]> {
  const core = await getCoreLazy();
  const allWUs = await core.listWUs({ projectRoot });
  return allWUs.map((wu) => ({
    id: wu.id,
    title: wu.title,
    lane: wu.lane,
    status: wu.status as WUMetrics['status'],
  }));
}

// --- WU-1803: Flow/Metrics/Context in-process handler implementations ---

/**
 * flow:bottlenecks handler — delegates to @lumenflow/core (graph) + @lumenflow/metrics (analysis)
 */
const flowBottlenecksHandler: InProcessToolFn = async (rawInput) => {
  try {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const limit = typeof input.limit === 'number' ? input.limit : 10;

    const { buildDependencyGraphAsync } = await import('@lumenflow/core/dependency-graph');
    const metrics = await getMetrics();

    const coreGraph = await buildDependencyGraphAsync();
    const analysis = metrics.getBottleneckAnalysis(
      coreGraph as unknown as MetricsDependencyGraph,
      limit,
    );
    return { success: true, data: analysis };
  } catch (err) {
    return {
      success: false,
      error: { code: 'FLOW_BOTTLENECKS_ERROR', message: (err as Error).message },
    };
  }
};

/**
 * flow:report handler — delegates to @lumenflow/metrics generateFlowReport
 */
const flowReportHandler: InProcessToolFn = async (rawInput) => {
  try {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const metrics = await getMetrics();
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { existsSync } = await import('node:fs');

    const baseDir = process.cwd();
    const days = typeof input.days === 'number' ? input.days : 30;
    const end = input.end ? new Date(input.end as string) : new Date();
    const start = input.start
      ? new Date(input.start as string)
      : new Date(end.getTime() - days * 86_400_000);

    const gatesPath = join(baseDir, metrics.TELEMETRY_PATHS.GATES);
    const llmPath = join(baseDir, metrics.TELEMETRY_PATHS.LLM_CLASSIFICATION);

    const readNDJSON = async <T>(filePath: string): Promise<T[]> => {
      if (!existsSync(filePath)) return [];
      const content = await readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as T;
          } catch {
            return null;
          }
        })
        .filter((item): item is T => item !== null);
    };

    const [gateEvents, llmEvents] = await Promise.all([
      readNDJSON<GateTelemetryEvent>(gatesPath),
      readNDJSON<LLMTelemetryEvent>(llmPath),
    ]);

    const completedWUs = (await loadWUMetricsFromCore(baseDir)).filter(
      (wu) => wu.status === 'done',
    );

    const report = metrics.generateFlowReport({
      gateEvents,
      llmEvents,
      completedWUs,
      dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
    });
    return { success: true, data: report };
  } catch (err) {
    return {
      success: false,
      error: { code: 'FLOW_REPORT_ERROR', message: (err as Error).message },
    };
  }
};

/**
 * metrics:snapshot handler — delegates to @lumenflow/metrics captureMetricsSnapshot
 */
const metricsSnapshotHandler: InProcessToolFn = async () => {
  try {
    const metrics = await getMetrics();
    const wuMetrics = await loadWUMetricsFromCore(process.cwd());

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const snapshot = metrics.captureMetricsSnapshot({
      commits: [],
      wuMetrics,
      skipGatesEntries: [],
      weekStart,
      weekEnd: now,
      type: 'all',
    });
    return { success: true, data: snapshot };
  } catch (err) {
    return {
      success: false,
      error: { code: 'METRICS_SNAPSHOT_ERROR', message: (err as Error).message },
    };
  }
};

/**
 * metrics handler — delegates to @lumenflow/metrics based on subcommand
 */
const metricsHandler: InProcessToolFn = async (rawInput) => {
  try {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const subcommand = (typeof input.subcommand === 'string' ? input.subcommand : 'all') as string;
    const days = typeof input.days === 'number' ? input.days : 7;

    const metrics = await getMetrics();
    const wuMetrics = await loadWUMetricsFromCore(process.cwd());

    if (subcommand === 'flow') {
      const flowState = metrics.calculateFlowState(wuMetrics);
      return { success: true, data: flowState };
    }

    const now = new Date();
    const weekStart = new Date(now.getTime() - days * 86_400_000);

    const snapshot = metrics.captureMetricsSnapshot({
      commits: [],
      wuMetrics,
      skipGatesEntries: [],
      weekStart,
      weekEnd: now,
      type: subcommand as MetricsSnapshotType,
    });
    return { success: true, data: snapshot };
  } catch (err) {
    return {
      success: false,
      error: { code: 'METRICS_ERROR', message: (err as Error).message },
    };
  }
};

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

async function loadWuLifecycleDocuments(core: CoreModule, wuDir: string): Promise<WuLifecycleDocument[]> {
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
          .map((file) =>
            file.slice(0, -1 * STATE_RUNTIME_CONSTANTS.DONE_STAMP_EXTENSION.length),
          );
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

const registeredInProcessToolHandlers = new Map<string, RegisteredInProcessToolHandler>([
  [
    IN_PROCESS_TOOL_NAMES.WU_STATUS,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.WU_STATUS,
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: async () => ({
        success: false,
        error: {
          code: RUNTIME_TOOL_NOT_MIGRATED_CODE,
          message: RUNTIME_TOOL_NOT_MIGRATED_MESSAGE,
        },
      }),
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.FILE_READ,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.FILE_READ,
      inputSchema: FILE_READ_INPUT_SCHEMA,
      outputSchema: FILE_READ_OUTPUT_SCHEMA,
      fn: fileReadInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.FILE_WRITE,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.FILE_WRITE,
      inputSchema: FILE_WRITE_INPUT_SCHEMA,
      outputSchema: FILE_WRITE_OUTPUT_SCHEMA,
      fn: fileWriteInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.FILE_EDIT,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.FILE_EDIT,
      inputSchema: FILE_EDIT_INPUT_SCHEMA,
      outputSchema: FILE_EDIT_OUTPUT_SCHEMA,
      fn: fileEditInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.FILE_DELETE,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.FILE_DELETE,
      inputSchema: FILE_DELETE_INPUT_SCHEMA,
      outputSchema: FILE_DELETE_OUTPUT_SCHEMA,
      fn: fileDeleteInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.BACKLOG_PRUNE,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.BACKLOG_PRUNE,
      inputSchema: BACKLOG_PRUNE_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: backlogPruneInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.STATE_BOOTSTRAP,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.STATE_BOOTSTRAP,
      inputSchema: STATE_BOOTSTRAP_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: stateBootstrapInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.STATE_CLEANUP,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.STATE_CLEANUP,
      inputSchema: STATE_CLEANUP_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: stateCleanupInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.STATE_DOCTOR,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.STATE_DOCTOR,
      inputSchema: STATE_DOCTOR_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: stateDoctorInProcess,
    },
  ],
  [
    IN_PROCESS_TOOL_NAMES.SIGNAL_CLEANUP,
    {
      description: IN_PROCESS_TOOL_DESCRIPTIONS.SIGNAL_CLEANUP,
      inputSchema: SIGNAL_CLEANUP_INPUT_SCHEMA,
      outputSchema: DEFAULT_IN_PROCESS_OUTPUT_SCHEMA,
      fn: signalCleanupInProcess,
    },
  ],
  // WU-1803: Flow/Metrics/Context tool registrations
  [
    'flow:bottlenecks',
    {
      description: 'Identify flow bottlenecks via in-process dependency analysis',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: flowBottlenecksHandler,
    },
  ],
  [
    'flow:report',
    {
      description: 'Generate flow metrics report via in-process telemetry analysis',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: flowReportHandler,
    },
  ],
  [
    'metrics:snapshot',
    {
      description: 'Capture metrics snapshot via in-process WU and DORA analysis',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: metricsSnapshotHandler,
    },
  ],
  [
    'lumenflow:metrics',
    {
      description: 'View workflow metrics via in-process analysis (alias)',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: metricsHandler,
    },
  ],
  [
    'metrics',
    {
      description: 'View workflow metrics via in-process analysis',
      inputSchema: DEFAULT_IN_PROCESS_INPUT_SCHEMA,
      fn: metricsHandler,
    },
  ],
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
