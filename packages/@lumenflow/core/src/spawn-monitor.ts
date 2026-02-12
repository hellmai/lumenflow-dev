/**
 * Spawn Monitor Library (WU-1948, WU-1968)
 *
 * Core monitoring logic for detecting stuck spawns and zombie locks.
 * Used by orchestrate:monitor CLI command.
 *
 * Features:
 * - Analyzes spawn registry for status counts
 * - Detects pending spawns older than threshold (stuck)
 * - Checks lane locks for zombie PIDs
 * - Generates recovery suggestions
 * - WU-1968: Processes spawn_failure signals from memory bus
 *
 * Library-First Note: This is project-specific monitoring code for
 * ExampleApp's spawn-registry.jsonl and lane-lock files. No external
 * library exists for this custom format.
 *
 * @see {@link packages/@lumenflow/cli/src/__tests__/orchestrate-monitor.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/spawn-monitor.test.ts} - Signal handler tests
 * @see {@link packages/@lumenflow/cli/src/orchestrate-monitor.ts} - CLI entry point
 * @see {@link packages/@lumenflow/cli/src/lib/spawn-registry-store.ts} - Registry storage
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { SpawnStatus } from './spawn-registry-schema.js';
import { isZombieLock, readLockMetadata } from './lane-lock.js';
import { recoverStuckSpawn, RecoveryAction } from './spawn-recovery.js';
import {
  escalateStuckSpawn,
  SPAWN_FAILURE_SIGNAL_TYPE,
  SuggestedAction,
} from './spawn-escalation.js';
import { LUMENFLOW_PATHS } from './wu-constants.js';

// Optional import from @lumenflow/memory
type Signal = { id: string; message: string };
type LoadSignalsFn = (baseDir: string, options: { unreadOnly?: boolean }) => Promise<Signal[]>;
type MarkSignalsAsReadFn = (baseDir: string, signalIds: string[]) => Promise<void>;
let loadSignals: LoadSignalsFn | null = null;
let markSignalsAsRead: MarkSignalsAsReadFn | null = null;
try {
  const mod = await import('@lumenflow/memory/signal');
  loadSignals = mod.loadSignals;
  markSignalsAsRead = mod.markSignalsAsRead;
} catch {
  // @lumenflow/memory not available - signal features disabled
}

/**
 * Default threshold for stuck spawn detection (in minutes)
 */
export const DEFAULT_THRESHOLD_MINUTES = 30;

/**
 * Log prefix for spawn-monitor messages
 */
export const LOG_PREFIX = '[spawn-monitor]';

/**
 * @typedef {Object} SpawnAnalysis
 * @property {number} pending - Count of pending spawns
 * @property {number} completed - Count of completed spawns
 * @property {number} timeout - Count of timed out spawns
 * @property {number} crashed - Count of crashed spawns
 * @property {number} total - Total spawn count
 */

/**
 * @typedef {Object} StuckSpawnInfo
 * @property {import('./spawn-registry-schema.js').SpawnEvent} spawn - The stuck spawn event
 * @property {number} ageMinutes - Age of spawn in minutes
 * @property {string|null} lastCheckpoint - Last checkpoint timestamp (if available from memory layer)
 */

/**
 * @typedef {Object} ZombieLockInfo
 * @property {string} wuId - WU ID that holds the zombie lock
 * @property {string} lane - Lane name
 * @property {number} pid - Process ID (no longer running)
 * @property {string} timestamp - When lock was acquired
 */

/**
 * @typedef {Object} Suggestion
 * @property {string} command - Suggested command to run
 * @property {string} reason - Explanation of why this is suggested
 */

/**
 * @typedef {Object} MonitorResult
 * @property {SpawnAnalysis} analysis - Spawn status counts
 * @property {StuckSpawnInfo[]} stuckSpawns - List of stuck spawns
 * @property {ZombieLockInfo[]} zombieLocks - List of zombie locks
 * @property {Suggestion[]} suggestions - Recovery suggestions
 */

