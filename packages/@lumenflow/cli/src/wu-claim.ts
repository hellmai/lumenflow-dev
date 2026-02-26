#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Claim Helper
 *
 * Canonical sequence:
 * 1) Auto-update backlog/status/WU YAML (safe parsing) unless `--no-auto`
 * 2) Commit and push to `main`
 * 3) Create a dedicated worktree+branch for the WU
 *
 * Usage:
 *   node tools/wu-claim.ts --id WU-334 --lane Intelligence \
 *     [--worktree worktrees/intelligence-wu-334] [--branch lane/intelligence/wu-334]
 *
 * WU-2542: This script imports utilities from @lumenflow/core package.
 * Full migration to thin shim pending @lumenflow/core CLI export implementation.
 *
 * WU-1649: Decomposed into focused modules:
 *   - wu-claim-validation.ts: Pre-flight validation, schema, lane/spec checks
 *   - wu-claim-state.ts: State update helpers (WU YAML, backlog, status)
 *   - wu-claim-worktree.ts: Worktree mode claim workflow
 *   - wu-claim-branch.ts: Branch-only mode claim workflow
 *   - wu-claim-output.ts: Output formatting and display helpers
 *   - wu-claim-resume-handler.ts: Resume/handoff mode handler
 *   - wu-claim-mode.ts: Mode resolution (pre-existing)
 *   - wu-claim-cloud.ts: Cloud claim helpers (pre-existing)
 */

// WU-2542: Import from @lumenflow/core to establish shim layer dependency
// eslint-disable-next-line sonarjs/unused-import -- Validates @lumenflow/core package link
import { VERSION as _LUMENFLOW_VERSION } from '@lumenflow/core';

import { rmSync } from 'node:fs';
import path from 'node:path';
import { isOrphanWorktree } from '@lumenflow/core/orphan-detector';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { die, getErrorMessage } from '@lumenflow/core/error-handler';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
// WU-1491: Mode resolution for --cloud and flag combinations
import { resolveClaimMode } from './wu-claim-mode.js';
// WU-1590: Cloud claim helpers for branch-pr/cloud execution behavior
// WU-1766: shouldSkipEnsureOnMainForClaim added to bypass ensureOnMain in cloud mode
import {
  shouldSkipBranchExistsCheck,
  resolveBranchClaimExecution,
  shouldSkipEnsureOnMainForClaim,
} from './wu-claim-cloud.js';
// WU-1495: Cloud auto-detection from config-driven env signals
import {
  detectCloudMode,
  resolveEffectiveCloudActivation,
  CLOUD_ACTIVATION_SOURCE,
  type CloudDetectConfig,
  type EffectiveCloudActivationResult,
} from '@lumenflow/core/cloud-detect';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import {
  BRANCHES,
  REMOTES,
  CLAIMED_MODES,
  PATTERNS,
  toKebab,
  LOG_PREFIX,
  EMOJI,
  ENV_VARS,
  EXIT_CODES,
} from '@lumenflow/core/wu-constants';
import { shouldSkipRemoteOperations } from '@lumenflow/core/micro-worktree';
import { ensureOnMain } from '@lumenflow/core/wu-helpers';
import { emitWUFlowEvent } from '@lumenflow/core/telemetry';
import { startSessionForWU } from '@lumenflow/agent/auto-session';
import { getConfig } from '@lumenflow/core/config';
import {
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  forceRemoveStaleLock,
} from '@lumenflow/core/lane-lock';
import { getAssignedEmail } from '@lumenflow/core/wu-claim-helpers';

// WU-1649: Import from extracted modules
import {
  runPreflightValidations,
  handleCodePathOverlap,
  validateBranchOnlyMode,
} from './wu-claim-validation.js';
import {
  readWUTitle,
  getStagedChanges,
  ensureCleanOrClaimOnlyWhenNoAuto,
  applyCanonicalClaimUpdate,
  rollbackCanonicalClaim,
  recordClaimPickupEvidence,
  shouldApplyCanonicalClaimUpdate as shouldApplyCanonicalClaimUpdateFn,
} from './wu-claim-state.js';
import { claimWorktreeMode } from './wu-claim-worktree.js';
import { claimBranchOnlyMode } from './wu-claim-branch.js';
import { handleResumeMode } from './wu-claim-resume-handler.js';
import { extractSandboxCommandFromArgv, runWuSandbox } from './wu-sandbox.js';
import { flushWuLifecycleSync } from './wu-lifecycle-sync/service.js';
import { WU_LIFECYCLE_COMMANDS } from './wu-lifecycle-sync/constants.js';

