#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Done Helper
 *
 * Canonical sequence (Worktree mode - DEFAULT):
 * 1) Run gates in lane worktree (validates the change, not just main)
 * 2) Pre-flight validation: run ALL pre-commit hooks before merge (prevents partial completion)
 * 3) cd into worktree
 * 4) Auto-update WU YAML/backlog/status to Done in worktree (unless --no-auto)
 * 5) Create `.lumenflow/stamps/WU-{id}.done` in worktree
 * 6) Validate staged files against whitelist
 * 7) Commit metadata changes in worktree (on lane branch)
 * 8) cd back to main
 * 9) Merge lane branch to main with --ff-only (metadata + code merged atomically)
 * 10) Push to `main`
 * 11) Remove the associated worktree (unless --no-remove)
 * 12) Optionally delete the lane branch (with --delete-branch)
 * 13) Emit telemetry to .lumenflow/flow.log
 *
 * Canonical sequence (Branch-Only mode - LEGACY):
 * 1) Run gates on lane branch (in main checkout)
 * 2) Pre-flight validation
 * 3) Merge lane branch to main
 * 4) Update metadata on main
 * 5) Commit and push
 * 6) Delete lane branch
 *
 * Usage:
 *   pnpm wu:done --id WU-334 [--worktree worktrees/intelligence-wu-334] [--no-auto] [--no-remove] [--no-merge] [--delete-branch]
 *
 * WU-2542: This script imports utilities from @lumenflow/core package.
 * Full migration to thin shim pending @lumenflow/core CLI export implementation.
 */

// WU-2542: Import from @lumenflow/core to establish shim layer dependency

import '@lumenflow/core';

// WU-1663: XState pipeline actor for state-driven orchestration
import { createActor } from 'xstate';
import { wuDoneMachine, WU_DONE_EVENTS } from '@lumenflow/core/wu-done-machine';

// WU-1153: wu:done guard for uncommitted code_paths is implemented in core package
// The guard runs in executeWorktreeCompletion() before metadata transaction
// See: packages/@lumenflow/core/src/wu-done-validation.ts

import { execSync } from 'node:child_process';
import prettyMs from 'pretty-ms';
import type { ZodIssue } from 'zod';
import { runGates } from './gates.js';
// WU-2102: Import scoped test resolver for wu:done gate fallback
import { resolveScopedUnitTestsForPrep } from './wu-prep.js';
import { resolveWuDonePreCommitGateDecision } from '@lumenflow/core/gates-agent-mode';
import { buildClaimRepairCommand } from './wu-claim-repair-guidance.js';
import { resolveStateDir, resolveWuEventsRelativePath } from './state-path-resolvers.js';
import { getGitForCwd, createGitForPath } from '@lumenflow/core/git-adapter';
import { die, getErrorMessage, createError, ErrorCodes } from '@lumenflow/core/error-handler';
// WU-1223: Location detection for worktree check
import { resolveLocation } from '@lumenflow/core/context/location-resolver';
import { existsSync, readFileSync, mkdirSync, appendFileSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
// WU-1825: Import from unified code-path-validator (consolidates 3 validators)
import { validateWUCodePaths } from '@lumenflow/core/code-path-validator';
import { rollbackFiles } from '@lumenflow/core/rollback-utils';
import {
  validateInputs,
  detectModeAndPaths,
  defaultBranchFrom,
  runCleanup,
  validateSpecCompleteness,
  runPreflightTasksValidation,
  buildPreflightErrorMessage,
  // WU-1805: Preflight code_paths validation before gates
  executePreflightCodePathValidation,
  buildPreflightCodePathErrorMessage,
  // WU-2308: Pre-commit hooks with worktree context
  validateAllPreCommitHooks,
  // WU-2310: Type vs code_paths preflight validation
  validateTypeVsCodePathsPreflight,
  buildTypeVsCodePathsErrorMessage,
} from '@lumenflow/core/wu-done-validators';
import { formatPreflightWarnings } from '@lumenflow/core/wu-preflight-validators';
// WU-1825: validateCodePathsExist moved to unified code-path-validator
import { validateCodePathsExist } from '@lumenflow/core/code-path-validator';
import {
  BRANCHES,
  PATTERNS,
  DEFAULTS,
  LOG_PREFIX,
  EMOJI,
  GIT,
  SESSION,
  WU_STATUS,
  PKG_MANAGER,
  SCRIPTS,
  CLI_FLAGS,
  FILE_SYSTEM,
  EXIT_CODES,
  STRING_LITERALS,
  MICRO_WORKTREE_OPERATIONS,
  TELEMETRY_STEPS,
  SKIP_GATES_REASONS,
  CHECKPOINT_MESSAGES,
  ENV_VARS,
  getWUStatusDisplay,
  // WU-1223: Location types for worktree detection
  CONTEXT_VALIDATION,
} from '@lumenflow/core/wu-constants';
import { getDocsOnlyPrefixes, DOCS_ONLY_ROOT_FILES } from '@lumenflow/core';
import { printGateFailureBox, printStatusPreview } from '@lumenflow/core/wu-done-ui';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { getConfig, clearConfigCache } from '@lumenflow/core/config';
import { writeWU, appendNote, parseYAML } from '@lumenflow/core/wu-yaml';
import {
  PLACEHOLDER_SENTINEL,
  validateWU,
  validateDoneWU,
  validateApprovalGates,
} from '@lumenflow/core/wu-schema';
import { validateBacklogSync } from '@lumenflow/core/backlog-sync-validator';
import {
  executeBranchOnlyCompletion,
  // WU-1492: Import branch-pr completion path
  executeBranchPRCompletion,
} from '@lumenflow/core/wu-done-branch-only';
import { executeWorktreeCompletion, autoRebaseBranch } from '@lumenflow/core/wu-done-worktree';
// WU-1746: Already-merged worktree resilience
import {
  detectAlreadyMergedNoWorktree,
  executeAlreadyMergedCompletion,
} from '@lumenflow/core/wu-done-merged-worktree';
// WU-2211: --already-merged finalize-only mode
import {
  verifyCodePathsOnMainHead,
  executeAlreadyMergedFinalize as executeAlreadyMergedFinalizeFromModule,
} from './wu-done-already-merged.js';
import { checkWUConsistency } from '@lumenflow/core/wu-consistency-checker';
// WU-1542: Use blocking mode compliance check (replaces non-blocking checkMandatoryAgentsCompliance)
import { checkMandatoryAgentsComplianceBlocking } from '@lumenflow/core/orchestration-rules';
import { endSessionForWU } from '@lumenflow/agent/auto-session';
import { runBackgroundProcessCheck } from '@lumenflow/core/process-detector';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
// WU-1588: INIT-007 memory layer integration
import { createCheckpoint } from '@lumenflow/memory/checkpoint';
import { createSignal, loadSignals } from '@lumenflow/memory/signal';
// WU-1763: Memory store for loading discoveries (lifecycle nudges)
import { loadMemory, queryByWu } from '@lumenflow/memory/store';
// WU-1943: Checkpoint warning helper
import { hasSessionCheckpoints } from '@lumenflow/core/wu-done-worktree';
// WU-1603: Atomic lane locking - release lock on WU completion
import { releaseLaneLock } from '@lumenflow/core/lane-lock';
// WU-1747: Checkpoint and lock for concurrent load resilience
import {
  createPreGatesCheckpoint as createWU1747Checkpoint,
  markGatesPassed,
  canSkipGates,
  clearCheckpoint,
} from '@lumenflow/core/wu-checkpoint';
// WU-1946: Spawn registry for tracking sub-agent spawns
import { DelegationRegistryStore } from '@lumenflow/core/delegation-registry-store';
import { DelegationStatus } from '@lumenflow/core/delegation-registry-schema';
import { ensureCleanWorktree } from './wu-done-check.js';
// WU-1366: Auto cleanup after wu:done success
// WU-1533: commitCleanupChanges auto-commits dirty state files after cleanup
import { runAutoCleanupAfterDone, commitCleanupChanges } from './wu-done-auto-cleanup.js';
// WU-1471 AC4: Hook counter cleanup on wu:done completion
import { cleanupHookCounters } from './hooks/auto-checkpoint-utils.js';
// WU-1473: Mark completed-WU signals as read using receipt-aware behavior
import { markCompletedWUSignalsAsRead } from './hooks/enforcement-generator.js';
import { evaluateMainDirtyMutationGuard } from './hooks/dirty-guard.js';
// WU-1474: Decay policy invocation during completion lifecycle
import { runDecayOnDone } from './wu-done-decay.js';
import {
  enforceSpawnProvenanceForDone,
  enforceWuBriefEvidenceForDone,
  printExposureWarnings,
  validateAccessibilityOrDie,
  validateDocsOnlyFlag,
} from './wu-done-policies.js';
import {
  detectParallelCompletions,
  ensureNoAutoStagedOrNoop,
  runTripwireCheck,
  validateBranchOnlyMode,
  validateStagedFiles,
} from './wu-done-git-ops.js';
import { flushWuLifecycleSync } from './wu-lifecycle-sync/service.js';
import { WU_LIFECYCLE_COMMANDS } from './wu-lifecycle-sync/constants.js';

export {
  buildGatesCommand,
  buildMissingSpawnPickupEvidenceMessage,
  buildMissingSpawnProvenanceMessage,
  buildMissingWuBriefEvidenceMessage,
  enforceSpawnProvenanceForDone,
  enforceWuBriefEvidenceForDone,
  hasSpawnPickupEvidence,
  printExposureWarnings,
  shouldEnforceSpawnProvenance,
  shouldEnforceWuBriefEvidence,
  validateAccessibilityOrDie,
  validateDocsOnlyFlag,
} from './wu-done-policies.js';
export { isBranchAlreadyMerged } from './wu-done-git-ops.js';

// WU-1588: Memory layer constants
const MEMORY_SIGNAL_TYPES = {
  WU_COMPLETION: 'wu_completion',
};
const MEMORY_CHECKPOINT_NOTES = {
  PRE_GATES: 'Pre-gates checkpoint for recovery if gates fail',
};
const MEMORY_SIGNAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour for recent signals

export const CHECKPOINT_GATE_MODES = {
  OFF: 'off',
  WARN: 'warn',
  BLOCK: 'block',
} as const;

type CheckpointGateMode = (typeof CHECKPOINT_GATE_MODES)[keyof typeof CHECKPOINT_GATE_MODES];

const CHECKPOINT_GATE_CONFIG = {
  PATH: 'memory.enforcement.require_checkpoint_for_done',
  COMMAND_PREFIX: 'pnpm mem:checkpoint --wu',
  WARN_TAG: 'WU-1998',
} as const;

type CheckpointNodes = Awaited<ReturnType<typeof queryByWu>>;

interface EnforceCheckpointGateForDoneOptions {
  id: string;
  workspacePath: string;
  mode: CheckpointGateMode;
  queryByWuFn?: (basePath: string, wuId: string) => Promise<CheckpointNodes>;
  hasSessionCheckpointsFn?: (wuId: string, wuNodes: CheckpointNodes) => boolean;
  log?: (message: string) => void;
  blocker?: (message: string) => void;
}

function buildCheckpointGateBlockMessage(id: string): string {
  return (
    `${STRING_LITERALS.NEWLINE}${LOG_PREFIX.DONE} ${EMOJI.FAILURE} No checkpoints found for ${id} session.${STRING_LITERALS.NEWLINE}` +
    `${LOG_PREFIX.DONE} ${CHECKPOINT_GATE_CONFIG.PATH} is set to '${CHECKPOINT_GATE_MODES.BLOCK}'.${STRING_LITERALS.NEWLINE}` +
    `${LOG_PREFIX.DONE} Create a checkpoint before completing: ${CHECKPOINT_GATE_CONFIG.COMMAND_PREFIX} ${id}${STRING_LITERALS.NEWLINE}`
  );
}

function buildCheckpointGateWarnMessages(id: string): string[] {
  return [
    `${STRING_LITERALS.NEWLINE}${LOG_PREFIX.DONE} ${EMOJI.INFO} ${CHECKPOINT_GATE_CONFIG.WARN_TAG}: No prior checkpoints recorded for ${id} in this session.`,
    `${LOG_PREFIX.DONE} A pre-gates checkpoint will be created automatically by wu:done.`,
    `${LOG_PREFIX.DONE} For earlier crash recovery, run '${CHECKPOINT_GATE_CONFIG.COMMAND_PREFIX} ${id}' after each acceptance criterion, before gates, or every 30 tool calls.${STRING_LITERALS.NEWLINE}`,
  ];
}

export function resolveCheckpointGateMode(mode: unknown): CheckpointGateMode {
  if (mode === CHECKPOINT_GATE_MODES.OFF) {
    return CHECKPOINT_GATE_MODES.OFF;
  }
  if (mode === CHECKPOINT_GATE_MODES.BLOCK) {
    return CHECKPOINT_GATE_MODES.BLOCK;
  }
  return CHECKPOINT_GATE_MODES.WARN;
}

export async function enforceCheckpointGateForDone({
  id,
  workspacePath,
  mode,
  queryByWuFn = queryByWu,
  hasSessionCheckpointsFn = hasSessionCheckpoints,
  log = console.log,
  blocker = (message: string) => {
    die(message);
  },
}: EnforceCheckpointGateForDoneOptions): Promise<void> {
  if (mode === CHECKPOINT_GATE_MODES.OFF) {
    return;
  }

  let wuNodes: CheckpointNodes;
  try {
    wuNodes = await queryByWuFn(workspacePath, id);
    if (hasSessionCheckpointsFn(id, wuNodes)) {
      return;
    }
  } catch {
    // Fail-open: checkpoint discovery issues should not block wu:done.
    return;
  }

  if (mode === CHECKPOINT_GATE_MODES.BLOCK) {
    blocker(buildCheckpointGateBlockMessage(id));
    return;
  }

  const warnMessages = buildCheckpointGateWarnMessages(id);
  for (const message of warnMessages) {
    log(message);
  }
}

interface WUDocLike extends Record<string, unknown> {
  id?: string;
  title?: string;
  initiative?: string;
  lane?: string;
  type?: string;
  status?: string;
  locked?: boolean;
  baseline_main_sha?: string;
  code_paths?: string[];
  notes?: string | string[];
  assigned_to?: string | null;
}

function normalizeWUDocLike(doc: unknown): WUDocLike {
  if (!doc || typeof doc !== 'object') {
    return {};
  }

  const normalized: WUDocLike = { ...(doc as Record<string, unknown>) };
  if (typeof normalized.status !== 'string') {
    delete normalized.status;
  }
  return normalized;
}

interface TransactionState {
  id: string;
  timestamp: string;
  wuYamlContent: string | null;
  stampExisted: boolean;
  backlogContent: string | null;
  statusContent: string | null;
  mainSHA: string;
  laneBranch: string;
}

interface OwnershipCheckResult {
  valid: boolean;
  error: string | null;
  auditEntry: Record<string, unknown> | null;
}

interface WuDoneArgsLike {
  skipGates?: boolean;
  reason?: string;
  fixWu?: string;
  force?: boolean;
  overrideOwner?: boolean;
  skipCosGates?: boolean;
  skipExposureCheck?: boolean;
  skipAccessibilityCheck?: boolean;
  allowTodo?: boolean;
  noAutoRebase?: boolean;
  docsOnly?: boolean;
  [key: string]: unknown;
}

interface PreFlightParams {
  id: string;
  args: WuDoneArgsLike;
  isBranchOnly: boolean;
  isDocsOnly: boolean;
  docMain: WUDocLike;
  docForValidation: WUDocLike;
  derivedWorktree: string | null;
}

interface StateHudParams {
  id: string;
  docMain: WUDocLike;
  isBranchOnly: boolean;
  isDocsOnly: boolean;
  derivedWorktree: string | null;
  STAMPS_DIR: string;
}

// WU-2099: Shared resolvers extracted to state-path-resolvers.ts

/**
 * WU-1804: Preflight validation for claim metadata before gates.
 *
 * Validates that the WU is properly claimed before running gates:
 * 1. Worktree YAML status must be 'in_progress'
 * 2. State store must show WU as 'in_progress'
 *
 * If either fails, exits before gates with actionable guidance to repair claim metadata.
 * This prevents burning tokens on gates that will ultimately fail.
 *
 * @param {string} id - WU ID
 * @param {string} worktreePath - Path to the worktree
 * @param {string} yamlStatus - Current status from worktree YAML
 * @returns {Promise<void>}
 */
async function validateClaimMetadataBeforeGates(
  id: string,
  worktreePath: string,
  yamlStatus: unknown,
) {
  const errors = [];

  // Check 1: YAML status must be in_progress
  if (yamlStatus !== WU_STATUS.IN_PROGRESS) {
    errors.push(`Worktree YAML status is '${yamlStatus}', expected '${WU_STATUS.IN_PROGRESS}'`);
  }

  // Check 2: State store must show WU as in_progress
  const resolvedWorktreePath = path.resolve(worktreePath);
  const stateDir = resolveStateDir(resolvedWorktreePath);
  const eventsPath = path.join(
    resolvedWorktreePath,
    resolveWuEventsRelativePath(resolvedWorktreePath),
  );

  try {
    const store = new WUStateStore(stateDir);
    await store.load();
    const inProgress = store.getByStatus(WU_STATUS.IN_PROGRESS);
    if (!inProgress.has(id)) {
      errors.push(`State store does not show ${id} as in_progress (path: ${eventsPath})`);
    }
  } catch (err) {
    errors.push(`Cannot read state store: ${getErrorMessage(err)} (path: ${eventsPath})`);
  }

  // If no errors, we're good
  if (errors.length === 0) {
    return;
  }

  // Build actionable error message with canonical wu:repair --claim guidance
  const repairCommand = buildClaimRepairCommand(id);
  die(
    `❌ CLAIM METADATA VALIDATION FAILED (WU-1804)\n\n` +
      `Cannot proceed with wu:done - the WU is not properly claimed.\n\n` +
      `Issues detected:\n${errors.map((e) => `  - ${e}`).join('\n')}\n\n` +
      `This typically happens when:\n` +
      `  • A crash/rebase interrupted worktree creation\n` +
      `  • The claim transaction was partially completed\n` +
      `  • Another process modified the WU state\n\n` +
      `Next step:\n` +
      `  ${repairCommand}\n\n` +
      `After repair, retry:\n` +
      `  pnpm wu:done --id ${id}\n\n` +
      `See: https://lumenflow.dev/reference/troubleshooting-wu-done/ for more recovery options.`,
  );
}

async function _assertWorktreeWUInProgressInStateStore(id: string, worktreePath: string) {
  const resolvedWorktreePath = path.resolve(worktreePath);
  const stateDir = resolveStateDir(resolvedWorktreePath);
  const eventsPath = path.join(
    resolvedWorktreePath,
    resolveWuEventsRelativePath(resolvedWorktreePath),
  );

  const store = new WUStateStore(stateDir);
  try {
    await store.load();
  } catch (err) {
    die(
      `Cannot read WU state store for ${id}.\n\n` +
        `Path: ${eventsPath}\n\n` +
        `Error: ${getErrorMessage(err)}\n\n` +
        `If this WU was claimed on an older tool version or the event log is missing/corrupt,\n` +
        `repair the worktree state store before rerunning wu:done.`,
    );
  }

  const inProgress = store.getByStatus(WU_STATUS.IN_PROGRESS);
  if (!inProgress.has(id)) {
    die(
      `WU ${id} is not in_progress in the worktree state store.\n\n` +
        `Path: ${eventsPath}\n\n` +
        `This will fail later when wu:done tries to append a complete event and regenerate backlog/status.\n` +
        `Fix the claim/state log first, then rerun wu:done.`,
    );
  }
}

/**
 * WU-1588: Create pre-gates checkpoint for recovery if gates fail.
 * Non-blocking wrapper around mem:checkpoint - failures logged as warnings.
 *
 * @param {string} id - WU ID
 * @param {string|null} worktreePath - Path to worktree
 * @param {string} baseDir - Base directory for memory layer
 * @returns {Promise<void>}
 */
async function createPreGatesCheckpoint(
  id: string,
  worktreePath: string | null,
  baseDir: string = process.cwd(),
) {
  try {
    const result = await createCheckpoint(baseDir, {
      note: MEMORY_CHECKPOINT_NOTES.PRE_GATES,
      wuId: id,
      progress: `Starting gates execution for ${id}`,
      nextSteps: worktreePath
        ? `Gates running in worktree: ${worktreePath}`
        : 'Gates running in branch-only mode',
      trigger: 'wu-done-pre-gates',
    });
    if (result.success) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pre-gates checkpoint created (${result.checkpoint.id})`,
      );
    }
  } catch (err) {
    // Non-blocking: checkpoint failure should not block wu:done
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not create pre-gates checkpoint: ${getErrorMessage(err)}`,
    );
  }
}