/**
 * @typedef {Object} RecoveryResultInfo
 * @property {string} spawnId - ID of the spawn that was processed
 * @property {string} targetWuId - Target WU ID for the spawn
 * @property {string} action - Recovery action taken (from RecoveryAction)
 * @property {boolean} recovered - Whether auto-recovery was successful
 * @property {string} reason - Human-readable explanation
 * @property {Object} [escalation] - Escalation info if action is ESCALATED_STUCK
 * @property {string} [escalation.bugWuId] - Bug WU ID created for escalation
 * @property {string} [escalation.title] - Bug WU title
 */

/**
 * Analyzes spawn events and returns status counts.
 *
 * @param {import('./spawn-registry-schema.js').SpawnEvent[]} spawns - Array of spawn events
 * @returns {SpawnAnalysis} Status counts
 *
 * @example
 * const analysis = analyzeSpawns(spawns);
 * console.log(`Pending: ${analysis.pending}, Completed: ${analysis.completed}`);
 */
export function analyzeSpawns(spawns) {
  const counts = {
    pending: 0,
    completed: 0,
    timeout: 0,
    crashed: 0,
    total: spawns.length,
  };

  for (const spawn of spawns) {
    switch (spawn.status) {
      case SpawnStatus.PENDING:
        counts.pending++;
        break;
      case SpawnStatus.COMPLETED:
        counts.completed++;
        break;
      case SpawnStatus.TIMEOUT:
        counts.timeout++;
        break;
      case SpawnStatus.CRASHED:
        counts.crashed++;
        break;
    }
  }

  return counts;
}

/**
 * Detects pending spawns that have been running longer than the threshold.
 *
 * @param {import('./spawn-registry-schema.js').SpawnEvent[]} spawns - Array of spawn events
 * @param {number} [thresholdMinutes=DEFAULT_THRESHOLD_MINUTES] - Threshold in minutes
 * @returns {StuckSpawnInfo[]} Array of stuck spawn info
 *
 * @example
 * const stuck = detectStuckSpawns(spawns, 30);
 * for (const info of stuck) {
 *   console.log(`${info.spawn.targetWuId} stuck for ${info.ageMinutes} minutes`);
 * }
 */
export function detectStuckSpawns(spawns, thresholdMinutes = DEFAULT_THRESHOLD_MINUTES) {
  const now = Date.now();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const stuck = [];

  for (const spawn of spawns) {
    // Only check pending spawns
    if (spawn.status !== SpawnStatus.PENDING) {
      continue;
    }

    const spawnedAt = new Date(spawn.spawnedAt).getTime();
    const ageMs = now - spawnedAt;
    const ageMinutes = Math.floor(ageMs / (60 * 1000));

    if (ageMs > thresholdMs) {
      stuck.push({
        spawn,
        ageMinutes,
        lastCheckpoint: spawn.lastCheckpoint ?? null,
      });
    }
  }

  // Sort by age descending (oldest first)
  stuck.sort((a, b) => b.ageMinutes - a.ageMinutes);

  return stuck;
}

/**
 * Checks lane lock files for zombie locks (dead PIDs).
 *
 * @param {SpawnMonitorBaseDirOptions} [options] - Options
 * @returns {Promise<ZombieLockInfo[]>} Array of zombie lock info
 *
 * @example
 * const zombies = await checkZombieLocks();
 * for (const lock of zombies) {
 *   console.log(`Zombie lock: ${lock.lane} (PID ${lock.pid})`);
 * }
 */
interface SpawnMonitorBaseDirOptions {
  /** Base directory (defaults to process.cwd()) */
  baseDir?: string;
}

