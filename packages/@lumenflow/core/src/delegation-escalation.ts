// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Delegation Escalation Module (WU-1952, WU-1967)
 *
 * WU-1967: Replaced Bug WU creation with memory bus signalling.
 * Signals orchestrator inbox instead of creating human-in-loop Bug WUs.
 *
 * Escalation Flow:
 * 1. recoverStuckDelegation() returns { recovered: false, action: ESCALATED_STUCK }
 * 2. escalateStuckDelegation() signals orchestrator via memory bus
 * 3. Delegation status updated to ESCALATED (prevents duplicate signals)
 * 4. Orchestrator decides: retry (1st), block (2nd), human escalate (3rd+)
 *
 * Library-First Note: This is project-specific delegation escalation code for
 * ExampleApp's custom delegation-registry.jsonl and memory bus patterns.
 * No external library exists for this domain-specific agent lifecycle management.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/delegation-escalation.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/delegation-recovery.ts} - Recovery logic
 * @see {@link packages/@lumenflow/cli/src/lib/mem-signal-core.ts} - Signal creation
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DelegationRegistryStore } from './delegation-registry-store.js';
import { DelegationStatus } from './delegation-registry-schema.js';
import { RECOVERY_DIR_NAME } from './delegation-recovery.js';
import { LUMENFLOW_PATHS } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

// Optional import from @lumenflow/memory
type SignalResult = { signal: { id: string } };
type CreateSignalFn = (
  baseDir: string,
  options: { message: string; wuId: string; lane: string },
) => Promise<SignalResult>;
let createSignal: CreateSignalFn | null = null;
try {
  const mod = await import('@lumenflow/memory/signal');
  createSignal = mod.createSignal;
} catch {
  // @lumenflow/memory not available - signal features disabled
}

/**
 * Log prefix for delegation-escalation messages
 */
const LOG_PREFIX = '[delegation-escalation]';

/**
 * Signal type for delegation failures.
 */
export const DELEGATION_FAILURE_SIGNAL_TYPE = 'delegation_failure';

/**
 * Severity levels for delegation failure signals
 */
export const SignalSeverity = Object.freeze({
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
});

/**
 * Suggested actions for delegation failure signals
 */
export const SuggestedAction = Object.freeze({
  RETRY: 'retry',
  BLOCK: 'block',
  HUMAN_ESCALATE: 'human_escalate',
});

/**
 * @typedef {Object} DelegationFailureSignal
 * @property {string} type - Always 'delegation_failure'
 * @property {string} severity - 'warning' | 'error' | 'critical'
 * @property {string} delegation_id - Delegation ID
 * @property {string} target_wu_id - Target WU ID
 * @property {string} parent_wu_id - Parent WU ID (orchestrator)
 * @property {string} lane - Lane name
 * @property {string} recovery_action - Recovery action that triggered escalation
 * @property {number} recovery_attempts - Number of recovery attempts
 * @property {string|null} last_checkpoint - Last checkpoint timestamp
 * @property {string} suggested_action - 'retry' | 'block' | 'human_escalate'
 * @property {string} message - Human-readable message
 */

/**
 * @typedef {Object} EscalationResult
 * @property {string} signalId - Signal ID (e.g., 'sig-abc12345')
 * @property {DelegationFailureSignal} signal - The signal payload
 * @property {string} delegationStatus - Updated delegation status (ESCALATED)
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} timestamp - ISO timestamp of recovery action
 * @property {string} delegationId - ID of the delegation being recovered
 * @property {string} action - Recovery action taken
 * @property {string} reason - Explanation of why action was taken
 * @property {Object} context - Additional context
 */

/**
 * Counts existing escalation attempts for a delegation by reading audit logs.
 *
 * @param {string} baseDir - Base directory
 * @param {string} delegationId - Delegation ID to count attempts for
 * @returns {Promise<number>} Number of previous escalation attempts
 */
