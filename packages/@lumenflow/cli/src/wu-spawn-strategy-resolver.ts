// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Spawn Strategy Resolver
 *
 * Extracted from wu-spawn.ts (WU-1652).
 * Contains client/strategy resolution, lane occupation checks,
 * and CLI argument parsing for wu:brief/wu:delegate commands.
 *
 * @module wu-spawn-strategy-resolver
 */

import { existsSync, readFileSync } from 'node:fs';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { die } from '@lumenflow/core/error-handler';
import { WU_STATUS, PATTERNS, FILE_SYSTEM, EMOJI } from '@lumenflow/core/wu-constants';
// WU-1603: Check lane lock status before spawning
// WU-1325: Import lock policy getter for lane availability check
import { checkLaneLock } from '@lumenflow/core/lane-lock';
import { getLockPolicyForLane, getWipLimitForLane } from '@lumenflow/core/lane-checker';
import {
  validateSpawnArgs,
  recordSpawnToRegistry,
  formatSpawnRecordedMessage,
} from '@lumenflow/core/wu-spawn-helpers';
import { WUStateStore, WU_BRIEF_EVIDENCE_NOTE_PREFIX } from '@lumenflow/core/wu-state-store';
import { SpawnStrategyFactory } from '@lumenflow/core/spawn-strategy';
import { getConfig } from '@lumenflow/core/config';
import { resolveClientConfig } from '@lumenflow/core/wu-spawn-skills';
import {
  validateSpawnDependencies,
  formatDependencyError,
} from '@lumenflow/core/dependency-validator';
import {
  checkMemoryLayerInitialized,
  getMemoryContextMaxSize,
  generateMemoryContextSection,
} from '@lumenflow/core/wu-spawn-context';

import type { WUDocument, SpawnOptions, ClientContext } from './wu-spawn-prompt-builders.js';
import { generateTaskInvocation, generateCodexPrompt } from './wu-spawn-prompt-builders.js';
import { resolveStateDir } from './state-path-resolvers.js';

// Re-export types used by consumers
export type { WUDocument, SpawnOptions, ClientContext };

// Re-export SpawnStrategyFactory for consumers
export { SpawnStrategyFactory };

const BRIEF_LOG_PREFIX = '[wu:brief]';
const DELEGATE_LOG_PREFIX = '[wu:delegate]';
const BRIEF_EVIDENCE_PROGRESS = 'wu:brief executed';

// ─── Lane Occupation ───

/**
 * WU-1603: Check if a lane is currently occupied by another WU
 * WU-1325: Now considers lock_policy - lanes with policy=none are never occupied
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {import('@lumenflow/core/lane-lock').LockMetadata|null} Lock metadata if occupied, null otherwise
 */
export function checkLaneOccupation(
  lane: string,
): ReturnType<typeof checkLaneLock>['metadata'] | null {
  // WU-1325: Lanes with lock_policy=none never report as occupied
  const lockPolicy = getLockPolicyForLane(lane);
  if (lockPolicy === 'none') {
    return null;
  }

  const lockStatus = checkLaneLock(lane);
  if (lockStatus.locked && lockStatus.metadata) {
    return lockStatus.metadata;
  }
  return null;
}

/**
 * WU-1603: Generate a warning message when lane is occupied
 *
 * @param {import('@lumenflow/core/lane-lock').LockMetadata} lockMetadata - Lock metadata
 * @param {string} targetWuId - WU ID being spawned
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.isStale] - Whether the lock is stale (>24h old)
 * @param {number} [options.wipLimit] - WU-1346: Injected WIP limit (for testing)
 * @param {'all' | 'active' | 'none'} [options.lockPolicy] - WU-1346: Injected lock policy (for testing)
 * @returns {string} Warning message
 */
interface LaneOccupationOptions {
  isStale?: boolean;
  /** WU-1346: Injected WIP limit for testing (bypasses config lookup) */
  wipLimit?: number;
  /** WU-1346: Injected lock policy for testing (bypasses config lookup) */
  lockPolicy?: 'all' | 'active' | 'none';
}