/**
 * WU-1588: Broadcast completion signal to parallel agents.
 * Non-blocking wrapper around mem:signal - failures logged as warnings.
 *
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @param {string} baseDir - Base directory for memory layer
 * @returns {Promise<void>}
 */
async function broadcastCompletionSignal(
  id: string,
  title: string,
  baseDir: string = process.cwd(),
) {
  try {
    const result = await createSignal(baseDir, {
      message: `${MEMORY_SIGNAL_TYPES.WU_COMPLETION}: ${id} - ${title}`,
      wuId: id,
    });
    if (result.success) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Completion signal broadcast (${result.signal.id})`,
      );
    }
  } catch (err) {
    // Non-blocking: signal failure should not block wu:done
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not broadcast completion signal: ${getErrorMessage(err)}`,
    );
  }
}

/**
 * WU-1588: Check inbox for recent signals from parallel agents.
 * Non-blocking wrapper around loadSignals - failures logged as warnings.
 *
 * @param {string} id - Current WU ID (for filtering)
 * @param {string} baseDir - Base directory for memory layer
 * @returns {Promise<void>}
 */
async function checkInboxForRecentSignals(id: string, baseDir: string = process.cwd()) {
  try {
    const since = new Date(Date.now() - MEMORY_SIGNAL_WINDOW_MS);
    const signals = await loadSignals(baseDir, { since, unreadOnly: true });

    // Filter out signals for current WU
    const relevantSignals = signals.filter((s) => s.wu_id !== id);

    if (relevantSignals.length > 0) {
      console.log(`\n${LOG_PREFIX.DONE} ${EMOJI.INFO} Recent signals from parallel agents:`);
      for (const signal of relevantSignals.slice(0, 5)) {
        // Show at most 5
        const timestamp = new Date(signal.created_at).toLocaleTimeString();
        console.log(`  - [${timestamp}] ${signal.message}`);
      }
      if (relevantSignals.length > 5) {
        console.log(`  ... and ${relevantSignals.length - 5} more`);
      }
      console.log(`  Run 'pnpm mem:inbox' for full list\n`);
    }
  } catch (err) {
    // Non-blocking: inbox check failure should not block wu:done
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not check inbox for signals: ${getErrorMessage(err)}`,
    );
  }
}

/**
 * WU-1946: Update spawn registry on WU completion.
 * Non-blocking wrapper - failures logged as warnings.
 *
 * When a WU is completed via wu:done, this function updates the spawn registry
 * to mark the spawned entry as completed (if one exists). This allows orchestrators
 * to track sub-agent spawn completion status.
 *
 * Gracefully skips if:
 * - No spawn entry found for this WU (legacy WU created before registry)
 * - Registry file doesn't exist
 * - Any error during update
 *
 * @param {string} id - WU ID being completed
 * @param {string} baseDir - Base directory containing .lumenflow/state/
 * @returns {Promise<void>}
 */
export async function updateSpawnRegistryOnCompletion(id: string, baseDir: string = process.cwd()) {
  try {
    const store = new DelegationRegistryStore(resolveStateDir(baseDir));
    await store.load();

    const spawnEntry = store.getByTarget(id);

    // Graceful skip if no spawn entry found (legacy WU)
    if (!spawnEntry) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} No spawn registry entry found for ${id} (legacy WU or not spawned)`,
      );
      return;
    }

    // Update status to completed with completedAt timestamp
    await store.updateStatus(spawnEntry.id, DelegationStatus.COMPLETED);
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Spawn registry updated: ${id} marked as completed`,
    );
  } catch (err) {
    // Non-blocking: spawn registry update failure should not block wu:done
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not update spawn registry for ${id}: ${getErrorMessage(err)}`,
    );
  }
}

// Git config keys used for user identification
const GIT_CONFIG_USER_NAME = 'user.name';
const GIT_CONFIG_USER_EMAIL = 'user.email';

// Default fallback messages
const DEFAULT_NO_REASON = '(no reason provided)';

/**
 * WU-1234: Normalize username for ownership comparison
 * Extracts username from email address for comparison.
 * This allows tom@hellm.ai to match 'tom' assigned_to field.
 *
 * @param {string|null|undefined} value - Email address or username
 * @returns {string} Normalized username (lowercase)
 */
export function normalizeUsername(value: string | null | undefined): string {
  if (!value) return '';
  const str = String(value).trim();
  // Extract username from email: tom@hellm.ai -> tom
  // WU-1281: Using string split instead of regex
  const atIndex = str.indexOf('@');
  const username = atIndex > 0 ? str.slice(0, atIndex) : str;
  return username.toLowerCase();
}

// WU-1281: isDocsOnlyByPaths removed - use shouldSkipWebTests from path-classifiers.ts
// The validators already use shouldSkipWebTests via detectDocsOnlyByPaths wrapper.
// Keeping the export for backward compatibility but re-exporting the canonical function.
export { shouldSkipWebTests as isDocsOnlyByPaths } from '@lumenflow/core/path-classifiers';

/**
 * WU-1234: Pre-flight check for backlog state consistency
 * Fails fast if the WU appears in both Done and In Progress sections.
 *
 * @param {string} id - WU ID to check
 * @param {string} backlogPath - Path to backlog.md
 * @returns {{ valid: boolean, error: string|null }}
 */