export async function checkZombieLocks(options: SpawnMonitorBaseDirOptions = {}) {
  const { baseDir = process.cwd() } = options;
  // WU-1421: Use LUMENFLOW_PATHS.LOCKS_DIR (same as lane-lock.ts) for consistency
  const locksDir = path.join(baseDir, LUMENFLOW_PATHS.LOCKS_DIR);
  const zombies = [];

  try {
    // Check if locks directory exists
    await fs.access(locksDir);
  } catch {
    // Directory doesn't exist - no locks
    return zombies;
  }

  try {
    const files = await fs.readdir(locksDir);

    for (const file of files) {
      if (!file.endsWith('.lock')) {
        continue;
      }

      const lockPath = path.join(locksDir, file);
      const metadata = readLockMetadata(lockPath);

      if (metadata && isZombieLock(metadata)) {
        zombies.push({
          wuId: metadata.wuId,
          lane: metadata.lane,
          pid: metadata.pid,
          timestamp: metadata.timestamp,
        });
      }
    }
  } catch {
    // Error reading directory - return empty
  }

  return zombies;
}

/**
 * Generates recovery suggestions for stuck spawns and zombie locks.
 *
 * @param {StuckSpawnInfo[]} stuckSpawns - Array of stuck spawn info
 * @param {ZombieLockInfo[]} zombieLocks - Array of zombie lock info
 * @returns {Suggestion[]} Array of suggestions
 *
 * @example
 * const suggestions = generateSuggestions(stuckSpawns, zombieLocks);
 * for (const s of suggestions) {
 *   console.log(`${s.reason}\n  ${s.command}`);
 * }
 */
export function generateSuggestions(stuckSpawns, zombieLocks) {
  const suggestions = [];

  // Suggestions for stuck spawns
  for (const info of stuckSpawns) {
    const wuId = info.spawn.targetWuId;
    const age = info.ageMinutes;

    suggestions.push({
      command: `pnpm wu:block --id ${wuId} --reason "Spawn stuck for ${age} minutes"`,
      reason: `Spawn for ${wuId} has been pending for ${age} minutes (threshold exceeded)`,
    });
  }

  // Suggestions for zombie locks
  for (const lock of zombieLocks) {
    suggestions.push({
      command: `pnpm lane:unlock "${lock.lane}" --reason "Zombie lock (PID ${lock.pid} not running)"`,
      reason: `Zombie lock detected for lane "${lock.lane}" (PID ${lock.pid} is not running)`,
    });
  }

  return suggestions;
}

/**
 * Formats monitor output for display.
 *
 * @param {MonitorResult} result - Monitor result to format
 * @returns {string} Formatted output string
 *
 * @example
 * const output = formatMonitorOutput(result);
 * console.log(output);
 */
export function formatMonitorOutput(result) {
  const { analysis, stuckSpawns, zombieLocks, suggestions } = result;
  const lines = [];

  // Header
  lines.push('=== Spawn Status Summary ===');
  lines.push('');

  // Status counts table
  lines.push(`  Pending:   ${analysis.pending}`);
  lines.push(`  Completed: ${analysis.completed}`);
  lines.push(`  Timeout:   ${analysis.timeout}`);
  lines.push(`  Crashed:   ${analysis.crashed}`);
  lines.push('  ─────────────────');
  lines.push(`  Total:     ${analysis.total}`);
  lines.push('');

  // Stuck spawns section
  if (stuckSpawns.length > 0) {
    lines.push('=== Stuck Spawns ===');
    lines.push('');

    for (const info of stuckSpawns) {
      lines.push(`  ${info.spawn.targetWuId}`);
      lines.push(`    Lane: ${info.spawn.lane}`);
      lines.push(`    Age: ${info.ageMinutes} minutes`);
      lines.push(`    Parent: ${info.spawn.parentWuId}`);
      if (info.lastCheckpoint) {
        lines.push(`    Last Checkpoint: ${info.lastCheckpoint}`);
      }
      lines.push('');
    }
  }

  // Zombie locks section
  if (zombieLocks.length > 0) {
    lines.push('=== Zombie Locks ===');
    lines.push('');

    for (const lock of zombieLocks) {
      lines.push(`  ${lock.lane}`);
      lines.push(`    WU: ${lock.wuId}`);
      lines.push(`    PID: ${lock.pid} (not running)`);
      lines.push(`    Since: ${lock.timestamp}`);
      lines.push('');
    }
  }

  // Suggestions section
  if (suggestions.length > 0) {
    lines.push('=== Suggestions ===');
    lines.push('');

    for (const s of suggestions) {
      lines.push(`  ${s.reason}`);
      lines.push(`    $ ${s.command}`);
      lines.push('');
    }
  }

  // Health status
  if (stuckSpawns.length === 0 && zombieLocks.length === 0) {
    lines.push('No issues detected. All spawns healthy.');
  }

  return lines.join('\n');
}

