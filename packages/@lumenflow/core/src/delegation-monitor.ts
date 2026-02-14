/**
 * Delegation Monitor Library (WU-1948, WU-1968)
 *
 * Core monitoring logic for detecting stuck delegations and zombie locks.
 * Used by orchestrate:monitor CLI command.
 *
 * Features:
 * - Analyzes delegation registry for status counts
 * - Detects pending delegations older than threshold (stuck)
 * - Checks lane locks for zombie PIDs
 * - Generates recovery suggestions
 * - WU-1968: Processes delegation_failure signals from memory bus
 *
 * Library-First Note: This is project-specific monitoring code for
 * ExampleApp's delegation-registry.jsonl and lane-lock files. No external
 * library exists for this custom format.
 *
 * @see {@link packages/@lumenflow/cli/src/__tests__/orchestrate-monitor.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/delegation-monitor.test.ts} - Signal handler tests
 * @see {@link packages/@lumenflow/cli/src/orchestrate-monitor.ts} - CLI entry point
 * @see {@link packages/@lumenflow/cli/src/lib/delegation-registry-store.ts} - Registry storage
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DelegationStatus } from './delegation-registry-schema.js';
import { isZombieLock, readLockMetadata } from './lane-lock.js';
import { recoverStuckDelegation, RecoveryAction } from './delegation-recovery.js';
import {
  escalateStuckDelegation,
  DELEGATION_FAILURE_SIGNAL_TYPE,
  SuggestedAction,
} from './delegation-escalation.js';
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
 * Default threshold for stuck delegation detection (in minutes)
 */
export const DEFAULT_THRESHOLD_MINUTES = 30;

/**
 * Log prefix for delegation-monitor messages
 */
export const LOG_PREFIX = '[delegation-monitor]';

/**
 * @typedef {Object} SpawnAnalysis
 * @property {number} pending - Count of pending delegations
 * @property {number} completed - Count of completed delegations
 * @property {number} timeout - Count of timed out delegations
 * @property {number} crashed - Count of crashed delegations
 * @property {number} total - Total delegation count
 */

/**
 * @typedef {Object} StuckSpawnInfo
 * @property {import('./delegation-registry-schema.js').DelegationEvent} delegation - The stuck delegation event
 * @property {number} ageMinutes - Age of delegation in minutes
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
 * @property {SpawnAnalysis} analysis - Delegation status counts
 * @property {StuckSpawnInfo[]} stuckDelegations - List of stuck delegations
 * @property {ZombieLockInfo[]} zombieLocks - List of zombie locks
 * @property {Suggestion[]} suggestions - Recovery suggestions
 */

/**
 * @typedef {Object} RecoveryResultInfo
 * @property {string} delegationId - ID of the delegation that was processed
 * @property {string} targetWuId - Target WU ID for the delegation
 * @property {string} action - Recovery action taken (from RecoveryAction)
 * @property {boolean} recovered - Whether auto-recovery was successful
 * @property {string} reason - Human-readable explanation
 * @property {Object} [escalation] - Escalation info if action is ESCALATED_STUCK
 * @property {string} [escalation.bugWuId] - Bug WU ID created for escalation
 * @property {string} [escalation.title] - Bug WU title
 */

/**
 * Analyzes delegation events and returns status counts.
 *
 * @param {import('./delegation-registry-schema.js').DelegationEvent[]} delegations - Array of delegation events
 * @returns {SpawnAnalysis} Status counts
 *
 * @example
 * const analysis = analyzeDelegations(delegations);
 * console.log(`Pending: ${analysis.pending}, Completed: ${analysis.completed}`);
 */
export function analyzeDelegations(delegations) {
  const counts = {
    pending: 0,
    completed: 0,
    timeout: 0,
    crashed: 0,
    total: delegations.length,
  };

  for (const delegation of delegations) {
    switch (delegation.status) {
      case DelegationStatus.PENDING:
        counts.pending++;
        break;
      case DelegationStatus.COMPLETED:
        counts.completed++;
        break;
      case DelegationStatus.TIMEOUT:
        counts.timeout++;
        break;
      case DelegationStatus.CRASHED:
        counts.crashed++;
        break;
    }
  }

  return counts;
}

/**
 * Detects pending delegations that have been running longer than the threshold.
 *
 * @param {import('./delegation-registry-schema.js').DelegationEvent[]} delegations - Array of delegation events
 * @param {number} [thresholdMinutes=DEFAULT_THRESHOLD_MINUTES] - Threshold in minutes
 * @returns {StuckSpawnInfo[]} Array of stuck delegation info
 *
 * @example
 * const stuck = detectStuckDelegations(delegations, 30);
 * for (const info of stuck) {
 *   console.log(`${info.delegation.targetWuId} stuck for ${info.ageMinutes} minutes`);
 * }
 */