export function checkBacklogConsistencyForWU(
  id: string,
  backlogPath: string,
): { valid: boolean; error: string | null } {
  try {
    const result = validateBacklogSync(backlogPath);

    // Check if this specific WU is in both Done and In Progress
    if (!result.valid) {
      for (const error of result.errors) {
        // Check if the error mentions both Done and In Progress AND mentions our WU
        if (error.includes('Done and In Progress') && error.includes(id)) {
          return {
            valid: false,
            error:
              `❌ BACKLOG STATE INCONSISTENCY: ${id} found in both Done and In Progress sections.\n\n` +
              `This is an invalid state that must be fixed manually before wu:done can proceed.\n\n` +
              `Fix options:\n` +
              `  1. If ${id} is truly done: Remove from In Progress in backlog.md\n` +
              `  2. If ${id} needs more work: Remove from Done in backlog.md, update WU YAML status\n\n` +
              `After fixing backlog.md, retry: pnpm wu:done --id ${id}`,
          };
        }
      }
    }

    return { valid: true, error: null };
  } catch (e) {
    // If validation fails (e.g., file not found), warn but don't block
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not validate backlog consistency: ${getErrorMessage(e)}`,
    );
    return { valid: true, error: null };
  }
}

/**
 * Read commitlint header-max-length from config, fallback to DEFAULTS.MAX_COMMIT_SUBJECT
 * WU-1281: Using centralized constant instead of hardcoded 100
 */
function getCommitHeaderLimit() {
  try {
    const configPath = path.join(process.cwd(), '.commitlintrc.json');
    if (!existsSync(configPath)) return DEFAULTS.MAX_COMMIT_SUBJECT;
    const cfg = JSON.parse(
      readFileSync(configPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding }),
    );
    return cfg?.rules?.['header-max-length']?.[2] ?? DEFAULTS.MAX_COMMIT_SUBJECT;
  } catch {
    return DEFAULTS.MAX_COMMIT_SUBJECT; // Fallback if config is malformed or missing
  }
}

// ensureOnMain() moved to wu-helpers.ts (WU-1256)

export function emitTelemetry(event: Record<string, unknown>): void {
  const logPath = path.join('.lumenflow', 'flow.log');
  const logDir = path.dirname(logPath);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
  appendFileSync(logPath, `${line}\n`, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
}

async function auditSkipGates(
  id: string,
  reason: unknown,
  fixWU: unknown,
  worktreePath: string | null,
): Promise<void> {
  const auditBaseDir = worktreePath || process.cwd();
  const auditPath = path.join(auditBaseDir, '.lumenflow', 'skip-gates-audit.log');
  const auditDir = path.dirname(auditPath);
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const gitAdapter = getGitForCwd();
  const userName = await gitAdapter.getConfigValue(GIT_CONFIG_USER_NAME);
  const userEmail = await gitAdapter.getConfigValue(GIT_CONFIG_USER_EMAIL);
  const commitHash = await gitAdapter.getCommitHash();
  const reasonText = typeof reason === 'string' ? reason : undefined;
  const fixWUText = typeof fixWU === 'string' ? fixWU : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    wu_id: id,
    reason: reasonText || DEFAULT_NO_REASON,
    fix_wu: fixWUText || '(no fix WU specified)',
    worktree: worktreePath || '(unknown)',
    git_user: `${userName.trim()} <${userEmail.trim()}>`,
    git_commit: commitHash.trim(),
  };
  const line = JSON.stringify(entry);
  appendFileSync(auditPath, `${line}\n`, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.MEMO} Skip-gates event logged to ${path.relative(process.cwd(), auditPath) || auditPath}`,
  );
}

/**
 * Audit trail for COS gates skip (COS v1.3 S7)
 * WU-1852: Renamed from skip-cos-gates to avoid referencing non-existent CLI flag
 */
async function auditSkipCosGates(
  id: string,
  reason: unknown,
  worktreePath: string | null,
): Promise<void> {
  const auditBaseDir = worktreePath || process.cwd();
  const auditPath = path.join(auditBaseDir, '.lumenflow', 'skip-cos-gates-audit.log');
  const auditDir = path.dirname(auditPath);
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const gitAdapter = getGitForCwd();
  const userName = await gitAdapter.getConfigValue(GIT_CONFIG_USER_NAME);
  const userEmail = await gitAdapter.getConfigValue(GIT_CONFIG_USER_EMAIL);
  const commitHash = await gitAdapter.getCommitHash();
  const reasonText = typeof reason === 'string' ? reason : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    wu_id: id,
    reason: reasonText || DEFAULT_NO_REASON,
    git_user: `${userName.trim()} <${userEmail.trim()}>`,
    git_commit: commitHash.trim(),
  };
  const line = JSON.stringify(entry);
  appendFileSync(auditPath, `${line}\n`, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.MEMO} Skip-COS-gates event logged to ${auditPath}`);
}

// WU-2308: validateAllPreCommitHooks moved to wu-done-validators.ts
// Now accepts worktreePath parameter to run audit from worktree context

/**
 * Check if node_modules in worktree may be stale
 * Detects when package.json differs between main and worktree, which indicates
 * dependencies were added/removed but pnpm install may not have run in worktree.
 * This prevents confusing typecheck failures due to missing dependencies.
 * @param {string} worktreePath - Path to worktree
 */
function checkNodeModulesStaleness(worktreePath: string): void {
  try {
    const mainPackageJson = path.resolve('package.json');
    const worktreePackageJson = path.resolve(worktreePath, 'package.json');

    if (!existsSync(mainPackageJson) || !existsSync(worktreePackageJson)) {
      // No package.json to compare
      return;
    }

    const mainContent = readFileSync(mainPackageJson, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    });
    const worktreeContent = readFileSync(worktreePackageJson, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    });

    // Compare package.json files
    if (mainContent !== worktreeContent) {
      const worktreeNodeModules = path.resolve(worktreePath, 'node_modules');

      // Check if node_modules exists and when it was last modified
      if (existsSync(worktreeNodeModules)) {
        const nodeModulesStat = statSync(worktreeNodeModules);
        const packageJsonStat = statSync(worktreePackageJson);

        // If package.json is newer than node_modules, dependencies may be stale
        if (packageJsonStat.mtimeMs > nodeModulesStat.mtimeMs) {
          console.log(
            `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WARNING: Potentially stale node_modules detected\n\n` +
              `  package.json in worktree differs from main checkout\n` +
              `  node_modules was last modified: ${nodeModulesStat.mtime.toISOString()}\n` +
              `  package.json was last modified: ${packageJsonStat.mtime.toISOString()}\n\n` +
              `  If gates fail with missing dependencies/types, run:\n` +
              `    cd ${worktreePath}\n` +
              `    pnpm install\n` +
              `    cd -\n` +
              `    pnpm wu:done --id <WU-ID>\n`,
          );
        }
      } else {
        // node_modules doesn't exist at all
        console.log(
          `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WARNING: node_modules missing in worktree\n\n` +
            `  package.json in worktree differs from main checkout\n` +
            `  but node_modules directory does not exist\n\n` +
            `  If gates fail with missing dependencies/types, run:\n` +
            `    cd ${worktreePath}\n` +
            `    pnpm install\n` +
            `    cd -\n` +
            `    pnpm wu:done --id <WU-ID>\n`,
        );
      }
    }
  } catch (e) {
    // Non-critical check - just warn if it fails
    console.warn(
      `${LOG_PREFIX.DONE} Could not check node_modules staleness: ${getErrorMessage(e)}`,
    );
  }
}

/**
 * Run gates in worktree
 * @param {string} worktreePath - Path to worktree
 * @param {string} id - WU ID
 * @param {object} options - Gates options
 * @param {boolean} options.isDocsOnly - Auto-detected docs-only from code_paths
 * @param {boolean} options.docsOnly - Explicit --docs-only flag from CLI
 */
async function runGatesInWorktree(
  worktreePath: string,
  id: string,
  options: { isDocsOnly?: boolean; docsOnly?: boolean; scopedTestPaths?: string[] } = {},
) {
  const { isDocsOnly = false, docsOnly = false, scopedTestPaths } = options;
  console.log(`\n${LOG_PREFIX.DONE} Running gates in worktree: ${worktreePath}`);

  // Check for stale node_modules before running gates (prevents confusing failures)
  checkNodeModulesStaleness(worktreePath);

  // WU-1012: Use docs-only gates if explicit --docs-only flag OR auto-detected
  const useDocsOnlyGates = docsOnly || isDocsOnly;
  if (useDocsOnlyGates) {
    console.log(`${LOG_PREFIX.DONE} Using docs-only gates (skipping lint/typecheck/tests)`);
    if (docsOnly) {
      console.log(`${LOG_PREFIX.DONE} (explicit --docs-only flag)`);
    }
  }
  const startTime = Date.now();
  try {
    const ok = Boolean(
      await runGates({
        cwd: worktreePath,
        docsOnly: useDocsOnlyGates,
        coverageMode: undefined,
        scopedTestPaths,
      }),
    );
    if (!ok) {
      throw createError(ErrorCodes.GATES_FAILED, 'Gates failed');
    }
    const duration = Date.now() - startTime;
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Gates passed in ${prettyMs(duration)}`);
    emitTelemetry({ script: 'wu-done', wu_id: id, step: 'gates', ok: true, duration_ms: duration });
    return true;
  } catch {
    const duration = Date.now() - startTime;
    emitTelemetry({
      script: 'wu-done',
      wu_id: id,
      step: 'gates',
      ok: false,
      duration_ms: duration,
    });

    // WU-1280: Prominent error summary box (visible after ~130k chars of gate output)
    // WU-1281: Extracted to helper using pretty-ms for duration formatting
    printGateFailureBox({ id, location: worktreePath, durationMs: duration, isWorktreeMode: true });

    die(`Gates failed in ${worktreePath}. Fix issues in the worktree and try again.`);
  }
}

// Note: updateStatusRemoveInProgress, addToStatusCompleted, and moveWUToDoneBacklog
// have been extracted to tools/lib/wu-status-updater.ts and imported above (WU-1163)
//
// Note: ensureStamp has been replaced with createStamp from tools/lib/stamp-utils.ts (WU-1163)
//
// Note: readWUPreferWorktree, detectCurrentWorktree, defaultWorktreeFrom, detectWorkspaceMode,
// defaultBranchFrom, branchExists, runCleanup have been extracted to
// tools/lib/wu-done-validators.ts and imported above (WU-1215)

/**
 * WU-755 + WU-1230: Record transaction state for rollback
 * @param {string} id - WU ID
 * @param {string} wuPath - Path to WU YAML
 * @param {string} stampPath - Path to stamp file
 * @param {string} backlogPath - Path to backlog.md (WU-1230)
 * @param {string} statusPath - Path to status.md (WU-1230)
 * @returns {object} - Transaction state for rollback
 */
function recordTransactionState(
  id: string,
  wuPath: string,
  stampPath: string,
  backlogPath: string,
  statusPath: string,
): TransactionState {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Git is a required local tool in the CLI runtime.
  const mainSHA = execSync('git rev-parse HEAD', {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  }).trim();
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Git is a required local tool in the CLI runtime.
  const laneBranch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
  }).trim();
  return {
    id,
    timestamp: new Date().toISOString(),
    wuYamlContent: existsSync(wuPath)
      ? readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding })
      : null,
    stampExisted: existsSync(stampPath),
    backlogContent: existsSync(backlogPath)
      ? readFileSync(backlogPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding })
      : null,
    statusContent: existsSync(statusPath)
      ? readFileSync(statusPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding })
      : null,
    mainSHA,
    laneBranch,
  };
}

/**
 * WU-755 + WU-1230: Rollback transaction on failure
 * @param {object} txState - Transaction state from recordTransactionState
 * @param {string} wuPath - Path to WU YAML
 * @param {string} stampPath - Path to stamp file
 * @param {string} backlogPath - Path to backlog.md (WU-1230)
 * @param {string} statusPath - Path to status.md (WU-1230)
 */

async function rollbackTransaction(
  txState: TransactionState,
  wuPath: string,
  stampPath: string,
  backlogPath: string,
  statusPath: string,
): Promise<void> {
  console.error(
    `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} ROLLING BACK TRANSACTION (WU-755 + WU-1230 + WU-1255 + WU-1280)...`,
  );

  // WU-1280: ATOMIC ROLLBACK - Clean git state FIRST, then restore files
  // Previous order (restore → git checkout) caused issues:
  // - git checkout -- . would UNDO file restorations
  // - Left messy state with staged + unstaged conflicts
  //
  // New order:
  // 1. Unstage everything (git reset HEAD)
  // 2. Discard working tree changes (git checkout -- .)
  // 3. Remove stamp if created
  // 4. THEN restore files from txState

  // Step 1: Unstage all staged files FIRST
  // Emergency fix Session 2: Use git-adapter instead of raw execSync
  try {
    const gitAdapter = getGitForCwd();
    await gitAdapter.raw(['reset', 'HEAD']);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Unstaged all files`);
  } catch {
    // Ignore - may not have anything staged
  }

  // Step 2: Discard working directory changes (reset to last commit)
  // Emergency fix Session 2: Use git-adapter instead of raw execSync
  try {
    const gitAdapter = getGitForCwd();
    await gitAdapter.raw(['checkout', '--', '.']);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Reset working tree to HEAD`);
  } catch {
    // Ignore - may not have anything to discard
  }

  // Step 3: Remove stamp unconditionally if it exists (WU-1440)
  // Previous behavior only removed if !stampExisted, but that flag could be wrong
  // due to edge cases. Unconditional removal ensures clean rollback state.
  if (existsSync(stampPath)) {
    try {
      unlinkSync(stampPath);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Removed ${stampPath}`);
    } catch (err) {
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Failed to remove stamp: ${getErrorMessage(err)}`,
      );
    }
  }

  // Step 4: Restore files from txState (AFTER git cleanup)
  // Build list of files to restore with per-file error tracking (ref: WU-1255)
  const filesToRestore = [];

  // Restore backlog.md (ref: WU-1230)
  if (txState.backlogContent && existsSync(backlogPath)) {
    filesToRestore.push({ name: 'backlog.md', path: backlogPath, content: txState.backlogContent });
  }

  // Restore status.md (ref: WU-1230)
  if (txState.statusContent && existsSync(statusPath)) {
    filesToRestore.push({ name: 'status.md', path: statusPath, content: txState.statusContent });
  }

  // Restore WU YAML if it was modified
  if (txState.wuYamlContent && existsSync(wuPath)) {
    filesToRestore.push({ name: 'WU YAML', path: wuPath, content: txState.wuYamlContent });
  }

  // WU-1255: Use rollbackFiles utility for per-file error tracking
  const restoreResult = rollbackFiles(filesToRestore);

  // Log results
  for (const name of restoreResult.restored) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Restored ${name}`);
  }
  for (const err of restoreResult.errors) {
    console.error(
      `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Failed to restore ${err.name}: ${err.error}`,
    );
  }

  // Reset main to original SHA if we're on main
  try {
    const gitAdapter = getGitForCwd();
    const currentBranch = await gitAdapter.getCurrentBranch();
    if (currentBranch === BRANCHES.MAIN) {
      const currentSHA = await gitAdapter.getCommitHash();
      if (currentSHA !== txState.mainSHA) {
        await gitAdapter.reset(txState.mainSHA, { hard: true });
        // Emergency fix Session 2: Use GIT.SHA_SHORT_LENGTH constant
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Reset main to ${txState.mainSHA.slice(0, GIT.SHA_SHORT_LENGTH)}`,
        );
      }
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not reset main: ${getErrorMessage(e)}`);
  }

  // WU-1280: Verify clean git status after rollback
  // WU-1281: Extracted to helper to fix repeated parsing and magic number
  // Emergency fix Session 2: Use git-adapter instead of raw execSync
  try {
    const gitAdapter = getGitForCwd();
    const statusOutput = (await gitAdapter.raw(['status', '--porcelain'])).trim();
    if (statusOutput) {
      printStatusPreview(statusOutput);
    } else {
      console.log(`${LOG_PREFIX.DONE} ✅ Working tree is clean`);
    }
  } catch {
    // Ignore - git status may fail in edge cases
  }

  // WU-1255: Report final status with all errors
  if (restoreResult.errors.length > 0) {
    console.error(
      `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} Rollback completed with ${restoreResult.errors.length} error(s):`,
    );
    for (const err of restoreResult.errors) {
      console.error(`  - ${err.name}: ${err.error}`);
    }
    console.error(`${LOG_PREFIX.DONE} Manual intervention required for failed files`);
    console.error(`${LOG_PREFIX.DONE} See playbook.md section 12 "Scenario D" for recovery steps`);
  } else {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Rollback complete - WU state fully reverted (no infinite loop)`,
    );
  }
}