/**
 * Runs recovery for stuck spawns by calling recoverStuckSpawn for each.
 * When a spawn is escalated (action=ESCALATED_STUCK), chains to escalateStuckSpawn.
 *
 * @param {StuckSpawnInfo[]} stuckSpawns - Array of stuck spawn info
 * @param {RunRecoveryOptions} [options] - Options
 * @returns {Promise<RecoveryResultInfo[]>} Array of recovery results
 *
 * @example
 * const results = await runRecovery(stuckSpawns, { baseDir: '/path/to/project' });
 * for (const result of results) {
 *   console.log(`${result.spawnId}: ${result.action}`);
 * }
 */
interface RunRecoveryOptions extends SpawnMonitorBaseDirOptions {
  /** If true, escalations return spec only */
  dryRun?: boolean;
}

export async function runRecovery(stuckSpawns, options: RunRecoveryOptions = {}) {
  const { baseDir = process.cwd(), dryRun = false } = options;
  const results = [];

  for (const { spawn } of stuckSpawns) {
    const recoveryResult = await recoverStuckSpawn(spawn.id, { baseDir });

    const resultInfo: {
      spawnId: string;
      targetWuId: string;
      action: string;
      recovered: boolean;
      reason: string;
      escalation?: { bugWuId: string; title: string };
    } = {
      spawnId: spawn.id,
      targetWuId: spawn.targetWuId,
      action: recoveryResult.action,
      recovered: recoveryResult.recovered,
      reason: recoveryResult.reason,
    };

    // Chain to escalation if action is ESCALATED_STUCK
    if (recoveryResult.action === RecoveryAction.ESCALATED_STUCK) {
      try {
        const escalationResult = await escalateStuckSpawn(spawn.id, { baseDir, dryRun });
        // escalationResult contains signalId, signal payload, and spawnStatus
        // The signal payload has target_wu_id which represents the stuck WU
        resultInfo.escalation = {
          bugWuId: escalationResult.signalId,
          title: `Escalation signal for ${spawn.targetWuId}`,
        };
      } catch (error) {
        // Escalation failed, but we still want to report the recovery result
        const message = error instanceof Error ? error.message : String(error);
        console.log(`${LOG_PREFIX} Escalation failed for ${spawn.id}: ${message}`);
      }
    }

    results.push(resultInfo);
  }

  return results;
}

/**
 * Formats recovery results for display.
 *
 * @param {RecoveryResultInfo[]} results - Array of recovery results
 * @returns {string} Formatted output string
 *
 * @example
 * const output = formatRecoveryResults(results);
 * console.log(output);
 */