export function generateLaneOccupationWarning(
  lockMetadata: { lane: string; wuId: string },
  targetWuId: string,
  options: LaneOccupationOptions = {},
): string {
  const { isStale = false } = options;

  let warning = `⚠️  Lane "${lockMetadata.lane}" is occupied by ${lockMetadata.wuId}\n`;
  // WU-1346: Use injected values if provided, otherwise look up from config
  const lockPolicy = options.lockPolicy ?? getLockPolicyForLane(lockMetadata.lane);
  const wipLimit = options.wipLimit ?? getWipLimitForLane(lockMetadata.lane);

  warning += `   This violates WIP=${wipLimit} (lock_policy=${lockPolicy}).\n\n`;

  if (isStale) {
    warning += `   ⏰ This lock is STALE (>24 hours old) - the WU may be abandoned.\n`;
    warning += `   Consider using pnpm wu:block --id ${lockMetadata.wuId} if work is stalled.\n\n`;
  }

  warning += `   Options:\n`;
  warning += `   1. Wait for ${lockMetadata.wuId} to complete or block\n`;
  warning += `   2. Choose a different lane for ${targetWuId}\n`;
  warning += `   3. Block ${lockMetadata.wuId} if work is stalled: pnpm wu:block --id ${lockMetadata.wuId}`;

  return warning;
}

// ─── CLI Argument Parsing ───

/**
 * Parse and validate CLI arguments
 */
interface ParsedArgs {
  id: string;
  thinking?: boolean;
  noThinking?: boolean;
  budget?: string;
  codex?: boolean;
  parentWu?: string;
  client?: string;
  vendor?: string;
  noContext?: boolean;
}

/**
 * Parser configuration for wu:brief / wu:delegate commands
 */
interface BriefParserConfig {
  /** CLI command name (e.g., 'wu-brief' or 'wu-delegate') */
  name: string;
  /** CLI description shown in --help */
  description: string;
}

const BRIEF_PARSER_CONFIG: BriefParserConfig = {
  name: 'wu-brief',
  description: 'Generate handoff prompt for sub-agent WU execution',
};

const DELEGATE_PARSER_CONFIG: BriefParserConfig = {
  name: 'wu-delegate',
  description: 'Generate delegation prompt and record explicit lineage intent',
};

function parseAndValidateArgs(parserConfig: BriefParserConfig = BRIEF_PARSER_CONFIG): ParsedArgs {
  const args = createWUParser({
    name: parserConfig.name,
    description: parserConfig.description,
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.thinking,
      WU_OPTIONS.noThinking,
      WU_OPTIONS.budget,
      WU_OPTIONS.codex,
      WU_OPTIONS.parentWu, // WU-1945: Parent WU for spawn registry tracking
      WU_OPTIONS.client,
      WU_OPTIONS.vendor,
      WU_OPTIONS.noContext, // WU-1240: Skip memory context injection
    ],
    required: ['id'],
    allowPositionalId: true,
  }) as ParsedArgs;

  // Validate thinking mode options
  try {
    validateSpawnArgs(args);
  } catch (e) {
    die((e as Error).message);
  }

  return args;
}

// ─── WU Document Loading ───

/**
 * Load and validate WU document from YAML file
 */