async function countEscalationAttempts(baseDir: UnsafeAny, delegationId: UnsafeAny) {
  // WU-1421: Use LUMENFLOW_PATHS.BASE for consistency
  const recoveryDir = path.join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_DIR_NAME);

  try {
    const files = await fs.readdir(recoveryDir);
    const delegationFiles = files.filter(
      (f) => f.startsWith(`${delegationId}-`) && f.endsWith('.json'),
    );
    return delegationFiles.length;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/**
 * Determines severity and suggested action based on recovery attempts.
 *
 * @param {number} attempts - Number of recovery attempts
 * @returns {{ severity: string, suggestedAction: string }}
 */
function determineEscalationLevel(attempts: UnsafeAny) {
  if (attempts <= 1) {
    return {
      severity: SignalSeverity.WARNING,
      suggestedAction: SuggestedAction.RETRY,
    };
  } else if (attempts === 2) {
    return {
      severity: SignalSeverity.ERROR,
      suggestedAction: SuggestedAction.BLOCK,
    };
  } else {
    return {
      severity: SignalSeverity.CRITICAL,
      suggestedAction: SuggestedAction.HUMAN_ESCALATE,
    };
  }
}

/**
 * Find the most recent escalation audit log for a delegation.
 *
 * @param {string} baseDir - Base directory
 * @param {string} delegationId - Delegation ID to find audit log for
 * @returns {Promise<AuditLogEntry|null>} Audit log entry or null if not found
 */
async function findEscalationAuditLog(baseDir: UnsafeAny, delegationId: UnsafeAny) {
  // WU-1421: Use LUMENFLOW_PATHS.BASE for consistency
  const recoveryDir = path.join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_DIR_NAME);

  try {
    const files = await fs.readdir(recoveryDir);
    // Filter files for this delegation ID, sorted by name (timestamp-based)
    const delegationFiles = files
      .filter((f) => f.startsWith(`${delegationId}-`) && f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    if (delegationFiles.length === 0) {
      return null;
    }

    // Read the most recent audit log
    const latestFile = delegationFiles[0];
    if (!latestFile) {
      return null;
    }
    const auditPath = path.join(recoveryDir, latestFile);
    const content = await fs.readFile(auditPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Builds a delegation failure signal payload.
 *
 * @param {Object} delegation - Delegation event data
 * @param {AuditLogEntry} auditLog - Escalation audit log
 * @param {number} attempts - Number of recovery attempts
 * @returns {DelegationFailureSignal} Signal payload
 */
function buildDelegationFailureSignal(
  delegation: UnsafeAny,
  auditLog: UnsafeAny,
  attempts: UnsafeAny,
) {
  const { severity, suggestedAction } = determineEscalationLevel(attempts);
  const lastCheckpoint = auditLog.context.lastCheckpoint || null;

  return {
    type: DELEGATION_FAILURE_SIGNAL_TYPE,
    severity,
    delegation_id: delegation.id,
    target_wu_id: delegation.targetWuId,
    parent_wu_id: delegation.parentWuId,
    lane: delegation.lane,
    recovery_action: auditLog.action,
    recovery_attempts: attempts,
    last_checkpoint: lastCheckpoint,
    suggested_action: suggestedAction,
    message: `Delegation ${delegation.id} for ${delegation.targetWuId} stuck: ${auditLog.reason}`,
  };
}

/**
 * Escalates a stuck delegation by signalling the orchestrator.
 *
 * WU-1967: Replaced Bug WU creation with memory bus signalling.
 * Called when recoverStuckDelegation() returns ESCALATED_STUCK.
 * Signals orchestrator inbox with delegation failure context.
 *
 * Escalation levels based on recovery attempts:
 * - 1st attempt: severity=warning, suggested_action=retry
 * - 2nd attempt: severity=error, suggested_action=block
 * - 3rd+ attempt: severity=critical, suggested_action=human_escalate
 *
 * @param {string} delegationId - ID of the stuck delegation
 * @param {Object} options - Options
 * @param {string} options.baseDir - Base directory for .lumenflow/
 * @param {boolean} [options.dryRun=false] - If true, returns signal without sending
 * @returns {Promise<EscalationResult>} Escalation result with signal details
 *
 * @throws {Error} If delegation not found
 * @throws {Error} If delegation already escalated (duplicate prevention)
 * @throws {Error} If no escalation audit log exists
 *
 * @example
 * // After recoverStuckDelegation returns ESCALATED_STUCK
 * const result = await escalateStuckDelegation('delegation-1234', { baseDir: '/path/to/project' });
 * console.log(`Signal sent: ${result.signalId}, action: ${result.signal.suggested_action}`);
 */
export interface EscalateStuckDelegationOptions {
  /** Base directory for .lumenflow/ */
  baseDir?: string;
  /** If true, return spec only without sending signal */
  dryRun?: boolean;
}

export async function escalateStuckDelegation(
  delegationId: UnsafeAny,
  options: EscalateStuckDelegationOptions = {},
) {
  const { baseDir = process.cwd(), dryRun = false } = options;
  // WU-1421: Use LUMENFLOW_PATHS.STATE_DIR for consistency
  const registryDir = path.join(baseDir, LUMENFLOW_PATHS.STATE_DIR);

  // Load delegation registry
  const store = new DelegationRegistryStore(registryDir);

  try {
    await store.load();
  } catch {
    throw createError(
      ErrorCodes.DELEGATION_NOT_FOUND,
      `Delegation ${delegationId} not found: registry unavailable`,
    );
  }

  // Find the delegation
  const delegation = store.getById(delegationId);

  if (!delegation) {
    throw createError(
      ErrorCodes.DELEGATION_NOT_FOUND,
      `Delegation ${delegationId} not found in registry`,
    );
  }

  // Check if signal module is available
  if (!createSignal) {
    throw createError(
      ErrorCodes.SIGNAL_UNAVAILABLE,
      'Signal module (@lumenflow/memory) not available - cannot escalate',
    );
  }

  // WU-1967: Check if already escalated (prevents duplicate signals)
  if (delegation.status === DelegationStatus.ESCALATED) {
    throw createError(
      ErrorCodes.DELEGATION_ALREADY_ESCALATED,
      `Delegation ${delegationId} already escalated`,
    );
  }

  // Find escalation audit log
  const auditLog = await findEscalationAuditLog(baseDir, delegationId);

  if (!auditLog) {
    throw createError(
      ErrorCodes.DELEGATION_NOT_FOUND,
      `No escalation audit log found for delegation ${delegationId}`,
    );
  }

  // Count previous escalation attempts
  const attempts = await countEscalationAttempts(baseDir, delegationId);

  // Build signal payload
  const signalPayload = buildDelegationFailureSignal(delegation, auditLog, attempts);

  if (dryRun) {
    console.log(`${LOG_PREFIX} [dry-run] Would signal orchestrator`);
    console.log(`${LOG_PREFIX} [dry-run] Severity: ${signalPayload.severity}`);
    console.log(`${LOG_PREFIX} [dry-run] Suggested action: ${signalPayload.suggested_action}`);
    console.log(`${LOG_PREFIX} [dry-run] Message: ${signalPayload.message}`);
    return {
      signalId: 'sig-dry-run',
      signal: signalPayload,
      delegationStatus: DelegationStatus.ESCALATED,
    };
  }

  // WU-1967: Send signal to orchestrator inbox
  console.log(`${LOG_PREFIX} Signalling orchestrator for delegation ${delegationId}`);
  console.log(`${LOG_PREFIX} Target WU: ${delegation.targetWuId}`);
  console.log(`${LOG_PREFIX} Severity: ${signalPayload.severity}`);
  console.log(`${LOG_PREFIX} Suggested action: ${signalPayload.suggested_action}`);

  // Create signal with structured message (JSON payload in message field)
  const signalResult = await createSignal(baseDir, {
    message: JSON.stringify(signalPayload),
    wuId: delegation.parentWuId, // Signal targets the orchestrator (parent WU)
    lane: delegation.lane,
  });

  // Update delegation status to ESCALATED (prevents duplicate signals)
  await store.updateStatus(delegationId, DelegationStatus.ESCALATED);

  console.log(`${LOG_PREFIX} Signal sent: ${signalResult.signal.id}`);
  console.log(`${LOG_PREFIX} Delegation ${delegationId} status updated to ESCALATED`);

  return {
    signalId: signalResult.signal.id,
    signal: signalPayload,
    delegationStatus: DelegationStatus.ESCALATED,
  };
}