export function formatRecoveryResults(results) {
  if (results.length === 0) {
    return 'No recovery actions taken.';
  }

  const lines = [];

  // Header
  lines.push('=== Recovery Results ===');
  lines.push('');

  // Count statistics
  let recoveredCount = 0;
  let escalatedCount = 0;
  let noActionCount = 0;

  for (const result of results) {
    if (result.recovered) {
      recoveredCount++;
    } else if (result.action === RecoveryAction.ESCALATED_STUCK) {
      escalatedCount++;
    } else {
      noActionCount++;
    }
  }

  // Individual results
  for (const result of results) {
    lines.push(`  ${result.targetWuId} (${result.spawnId})`);
    lines.push(`    Action: ${result.action}`);
    lines.push(`    Status: ${result.recovered ? 'Recovered' : 'Not auto-recovered'}`);
    lines.push(`    Reason: ${result.reason}`);

    if (result.escalation) {
      lines.push(`    Escalation: Created ${result.escalation.bugWuId}`);
      lines.push(`      Title: ${result.escalation.title}`);
    }

    lines.push('');
  }

  // Summary
  lines.push('--- Summary ---');
  lines.push(`  Recovered: ${recoveredCount}`);
  lines.push(`  Escalated: ${escalatedCount}`);
  if (noActionCount > 0) {
    lines.push(`  No action: ${noActionCount}`);
  }

  return lines.join('\n');
}

// ============================================================================
// WU-1968: Spawn Failure Signal Handler
// ============================================================================

/**
 * Log prefix for signal handler messages
 */
export const SIGNAL_HANDLER_LOG_PREFIX = '[spawn-signal-handler]';

/**
 * Response actions for spawn failure signals
 */
export const SignalResponseAction = Object.freeze({
  RETRY: 'retry',
  BLOCK: 'block',
  BUG_WU: 'bug_wu',
  NONE: 'none',
});

/**
 * @typedef {Object} SignalResponse
 * @property {string} signalId - Signal ID that was processed
 * @property {string} spawnId - Spawn ID from the signal
 * @property {string} targetWuId - Target WU ID from the signal
 * @property {string} action - Response action taken
 * @property {string} reason - Human-readable reason for the action
 * @property {string} severity - Original signal severity
 * @property {boolean} wuBlocked - Whether the WU was blocked
 * @property {string|null} bugWuCreated - Bug WU ID if created, null otherwise
 * @property {string} [blockReason] - Reason used for blocking (if applicable)
 * @property {Object} [bugWuSpec] - Bug WU spec (if applicable)
 */

/**
 * @typedef {Object} SignalProcessingResult
 * @property {SignalResponse[]} processed - Array of processed signal responses
 * @property {number} signalCount - Total number of spawn_failure signals found
 * @property {number} retryCount - Number of retry actions
 * @property {number} blockCount - Number of block actions
 * @property {number} bugWuCount - Number of Bug WU creations
 */

/**
 * Parses a signal message to extract spawn_failure payload.
 *
 * @param {string} message - Signal message (may be JSON or plain text)
 * @returns {Object|null} Parsed payload or null if not a spawn_failure signal
 */
function parseSpawnFailurePayload(message) {
  try {
    const parsed = JSON.parse(message);
    if (parsed.type === SPAWN_FAILURE_SIGNAL_TYPE) {
      return parsed;
    }
    return null;
  } catch {
    // Not JSON or invalid JSON - not a spawn_failure signal
    return null;
  }
}

/**
 * Determines the response action based on signal severity and suggested_action.
 *
 * Escalation levels:
 * - First failure (severity=warning, suggested_action=retry): RETRY
 * - Second failure (severity=error, suggested_action=block): BLOCK
 * - Third+ failure (severity=critical, suggested_action=human_escalate): BUG_WU
 *
 * @param {Object} payload - Spawn failure signal payload
 * @returns {{ action: string, reason: string }}
 */