function loadWUDocument(id: string, wuPath: string): WUDocument {
  // Check if WU file exists
  if (!existsSync(wuPath)) {
    die(
      `WU file not found: ${wuPath}\n\n` +
        `Cannot spawn a sub-agent for a WU that doesn't exist.\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane <lane> --title "..."\n` +
        `  2. Check if the WU ID is correct`,
    );
  }

  // Read WU file
  let text: string;
  try {
    text = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch (e) {
    die(
      `Failed to read WU file: ${wuPath}\n\n` +
        `Error: ${(e as Error).message}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${wuPath}\n` +
        `  2. Ensure the file exists and is readable`,
    );
  }

  // Parse YAML
  try {
    return parseYAML(text) as WUDocument;
  } catch (e) {
    die(
      `Failed to parse WU YAML ${wuPath}\n\n` +
        `Error: ${(e as Error).message}\n\n` +
        `Options:\n` +
        `  1. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  2. Fix YAML errors manually and retry`,
    );
  }
}

// ─── Client Resolution ───

/**
 * Resolve the client name from args and config
 */
function resolveClientName(
  args: ParsedArgs,
  config: ReturnType<typeof getConfig>,
  logPrefix = BRIEF_LOG_PREFIX,
): string {
  let clientName = args.client;

  if (!clientName && args.vendor) {
    console.warn(`${logPrefix} ${EMOJI.WARNING} Warning: --vendor is deprecated. Use --client.`);
    clientName = args.vendor;
  }

  // Codex handling (deprecated legacy flag)
  if (args.codex && !clientName) {
    console.warn(
      `${logPrefix} ${EMOJI.WARNING} Warning: --codex is deprecated. Use --client codex-cli.`,
    );
    clientName = 'codex-cli';
  }

  const resolved = clientName || config.agents.defaultClient || 'claude-code';
  if (!clientName && !config.agents.defaultClient) {
    console.warn(
      `${logPrefix} Warning: No --client specified. Falling back to 'claude-code'. ` +
        `Available clients: claude-code, codex-cli, cursor, gemini-cli, windsurf`,
    );
  }
  return resolved;
}

/**
 * Check lane occupation and warn if occupied by a different WU
 */
async function checkAndWarnLaneOccupation(
  lane: string | undefined,
  id: string,
  logPrefix = BRIEF_LOG_PREFIX,
): Promise<void> {
  if (!lane) return;

  const existingLock = checkLaneOccupation(lane);
  if (existingLock && existingLock.wuId !== id) {
    // Lane is occupied by a different WU
    const { isLockStale } = await import('@lumenflow/core/lane-lock');
    const isStale = isLockStale(existingLock);
    const warning = generateLaneOccupationWarning(existingLock, id, { isStale });
    console.warn(`${logPrefix} ${EMOJI.WARNING}\n${warning}\n`);
  }
}

// ─── Spawn Output and Registry ───

interface SpawnOutputWithRegistryOptions {
  id: string;
  output: string;
  isCodexClient: boolean;
  parentWu?: string;
  lane?: string;
  /** Record lineage intent in registry (wu:delegate explicit path only). */
  recordDelegationIntent?: boolean;
  /** WU-1608: Log prefix to use instead of module-level default */
  logPrefix?: string;
}

interface SpawnOutputWithRegistryDependencies {
  log?: (message: string) => void;
  recordSpawn?: typeof recordSpawnToRegistry;
  formatSpawnMessage?: typeof formatSpawnRecordedMessage;
}

interface RecordWuBriefEvidenceOptions {
  wuId: string;
  workspaceRoot: string;
  clientName: string;
}

interface BriefEvidenceStore {
  checkpoint: (
    wuId: string,
    note: string,
    options?: { sessionId?: string; progress?: string; nextSteps?: string },
  ) => Promise<void>;
}

interface RecordWuBriefEvidenceDependencies {
  createStore?: (stateDir: string) => BriefEvidenceStore;
}

/**
 * Record auditable wu:brief execution evidence in wu-events.jsonl.
 *
 * WU-2132: Completion lifecycle now requires proof that wu:brief was run.
 */
export async function recordWuBriefEvidence(
  options: RecordWuBriefEvidenceOptions,
  dependencies: RecordWuBriefEvidenceDependencies = {},
): Promise<void> {
  const { wuId, workspaceRoot, clientName } = options;
  const stateDir = resolveStateDir(workspaceRoot);
  const createStore = dependencies.createStore ?? ((dir: string) => new WUStateStore(dir));
  const store = createStore(stateDir);
  const note = `${WU_BRIEF_EVIDENCE_NOTE_PREFIX} generated via ${clientName}`;

  await store.checkpoint(wuId, note, {
    progress: BRIEF_EVIDENCE_PROGRESS,
    nextSteps: `client=${clientName}`,
  });
}

/**
 * Emit prompt output and optionally persist parent/child lineage.
 *
 * WU-1604: Prompt generation (wu:brief) is side-effect free.
 * Only explicit delegation mode records lineage intent.
 */
export async function emitSpawnOutputWithRegistry(
  options: SpawnOutputWithRegistryOptions,
  dependencies: SpawnOutputWithRegistryDependencies = {},
): Promise<void> {
  const {
    id,
    output,
    isCodexClient,
    parentWu,
    lane,
    recordDelegationIntent = false,
    logPrefix: prefix = BRIEF_LOG_PREFIX,
  } = options;
  const log = dependencies.log ?? console.log;
  const recordSpawn = dependencies.recordSpawn ?? recordSpawnToRegistry;
  const formatSpawnMessage = dependencies.formatSpawnMessage ?? formatSpawnRecordedMessage;

  if (isCodexClient) {
    log(`${prefix} Generated Codex/GPT prompt for ${id}`);
    log(`${prefix} Copy the Markdown below:\n`);
    log(output.trimEnd());
  } else {
    log(`${prefix} Generated Task tool invocation for ${id}`);
    log(`${prefix} Copy the block below to spawn a sub-agent:\n`);
    log(output);
  }

  if (!recordDelegationIntent || !parentWu) {
    return;
  }

  const config = getConfig({ projectRoot: process.cwd() });
  const registryResult = await recordSpawn({
    parentWuId: parentWu,
    targetWuId: id,
    lane: lane || 'Unknown',
    baseDir: config.state.stateDir,
  });

  const registryMessage = formatSpawnMessage(registryResult.spawnId, registryResult.error);
  log(`\n${registryMessage}`);
}

// ─── Run Brief Logic ───

/**
 * Options for running prompt-generation logic.
 */
export interface RunBriefOptions {
  /** Parser config override (command name and description) */
  parserConfig?: BriefParserConfig;
  /** Log prefix override for output messages */
  logPrefix?: string;
  /** Execution mode for command entry points */
  mode?: 'brief' | 'delegate';
}

/**
 * Shared entry point for wu:brief and wu:delegate.
 */
export async function runBriefLogic(options: RunBriefOptions = {}): Promise<void> {
  const {
    mode = 'brief',
    parserConfig = mode === 'delegate' ? DELEGATE_PARSER_CONFIG : BRIEF_PARSER_CONFIG,
    logPrefix = BRIEF_LOG_PREFIX,
  } = options;

  const args = parseAndValidateArgs(parserConfig);
  const explicitDelegation = mode === 'delegate';
  const effectiveLogPrefix = explicitDelegation ? DELEGATE_LOG_PREFIX : logPrefix;

  // WU-2202: Validate dependencies BEFORE UnsafeAny other operation
  // This prevents false lane occupancy reports when yaml package is missing
  const commandLabel = explicitDelegation ? 'wu:delegate' : 'wu:brief';
  const depResult = await validateSpawnDependencies();
  if (!depResult.valid) {
    die(formatDependencyError(commandLabel, depResult.missing));
  }

  if (explicitDelegation && !args.parentWu) {
    die(
      'wu:delegate requires --parent-wu to record delegation lineage intent.\n\n' +
        'Example:\n' +
        '  pnpm wu:delegate --id WU-123 --parent-wu WU-100 --client <client>',
    );
  }

  if (!explicitDelegation && args.parentWu) {
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} --parent-wu does not record lineage in generation-only mode.`,
    );
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} Use wu:delegate for explicit, side-effectful delegation intent tracking.`,
    );
    console.warn('');
  }

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU id '${args.id}'. Expected format WU-123`);
  }

  const wuPath = WU_PATHS.WU(id);
  const doc = loadWUDocument(id, wuPath);

  // Warn if WU is not in ready or in_progress status
  const validStatuses = [WU_STATUS.READY, WU_STATUS.IN_PROGRESS];
  const status = doc.status || 'unknown';
  if (!validStatuses.includes(status)) {
    console.warn(`${effectiveLogPrefix} ${EMOJI.WARNING} Warning: ${id} has status '${status}'.`);
    console.warn(
      `${effectiveLogPrefix} ${EMOJI.WARNING} Sub-agents typically work on ready or in_progress WUs.`,
    );
    console.warn('');
  }

  // WU-1603: Check if lane is already occupied and warn
  await checkAndWarnLaneOccupation(doc.lane, id, effectiveLogPrefix);

  // Build thinking mode options for task invocation
  const thinkingOptions = {
    thinking: args.thinking,
    noThinking: args.noThinking,
    budget: args.budget,
  };

  // Client Resolution
  const config = getConfig();
  const clientName = resolveClientName(args, config, effectiveLogPrefix);

  // WU-1240: Generate memory context if not skipped
  const baseDir = process.cwd();
  let memoryContextContent = '';
  const shouldIncludeMemoryContext = !args.noContext;

  if (shouldIncludeMemoryContext) {
    const isMemoryInitialized = await checkMemoryLayerInitialized(baseDir);
    if (isMemoryInitialized) {
      const maxSize = getMemoryContextMaxSize(config);
      memoryContextContent = await generateMemoryContextSection(baseDir, {
        wuId: id,
        lane: doc.lane,
        maxSize,
      });
      if (memoryContextContent) {
        console.log(
          `${effectiveLogPrefix} Memory context loaded (${memoryContextContent.length} bytes)`,
        );
      }
    }
  }

  // Create strategy

  const strategy = SpawnStrategyFactory.create(clientName);
  const clientContext = { name: clientName, config: resolveClientConfig(config, clientName) };

  const isCodexClient = clientName === 'codex-cli' || args.codex;

  const recordEvidenceOrFail = async () => {
    if (explicitDelegation) {
      return;
    }

    try {
      await recordWuBriefEvidence({
        wuId: id,
        workspaceRoot: baseDir,
        clientName,
      });
    } catch (error) {
      die(
        `${effectiveLogPrefix} Failed to record wu:brief evidence for ${id}: ${(error as Error).message}\n\n` +
          `Fix options:\n` +
          `  1. Ensure state directory is writable\n` +
          `  2. Retry: pnpm wu:brief --id ${id}`,
      );
    }
  };

  if (isCodexClient) {
    const prompt = generateCodexPrompt(doc, id, strategy, {
      ...thinkingOptions,
      client: clientContext,
      config,
    });
    await emitSpawnOutputWithRegistry({
      id,
      output: prompt,
      isCodexClient: true,
      parentWu: args.parentWu,
      lane: doc.lane,
      recordDelegationIntent: explicitDelegation,
      logPrefix: effectiveLogPrefix,
    });
    await recordEvidenceOrFail();
    return;
  }

  // Generate and output the Task invocation
  const invocation = generateTaskInvocation(doc, id, strategy, {
    ...thinkingOptions,
    client: clientContext,
    config,
    // WU-1240: Include memory context in spawn prompt
    baseDir,
    includeMemoryContext: shouldIncludeMemoryContext && memoryContextContent.length > 0,
    memoryContextContent,
    noContext: args.noContext,
  });
  await emitSpawnOutputWithRegistry({
    id,
    output: invocation,
    isCodexClient: false,
    parentWu: args.parentWu,
    lane: doc.lane,
    recordDelegationIntent: explicitDelegation,
    logPrefix: effectiveLogPrefix,
  });
  await recordEvidenceOrFail();
}