/**
 * Validate WU code paths for incomplete work markers and Mock classes
 * @param {object} doc - WU YAML document
 * @param {string} id - WU ID
 * @param {boolean} allowTodo - Allow incomplete work markers (with warning)
 * @param {string|null} worktreePath - Path to worktree to validate files from
 */
function runWUValidator(
  doc: WUDocLike,
  id: string,
  allowTodo = false,
  worktreePath: string | null = null,
): void {
  console.log(`\n${LOG_PREFIX.DONE} Running WU validator for ${id}...`);

  // Check if WU has code_paths defined
  const codePaths = doc.code_paths || [];
  if (codePaths.length === 0) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} No code_paths defined in WU YAML, skipping validator`,
    );
    return;
  }

  // Check if incomplete work flag requires justification in notes
  if (allowTodo) {
    // Handle both string and array formats for notes (WU-654)
    let notesText = '';
    if (typeof doc.notes === 'string') {
      notesText = doc.notes;
    } else if (Array.isArray(doc.notes)) {
      notesText = doc.notes.join(STRING_LITERALS.NEWLINE);
    }

    const hasJustification =
      notesText.toLowerCase().includes('todo') || notesText.toLowerCase().includes('allow-todo');
    if (!hasJustification) {
      die(
        '--allow-todo flag requires justification in WU YAML notes field.\n' +
          'Add a note explaining why TODOs are acceptable for this WU.',
      );
    }
  }

  // Validate from worktree if available (ensures we check the lane branch code)
  const validateOptions: { allowTodos: boolean; worktreePath?: string } = { allowTodos: allowTodo };
  if (worktreePath && existsSync(worktreePath)) {
    validateOptions.worktreePath = worktreePath;
    console.log(`${LOG_PREFIX.DONE} Validating code paths from worktree: ${worktreePath}`);
  }

  // Run validation
  const result = validateWUCodePaths(codePaths, validateOptions);

  // Display warnings
  if (result.warnings.length > 0) {
    console.log('\n⚠️  WU VALIDATOR WARNINGS:');
    result.warnings.forEach((warning) => console.log(warning));
  }

  // Handle errors
  if (!result.valid) {
    console.log('\n❌ WU VALIDATOR FAILED:');
    result.errors.forEach((error) => console.log(error));
    console.log('\nFix these issues before marking WU as done.');
    console.log(
      'Alternatively, use --allow-todo if TODOs are acceptable (requires justification in notes).',
    );
    die('WU validation failed. See errors above.');
  }

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU validator passed`);
}

/**
 * GUARDRAIL 2: Enforce ownership semantics in wu:done
 *
 * Validates that the current user owns the WU before allowing completion.
 * Prevents agents/humans from finishing WUs they do not own.
 *
 * @param {string} id - WU ID
 * @param {object} doc - WU YAML document
 * @param {string|null} worktreePath - Expected worktree path
 * @param {boolean} overrideOwner - Override flag (requires reason)
 * @param {string|null} overrideReason - Reason for override
 * @returns {{valid: boolean, error: string|null, auditEntry: object|null}}
 */