function determineResponseAction(payload) {
  const { suggested_action, recovery_attempts } = payload;

  if (suggested_action === SuggestedAction.RETRY) {
    return {
      action: SignalResponseAction.RETRY,
      reason: `First failure (attempt ${recovery_attempts}): suggest retry spawn`,
    };
  }

  if (suggested_action === SuggestedAction.BLOCK) {
    return {
      action: SignalResponseAction.BLOCK,
      reason: `Second failure (attempt ${recovery_attempts}): blocking WU`,
    };
  }

  if (suggested_action === SuggestedAction.HUMAN_ESCALATE) {
    return {
      action: SignalResponseAction.BUG_WU,
      reason: `Critical failure (attempt ${recovery_attempts}): creating Bug WU for human review`,
    };
  }

  // Unknown suggested_action - default based on severity
  if (payload.severity === 'critical') {
    return {
      action: SignalResponseAction.BUG_WU,
      reason: `Critical severity: creating Bug WU`,
    };
  }

  return {
    action: SignalResponseAction.NONE,
    reason: `Unknown suggested action: ${suggested_action}`,
  };
}

/**
 * Generates a Bug WU spec for critical failures.
 *
 * @param {Object} payload - Spawn failure signal payload
 * @returns {Object} Bug WU specification
 */
function generateBugWuSpec(payload) {
  const { spawn_id, target_wu_id, lane, recovery_attempts, message, last_checkpoint } = payload;

  const checkpointInfo = last_checkpoint
    ? `Last checkpoint: ${last_checkpoint}`
    : 'No checkpoint recorded';

  return {
    title: `Bug: Stuck spawn for ${target_wu_id} (${spawn_id}) after ${recovery_attempts} attempts`,
    lane,
    description: [
      `Context: Spawn ${spawn_id} for WU ${target_wu_id} has failed ${recovery_attempts} times.`,
      ``,
      `Problem: ${message}`,
      `${checkpointInfo}`,
      ``,
      `Solution: Investigate root cause of repeated spawn failures.`,
      `Consider: prompt issues, tool availability, WU spec clarity, or external dependencies.`,
    ].join('\n'),
    type: 'bug',
    priority: 'P1',
  };
}

/**
 * Generates a block reason for second failure.
 *
 * @param {Object} payload - Spawn failure signal payload
 * @returns {string} Block reason
 */
function generateBlockReason(payload) {
  const { spawn_id, target_wu_id, recovery_attempts, message } = payload;
  return `Spawn ${spawn_id} for ${target_wu_id} failed ${recovery_attempts} times: ${message}`;
}

/**
 * Processes spawn_failure signals from the memory bus.
 *
 * WU-1968: Orchestrator signal handler for spawn_failure signals.
 *
 * Response logic:
 * - First failure (suggested_action=retry): logs warning, suggests retry
 * - Second failure (suggested_action=block): marks WU blocked with reason
 * - Third+ failure (suggested_action=human_escalate): creates Bug WU
 *
 * @param {RunRecoveryOptions} options - Options
 * @returns {Promise<SignalProcessingResult>} Processing result
 *
 * @example
 * const result = await processSpawnFailureSignals({ baseDir: '/path/to/project' });
 * console.log(`Processed ${result.signalCount} signals`);
 * for (const response of result.processed) {
 *   console.log(`${response.targetWuId}: ${response.action}`);
 * }
 */