// ============================================================================
// RE-EXPORTS: Preserve public API for existing test consumers
// ============================================================================

// From wu-claim-validation.ts
export { resolveClaimStatus, validateManualTestsForClaim } from './wu-claim-validation.js';

// From wu-claim-state.ts
export {
  shouldApplyCanonicalClaimUpdate,
  shouldPersistClaimMetadataOnBranch,
  resolveClaimBaselineRef,
  buildRollbackYamlDoc,
  hasClaimPickupEvidence,
  recordClaimPickupEvidence,
  getWorktreeCommitFiles,
} from './wu-claim-state.js';
export type { ClaimPickupEvidenceResult } from './wu-claim-state.js';

// From wu-claim-output.ts
export {
  formatProjectDefaults,
  printProjectDefaults,
  printLifecycleNudge,
} from './wu-claim-output.js';

// From wu-claim-worktree.ts
export { applyFallbackSymlinks } from './wu-claim-worktree.js';

// ============================================================================
// Cloud activation (kept in orchestrator since it's only used in main())
// ============================================================================

const PREFIX = LOG_PREFIX.CLAIM;
const WU_CLAIM_SANDBOX_OPTION = {
  name: 'sandbox',
  flags: '--sandbox',
  description:
    'Launch a post-claim session via wu:sandbox (use -- <command> to override the default shell)',
  type: 'boolean' as const,
};

interface ResolveClaimCloudActivationInput {
  cloudFlag: boolean;
  env: Readonly<Record<string, string | undefined>>;
  config: CloudDetectConfig;
  currentBranch: string;
}

/**
 * Resolve branch-aware cloud activation for wu:claim.
 *
 * This preserves source attribution from detectCloudMode while enforcing
 * protected-branch behavior for explicit vs env-signal activation.
 */
export function resolveCloudActivationForClaim(
  input: ResolveClaimCloudActivationInput,
): EffectiveCloudActivationResult {
  const detection = detectCloudMode({
    cloudFlag: input.cloudFlag,
    env: input.env,
    config: input.config,
  });
  return resolveEffectiveCloudActivation({
    detection,
    currentBranch: input.currentBranch,
  });
}

export function resolveDefaultClaimSandboxCommand(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform | string = process.platform,
): string[] {
  if (platform === 'win32') {
    return ['powershell.exe', '-NoLogo'];
  }

  const shell = env.SHELL?.trim();
  return shell && shell.length > 0 ? [shell] : ['/bin/sh'];
}

export function resolveClaimSandboxCommand(
  argv: string[] = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform | string = process.platform,
): string[] {
  const explicit = extractSandboxCommandFromArgv(argv);
  if (explicit.length > 0) {
    return explicit;
  }

  return resolveDefaultClaimSandboxCommand(env, platform);
}

export interface ClaimSandboxLaunchInput {
  enabled: boolean;
  id: string;
  worktreePath: string;
  argv?: string[];
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform | string;
}

export async function maybeLaunchClaimSandboxSession(
  input: ClaimSandboxLaunchInput,
  deps: {
    launchSandbox?: typeof runWuSandbox;
  } = {},
): Promise<number | null> {
  if (!input.enabled) {
    return null;
  }

  const launchSandbox = deps.launchSandbox || runWuSandbox;
  const command = resolveClaimSandboxCommand(
    input.argv || process.argv,
    input.env || (process.env as Record<string, string | undefined>),
    input.platform || process.platform,
  );

  console.log(`${PREFIX} Launching post-claim session via wu:sandbox...`);
  return launchSandbox({
    id: input.id,
    worktree: input.worktreePath,
    command,
  });
}

// ============================================================================
// Main orchestrator
// ============================================================================

