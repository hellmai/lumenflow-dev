// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import prettyMs from 'pretty-ms';
import { runGates } from './gates.js';
import { resolveWuEventsRelativePath } from './state-path-resolvers.js';
import { canSkipGates, createPreGatesCheckpoint as createWU1747Checkpoint, markGatesPassed } from '@lumenflow/core/wu-checkpoint';
import { printGateFailureBox } from '@lumenflow/core/wu-done-ui';
import {
  CHECKPOINT_MESSAGES,
  CLI_FLAGS,
  EMOJI,
  FILE_SYSTEM,
  LOG_PREFIX,
  PKG_MANAGER,
  SCRIPTS,
  SKIP_GATES_REASONS,
  TELEMETRY_STEPS,
} from '@lumenflow/core/wu-constants';
import { createError, die, ErrorCodes, getErrorMessage } from '@lumenflow/core/error-handler';

interface ExecuteGatesDependencies {
  auditSkipGates: (
    id: string,
    reason: unknown,
    fixWu: unknown,
    worktreePath: string | null,
  ) => Promise<void>;
  auditSkipCosGates: (id: string, reason: unknown, worktreePath: string | null) => Promise<void>;
  createPreGatesCheckpoint: (
    id: string,
    worktreePath: string | null,
    baseDir: string,
  ) => Promise<void>;
  emitTelemetry: (event: Record<string, unknown>) => void;
}

/**
 * WU-2165: Check if node_modules in worktree may be stale.
 */
function checkNodeModulesStaleness(worktreePath: string): void {
  try {
    const mainPackageJson = path.resolve('package.json');
    const worktreePackageJson = path.resolve(worktreePath, 'package.json');

    if (!existsSync(mainPackageJson) || !existsSync(worktreePackageJson)) {
      return;
    }

    const mainContent = readFileSync(mainPackageJson, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    });
    const worktreeContent = readFileSync(worktreePackageJson, {
      encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
    });

    if (mainContent !== worktreeContent) {
      const worktreeNodeModules = path.resolve(worktreePath, 'node_modules');

      if (existsSync(worktreeNodeModules)) {
        const nodeModulesStat = statSync(worktreeNodeModules);
        const packageJsonStat = statSync(worktreePackageJson);

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
    console.warn(
      `${LOG_PREFIX.DONE} Could not check node_modules staleness: ${getErrorMessage(e)}`,
    );
  }
}

/**
 * WU-2165: Run gates in the lane worktree.
 */
async function runGatesInWorktree(
  worktreePath: string,
  id: string,
  emitTelemetry: ExecuteGatesDependencies['emitTelemetry'],
  options: { isDocsOnly?: boolean; docsOnly?: boolean; scopedTestPaths?: string[] } = {},
) {
  const { isDocsOnly = false, docsOnly = false, scopedTestPaths } = options;
  console.log(`\n${LOG_PREFIX.DONE} Running gates in worktree: ${worktreePath}`);

  checkNodeModulesStaleness(worktreePath);

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

    printGateFailureBox({ id, location: worktreePath, durationMs: duration, isWorktreeMode: true });
    die(`Gates failed in ${worktreePath}. Fix issues in the worktree and try again.`);
  }
}

export interface ExecuteGatesParams {
  id: string;
  args: Record<string, unknown>;
  isBranchOnly: boolean;
  isDocsOnly: boolean;
  worktreePath: string | null;
  branchName?: string;
  scopedTestPaths?: string[];
}

export interface ExecuteGatesResult {
  fullGatesRanInCurrentRun: boolean;
  skippedByCheckpoint: boolean;
  checkpointId: string | null;
}

/**
 * WU-2165: Gate orchestration extracted from wu-done.ts.
 */