export function detectStuckDelegations(delegations, thresholdMinutes = DEFAULT_THRESHOLD_MINUTES) {
  const now = Date.now();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const stuck = [];

  for (const delegation of delegations) {
    // Only check pending delegations
    if (delegation.status !== DelegationStatus.PENDING) {
      continue;
    }

    const delegatedAt = new Date(delegation.delegatedAt).getTime();
    const ageMs = now - delegatedAt;
    const ageMinutes = Math.floor(ageMs / (60 * 1000));

    if (ageMs > thresholdMs) {
      stuck.push({
        delegation,
        ageMinutes,
        lastCheckpoint: delegation.lastCheckpoint ?? null,
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
 * Generates recovery suggestions for stuck delegations and zombie locks.
 *
 * @param {StuckSpawnInfo[]} stuckDelegations - Array of stuck delegation info
 * @param {ZombieLockInfo[]} zombieLocks - Array of zombie lock info
 * @returns {Suggestion[]} Array of suggestions
 *
 * @example
 * const suggestions = generateSuggestions(stuckDelegations, zombieLocks);
 * for (const s of suggestions) {
 *   console.log(`${s.reason}\n  ${s.command}`);
 * }
 */
export function generateSuggestions(stuckDelegations, zombieLocks) {
  const suggestions = [];

  // Suggestions for stuck delegations
  for (const info of stuckDelegations) {
    const wuId = info.delegation.targetWuId;
    const age = info.ageMinutes;

    suggestions.push({
      command: `pnpm wu:block --id ${wuId} --reason "Delegation stuck for ${age} minutes"`,
      reason: `Delegation for ${wuId} has been pending for ${age} minutes (threshold exceeded)`,
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
  const { analysis, stuckDelegations, zombieLocks, suggestions } = result;
  const lines = [];

  // Header
  lines.push('=== Delegation Status Summary ===');
  lines.push('');

  // Status counts table
  lines.push(`  Pending:   ${analysis.pending}`);
  lines.push(`  Completed: ${analysis.completed}`);
  lines.push(`  Timeout:   ${analysis.timeout}`);
  lines.push(`  Crashed:   ${analysis.crashed}`);
  lines.push('  ─────────────────');
  lines.push(`  Total:     ${analysis.total}`);
  lines.push('');

  // Stuck delegations section
  if (stuckDelegations.length > 0) {
    lines.push('=== Stuck Delegations ===');
    lines.push('');

    for (const info of stuckDelegations) {
      lines.push(`  ${info.delegation.targetWuId}`);
      lines.push(`    Lane: ${info.delegation.lane}`);
      lines.push(`    Age: ${info.ageMinutes} minutes`);
      lines.push(`    Parent: ${info.delegation.parentWuId}`);
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
  if (stuckDelegations.length === 0 && zombieLocks.length === 0) {
    lines.push('No issues detected. All delegations healthy.');
  }

  return lines.join('\n');
}

/**
 * Runs recovery for stuck delegations by calling recoverStuckDelegation for each.
 * When a delegation is escalated (action=ESCALATED_STUCK), chains to escalateStuckDelegation.
 *
 * @param {StuckSpawnInfo[]} stuckDelegations - Array of stuck delegation info
 * @param {RunRecoveryOptions} [options] - Options
 * @returns {Promise<RecoveryResultInfo[]>} Array of recovery results
 *
 * @example
 * const results = await runRecovery(stuckDelegations, { baseDir: '/path/to/project' });
 * for (const result of results) {
 *   console.log(`${result.delegationId}: ${result.action}`);
 * }
 */
interface RunRecoveryOptions extends SpawnMonitorBaseDirOptions {
  /** If true, escalations return spec only */
  dryRun?: boolean;
}

export async function runRecovery(stuckDelegations, options: RunRecoveryOptions = {}) {
  const { baseDir = process.cwd(), dryRun = false } = options;
  const results = [];

  for (const { delegation } of stuckDelegations) {
    const recoveryResult = await recoverStuckDelegation(delegation.id, { baseDir });

    const resultInfo: {
      delegationId: string;
      targetWuId: string;
      action: string;
      recovered: boolean;
      reason: string;
      escalation?: { bugWuId: string; title: string };
    } = {
      delegationId: delegation.id,
      targetWuId: delegation.targetWuId,
      action: recoveryResult.action,
      recovered: recoveryResult.recovered,
      reason: recoveryResult.reason,
    };

    // Chain to escalation if action is ESCALATED_STUCK
    if (recoveryResult.action === RecoveryAction.ESCALATED_STUCK) {
      try {
        const escalationResult = await escalateStuckDelegation(delegation.id, { baseDir, dryRun });
        // escalationResult contains signalId, signal payload, and delegationStatus
        // The signal payload has target_wu_id which represents the stuck WU
        resultInfo.escalation = {
          bugWuId: escalationResult.signalId,
          title: `Escalation signal for ${delegation.targetWuId}`,
        };
      } catch (error) {
        // Escalation failed, but we still want to report the recovery result
        const message = error instanceof Error ? error.message : String(error);
        console.log(`${LOG_PREFIX} Escalation failed for ${delegation.id}: ${message}`);
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
    lines.push(`  ${result.targetWuId} (${result.delegationId})`);
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
// WU-1968: Delegation Failure Signal Handler
// ============================================================================

/**
 * Log prefix for signal handler messages
 */
export const SIGNAL_HANDLER_LOG_PREFIX = '[delegation-signal-handler]';

/**
 * Response actions for delegation failure signals
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
 * @property {string} delegationId - Delegation ID from the signal
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
 * @property {number} signalCount - Total number of delegation_failure signals found
 * @property {number} retryCount - Number of retry actions
 * @property {number} blockCount - Number of block actions
 * @property {number} bugWuCount - Number of Bug WU creations
 */

/**
 * Parses a signal message to extract delegation_failure payload.
 *
 * @param {string} message - Signal message (may be JSON or plain text)
 * @returns {Object|null} Parsed payload or null if not a delegation_failure signal
 */
function parseDelegationFailurePayload(message) {
  try {
    const parsed = JSON.parse(message);
    if (parsed.type === DELEGATION_FAILURE_SIGNAL_TYPE) {
      return parsed;
    }
    return null;
  } catch {
    // Not JSON or invalid JSON - not a delegation_failure signal
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
 * @param {Object} payload - Delegation failure signal payload
 * @returns {{ action: string, reason: string }}
 */
function determineResponseAction(payload) {
  const { suggested_action, recovery_attempts } = payload;

  if (suggested_action === SuggestedAction.RETRY) {
    return {
      action: SignalResponseAction.RETRY,
      reason: `First failure (attempt ${recovery_attempts}): suggest retry delegation`,
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
 * @param {Object} payload - Delegation failure signal payload
 * @returns {Object} Bug WU specification
 */
function generateBugWuSpec(payload) {
  const { delegation_id, target_wu_id, lane, recovery_attempts, message, last_checkpoint } =
    payload;

  const checkpointInfo = last_checkpoint
    ? `Last checkpoint: ${last_checkpoint}`
    : 'No checkpoint recorded';

  return {
    title: `Bug: Stuck delegation for ${target_wu_id} (${delegation_id}) after ${recovery_attempts} attempts`,
    lane,
    description: [
      `Context: Delegation ${delegation_id} for WU ${target_wu_id} has failed ${recovery_attempts} times.`,
      ``,
      `Problem: ${message}`,
      `${checkpointInfo}`,
      ``,
      `Solution: Investigate root cause of repeated delegation failures.`,
      `Consider: prompt issues, tool availability, WU spec clarity, or external dependencies.`,
    ].join('\n'),
    type: 'bug',
    priority: 'P1',
  };
}

/**
 * Generates a block reason for second failure.
 *
 * @param {Object} payload - Delegation failure signal payload
 * @returns {string} Block reason
 */
function generateBlockReason(payload) {
  const { delegation_id, target_wu_id, recovery_attempts, message } = payload;
  return `Delegation ${delegation_id} for ${target_wu_id} failed ${recovery_attempts} times: ${message}`;
}

/**
 * Processes delegation_failure signals from the memory bus.
 *
 * WU-1968: Orchestrator signal handler for delegation_failure signals.
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
 * const result = await processDelegationFailureSignals({ baseDir: '/path/to/project' });
 * console.log(`Processed ${result.signalCount} signals`);
 * for (const response of result.processed) {
 *   console.log(`${response.targetWuId}: ${response.action}`);
 * }
 */
export async function processDelegationFailureSignals(options: RunRecoveryOptions = {}) {
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

  // Filter for delegation_failure signals
  const delegationFailureSignals = [];
  for (const signal of signals) {
    const payload = parseDelegationFailurePayload(signal.message);
    if (payload) {
      delegationFailureSignals.push({ signal, payload });
    }
  }

  const processed = [];
  let retryCount = 0;
  let blockCount = 0;
  let bugWuCount = 0;

  for (const { signal, payload } of delegationFailureSignals) {
    const { action, reason } = determineResponseAction(payload);

    const response: {
      signalId: string;
      delegationId: string;
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
      delegationId: payload.delegation_id,
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
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Delegation: ${payload.delegation_id}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Target: ${payload.target_wu_id}`);
        console.log(
          `${SIGNAL_HANDLER_LOG_PREFIX}   Suggestion: Re-generate with pnpm wu:brief --id ${payload.target_wu_id} --client claude-code`,
        );
        break;

      case SignalResponseAction.BLOCK:
        blockCount++;
        response.blockReason = generateBlockReason(payload);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX} [BLOCK] ${reason}`);
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Delegation: ${payload.delegation_id}`);
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
        console.log(`${SIGNAL_HANDLER_LOG_PREFIX}   Delegation: ${payload.delegation_id}`);
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
  if (!dryRun && delegationFailureSignals.length > 0 && markSignalsAsRead) {
    const signalIds = delegationFailureSignals.map((s) => s.signal.id);
    await markSignalsAsRead(baseDir, signalIds);
  }

  return {
    processed,
    signalCount: delegationFailureSignals.length,
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
    lines.push(`${SIGNAL_HANDLER_LOG_PREFIX} No delegation_failure signals in inbox.`);
    return lines.join('\n');
  }

  lines.push(`${SIGNAL_HANDLER_LOG_PREFIX} Processed ${signalCount} delegation_failure signal(s):`);
  lines.push('');

  for (const response of processed) {
    lines.push(`  ${response.targetWuId} (${response.delegationId})`);
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