// eslint-disable-next-line sonarjs/cognitive-complexity -- main() orchestrates multi-step claim workflow
export async function main() {
  const args = createWUParser({
    name: 'wu-claim',
    description: 'Claim a work unit by creating a worktree/branch and updating status',
    options: [
      WU_OPTIONS.id,
      WU_OPTIONS.lane,
      WU_OPTIONS.worktree,
      WU_OPTIONS.branch,
      WU_OPTIONS.branchOnly,
      WU_OPTIONS.prMode,
      WU_OPTIONS.noAuto,
      WU_OPTIONS.force,
      WU_OPTIONS.forceOverlap,
      WU_OPTIONS.fix,
      WU_OPTIONS.reason,
      WU_OPTIONS.allowIncomplete,
      WU_OPTIONS.cloud, // WU-1491: Cloud/branch-pr mode for cloud agents
      WU_OPTIONS.resume, // WU-2411: Agent handoff flag
      WU_OPTIONS.skipSetup, // WU-1023: Skip auto-setup for fast claims
      WU_OPTIONS.noPush, // Skip pushing claim state/branch (air-gapped)
      WU_CLAIM_SANDBOX_OPTION,
    ],
    required: ['id', 'lane'],
    allowPositionalId: true,
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) die(`Invalid WU id '${args.id}'. Expected format WU-123`);

  // WU-1609: Resolve branch-aware cloud activation at preflight so explicit
  // protected-branch cloud requests fail before lane locking/state mutation.
  // WU-1766: Cloud detection MUST happen before ensureOnMain so cloud agents
  // on claude/*/codex/* branches can bypass the main-branch requirement.
  const preflightBranch = await getGitForCwd().getCurrentBranch();
  const preflightCloudEffective = resolveCloudActivationForClaim({
    cloudFlag: Boolean(args.cloud),
    env: process.env as Record<string, string | undefined>,
    config: getConfig().cloud,
    currentBranch: preflightBranch,
  });
  if (preflightCloudEffective.blocked) {
    const sourceHint =
      preflightCloudEffective.source === CLOUD_ACTIVATION_SOURCE.FLAG
        ? '--cloud'
        : `${ENV_VARS.CLOUD}=1`;
    die(
      `Cloud mode blocked on protected branch "${preflightBranch}".\n\n` +
        `Explicit cloud activation (${sourceHint}) is not allowed on main/master.\n` +
        `Switch to a non-main branch for cloud mode, or run wu:claim without cloud activation on main/master.`,
    );
  }
  if (preflightCloudEffective.suppressed) {
    const signalSuffix = preflightCloudEffective.matchedSignal
      ? ` (signal: ${preflightCloudEffective.matchedSignal})`
      : '';
    console.log(
      `${PREFIX} Cloud auto-detection suppressed on protected branch "${preflightBranch}"${signalSuffix}; continuing with standard claim flow.`,
    );
  } else if (
    preflightCloudEffective.isCloud &&
    preflightCloudEffective.source === CLOUD_ACTIVATION_SOURCE.ENV_SIGNAL
  ) {
    console.log(
      `${PREFIX} Cloud mode auto-detected (source: ${preflightCloudEffective.source}${preflightCloudEffective.matchedSignal ? `, signal: ${preflightCloudEffective.matchedSignal}` : ''})`,
    );
  }

  // WU-1766: Skip ensureOnMain in cloud mode — cloud agents operate from
  // agent branches (claude/*, codex/*) and cannot switch to main.
  if (!shouldSkipEnsureOnMainForClaim({ isCloud: preflightCloudEffective.isCloud })) {
    await ensureOnMain(getGitForCwd());
  } else {
    console.log(`${PREFIX} Cloud mode: skipping ensureOnMain (agent branch: ${preflightBranch})`);
  }

  // WU-2411: Handle --resume flag for agent handoff
  if (args.resume) {
    await handleResumeMode(args, id);
    return; // Resume mode handles its own flow
  }

  // Preflight: ensure working tree is clean (unless --no-auto, which expects staged changes)
  if (!args.noAuto) {
    const status = await getGitForCwd().getStatus();
    if (status.trim()) {
      die(
        `Working tree is not clean. Commit or stash changes before claiming.\n\n` +
          `Uncommitted changes:\n${status}\n\n` +
          `Options:\n` +
          `  1. git add . && git commit -m "..."\n` +
          `  2. git stash\n` +
          `  3. Use --no-auto if you already staged claim edits manually`,
      );
    }
  }
  let stagedChanges: Awaited<ReturnType<typeof getStagedChanges>> = [];
  if (args.noAuto) {
    await ensureCleanOrClaimOnlyWhenNoAuto();
    stagedChanges = await getStagedChanges();
  }

  // WU-1361: Fetch latest remote before validation (no local main mutation)
  // WU-1653: Also skip when git.requireRemote=false (local-only mode)
  // WU-2194: Removed ensureMainUpToDate — pushOnly mode bases from origin/main,
  // not local main, so local-main staleness is irrelevant.
  const skipRemote = shouldSkipRemoteOperations();
  if (!args.noPush && !skipRemote) {
    await getGitForCwd().fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
  } else if (skipRemote) {
    console.log(`${PREFIX} Local-only mode (git.requireRemote=false): skipping origin sync`);
  } else {
    console.warn(
      `${PREFIX} Warning: --no-push enabled. Skipping origin/main sync; local state may be stale.`,
    );
  }

  const WU_PATH = WU_PATHS.WU(id);
  const STATUS_PATH = WU_PATHS.STATUS();
  const BACKLOG_PATH = WU_PATHS.BACKLOG();

  // WU-1649: Delegated to wu-claim-validation.ts
  const { fixableIssues } = await runPreflightValidations(args, id, WU_PATH, STATUS_PATH);

  // WU-1603: Atomic lane lock to prevent TOCTOU race conditions
  // This is Layer 2 defense after status.md check - prevents parallel agents from
  // both reading a free status.md before either updates it
  const existingLock = checkLaneLock(args.lane);
  if (existingLock.locked && existingLock.isStale) {
    const staleMetadata = existingLock.metadata;
    if (staleMetadata) {
      console.log(`${PREFIX} Detected stale lock for "${args.lane}" (${staleMetadata.wuId})`);
      console.log(`${PREFIX} Lock timestamp: ${staleMetadata.timestamp}`);
    } else {
      console.log(`${PREFIX} Detected stale lock for "${args.lane}"`);
    }
    forceRemoveStaleLock(args.lane);
  }

  const lockResult = acquireLaneLock(args.lane, id, {
    agentSession: null, // Will be set after session starts
  });

  if (!lockResult.acquired) {
    // Lock acquisition failed - another agent got there first
    const staleSuffix = lockResult.isStale
      ? '\n\nNote: This lock may be stale (>24h). Use --force to override if the owning WU is abandoned.'
      : '';
    die(
      `Cannot claim ${id}: ${lockResult.error}\n\n` +
        `Another agent is actively claiming or has claimed this lane.\n\n` +
        `Options:\n` +
        `  1. Wait for ${lockResult.existingLock?.wuId || 'the other WU'} to complete or block\n` +
        `  2. Choose a different lane\n` +
        `  3. Use --force to override (P0 emergencies only)${staleSuffix}`,
    );
  }

  emitWUFlowEvent({
    script: 'wu-claim',
    wu_id: id,
    lane: args.lane,
    step: 'lane_lock_acquired',
  });

  // WU-1808: Wrap claim execution in try/finally to ensure lock release on failure
  // If claim fails after lock acquisition, the lane would be blocked without this cleanup
  let claimSucceeded = false;
  // WU-1521: Track canonical claim push state for rollback in finally block
  let canonicalClaimPushed = false;
  let claimTitle = '';
  let claimActor: string | undefined;
  let postClaimSandboxWorktree: string | null;
  try {
    // Code paths overlap detection (WU-901)
    handleCodePathOverlap(WU_PATH, STATUS_PATH, id, args);

    // Prepare paths and branches
    const laneK = toKebab(args.lane);
    const idK = id.toLowerCase();
    const title = (await readWUTitle(id)) || '';
    const branch = args.branch || `lane/${laneK}/${idK}`;
    const configuredWorktreesDir = getConfig({ projectRoot: process.cwd() }).directories.worktrees;
    const worktree = args.worktree || path.join(configuredWorktreesDir, `${laneK}-${idK}`);
    const currentBranch = preflightBranch;
    const cloudEffective = preflightCloudEffective;
    const effectiveCloud = cloudEffective.isCloud;

    // WU-1590: Capture current branch for cloud claim metadata (before UnsafeAny branch switching)
    const currentBranchForCloud = effectiveCloud ? currentBranch : undefined;

    // WU-1491: Resolve claimed mode from flag combination
    const modeResult = resolveClaimMode({
      branchOnly: args.branchOnly,
      prMode: args.prMode,
      cloud: effectiveCloud,
    });
    if (modeResult.error) {
      die(modeResult.error);
    }
    const claimedMode = modeResult.mode;
    if (!claimedMode) {
      die('Could not resolve claim mode from CLI flags.');
    }

    // Branch-Only singleton guard: only for pure branch-only mode (not branch-pr)
    // branch-pr skips this guard because it supports parallel agents via PR isolation
    if (!modeResult.skipBranchOnlySingletonGuard) {
      await validateBranchOnlyMode(STATUS_PATH, id);
    }

    // WU-1590: Skip branch-exists checks in cloud mode (branch already exists by definition)
    const branchExecution = resolveBranchClaimExecution({
      claimedMode,
      isCloud: effectiveCloud,
      currentBranch,
      requestedBranch: branch,
    });
    const effectiveBranch = branchExecution.executionBranch;
    const skipBranchChecks = shouldSkipBranchExistsCheck({
      isCloud: effectiveCloud,
      currentBranch,
      laneBranch: effectiveBranch,
    });

    // Check if remote branch already exists (prevents duplicate global claims)
    // WU-1653: Skip when requireRemote=false (no remote to check)
    if (!args.noPush && !skipBranchChecks && !shouldSkipRemoteOperations()) {
      const remoteExists = await getGitForCwd().remoteBranchExists(REMOTES.ORIGIN, effectiveBranch);
      if (remoteExists) {
        die(
          `Remote branch ${REMOTES.ORIGIN}/${effectiveBranch} already exists. WU may already be claimed.\n\n` +
            `Options:\n` +
            `  1. Coordinate with the owning agent or wait for completion\n` +
            `  2. Choose a different WU\n` +
            `  3. Use --no-push for local-only claims (offline)`,
        );
      }
    }

    // Check if branch already exists locally (prevents duplicate claims)
    if (!skipBranchChecks) {
      const branchAlreadyExists = await getGitForCwd().branchExists(effectiveBranch);
      if (branchAlreadyExists) {
        die(
          `Branch ${effectiveBranch} already exists. WU may already be claimed.\n\n` +
            `Git branch existence = WU claimed (natural locking).\n\n` +
            `Options:\n` +
            `  1. Check git worktree list to see if worktree exists\n` +
            `  2. Coordinate with the owning agent or wait for them to complete\n` +
            `  3. Choose a different WU`,
        );
      }
    }

    // Layer 3 defense (WU-1476): Pre-flight orphan check
    // Clean up orphan directory if it exists at target worktree path
    const absoluteWorktreePath = path.resolve(worktree);
    if (await isOrphanWorktree(absoluteWorktreePath, process.cwd())) {
      console.log(`${PREFIX} Detected orphan directory at ${worktree}, cleaning up...`);
      try {
        rmSync(absoluteWorktreePath, { recursive: true, force: true });
        console.log(`${PREFIX} ${EMOJI.SUCCESS} Orphan directory removed`);
      } catch (err) {
        die(
          `Failed to clean up orphan directory at ${worktree}\n\n` +
            `Error: ${getErrorMessage(err)}\n\n` +
            `Manual cleanup: rm -rf ${absoluteWorktreePath}`,
        );
      }
    }

    // WU-1438: Start agent session BEFORE metadata update to include session_id in YAML
    let sessionId = null;
    try {
      const sessionResult = await startSessionForWU({
        wuId: id,
        tier: 2,
      });
      sessionId = sessionResult.sessionId;
      if (sessionResult.alreadyActive) {
        console.log(`${PREFIX} Agent session already active (${sessionId.slice(0, 8)}...)`);
      } else {
        console.log(
          `${PREFIX} ${EMOJI.SUCCESS} Agent session started (${sessionId.slice(0, 8)}...)`,
        );
      }
    } catch (err) {
      // Non-blocking: session start failure should not block claim
      console.warn(`${PREFIX} Warning: Could not start agent session: ${getErrorMessage(err)}`);
    }

    // Execute claim workflow
    const baseCtx = {
      args,
      id,
      laneK,
      title,
      branch: effectiveBranch,
      worktree,
      WU_PATH,
      STATUS_PATH,
      BACKLOG_PATH,
      claimedMode,
      shouldCreateBranch: branchExecution.shouldCreateBranch,
      currentBranch,
      fixableIssues, // WU-1361: Pass fixable issues for worktree application
      stagedChanges,
      currentBranchForCloud, // WU-1590: For persisting claimed_branch in branch-pr mode
    };
    let updatedTitle = title;
    claimTitle = title;
    const shouldApplyCanonicalUpdate = shouldApplyCanonicalClaimUpdateFn({
      isCloud: effectiveCloud,
      claimedMode,
      noPush: Boolean(args.noPush),
    });
    if (shouldApplyCanonicalUpdate) {
      updatedTitle = (await applyCanonicalClaimUpdate(baseCtx, sessionId)) || updatedTitle;
      // WU-1521: Mark that canonical claim was pushed to origin/main
      // If claim fails after this point, the finally block will rollback
      canonicalClaimPushed = true;
      claimTitle = updatedTitle || title;

      // Refresh origin/main after push-only update so worktrees start from canonical state
      // WU-1653: Skip fetch when requireRemote=false (no remote)
      if (!shouldSkipRemoteOperations()) {
        await getGitForCwd().fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
      }
    } else if (!args.noPush && claimedMode === CLAIMED_MODES.BRANCH_PR) {
      console.log(
        `${PREFIX} Skipping canonical claim update on origin/main for cloud branch-pr claim.`,
      );
    }
    const ctx = {
      ...baseCtx,
      args: baseCtx.args as import('./wu-claim-worktree.js').ClaimArgs,
      sessionId,
      updatedTitle,
    };
    // WU-1491: Route to correct mode handler
    // branch-pr uses branch-only workflow (no worktree) but with branch-pr claimed_mode
    if (claimedMode === CLAIMED_MODES.BRANCH_ONLY || claimedMode === CLAIMED_MODES.BRANCH_PR) {
      await claimBranchOnlyMode(ctx);
    } else {
      await claimWorktreeMode(ctx);
    }

    // WU-1605: Record claim-time pickup evidence for delegation provenance.
    // Non-blocking: this metadata should not block claim completion.
    try {
      let claimedBy = process.env.GIT_AUTHOR_EMAIL?.trim();
      try {
        claimedBy = await getAssignedEmail(getGitForCwd());
      } catch {
        // Fall back to env/default when git email lookup fails in this context.
      }

      const pickupResult = await recordClaimPickupEvidence(id, {
        baseDir: process.cwd(),
        claimedBy,
      });
      claimActor = claimedBy;
      if (pickupResult.recorded) {
        console.log(
          `${PREFIX} ${EMOJI.SUCCESS} Recorded delegation pickup evidence (${pickupResult.spawnId})`,
        );
      } else if (pickupResult.alreadyRecorded) {
        console.log(
          `${PREFIX} ${EMOJI.INFO} Delegation pickup evidence already recorded (${pickupResult.spawnId})`,
        );
      }
    } catch (err) {
      console.warn(
        `${PREFIX} Warning: Could not record delegation pickup evidence: ${getErrorMessage(err)}`,
      );
    }

    await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.CLAIM,
        wuId: id,
        by: claimActor,
        sessionId: sessionId ?? undefined,
      },
      {
        workspaceRoot: process.cwd(),
        logger: {
          warn: (message) => console.warn(`${PREFIX} ${message}`),
        },
      },
    );

    // Mark claim as successful - lock should remain for wu:done to release
    claimSucceeded = true;
    postClaimSandboxWorktree =
      claimedMode === CLAIMED_MODES.BRANCH_ONLY || claimedMode === CLAIMED_MODES.BRANCH_PR
        ? process.cwd()
        : path.resolve(worktree);
  } finally {
    // WU-1808: Release lane lock if claim did not complete successfully
    // This prevents orphan locks from blocking the lane when claim crashes or fails
    if (!claimSucceeded) {
      // WU-1521: Rollback canonical claim state if it was pushed to origin/main
      // This ensures re-running wu:claim succeeds without needing wu:repair
      if (canonicalClaimPushed) {
        await rollbackCanonicalClaim(id, args.lane, claimTitle);
      }

      console.log(`${PREFIX} Claim did not complete - releasing lane lock...`);
      const releaseResult = releaseLaneLock(args.lane, { wuId: id });
      if (releaseResult.released && !releaseResult.notFound) {
        console.log(`${PREFIX} Lane lock released for "${args.lane}"`);
      }
    }
  }

  const sandboxExitCode = await maybeLaunchClaimSandboxSession({
    enabled: Boolean(args.sandbox && claimSucceeded && postClaimSandboxWorktree),
    id,
    worktreePath: postClaimSandboxWorktree || process.cwd(),
    argv: process.argv,
  });
  if (sandboxExitCode !== null && sandboxExitCode !== EXIT_CODES.SUCCESS) {
    die(
      `Post-claim sandbox command exited with code ${sandboxExitCode}.\n` +
        `Claim for ${id} remains active. Resume from ${postClaimSandboxWorktree || process.cwd()}.`,
    );
  }
}

// Guard main() for testability (WU-1366)
// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