async function checkOwnership(
  id: string,
  doc: WUDocLike,
  worktreePath: string | null,
  overrideOwner = false,
  overrideReason: string | null = null,
): Promise<OwnershipCheckResult> {
  // Missing worktree means WU was not claimed properly (unless escape hatch applies)
  if (!worktreePath || !existsSync(worktreePath)) {
    return {
      valid: false,
      error:
        `Missing worktree for ${id}.\n\n` +
        `Expected worktree at: ${worktreePath || 'unknown'}\n\n` +
        `Worktrees are required for proper WU completion in Worktree mode.\n` +
        `If the worktree was removed, recreate it and retry, or use --skip-gates with justification.`,
      auditEntry: null,
    };
  }

  // Get assigned owner from WU YAML - read directly from worktree to ensure we get the lane branch version
  let assignedTo = doc.assigned_to || null;
  if (!assignedTo && worktreePath) {
    // Fallback: Read directly from worktree YAML if not present in doc (fixes WU-1106)
    const wtWUPath = path.join(worktreePath, WU_PATHS.WU(id));
    if (existsSync(wtWUPath)) {
      try {
        const text = readFileSync(wtWUPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
        const wtDoc = parseYAML(text);
        assignedTo = (wtDoc?.assigned_to as string) || null;
        if (assignedTo) {
          console.log(
            `${LOG_PREFIX.DONE} Note: Read assigned_to from worktree YAML (not found in main)`,
          );
        }
      } catch (err) {
        console.warn(
          `${LOG_PREFIX.DONE} Warning: Failed to read assigned_to from worktree: ${getErrorMessage(err)}`,
        );
      }
    }
  }
  if (!assignedTo) {
    return {
      valid: false,
      error:
        `WU ${id} has no assigned_to field.\n\n` +
        `This WU was claimed before ownership tracking was implemented.\n` +
        `To complete this WU:\n` +
        `  1. Add assigned_to: <your-email> to ${id}.yaml\n` +
        `  2. Commit the change\n` +
        `  3. Re-run: pnpm wu:done --id ${id}`,
      auditEntry: null,
    };
  }

  // Get current user identity
  let currentUser: string | null;
  try {
    currentUser = (await getGitForCwd().getConfigValue(GIT_CONFIG_USER_EMAIL)).trim();
  } catch {
    // Fallback to environment variable
    currentUser = process.env.GIT_USER || process.env.USER || null;
  }

  if (!currentUser) {
    return {
      valid: false,
      error:
        `Cannot determine current user identity.\n\n` +
        `Set git user.email or GIT_USER environment variable.`,
      auditEntry: null,
    };
  }

  // WU-1234: Normalize usernames for comparison (allows email vs username match)
  // e.g., tom@hellm.ai matches 'tom' assigned_to field
  const normalizedAssigned = normalizeUsername(assignedTo);
  const normalizedCurrent = normalizeUsername(currentUser);
  const isOwner = normalizedAssigned === normalizedCurrent;

  if (isOwner) {
    // Owner is completing their own WU - allow
    if (assignedTo !== currentUser) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Ownership match via normalization: "${assignedTo}" == "${currentUser}"`,
      );
    }
    return { valid: true, error: null, auditEntry: null };
  }

  // Not the owner - check for override
  if (overrideOwner) {
    if (!overrideReason) {
      return {
        valid: false,
        error: `--override-owner requires --reason "<why you're completing someone else's WU>"`,
        auditEntry: null,
      };
    }

    // Create audit entry
    const auditEntry = {
      timestamp: new Date().toISOString(),
      wu_id: id,
      assigned_to: assignedTo,
      completed_by: currentUser,
      reason: overrideReason,
      git_commit: (await getGitForCwd().getCommitHash()).trim(),
    };

    console.log(`\n⚠️  --override-owner: Completing WU assigned to someone else`);
    console.log(`   Assigned to: ${assignedTo}`);
    console.log(`   Completed by: ${currentUser}`);
    console.log(`   Reason: ${overrideReason}\n`);

    return { valid: true, error: null, auditEntry };
  }

  // Not the owner and no override - block
  return {
    valid: false,
    error:
      `\n❌ OWNERSHIP VIOLATION: ${id} is assigned to someone else\n\n` +
      `   Assigned to: ${assignedTo}\n` +
      `   Current user: ${currentUser}\n\n` +
      `   You cannot complete WUs you do not own.\n\n` +
      `   📋 Options:\n` +
      `      1. Contact ${assignedTo} to complete the WU\n` +
      `      2. Reassign the WU to yourself in ${id}.yaml (requires approval)\n` +
      `      3. Add co_assigned field for pairing (requires approval)\n\n` +
      `   ⚠️  To override (use with extreme caution):\n` +
      `      pnpm wu:done --id ${id} --override-owner --reason "<why>"\n\n` +
      `   AGENTS: NEVER use --override-owner without explicit instruction.\n` +
      `   Language protocol: "pick up WU-${id.replace('WU-', '')}" = READ ONLY.\n`,
    auditEntry: null,
  };
}

/**
 * Log ownership override to audit trail
 * @param {object} auditEntry - Audit entry to log
 */
function auditOwnershipOverride(auditEntry: Record<string, unknown>): void {
  const auditPath = path.join('.lumenflow', 'ownership-override-audit.log');
  const auditDir = path.dirname(auditPath);
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const line = JSON.stringify(auditEntry);
  appendFileSync(auditPath, `${line}\n`, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.MEMO} Ownership override logged to ${auditPath}`);
}

/**
 * Execute pre-flight checks before gates
 * Extracted from main() to reduce complexity (WU-1215 Phase 2 Extraction #3)
 * @param {object} params - Parameters
 * @param {string} params.id - WU ID
 * @param {object} params.args - Parsed CLI arguments
 * @param {boolean} params.isBranchOnly - Whether in branch-only mode
 * @param {boolean} params.isDocsOnly - Whether this is a docs-only WU
 * @param {object} params.docMain - Main WU YAML document
 * @param {object} params.docForValidation - WU YAML document to validate (worktree or main)
 * @param {string|null} params.derivedWorktree - Derived worktree path
 * @returns {Promise<{title: string, docForValidation: object}>} Updated title and doc
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
async function executePreFlightChecks({
  id,
  args,
  isBranchOnly,
  isDocsOnly,
  docMain,
  docForValidation,
  derivedWorktree,
}: PreFlightParams): Promise<{ title: string; docForValidation: WUDocLike }> {
  // YAML schema validation
  console.log(`${LOG_PREFIX.DONE} Validating WU YAML structure...`);
  const schemaResult = validateWU(docForValidation);
  if (!schemaResult.success) {
    const errors = schemaResult.error.issues
      .map((issue: ZodIssue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join(STRING_LITERALS.NEWLINE);
    die(`❌ WU YAML validation failed:\n\n${errors}\n\nFix these issues before running wu:done`);
  }

  // Additional done-specific validation
  if (docForValidation.status === WU_STATUS.DONE) {
    const doneResult = validateDoneWU(schemaResult.data);
    if (!doneResult.valid) {
      die(
        `❌ WU not ready for done status:\n\n${doneResult.errors.map((e) => `  - ${e}`).join(STRING_LITERALS.NEWLINE)}`,
      );
    }
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU YAML validation passed`);

  // WU-2079: Approval gate validation
  // Ensures required approvals are present before allowing completion
  console.log(`${LOG_PREFIX.DONE} Checking approval gates...`);
  const approvalResult = validateApprovalGates(schemaResult.data);
  if (!approvalResult.valid) {
    const governancePath = getConfig({ projectRoot: process.cwd() }).directories.governancePath;
    die(
      `❌ Approval gates not satisfied:\n\n${approvalResult.errors.map((e) => `  - ${e}`).join(STRING_LITERALS.NEWLINE)}\n\n` +
        `📋 To fix:\n` +
        `   1. Request approval from the required role(s)\n` +
        `   2. Add their email(s) to the 'approved_by' field in the WU YAML\n` +
        `   3. Re-run: pnpm wu:done --id ${id}\n\n` +
        `   See ${governancePath} for role definitions.`,
    );
  }
  // Log advisory warnings (non-blocking)
  if (approvalResult.warnings.length > 0) {
    approvalResult.warnings.forEach((w) => {
      console.warn(`${LOG_PREFIX.DONE} ⚠️  ${w}`);
    });
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Approval gates passed`);

  // WU-1805: Preflight code_paths and test_paths validation
  // Run BEFORE gates to catch YAML mismatches early (saves time vs. discovering after full gate run)
  const preflightResult = await executePreflightCodePathValidation(id, {
    rootDir: process.cwd(),
    worktreePath: derivedWorktree,
  });
  if (!preflightResult.valid) {
    const errorMessage = buildPreflightCodePathErrorMessage(id, preflightResult);
    die(errorMessage);
  }
  if (Array.isArray(preflightResult.warnings) && preflightResult.warnings.length > 0) {
    const warningLines = formatPreflightWarnings(
      preflightResult.warnings,
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Reality preflight warnings:`,
    );
    for (const line of warningLines) {
      console.log(line.startsWith('  - ') ? `${LOG_PREFIX.DONE} ${line}` : line);
    }
  }

  // WU-2310: Preflight type vs code_paths validation
  // Run BEFORE transaction to prevent documentation WUs with code paths from failing at git commit
  console.log(`${LOG_PREFIX.DONE} Validating type vs code_paths (WU-2310)...`);
  const typeVsCodePathsResult = validateTypeVsCodePathsPreflight(docForValidation);
  if (!typeVsCodePathsResult.valid) {
    const errorMessage = buildTypeVsCodePathsErrorMessage(id, typeVsCodePathsResult.blockedPaths);
    die(errorMessage);
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Type vs code_paths validation passed`);

  // Tripwire: Scan commands log for violations
  runTripwireCheck();

  // WU-1234: Pre-flight backlog consistency check
  // Fail fast if WU is in both Done and In Progress sections
  console.log(`${LOG_PREFIX.DONE} Checking backlog consistency...`);
  const backlogPath = WU_PATHS.BACKLOG();
  const backlogConsistency = checkBacklogConsistencyForWU(id, backlogPath);
  if (!backlogConsistency.valid) {
    die(backlogConsistency.error ?? 'Backlog consistency check failed');
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Backlog consistency check passed`);

  // WU-1276: Pre-flight WU state consistency check
  // Layer 2 defense-in-depth: fail fast if WU has pre-existing inconsistencies
  console.log(`${LOG_PREFIX.DONE} Checking WU state consistency...`);
  const stateCheck = await checkWUConsistency(id);
  if (!stateCheck.valid) {
    const errors = stateCheck.errors
      .map((e) => `  - ${e.type}: ${e.description}`)
      .join(STRING_LITERALS.NEWLINE);
    die(
      `Pre-existing inconsistencies for ${id}:\n${errors}\n\n` +
        `Fix with: pnpm wu:repair --id ${id}`,
    );
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU state consistency check passed`);

  // Branch-Only mode validation
  if (isBranchOnly) {
    const laneBranch = await defaultBranchFrom(docMain);
    if (!laneBranch) die('Cannot determine lane branch from WU YAML');

    const validation = await validateBranchOnlyMode(laneBranch);
    if (!validation.valid) {
      die(validation.error ?? 'Branch-only mode validation failed');
    }

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Branch-Only mode validation passed`);
    console.log(`${LOG_PREFIX.DONE} Working on branch: ${laneBranch}`);
  } else {
    // Worktree mode: must be on main
    await ensureOnMain(getGitForCwd());

    // P0 EMERGENCY FIX Part 1: Restore wu-events.jsonl BEFORE parallel completion check
    // Previous wu:done runs or memory layer writes may have left this file dirty,
    // which causes the auto-rebase to fail with "You have unstaged changes"
    if (derivedWorktree) {
      try {
        execSync(
          `git -C "${derivedWorktree}" restore "${resolveWuEventsRelativePath(derivedWorktree)}"`,
        );
      } catch {
        // Non-fatal: file might not exist or already clean
      }
    }

    // WU-1382: Detect parallel completions and warn
    // WU-1584 Fix #3: Trigger auto-rebase instead of just warning
    console.log(`${LOG_PREFIX.DONE} Checking for parallel WU completions...`);
    const parallelResult = await detectParallelCompletions(id, docForValidation);
    if (parallelResult.hasParallelCompletions) {
      console.warn(parallelResult.warning);
      // Emit telemetry for parallel detection
      emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'parallel_detection',
        parallel_wus: parallelResult.completedWUs,
        count: parallelResult.completedWUs.length,
      });

      // WU-1588: Check inbox for recent signals from parallel agents
      // Non-blocking: failures handled internally by checkInboxForRecentSignals
      await checkInboxForRecentSignals(id);

      // WU-1584: Instead of proceeding with warning, trigger auto-rebase
      // This prevents merge conflicts that would fail downstream
      if (derivedWorktree && !args.noAutoRebase) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-1584: Triggering auto-rebase to incorporate parallel completions...`,
        );
        const laneBranch = await defaultBranchFrom(docForValidation);
        if (laneBranch) {
          const rebaseResult = await autoRebaseBranch(laneBranch, derivedWorktree, id);
          if (rebaseResult.success) {
            console.log(
              `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU-1584: Auto-rebase complete - parallel completions incorporated`,
            );
            emitTelemetry({
              script: MICRO_WORKTREE_OPERATIONS.WU_DONE,
              wu_id: id,
              step: TELEMETRY_STEPS.PARALLEL_AUTO_REBASE,
              parallel_wus: parallelResult.completedWUs,
              count: parallelResult.completedWUs.length,
            });
          } else {
            // Rebase failed - provide detailed instructions
            console.error(`${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Auto-rebase failed`);
            console.error(rebaseResult.error);
            die(
              `WU-1584: Auto-rebase failed after detecting parallel completions.\n` +
                `Manual resolution required - see instructions above.`,
            );
          }
        }
      } else if (!args.noAutoRebase) {
        // No worktree path available - warn and proceed (legacy behavior)
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cannot auto-rebase (no worktree path) - proceeding with caution`,
        );
      } else {
        // Auto-rebase disabled - warn and proceed
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Auto-rebase disabled (--no-auto-rebase) - proceeding with caution`,
        );
      }
    }

    // WU-1381: Detect background processes that might interfere with gates
    // Non-blocking warning - helps agents understand mixed stdout/stderr output
    if (derivedWorktree) {
      await runBackgroundProcessCheck(derivedWorktree);
    }

    // WU-1804: Fail fast before gates with comprehensive claim metadata check.
    // Validates both YAML status AND state store BEFORE gates, not just one of them.
    // Provides actionable guidance to run wu:repair --claim if validation fails.
    if (derivedWorktree) {
      await validateClaimMetadataBeforeGates(id, derivedWorktree, docForValidation.status);
    }
  }

  // Use worktree title for commit message (not stale main title)
  const title = docForValidation.title || docMain.title || '';

  if (isDocsOnly) {
    console.log('\n📝 Docs-only WU detected');
    console.log('   - Gates will skip lint/typecheck/tests');
    console.log('   - Only docs/markdown paths allowed\n');
  }

  if (isBranchOnly) {
    console.log('\n🌿 Branch-Only mode detected');
    console.log('   - Gates run in main checkout on lane branch');
    console.log('   - No worktree to remove\n');
  }

  // Ownership check (skip in branch-only mode)
  if (!isBranchOnly) {
    const ownershipCheck = await checkOwnership(
      id,
      docForValidation,
      derivedWorktree,
      args.overrideOwner,
      args.reason,
    );

    if (!ownershipCheck.valid) {
      die(ownershipCheck.error ?? 'Ownership check failed');
    }

    // If override was used, log to audit trail and add to WU notes
    if (ownershipCheck.auditEntry) {
      auditOwnershipOverride(ownershipCheck.auditEntry);

      // Add override reason to WU notes (schema requires string, not array)
      const overrideNote = `Ownership override: Completed by ${ownershipCheck.auditEntry.completed_by} (assigned to ${ownershipCheck.auditEntry.assigned_to}). Reason: ${args.reason}`;
      appendNote(docForValidation, overrideNote);

      // Write updated WU YAML back to worktree
      if (derivedWorktree) {
        const wtWUPath = path.join(derivedWorktree, WU_PATHS.WU(id));
        if (existsSync(wtWUPath)) {
          writeWU(wtWUPath, docForValidation);
        }
      }
    }
  }

  // WU-1280: Early spec completeness validation (before gates)
  // Catches missing tests.manual, empty code_paths, etc. BEFORE 2min gate run
  console.log(`\n${LOG_PREFIX.DONE} Validating spec completeness for ${id}...`);
  const specResult = validateSpecCompleteness(docForValidation, id);
  if (!specResult.valid) {
    console.error(`\n❌ Spec completeness validation failed for ${id}:\n`);
    specResult.errors.forEach((err) => console.error(`  - ${err}`));
    // WU-1311: Use config-based path in error message
    const specConfig = getConfig();
    console.error(
      `\nFix these issues before running wu:done:\n` +
        `  1. Update ${specConfig.directories.wuDir}/${id}.yaml\n` +
        `  2. Fill description with Context/Problem/Solution\n` +
        `  3. Replace ${PLACEHOLDER_SENTINEL} text with specific criteria\n` +
        `  4. List all modified files in code_paths\n` +
        `  5. Add at least one test path (unit, e2e, integration, or manual)\n` +
        `  6. Re-run: pnpm wu:done --id ${id}\n\n` +
        `See: CLAUDE.md §2.7 "WUs are specs, not code"\n`,
    );
    die(`Cannot mark ${id} as done - spec incomplete`);
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Spec completeness check passed`);

  // WU-1351: Validate code_paths files exist (prevents false completions)
  // In worktree mode: validate files exist in worktree (will be merged)
  // In branch-only mode: validate files exist on current branch
  console.log(`\n${LOG_PREFIX.DONE} Validating code_paths existence for ${id}...`);
  const codePathsResult = await validateCodePathsExist(docForValidation, id, {
    worktreePath: derivedWorktree,
    targetBranch: isBranchOnly ? 'HEAD' : BRANCHES.MAIN,
  });
  if ('valid' in codePathsResult && !codePathsResult.valid) {
    console.error(`\n❌ code_paths validation failed for ${id}:\n`);
    if ('errors' in codePathsResult) {
      codePathsResult.errors.forEach((err: string) => console.error(err));
    }
    die(`Cannot mark ${id} as done - code_paths missing from target branch`);
  }

  // WU-1324 + WU-1542: Check mandatory agent compliance
  // WU-1542: --require-agents makes this a BLOCKING check
  const codePaths = docForValidation.code_paths || [];
  const compliance = checkMandatoryAgentsComplianceBlocking(codePaths, id, {
    blocking: Boolean(args.requireAgents),
  });

  if (compliance.blocking && compliance.errorMessage) {
    // WU-1542: Blocking mode - fail wu:done with detailed error
    die(compliance.errorMessage);
  } else if (!compliance.compliant) {
    // Non-blocking mode - show warning (original WU-1324 behavior)
    console.warn(`\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} MANDATORY AGENT WARNING`);
    console.warn(`The following mandatory agents were not confirmed as invoked:`);
    for (const agent of compliance.missing) {
      console.warn(`  • ${agent}`);
    }
    console.warn(`\nThis is a NON-BLOCKING warning.`);
    console.warn(`Use --require-agents to make this a blocking error.\n`);
  }

  // WU-1012: Validate --docs-only flag usage (BLOCKING)
  const docsOnlyValidation = validateDocsOnlyFlag(docForValidation, { docsOnly: args.docsOnly });
  if (!docsOnlyValidation.valid) {
    die(docsOnlyValidation.errors[0]);
  }

  // WU-1999: Exposure validation (NON-BLOCKING warning)
  printExposureWarnings(docForValidation, { skipExposureCheck: args.skipExposureCheck });

  // WU-2022: Feature accessibility validation (BLOCKING)
  validateAccessibilityOrDie(docForValidation, {
    skipAccessibilityCheck: args.skipAccessibilityCheck,
  });

  // Run WU validator
  runWUValidator(docForValidation, id, args.allowTodo, derivedWorktree);

  // Validate skip-gates requirements
  if (args.skipGates) {
    if (!args.reason) {
      die('--skip-gates requires --reason "<explanation of why gates are being skipped>"');
    }
    if (!args.fixWu) {
      die('--skip-gates requires --fix-wu WU-{id} (the WU that will fix the failing tests)');
    }
    if (!PATTERNS.WU_ID.test(args.fixWu.toUpperCase())) {
      die(`Invalid --fix-wu value '${args.fixWu}'. Expected format: WU-123`);
    }
  }

  return { title, docForValidation };
}

/**
 * Execute gates (engineering + COS governance)
 * Extracted from main() to reduce complexity (WU-1215 Phase 2 Extraction #2)
 * @param {object} params - Parameters
 * @param {string} params.id - WU ID
 * @param {object} params.args - Parsed CLI arguments
 * @param {boolean} params.isBranchOnly - Whether in branch-only mode
 * @param {boolean} params.isDocsOnly - Whether this is a docs-only WU
 * @param {string|null} params.worktreePath - Worktree path (null for branch-only)
 * @param {string} [params.branchName] - Lane branch name for checkpoint
 */

interface ExecuteGatesParams {
  id: string;
  args: Record<string, unknown>;
  isBranchOnly: boolean;
  isDocsOnly: boolean;
  worktreePath: string | null;
  branchName?: string;
  /** WU-2102: Scoped test paths from WU tests.unit for fallback when no checkpoint */
  scopedTestPaths?: string[];
}

interface ExecuteGatesResult {
  fullGatesRanInCurrentRun: boolean;
  skippedByCheckpoint: boolean;
  checkpointId: string | null;
}

async function executeGates({
  id,
  args,
  isBranchOnly,
  isDocsOnly,
  worktreePath,
  branchName,
  scopedTestPaths,
}: ExecuteGatesParams): Promise<ExecuteGatesResult> {
  const gateResult: ExecuteGatesResult = {
    fullGatesRanInCurrentRun: false,
    skippedByCheckpoint: false,
    checkpointId: null,
  };

  // WU-1747: Check if gates can be skipped based on valid checkpoint
  // This allows resuming wu:done without re-running gates if nothing changed
  // WU-2102: Look for checkpoint in worktree (where wu:prep writes it)
  const skipResult = canSkipGates(id, {
    currentHeadSha: undefined,
    baseDir: worktreePath || undefined,
  });
  if (skipResult.canSkip) {
    gateResult.skippedByCheckpoint = true;
    gateResult.checkpointId = skipResult.checkpoint.checkpointId;
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} ${CHECKPOINT_MESSAGES.SKIPPING_GATES_VALID}`);
    console.log(
      `${LOG_PREFIX.DONE} ${CHECKPOINT_MESSAGES.CHECKPOINT_LABEL}: ${skipResult.checkpoint.checkpointId}`,
    );
    console.log(
      `${LOG_PREFIX.DONE} ${CHECKPOINT_MESSAGES.GATES_PASSED_AT}: ${skipResult.checkpoint.gatesPassedAt}`,
    );
    emitTelemetry({
      script: TELEMETRY_STEPS.GATES,
      wu_id: id,
      step: TELEMETRY_STEPS.GATES,
      skipped: true,
      reason: SKIP_GATES_REASONS.CHECKPOINT_VALID,
      checkpoint_id: skipResult.checkpoint.checkpointId,
    });
    return gateResult; // Skip gates entirely
  }

  // WU-1747: Create checkpoint before gates for resumption on failure
  if (worktreePath && branchName) {
    try {
      await createWU1747Checkpoint({ wuId: id, worktreePath, branchName }, { gatesPassed: false });
    } catch (err) {
      // Non-blocking: checkpoint failure should not block wu:done
      console.warn(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} ${CHECKPOINT_MESSAGES.COULD_NOT_CREATE}: ${getErrorMessage(err)}`,
      );
    }
  }

  // WU-1588: Create pre-gates checkpoint for recovery if gates fail
  // Non-blocking: failures handled internally by createPreGatesCheckpoint
  // WU-1749 Bug 5: Pass worktreePath as baseDir to write to worktree's wu-events.jsonl, not main's
  await createPreGatesCheckpoint(id, worktreePath, worktreePath || process.cwd());

  // P0 EMERGENCY FIX: Restore wu-events.jsonl after checkpoint creation
  // WU-1748 added checkpoint persistence to wu-events.jsonl but doesn't commit it,
  // leaving unstaged changes that cause "git rebase" to fail with "You have unstaged changes"
  // This restores the file to HEAD state - checkpoint data is preserved in memory store
  if (worktreePath) {
    try {
      execSync(`git -C "${worktreePath}" restore "${resolveWuEventsRelativePath(worktreePath)}"`);
    } catch {
      // Non-fatal: file might not exist or already clean
    }
  }

  // Step 0a: Run invariants check (WU-2252: NON-BYPASSABLE, runs even with --skip-gates)
  // This ensures repo invariants are never violated, regardless of skip-gates flag
  // WU-2253: Run against worktreePath (when present) to catch violations that only exist in the worktree
  // WU-2425: Pass wuId to scope WU-specific invariants to just the completing WU
  const invariantsBaseDir = worktreePath || process.cwd();
  console.log(`\n${LOG_PREFIX.DONE} Running invariants check (non-bypassable)...`);
  console.log(`${LOG_PREFIX.DONE} Checking invariants in: ${invariantsBaseDir}`);
  const { runInvariants } = await import('@lumenflow/core/invariants-runner');
  const invariantsResult = runInvariants({ baseDir: invariantsBaseDir, silent: false, wuId: id });
  if (!invariantsResult.success) {
    emitTelemetry({
      script: 'wu-done',
      wu_id: id,
      step: 'invariants',
      ok: false,
    });
    die(
      `Invariants check failed. Fix violations before completing WU.\n\n${invariantsResult.formatted}`,
    );
  }
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Invariants check passed`);
  emitTelemetry({
    script: 'wu-done',
    wu_id: id,
    step: 'invariants',
    ok: true,
  });

  // Step 0b: Run gates BEFORE merge (or skip with audit trail)
  if (args.skipGates) {
    console.log(
      `\n${EMOJI.WARNING}  ${EMOJI.WARNING}  ${EMOJI.WARNING}  SKIP-GATES MODE ACTIVE ${EMOJI.WARNING}  ${EMOJI.WARNING}  ${EMOJI.WARNING}\n`,
    );
    console.log(`${LOG_PREFIX.DONE} Skipping gates check as requested`);
    console.log(`${LOG_PREFIX.DONE} Reason: ${args.reason}`);
    console.log(`${LOG_PREFIX.DONE} Fix WU: ${args.fixWu}`);
    console.log(`${LOG_PREFIX.DONE} Worktree: ${worktreePath || 'Branch-Only mode (no worktree)'}`);
    await auditSkipGates(id, args.reason, args.fixWu, worktreePath);
    console.log('\n⚠️  Ensure test failures are truly pre-existing!\n');
    emitTelemetry({
      script: 'wu-done',
      wu_id: id,
      step: 'gates',
      skipped: true,
      reason: args.reason,
      fix_wu: args.fixWu,
    });
  } else if (isBranchOnly) {
    // Branch-Only mode: run gates in-place (current directory on lane branch)
    console.log(`\n${LOG_PREFIX.DONE} Running gates in Branch-Only mode (in-place on lane branch)`);
    // WU-1012: Use docs-only gates if explicit --docs-only flag OR auto-detected
    const useDocsOnlyGates = Boolean(args.docsOnly) || Boolean(isDocsOnly);
    if (useDocsOnlyGates) {
      console.log(`${LOG_PREFIX.DONE} Using docs-only gates (skipping lint/typecheck/tests)`);
      if (args.docsOnly) {
        console.log(`${LOG_PREFIX.DONE} (explicit --docs-only flag)`);
      }
    }
    const startTime = Date.now();
    try {
      const ok = Boolean(await runGates({ docsOnly: useDocsOnlyGates }));
      if (!ok) {
        throw createError(ErrorCodes.GATES_FAILED, 'Gates failed');
      }
      const duration = Date.now() - startTime;
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Gates passed in ${prettyMs(duration)}`);
      emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'gates',
        ok: true,
        duration_ms: duration,
      });
    } catch {
      const duration = Date.now() - startTime;
      emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'gates',
        ok: false,
        duration_ms: duration,
      });

      // WU-1280: Prominent error summary box (Branch-Only mode)
      // WU-1281: Extracted to helper using pretty-ms for duration formatting
      printGateFailureBox({
        id,
        location: 'Branch-Only',
        durationMs: duration,
        isWorktreeMode: false,
      });

      die(`Gates failed in Branch-Only mode. Fix issues and try again.`);
    }
    gateResult.fullGatesRanInCurrentRun = true;
  } else if (worktreePath && existsSync(worktreePath)) {
    // Worktree mode: run gates in the dedicated worktree
    // WU-1012: Pass both auto-detected and explicit docs-only flags
    // WU-2102: Forward scopedTestPaths so wu:done uses scoped tests when no checkpoint skip
    await runGatesInWorktree(worktreePath, id, {
      isDocsOnly,
      docsOnly: Boolean(args.docsOnly),
      scopedTestPaths,
    });
    gateResult.fullGatesRanInCurrentRun = true;
  } else {
    die(
      `Worktree not found (${worktreePath || 'unknown'}). Gates must run in the lane worktree.\n` +
        `If the worktree was removed, recreate it and retry, or rerun with --branch-only when the lane branch exists.\n` +
        `Use --skip-gates only with justification.`,
    );
  }

  // Step 0.75: Run COS governance gates (WU-614, COS v1.3 §7)
  if (!args.skipCosGates) {
    console.log(`\n${LOG_PREFIX.DONE} Running COS governance gates...`);
    const startTime = Date.now();
    try {
      execSync(`${PKG_MANAGER} ${SCRIPTS.COS_GATES} ${CLI_FLAGS.WU} ${id}`, {
        stdio: 'inherit',
      });
      const duration = Date.now() - startTime;
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} COS gates passed in ${prettyMs(duration)}`);
      emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'cos-gates',
        ok: true,
        duration_ms: duration,
      });
    } catch {
      const duration = Date.now() - startTime;
      emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'cos-gates',
        ok: false,
        duration_ms: duration,
      });
      console.error(`\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} COS governance gates failed`);
      console.error('\nTo fix:');
      console.error('  1. Add required evidence to governance.evidence field in WU YAML');
      console.error('  2. See: https://lumenflow.dev/reference/evidence-format/');
      console.error('\nEmergency bypass (creates audit trail):');
      // WU-1852: Reference --skip-gates (the actual CLI flag), not the non-existent --skip-cos-gates
      console.error(
        `  pnpm wu:done --id ${id} --skip-gates --reason "COS evidence pending" --fix-wu WU-XXXX`,
      );
      die('Abort: WU not completed. Fix governance evidence and retry pnpm wu:done.');
    }
  } else {
    console.log(`\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} Skipping COS governance gates as requested`);
    console.log(`${LOG_PREFIX.DONE} Reason: ${args.reason || DEFAULT_NO_REASON}`);
    await auditSkipCosGates(id, args.reason, worktreePath);
    emitTelemetry({
      script: 'wu-done',
      wu_id: id,
      step: 'cos-gates',
      skipped: true,
      reason: args.reason,
    });
  }

  // WU-1747: Mark checkpoint as gates passed for resumption on failure
  // This allows subsequent wu:done attempts to skip gates if nothing changed
  markGatesPassed(id);

  return gateResult;
}

/**
 * Print State HUD for visibility
 * Extracted from main() to reduce complexity (WU-1215 Phase 2 Extraction #4)
 * @param {object} params - Parameters
 * @param {string} params.id - WU ID
 * @param {object} params.docMain - Main WU YAML document
 * @param {boolean} params.isBranchOnly - Whether in branch-only mode
 * @param {boolean} params.isDocsOnly - Whether this is a docs-only WU
 * @param {string|null} params.derivedWorktree - Derived worktree path
 * @param {string} params.STAMPS_DIR - Stamps directory path
 */
export function computeBranchOnlyFallback({
  isBranchOnly,
  branchOnlyRequested,
  worktreeExists,
  derivedWorktree,
}: {
  isBranchOnly: boolean;
  branchOnlyRequested: boolean | undefined;
  worktreeExists: boolean;
  derivedWorktree: string | null;
}) {
  const allowFallback =
    Boolean(branchOnlyRequested) && !isBranchOnly && !worktreeExists && Boolean(derivedWorktree);
  return {
    allowFallback,
    effectiveBranchOnly: isBranchOnly || allowFallback,
  };
}

export function getYamlStatusForDisplay(status: unknown) {
  return getWUStatusDisplay(status);
}

export function evaluateWuDoneMainMutationGuard(options: {
  mainCheckout: string;
  isBranchPr: boolean;
  hasActiveWorktreeContext: boolean;
  mainStatus: string;
}) {
  return evaluateMainDirtyMutationGuard({
    commandName: 'wu:done',
    mainCheckout: options.mainCheckout,
    mainStatus: options.mainStatus,
    hasActiveWorktreeContext: options.hasActiveWorktreeContext,
    isBranchPrMode: options.isBranchPr,
  });
}

function printStateHUD({
  id,
  docMain,
  isBranchOnly,
  isDocsOnly,
  derivedWorktree,
  STAMPS_DIR,
}: StateHudParams): void {
  const stampExists = existsSync(path.join(STAMPS_DIR, `${id}.done`)) ? 'yes' : 'no';
  const yamlStatus = getYamlStatusForDisplay(docMain.status);
  const yamlLocked = docMain.locked === true ? 'true' : 'false';
  const mode = isBranchOnly ? 'branch-only' : isDocsOnly ? 'docs-only' : 'worktree';
  const branch = defaultBranchFrom(docMain) || 'n/a';
  const worktreeDisplay = isBranchOnly ? 'none' : derivedWorktree || 'none';
  console.log(
    `\n${LOG_PREFIX.DONE} HUD: WU=${id} status=${yamlStatus} stamp=${stampExists} locked=${yamlLocked} mode=${mode} branch=${branch} worktree=${worktreeDisplay}`,
  );
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
export async function main() {
  // Allow pre-push hook to recognize wu:done automation (WU-1030)
  process.env[ENV_VARS.WU_TOOL] = 'wu-done';

  // Validate CLI arguments and WU ID format (extracted to wu-done-validators.ts)
  const { args, id } = validateInputs(process.argv);

  // WU-1223: Check if running from worktree - wu:done now requires main checkout
  // Agents should use wu:prep from worktree, then wu:done from main
  const { LOCATION_TYPES } = CONTEXT_VALIDATION;
  const currentLocation = await resolveLocation();
  if (currentLocation.type === LOCATION_TYPES.WORKTREE) {
    die(
      `${EMOJI.FAILURE} wu:done must be run from main checkout, not from a worktree.\n\n` +
        `Current location: ${currentLocation.cwd}\n\n` +
        `WU-1223 NEW WORKFLOW:\n` +
        `  1. From worktree, run: pnpm wu:prep --id ${id}\n` +
        `     (This runs gates and prepares for completion)\n\n` +
        `  2. From main, run: cd ${currentLocation.mainCheckout} && pnpm wu:done --id ${id}\n` +
        `     (This does merge + cleanup only)\n\n` +
        `Use wu:prep to run gates in the worktree, then wu:done from main for merge/cleanup.`,
    );
  }

  // Detect workspace mode and calculate paths (WU-1215: extracted to validators module)
  const pathInfo = await detectModeAndPaths(id, args);
  const {
    WU_PATH,
    STATUS_PATH,
    BACKLOG_PATH,
    STAMPS_DIR,
    docMain: docMainRaw,
    isBranchOnly,
    // WU-1492: Detect branch-pr mode for separate completion path
    isBranchPR,
    derivedWorktree,
    docForValidation: initialDocForValidationRaw,
    isDocsOnly,
  } = pathInfo;
  const docMain = normalizeWUDocLike(docMainRaw);
  const initialDocForValidation = normalizeWUDocLike(initialDocForValidationRaw);

  // Capture main checkout path once. process.cwd() may drift later during recovery flows.
  const mainCheckoutPath = process.cwd();

  // ──────────────────────────────────────────────
  // WU-2211: --already-merged early exit path
  // Skips merge phase, gates, worktree detection. Only writes metadata.
  // ──────────────────────────────────────────────
  if (args.alreadyMerged) {
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-2211: --already-merged mode activated`);

    // Safety check: verify code_paths exist on HEAD of main
    const codePaths = (docMain.code_paths as string[]) || [];
    const verification = await verifyCodePathsOnMainHead(codePaths);

    if (!verification.valid) {
      die(
        `${EMOJI.FAILURE} --already-merged safety check failed\n\n` +
          `${verification.error}\n\n` +
          `Cannot finalize ${id}: code_paths must exist on HEAD before using --already-merged.`,
      );
    }

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Safety check passed: all ${codePaths.length} code_paths verified on HEAD`,
    );

    // Execute finalize-only path
    const title = String(docMain.title || id);
    const lane = String(docMain.lane || '');
    const finalizeResult = await executeAlreadyMergedFinalizeFromModule({
      id,
      title,
      lane,
      doc: docMain as Record<string, unknown>,
    });

    if (!finalizeResult.success) {
      die(
        `${EMOJI.FAILURE} --already-merged finalization failed\n\n` +
          `Errors:\n${finalizeResult.errors.map((e) => `  - ${e}`).join('\n')}\n\n` +
          `Partial state may remain. Rerun: pnpm wu:done --id ${id} --already-merged`,
      );
    }

    // Release lane lock (non-blocking, same as normal wu:done)
    try {
      const lane = docMain.lane;
      if (lane) {
        const releaseResult = releaseLaneLock(lane, { wuId: id });
        if (releaseResult.released && !releaseResult.notFound) {
          console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Lane lock released for "${lane}"`);
        }
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX.DONE} Warning: Could not release lane lock: ${getErrorMessage(err)}`,
      );
    }

    // End agent session (non-blocking)
    try {
      endSessionForWU();
    } catch {
      // Non-blocking
    }

    // Broadcast completion signal (non-blocking)
    await broadcastCompletionSignal(id, title);

    console.log(`\n${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} ${id} finalized via --already-merged`);
    console.log(`- WU: ${id} -- ${title}`);

    clearConfigCache();
    process.exit(EXIT_CODES.SUCCESS);
  }

  // WU-1663: Determine prepPassed early for pipeline actor input.
  // canSkipGates checks if wu:prep already ran gates successfully via checkpoint.
  // This drives the isPrepPassed guard on the GATES_SKIPPED transition.
  // WU-2102: Look for checkpoint in worktree (where wu:prep writes it), not main
  const earlySkipResult = canSkipGates(id, {
    currentHeadSha: undefined,
    baseDir: derivedWorktree || undefined,
  });
  const prepPassed = earlySkipResult.canSkip;

  // WU-1663: Create XState pipeline actor for state-driven orchestration.
  // The actor tracks which pipeline stage we're in (validating, gating, committing, etc.)
  // and provides explicit state/transition contracts. Existing procedural logic continues
  // to do the real work; the actor provides structured state tracking alongside it.
  const pipelineActor = createActor(wuDoneMachine, {
    input: {
      wuId: id,
      worktreePath: derivedWorktree,
      prepPassed,
    },
  });
  pipelineActor.start();

  // WU-1663: Send START event to transition from idle -> validating
  pipelineActor.send({
    type: WU_DONE_EVENTS.START,
    wuId: id,
    worktreePath: derivedWorktree || '',
  });

  // WU-1590: branch-pr has no worktree, treat like branch-only for path resolution and ensureOnMain skip
  const isNoWorktreeMode = isBranchOnly || isBranchPR;
  const resolvedWorktreePath =
    derivedWorktree && !isNoWorktreeMode
      ? path.isAbsolute(derivedWorktree)
        ? derivedWorktree
        : path.resolve(mainCheckoutPath, derivedWorktree)
      : null;
  const worktreeExists = resolvedWorktreePath ? existsSync(resolvedWorktreePath) : false;
  const { allowFallback: allowBranchOnlyFallback, effectiveBranchOnly } = computeBranchOnlyFallback(
    {
      // WU-1590: Treat branch-pr like branch-only for fallback computation
      isBranchOnly: isNoWorktreeMode,
      branchOnlyRequested: args.branchOnly,
      worktreeExists,
      derivedWorktree,
    },
  );
  if (allowBranchOnlyFallback) {
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Worktree missing (${resolvedWorktreePath}). Proceeding in branch-only mode because --branch-only was provided.`,
    );
  }

  const effectiveDerivedWorktree = effectiveBranchOnly ? null : derivedWorktree;
  const effectiveWorktreePath = effectiveBranchOnly ? null : resolvedWorktreePath;

  const mainStatus = await getGitForCwd().getStatus();
  const mainMutationGuard = evaluateWuDoneMainMutationGuard({
    mainCheckout: mainCheckoutPath,
    isBranchPr: isBranchPR,
    hasActiveWorktreeContext: Boolean(effectiveWorktreePath && existsSync(effectiveWorktreePath)),
    mainStatus,
  });
  if (mainMutationGuard.blocked) {
    die(mainMutationGuard.message ?? 'wu:done blocked by dirty-main guard.');
  }

  // WU-1169: Ensure worktree is clean before proceeding
  // This prevents WU-1943 rollback loops if rebase fails due to dirty state
  if (effectiveWorktreePath && existsSync(effectiveWorktreePath)) {
    await ensureCleanWorktree(effectiveWorktreePath);
  }

  // Pre-flight checks (WU-1215: extracted to executePreFlightChecks function)
  // WU-1663: Wrap in try/catch to send pipeline failure event before die() propagates
  let preFlightResult: Awaited<ReturnType<typeof executePreFlightChecks>>;
  try {
    preFlightResult = await executePreFlightChecks({
      id,
      args,
      isBranchOnly: effectiveBranchOnly,
      isDocsOnly,
      docMain,
      docForValidation: initialDocForValidation,
      derivedWorktree: effectiveDerivedWorktree,
    });
  } catch (preFlightErr) {
    pipelineActor.send({
      type: WU_DONE_EVENTS.VALIDATION_FAILED,
      error: getErrorMessage(preFlightErr),
    });
    pipelineActor.stop();
    throw preFlightErr;
  }
  const title = preFlightResult.title;
  // Note: docForValidation is returned but not used after pre-flight checks
  // The metadata transaction uses docForUpdate instead

  // WU-1663: Pre-flight checks passed - transition to preparing state
  pipelineActor.send({ type: WU_DONE_EVENTS.VALIDATION_PASSED });

  // WU-2132: Enforce auditable wu:brief evidence for feature/bug WUs.
  await enforceWuBriefEvidenceForDone(id, docMain, {
    baseDir: effectiveWorktreePath || mainCheckoutPath,
    force: Boolean(args.force),
  });

  // WU-1599: Enforce auditable spawn provenance for initiative-governed WUs.
  await enforceSpawnProvenanceForDone(id, docMain, {
    baseDir: mainCheckoutPath,
    force: Boolean(args.force),
  });

  // Step 0: Run gates (WU-1215: extracted to executeGates function)
  const worktreePath = effectiveWorktreePath;

  // WU-1471 AC3 + WU-1998: Config-driven checkpoint gate with accurate warn-mode messaging.
  const checkpointGateConfig = getConfig();
  const requireCheckpoint = resolveCheckpointGateMode(
    checkpointGateConfig.memory?.enforcement?.require_checkpoint_for_done,
  );
  await enforceCheckpointGateForDone({
    id,
    workspacePath: worktreePath || mainCheckoutPath,
    mode: requireCheckpoint,
  });

  // WU-1663: Preparation complete - transition to gating state
  pipelineActor.send({ type: WU_DONE_EVENTS.PREPARATION_COMPLETE });

  // WU-2102: Resolve scoped test paths from WU spec tests.unit for gate fallback
  const scopedTestPathsForDone = resolveScopedUnitTestsForPrep({
    tests: docMain.tests as { unit?: unknown } | undefined,
  });

  // WU-1663: Wrap gates in try/catch to send pipeline failure event
  let gateExecutionResult: Awaited<ReturnType<typeof executeGates>>;
  try {
    gateExecutionResult = await executeGates({
      id,
      args,
      isBranchOnly: effectiveBranchOnly,
      isDocsOnly,
      worktreePath,
      scopedTestPaths: scopedTestPathsForDone,
    });
  } catch (gateErr) {
    pipelineActor.send({
      type: WU_DONE_EVENTS.GATES_FAILED,
      error: getErrorMessage(gateErr),
    });
    pipelineActor.stop();
    throw gateErr;
  }

  // WU-1663: Gates passed - transition from gating state.
  // Use GATES_SKIPPED if checkpoint dedup allowed skip, GATES_PASSED otherwise.
  if (gateExecutionResult.skippedByCheckpoint) {
    pipelineActor.send({ type: WU_DONE_EVENTS.GATES_SKIPPED });
  } else {
    pipelineActor.send({ type: WU_DONE_EVENTS.GATES_PASSED });
  }

  // Print State HUD for visibility (WU-1215: extracted to printStateHUD function)
  printStateHUD({
    id,
    docMain,
    isBranchOnly: effectiveBranchOnly,
    isDocsOnly,
    derivedWorktree: effectiveDerivedWorktree,
    STAMPS_DIR,
  });

  // Step 0.5: Pre-flight hook validation policy.
  // WU-1659: Reuse Step 0 gate attestation/checkpoint and avoid duplicate full-suite execution.
  const preCommitGateDecision = resolveWuDonePreCommitGateDecision({
    skipGates: Boolean(args.skipGates),
    fullGatesRanInCurrentRun: gateExecutionResult.fullGatesRanInCurrentRun,
    skippedByCheckpoint: gateExecutionResult.skippedByCheckpoint,
    checkpointId: gateExecutionResult.checkpointId,
  });
  console.log(`${LOG_PREFIX.DONE} ${preCommitGateDecision.message}`);

  // Fallback path remains available if gate attestation is missing for any reason.
  if (preCommitGateDecision.runPreCommitFullSuite) {
    const hookResult = await validateAllPreCommitHooks(id, worktreePath, {
      runGates: ({ cwd }) => runGates({ cwd, docsOnly: false }),
    });
    if (!hookResult.valid) {
      die('Pre-flight validation failed. Fix hook issues and try again.');
    }
  }

  // Step 0.6: WU-1781 - Run tasks:validate preflight BEFORE any merge/push operations
  // This prevents deadlocks where validation fails after merge, leaving local main ahead of origin
  // Specifically catches stamp-status mismatches from legacy WUs that would block pre-push hooks
  const tasksValidationResult = runPreflightTasksValidation(id);
  if (!tasksValidationResult.valid) {
    const errorMessage = buildPreflightErrorMessage(id, tasksValidationResult.errors);
    console.error(errorMessage);
    die('Preflight tasks:validate failed. See errors above for fix options.');
  }

  // Step 1: Execute mode-specific completion workflow (WU-1215: extracted to mode modules)
  // Worktree mode: Update metadata in worktree → commit → merge to main
  // Branch-Only mode: Merge to main → update metadata on main → commit
  // WU-1811: Track cleanupSafe flag to conditionally skip worktree removal on failure
  let completionResult: {
    cleanupSafe?: boolean;
    success?: boolean;
    committed?: boolean;
    pushed?: boolean;
    merged?: boolean;
    recovered?: boolean;
    prUrl?: string | null;
  } = { cleanupSafe: true }; // Default to safe for no-auto mode

  if (!args.noAuto) {
    // Build context for mode-specific execution
    // WU-1369: Worktree mode uses atomic transaction pattern (no recordTransactionState/rollbackTransaction)
    // Branch-only mode still uses the old rollback mechanism
    const baseContext = {
      id,
      args,
      docMain,
      title,
      isDocsOnly,
      maxCommitLength: getCommitHeaderLimit(),
      validateStagedFiles,
    };

    try {
      if (isBranchPR) {
        // WU-1492: Branch-PR mode: commit metadata on lane branch, push, create PR
        // Never checks out or merges to main
        const laneBranch = defaultBranchFrom(docMain);
        const branchPRContext = {
          ...baseContext,
          laneBranch,
        };
        completionResult = await executeBranchPRCompletion(branchPRContext);
      } else if (effectiveBranchOnly) {
        // Branch-Only mode: merge first, then update metadata on main
        // NOTE: Branch-only still uses old rollback mechanism
        const branchOnlyContext = {
          ...baseContext,
          recordTransactionState,
          rollbackTransaction,
        };
        completionResult = await executeBranchOnlyCompletion(branchOnlyContext);
      } else {
        // Worktree mode: update in worktree, commit, then merge or create PR
        // WU-1369: Uses atomic transaction pattern
        // WU-1541: Create worktree-aware validateStagedFiles to avoid process.chdir dependency
        if (!worktreePath) {
          // WU-1746: Before dying, check if branch is already merged to main
          // This handles the case where worktree was manually deleted after branch was merged
          const laneBranch = defaultBranchFrom(docMain);
          const mergedDetection = await detectAlreadyMergedNoWorktree({
            wuId: id,
            laneBranch: laneBranch || '',
            worktreePath: resolvedWorktreePath,
          });

          if (mergedDetection.merged && !mergedDetection.worktreeExists) {
            console.log(
              `${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-1746: Worktree missing but branch already merged to main`,
            );
            const mergedResult = await executeAlreadyMergedCompletion({
              id,
              title: title || String(docMain.title || id),
              lane: String(docMain.lane || ''),
            });
            completionResult = {
              success: mergedResult.success,
              committed: true,
              pushed: true,
              merged: true,
              cleanupSafe: true,
            };
          } else {
            die(`Missing worktree path for ${id} completion in worktree mode`);
          }
        } else {
          const worktreeGitForValidation = createGitForPath(worktreePath);
          const worktreeContext = {
            ...baseContext,
            worktreePath,
            validateStagedFiles: (
              wuId: string,
              docsOnly: boolean,
              options?: { metadataAllowlist?: string[] },
            ) => validateStagedFiles(wuId, docsOnly, worktreeGitForValidation, options),
          };
          completionResult = await executeWorktreeCompletion(worktreeContext);
        }
      }

      // WU-1663: Mode-specific completion succeeded - send pipeline events.
      // The completion modules handle commit, merge, and push internally.
      // We send the corresponding pipeline events based on the completion result.
      pipelineActor.send({ type: WU_DONE_EVENTS.COMMIT_COMPLETE });
      pipelineActor.send({ type: WU_DONE_EVENTS.MERGE_COMPLETE });
      pipelineActor.send({ type: WU_DONE_EVENTS.PUSH_COMPLETE });

      // Handle recovery mode (zombie state cleanup completed)
      if ('recovered' in completionResult && completionResult.recovered) {
        // P0 FIX: Release lane lock before early exit
        try {
          const lane = docMain.lane;
          if (lane) releaseLaneLock(lane, { wuId: id });
        } catch {
          // Intentionally ignore lock release errors during cleanup
        }
        pipelineActor.stop();
        process.exit(EXIT_CODES.SUCCESS);
      }
    } catch (err) {
      // WU-1663: Mode execution failed - determine which stage failed
      // based on completion result flags and send appropriate failure event.
      const failureStage =
        completionResult.committed === false
          ? WU_DONE_EVENTS.COMMIT_FAILED
          : completionResult.merged === false
            ? WU_DONE_EVENTS.MERGE_FAILED
            : completionResult.pushed === false
              ? WU_DONE_EVENTS.PUSH_FAILED
              : WU_DONE_EVENTS.COMMIT_FAILED; // Default to commit as earliest possible failure

      pipelineActor.send({
        type: failureStage,
        error: getErrorMessage(err),
      });

      // WU-1663: Log pipeline state for diagnostics
      const failedSnapshot = pipelineActor.getSnapshot();
      console.error(
        `${LOG_PREFIX.DONE} Pipeline state: ${failedSnapshot.value} (failedAt: ${failedSnapshot.context.failedAt})`,
      );
      pipelineActor.stop();

      // P0 FIX: Release lane lock before error exit
      try {
        const lane = docMain.lane;
        if (lane) releaseLaneLock(lane, { wuId: id });
      } catch {
        // Intentionally ignore lock release errors during error handling
      }

      console.error(
        `\n${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Mode execution failed: ${getErrorMessage(err)}`,
      );
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Next step: resolve the reported error and retry: pnpm wu:done --id ${id}`,
      );

      // WU-1811: Check if cleanup is safe before removing worktree
      // If cleanupSafe is false (or undefined), preserve worktree for recovery
      const cleanupSafe =
        typeof err === 'object' &&
        err !== null &&
        'cleanupSafe' in err &&
        typeof (err as { cleanupSafe?: unknown }).cleanupSafe === 'boolean'
          ? (err as { cleanupSafe?: boolean }).cleanupSafe
          : undefined;
      if (cleanupSafe === false) {
        console.log(
          `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1811: Worktree preserved - rerun wu:done to recover`,
        );
      }

      // Mode modules handle rollback internally, we just need to exit
      // Exit code 1 = recoverable (rebase/fix and retry)
      process.exit(EXIT_CODES.ERROR);
    }
  } else {
    await ensureNoAutoStagedOrNoop([WU_PATH, STATUS_PATH, BACKLOG_PATH, STAMPS_DIR]);
  }

  // Step 6 & 7: Cleanup (remove worktree, delete branch) - WU-1215
  // WU-1811: Only run cleanup if all completion steps succeeded
  if (completionResult.cleanupSafe !== false) {
    await runCleanup(docMain, args);
  } else {
    console.log(
      `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1811: Skipping worktree cleanup - metadata/push incomplete`,
    );
  }

  // WU-1603: Release lane lock after successful completion
  // This allows the lane to be claimed by another WU
  try {
    const lane = docMain.lane;
    if (lane) {
      const releaseResult = releaseLaneLock(lane, { wuId: id });
      if (releaseResult.released && !releaseResult.notFound) {
        console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Lane lock released for "${lane}"`);
      }
      // Silent if notFound - lock may not exist (older WUs, manual cleanup)
    }
  } catch (err) {
    // Non-blocking: lock release failure should not block completion
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not release lane lock: ${getErrorMessage(err)}`,
    );
  }

  // WU-1438: Auto-end agent session
  try {
    const sessionResult = endSessionForWU();
    if (sessionResult.ended) {
      const sessionId = sessionResult.summary?.session_id;
      if (sessionId) {
        // Emergency fix Session 2: Use SESSION.ID_DISPLAY_LENGTH constant
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Agent session ended (${sessionId.slice(0, SESSION.ID_DISPLAY_LENGTH)}...)`,
        );
      }
    }
    // No warning if no active session - silent no-op is expected
  } catch (err) {
    // Non-blocking: session end failure should not block completion
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not end agent session: ${getErrorMessage(err)}`,
    );
  }

  // WU-1588: Broadcast completion signal after session end
  // Non-blocking: failures handled internally by broadcastCompletionSignal
  await broadcastCompletionSignal(id, title);

  // WU-1473: Mark completed-WU signals as read using receipt-aware behavior
  // Non-blocking: markCompletedWUSignalsAsRead is fail-open (AC4)
  const markResult = await markCompletedWUSignalsAsRead(mainCheckoutPath, id);
  if (markResult.markedCount > 0) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Marked ${markResult.markedCount} signal(s) as read for ${id}`,
    );
  }

  // WU-1946: Update spawn registry to mark WU as completed
  // Non-blocking: failures handled internally by updateSpawnRegistryOnCompletion
  // Works in both worktree and branch-only modes (called after completionResult)
  await updateSpawnRegistryOnCompletion(id, mainCheckoutPath);

  await flushWuLifecycleSync(
    {
      command: WU_LIFECYCLE_COMMANDS.DONE,
      wuId: id,
    },
    {
      workspaceRoot: mainCheckoutPath,
      logger: {
        warn: (message) => console.warn(`${LOG_PREFIX.DONE} ${message}`),
      },
    },
  );

  // WU-1747: Clear checkpoint on successful completion
  // Checkpoint is no longer needed once WU is fully complete
  clearCheckpoint(id);

  // WU-1471 AC4: Remove per-WU hook counter file on completion
  // Fail-safe: cleanupHookCounters never throws
  cleanupHookCounters(mainCheckoutPath, id);

  // WU-1474: Invoke decay archival when memory.decay policy is configured
  // Non-blocking: errors are captured but never block wu:done completion (fail-open)
  try {
    const decayConfig = getConfig().memory?.decay;
    const decayResult = await runDecayOnDone(mainCheckoutPath, decayConfig);
    if (decayResult.ran && decayResult.archivedCount > 0) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Decay archival: ${decayResult.archivedCount} stale memory node(s) archived`,
      );
    } else if (decayResult.error) {
      console.warn(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Decay archival skipped (fail-open): ${decayResult.error}`,
      );
    }
  } catch (err) {
    // Double fail-open: even if runDecayOnDone itself throws unexpectedly, never block wu:done
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Decay archival error (fail-open): ${getErrorMessage(err)}`,
    );
  }

  // WU-1663: Cleanup complete - transition to final done state
  pipelineActor.send({ type: WU_DONE_EVENTS.CLEANUP_COMPLETE });

  // WU-1663: Log final pipeline state for diagnostics
  const finalSnapshot = pipelineActor.getSnapshot();
  console.log(`${LOG_PREFIX.DONE} Pipeline state: ${finalSnapshot.value} (WU-1663)`);
  pipelineActor.stop();

  console.log(
    `\n${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction COMMIT - all steps succeeded (WU-755)`,
  );
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Marked done, pushed, and cleaned up.`);
  console.log(`- WU: ${id} — ${title}`);

  // WU-2126: Invalidate config cache so subsequent commands in the same process
  // read fresh values from disk (wu:done may have mutated workspace.yaml/state).
  clearConfigCache();

  // WU-1763: Print lifecycle nudges (conditional, non-blocking)
  // Discovery summary nudge - only if discoveries exist
  const discoveries = await loadDiscoveriesForWU(mainCheckoutPath, id);
  printDiscoveryNudge(id, discoveries.count, discoveries.ids);

  // Documentation validation nudge - only if docs changed
  // Use worktreePath if available, otherwise skip (branch-only mode has no worktree)
  if (worktreePath) {
    const changedDocs = await detectChangedDocPaths(worktreePath, BRANCHES.MAIN);
    printDocValidationNudge(id, changedDocs);
  }

  const currentBranch = (await getGitForCwd().getCurrentBranch()).trim();
  const shouldRunCleanupMutations =
    currentBranch.length > 0 &&
    currentBranch !== BRANCHES.MAIN &&
    currentBranch !== BRANCHES.MASTER;

  if (shouldRunCleanupMutations) {
    // WU-1366: Auto state cleanup after successful completion
    // Non-fatal: errors are logged but do not block completion
    await runAutoCleanupAfterDone(mainCheckoutPath);

    // WU-1533: Auto-commit dirty state files left by cleanup.
    // Branch-aware: in branch-pr mode this stays on the lane branch.
    await commitCleanupChanges({ targetBranch: currentBranch });
  } else {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-1611: Skipping auto-cleanup mutations on protected branch ${currentBranch}`,
    );
  }
}

/**
 * WU-1763: Print discovery summary nudge when discoveries exist for this WU.
 * Conditional output - only prints when discoveryCount > 0.
 * Non-blocking, single-line output to avoid flooding the console.
 *
 * @param {string} id - WU ID being completed
 * @param {number} discoveryCount - Number of open discoveries for this WU
 * @param {string[]} discoveryIds - List of discovery IDs (limited to 5 in output)
 */
export function printDiscoveryNudge(
  id: string,
  discoveryCount: number,
  discoveryIds: string[],
): void {
  if (discoveryCount > 0) {
    const displayIds = discoveryIds.slice(0, 5).join(', ');
    const moreText = discoveryCount > 5 ? ` (+${discoveryCount - 5} more)` : '';
    console.log(
      `\n${LOG_PREFIX.DONE} 💡 ${discoveryCount} open discoveries: ${displayIds}${moreText}`,
    );
    console.log(`   Triage with: pnpm mem:triage --wu ${id}`);
  }
}

/**
 * WU-1763: Print documentation validation nudge when docs changed.
 * Conditional output - only prints when changedDocPaths.length > 0.
 * Non-blocking, single-line output to avoid flooding the console.
 *
 * @param {string} id - WU ID being completed
 * @param {string[]} changedDocPaths - List of documentation paths that changed
 */
export function printDocValidationNudge(id: string, changedDocPaths: string[]): void {
  if (changedDocPaths.length > 0) {
    console.log(`\n${LOG_PREFIX.DONE} 💡 Documentation changed (${changedDocPaths.length} files).`);
    console.log(`   Consider: pnpm validate:context && pnpm docs:linkcheck`);
  }
}

/**
 * WU-1763: Load discoveries for a WU from memory store.
 * Non-blocking - returns empty array on errors.
 *
 * @param {string} baseDir - Base directory containing .lumenflow/memory/
 * @param {string} wuId - WU ID to load discoveries for
 * @returns {Promise<{count: number, ids: string[]}>} Discovery count and IDs
 */
async function loadDiscoveriesForWU(
  baseDir: string,
  wuId: string,
): Promise<{ count: number; ids: string[] }> {
  try {
    const memory = await loadMemory(path.join(baseDir, '.lumenflow/memory'));
    const wuNodes = memory.byWu.get(wuId) || [];
    const discoveries = wuNodes.filter(
      (node: { type?: string; id: string }) => node.type === 'discovery',
    );
    return {
      count: discoveries.length,
      ids: discoveries.map((d: { id: string }) => d.id),
    };
  } catch {
    // Non-blocking: return empty on errors
    return { count: 0, ids: [] };
  }
}

/**
 * WU-1763: Detect documentation paths from changed files.
 * Non-blocking - returns empty array on errors.
 *
 * @param {string} worktreePath - Path to worktree
 * @param {string} baseBranch - Base branch to compare against
 * @returns {Promise<string[]>} List of changed documentation paths
 */
async function detectChangedDocPaths(worktreePath: string, baseBranch: string) {
  try {
    const git = getGitForCwd();
    // Get files changed in this branch vs base
    const diff = await git.raw(['diff', '--name-only', baseBranch]);
    const changedFiles: string[] = diff.split('\n').filter(Boolean);
    const docsOnlyPrefixes = getDocsOnlyPrefixes({ projectRoot: worktreePath }).map((prefix) =>
      prefix.toLowerCase(),
    );
    const docsRootFiles = DOCS_ONLY_ROOT_FILES.map((pattern) => pattern.toLowerCase());

    // Filter to documentation-related files using configured prefixes.
    return changedFiles.filter((filePath: string) => {
      const normalizedPath = filePath.replace(/\\/g, '/').trim();
      const lowerPath = normalizedPath.toLowerCase();

      if (docsOnlyPrefixes.some((prefix) => lowerPath.startsWith(prefix))) {
        return true;
      }

      if (!lowerPath.endsWith('.md')) {
        return false;
      }

      return docsRootFiles.some((pattern) => lowerPath.startsWith(pattern));
    });
  } catch {
    // Non-blocking: return empty on errors
    return [];
  }
}

// Guard main() execution for testability (WU-1366)
// When imported as a module for testing, main() should not auto-run
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