export async function executeGates(
  { id, args, isBranchOnly, isDocsOnly, worktreePath, branchName, scopedTestPaths }: ExecuteGatesParams,
  dependencies: ExecuteGatesDependencies,
): Promise<ExecuteGatesResult> {
  const gateResult: ExecuteGatesResult = {
    fullGatesRanInCurrentRun: false,
    skippedByCheckpoint: false,
    checkpointId: null,
  };

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
    dependencies.emitTelemetry({
      script: TELEMETRY_STEPS.GATES,
      wu_id: id,
      step: TELEMETRY_STEPS.GATES,
      skipped: true,
      reason: SKIP_GATES_REASONS.CHECKPOINT_VALID,
      checkpoint_id: skipResult.checkpoint.checkpointId,
    });
    return gateResult;
  }

  if (worktreePath && branchName) {
    try {
      await createWU1747Checkpoint({ wuId: id, worktreePath, branchName }, { gatesPassed: false });
    } catch (err) {
      console.warn(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} ${CHECKPOINT_MESSAGES.COULD_NOT_CREATE}: ${getErrorMessage(err)}`,
      );
    }
  }

  await dependencies.createPreGatesCheckpoint(id, worktreePath, worktreePath || process.cwd());

  if (worktreePath) {
    try {
      execSync(`git -C "${worktreePath}" restore "${resolveWuEventsRelativePath(worktreePath)}"`);
    } catch {
      // Non-fatal: file might not exist or already clean
    }
  }

  const invariantsBaseDir = worktreePath || process.cwd();
  console.log(`\n${LOG_PREFIX.DONE} Running invariants check (non-bypassable)...`);
  console.log(`${LOG_PREFIX.DONE} Checking invariants in: ${invariantsBaseDir}`);
  const { runInvariants } = await import('@lumenflow/core/invariants-runner');
  const invariantsResult = runInvariants({ baseDir: invariantsBaseDir, silent: false, wuId: id });
  if (!invariantsResult.success) {
    dependencies.emitTelemetry({
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
  dependencies.emitTelemetry({
    script: 'wu-done',
    wu_id: id,
    step: 'invariants',
    ok: true,
  });

  if (args.skipGates) {
    console.log(
      `\n${EMOJI.WARNING}  ${EMOJI.WARNING}  ${EMOJI.WARNING}  SKIP-GATES MODE ACTIVE ${EMOJI.WARNING}  ${EMOJI.WARNING}  ${EMOJI.WARNING}\n`,
    );
    console.log(`${LOG_PREFIX.DONE} Skipping gates check as requested`);
    console.log(`${LOG_PREFIX.DONE} Reason: ${args.reason}`);
    console.log(`${LOG_PREFIX.DONE} Fix WU: ${args.fixWu}`);
    console.log(`${LOG_PREFIX.DONE} Worktree: ${worktreePath || 'Branch-Only mode (no worktree)'}`);
    await dependencies.auditSkipGates(id, args.reason, args.fixWu, worktreePath);
    console.log('\n⚠️  Ensure test failures are truly pre-existing!\n');
    dependencies.emitTelemetry({
      script: 'wu-done',
      wu_id: id,
      step: 'gates',
      skipped: true,
      reason: args.reason,
      fix_wu: args.fixWu,
    });
  } else if (isBranchOnly) {
    console.log(`\n${LOG_PREFIX.DONE} Running gates in Branch-Only mode (in-place on lane branch)`);
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
      dependencies.emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'gates',
        ok: true,
        duration_ms: duration,
      });
    } catch {
      const duration = Date.now() - startTime;
      dependencies.emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'gates',
        ok: false,
        duration_ms: duration,
      });
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
    await runGatesInWorktree(worktreePath, id, dependencies.emitTelemetry, {
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

  if (!args.skipCosGates) {
    console.log(`\n${LOG_PREFIX.DONE} Running COS governance gates...`);
    const startTime = Date.now();
    try {
      execSync(`${PKG_MANAGER} ${SCRIPTS.COS_GATES} ${CLI_FLAGS.WU} ${id}`, {
        stdio: 'inherit',
      });
      const duration = Date.now() - startTime;
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} COS gates passed in ${prettyMs(duration)}`);
      dependencies.emitTelemetry({
        script: 'wu-done',
        wu_id: id,
        step: 'cos-gates',
        ok: true,
        duration_ms: duration,
      });
    } catch {
      const duration = Date.now() - startTime;
      dependencies.emitTelemetry({
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
      console.error(
        `  pnpm wu:done --id ${id} --skip-gates --reason "COS evidence pending" --fix-wu WU-XXXX`,
      );
      die('Abort: WU not completed. Fix governance evidence and retry pnpm wu:done.');
    }
  } else {
    console.log(`\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} Skipping COS governance gates as requested`);
    console.log(`${LOG_PREFIX.DONE} Reason: ${args.reason || '(no reason provided)'}`);
    await dependencies.auditSkipCosGates(id, args.reason, worktreePath);
    dependencies.emitTelemetry({
      script: 'wu-done',
      wu_id: id,
      step: 'cos-gates',
      skipped: true,
      reason: args.reason,
    });
  }

  markGatesPassed(id, { baseDir: worktreePath || undefined });
  return gateResult;
}