export async function processSpawnFailureSignals(options: RunRecoveryOptions = {}) {
  const { baseDir = process.cwd(), dryRun = false } = options;

  // Check if signal module is available
  if (!loadSignals) {
    return {
      processed: [],
      signalCount: 0,
      retryCount: 0,
      blockCount: 0,
      bugWuCount: 0,
    };
  }

  // Load unread signals
  const signals = await loadSignals(baseDir, { unreadOnly: true });

  // Filter for spawn_failure signals
  const spawnFailureSignals = [];
  for (const signal of signals) {
    const payload = parseSpawnFailurePayload(signal.message);
    if (payload) {
      spawnFailureSignals.push({ signal, payload });
    }
  }

  const processed = [];
  let retryCount = 0;
  let blockCount = 0;
  let bugWuCount = 0;

  for (const { signal, payload } of spawnFailureSignals) {
    const { action, reason } = determineResponseAction(payload);

    const response: {
      signalId: string;
      spawnId: string;
      targetWuId: string;
      action: string;
      reason: string;
      severity: string;
      wuBlocked: boolean;
      bugWuCreated: string | null;
      blockReason?: string;
      bugWuSpec?: { title: string; description: string };
    } = {
      signalId: signal.id,
      spawnId: payload.spawn_id,
      targetWuId: payload.target_wu_id,
      action,
      reason,
      severity: payload.severity,
      wuBlocked: false,
      bugWuCreated: null,
    };

    // Process based on action
    switch (action) {
      case SignalResponseAction.RETRY:
        retryCount++;
        // Log warning only - no state change
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX} [WARNING] ${reason}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Spawn: ${payload.spawn_id}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Target: ${payload.target_wu_id}`);
        console.log(
          `${SIGNAL_HANDLER_LOG_PREFIX}   Suggestion: Re-generate with pnpm wu:brief --id ${payload.target_wu_id} --client claude-code`,
        );
        break;

      case SignalResponseAction.BLOCK:
        blockCount++;
        response.blockReason = generateBlockReason(payload);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX} [BLOCK] ${reason}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Spawn: ${payload.spawn_id}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Target: ${payload.target_wu_id}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Reason: ${response.blockReason}`);

        if (!dryRun) {
          // In non-dry-run, would call wu:block here
          // For now, just set the flag - actual blocking done by caller
          response.wuBlocked = true;
        }
        break;

      case SignalResponseAction.BUG_WU:
        bugWuCount++;
        response.bugWuSpec = generateBugWuSpec(payload);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX} [BUG WU] ${reason}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Spawn: ${payload.spawn_id}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Target: ${payload.target_wu_id}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Bug WU title: ${response.bugWuSpec.title}`);

        if (!dryRun) {
          // In non-dry-run, would create Bug WU here
          // For now, just set the spec - actual creation done by caller
          // response.bugWuCreated = 'WU-XXXX' (set by caller after creation)
        }
        break;

      default:
        // NONE - no action
        break;
    }

    processed.push(response);
  }

  // Mark processed signals as read (unless dry-run)
  if (!dryRun && spawnFailureSignals.length > 0 && markSignalsAsRead) {
    const signalIds = spawnFailureSignals.map((s) => s.signal.id);
    await markSignalsAsRead(baseDir, signalIds);
  }

  return {
    processed,
    signalCount: spawnFailureSignals.length,
    retryCount,
    blockCount,
    bugWuCount,
  };
}

/**
 * Formats signal handler output for display.
 *
 * @param {SignalProcessingResult} result - Processing result
 * @returns {string} Formatted output string
 *
 * @example
 * const output = formatSignalHandlerOutput(result);
 * console.log(output);
 */
export function formatSignalHandlerOutput(result) {
  const { processed, signalCount, retryCount, blockCount, bugWuCount } = result;
  const lines = [];

  if (signalCount === 0) {
    lines.push(`${SIGNAL_HANDLER_LOG_PREFIX} No spawn_failure signals in inbox.`);
    return lines.join('\n');
  }

  lines.push(`${SIGNAL_HANDLER_LOG_PREFIX} Processed ${signalCount} spawn_failure signal(s):`);
  lines.push('');

  for (const response of processed) {
    lines.push(`  ${response.targetWuId} (${response.spawnId})`);
    lines.push(`    Action: ${response.action}`);
    lines.push(`    Severity: ${response.severity}`);
    lines.push(`    Reason: ${response.reason}`);

    if (response.blockReason) {
      lines.push(`    Block reason: ${response.blockReason}`);
    }

    if (response.bugWuSpec) {
      lines.push(`    Bug WU: ${response.bugWuSpec.title}`);
    }

    lines.push('');
  }

  lines.push('--- Summary ---');
  lines.push(`  Retry suggestions: ${retryCount}`);
  lines.push(`  WUs blocked: ${blockCount}`);
  lines.push(`  Bug WUs created: ${bugWuCount}`);

  return lines.join('\n');
}
