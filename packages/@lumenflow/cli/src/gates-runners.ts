// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gate Runner Functions
 *
 * WU-1647: Extracted gate runner functions that execute individual gates.
 * Each runner takes a GateLogContext and returns a result with ok/duration.
 *
 * @module gates-runners
 */

import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getChangedLintableFiles } from '@lumenflow/core/incremental-lint';
import { buildVitestChangedArgs, isCodeFilePath } from '@lumenflow/core/incremental-test';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import {
  resolveGatesCommands,
  resolveTestRunner,
  getGatesSection,
} from '@lumenflow/core/gates-config';
import { CoChangeRuleConfigSchema } from '@lumenflow/core/config-schema';
import type { CoChangeRuleConfig } from '@lumenflow/core/config-schema';
import type { LaneHealthMode } from '@lumenflow/core/gates-config';
import { validateBacklogSync } from '@lumenflow/core/validators/backlog-sync';
import { validateClaimValidation } from '@lumenflow/core';
import { runSupabaseDocsLinter } from '@lumenflow/core/validators/supabase-docs-linter';
import {
  BRANCHES,
  PACKAGES,
  PKG_MANAGER,
  ESLINT_FLAGS,
  ESLINT_COMMANDS,
  ESLINT_DEFAULTS,
  GIT_REFS,
  SCRIPTS,
  CACHE_STRATEGIES,
  DIRECTORIES,
  EXIT_CODES,
  FILE_SYSTEM,
} from '@lumenflow/core/wu-constants';
import { runLaneHealthCheck } from './lane-health.js';
import {
  type GateLogContext,
  pnpmCmd,
  pnpmRun,
  run,
  makeGateLogger,
  quoteShellArgs,
  filterExistingFiles,
  getChangedFilesForIncremental,
  detectCurrentWUForCwd,
  buildPrettierCheckCommand,
} from './gates-utils.js';
import {
  resolveFormatCheckPlan,
  resolveLintPlan,
  resolveTestPlan,
  resolveSpecLinterPlan,
  isTestConfigFile,
} from './gates-plan-resolvers.js';

const require = createRequire(import.meta.url);
const micromatch = require('micromatch') as {
  isMatch(path: string, patterns: string | readonly string[]): boolean;
};
const CO_CHANGE_SEVERITY = {
  WARN: 'warn',
  ERROR: 'error',
  OFF: 'off',
} as const;

// ── Format check gate ──────────────────────────────────────────────────

export async function runFormatCheckGate({ agentLog, useAgentMode, cwd }: GateLogContext): Promise<{
  ok: boolean;
  duration: number;
  fileCount: number;
  filesChecked?: string[];
}> {
  const start = Date.now();
  const effectiveCwd = cwd ?? process.cwd();
  const logLine = makeGateLogger({ agentLog, useAgentMode });

  let git;
  let isMainBranch: boolean;

  try {
    git = createGitForPath(effectiveCwd);
    const currentBranch = await git.getCurrentBranch();
    isMainBranch = currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER;
  } catch (error) {
    logLine(`\u26A0\uFE0F  Failed to determine branch for format check: ${error.message}`);
    const result = run(pnpmCmd(SCRIPTS.FORMAT_CHECK), { agentLog, cwd: effectiveCwd });
    return { ...result, duration: Date.now() - start, fileCount: -1 };
  }

  if (isMainBranch) {
    logLine('\uD83D\uDCCB On main branch - running full format check');
    const result = run(pnpmCmd(SCRIPTS.FORMAT_CHECK), { agentLog, cwd: effectiveCwd });
    return { ...result, duration: Date.now() - start, fileCount: -1 };
  }

  let changedFiles: string[] = [];
  let fileListError = false;

  try {
    changedFiles = await getChangedFilesForIncremental({ git });
  } catch (error) {
    fileListError = true;
    logLine(`\u26A0\uFE0F  Failed to determine changed files for format check: ${error.message}`);
  }

  const plan = resolveFormatCheckPlan({ changedFiles, fileListError, cwd: effectiveCwd });

  if (plan.mode === 'skip') {
    logLine('\n> format:check (incremental)\n');
    logLine('\u2705 No files changed - skipping format check');
    return { ok: true, duration: Date.now() - start, fileCount: 0, filesChecked: [] };
  }

  if (plan.mode === 'full') {
    const reason =
      plan.reason === 'prettier-config'
        ? ' (prettier config changed)'
        : plan.reason === 'file-list-error'
          ? ' (file list unavailable)'
          : '';

    logLine(`\uD83D\uDCCB Running full format check${reason}`);
    const result = run(pnpmCmd(SCRIPTS.FORMAT_CHECK), { agentLog, cwd: effectiveCwd });
    return { ...result, duration: Date.now() - start, fileCount: -1 };
  }

  const existingFiles = await filterExistingFiles(plan.files, effectiveCwd);
  if (existingFiles.length === 0) {
    logLine('\n> format:check (incremental)\n');
    logLine('\u2705 All changed files were deleted - skipping format check');
    return { ok: true, duration: Date.now() - start, fileCount: 0, filesChecked: [] };
  }

  logLine(`\n> format:check (incremental: ${existingFiles.length} files)\n`);
  const result = run(buildPrettierCheckCommand(existingFiles), { agentLog, cwd: effectiveCwd });
  return {
    ...result,
    duration: Date.now() - start,
    fileCount: existingFiles.length,
    filesChecked: existingFiles,
  };
}

// ── Lint gate ──────────────────────────────────────────────────────────

/**
 * Run incremental ESLint on changed files only
 * Falls back to full lint if on main branch or if incremental fails
 */
export async function runIncrementalLint({
  agentLog,
  cwd,
}: {
  agentLog?: { logFd: number; logPath: string } | null;
  cwd: string;
}) {
  const start = Date.now();
  const logLine = (line: string) => {
    if (!agentLog) {
      console.log(line);
      return;
    }
    writeSync(agentLog.logFd, `${line}\n`);
  };

  try {
    // Check if we're on main branch
    const git = createGitForPath(cwd);
    const currentBranch = await git.getCurrentBranch();
    const isMainBranch = currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER;

    if (isMainBranch) {
      logLine('\uD83D\uDCCB On main branch - running full lint');
      const result = run(pnpmCmd(SCRIPTS.LINT), { agentLog, cwd });
      return { ...result, fileCount: -1 };
    }

    const changedFiles = await getChangedLintableFiles({ git });
    const plan = resolveLintPlan({ isMainBranch, changedFiles });

    if (plan.mode === 'skip') {
      logLine('\n> ESLint (incremental)\n');
      logLine('\u2705 No lintable files changed - skipping lint');
      return { ok: true, duration: Date.now() - start, fileCount: 0 };
    }

    if (plan.mode === 'full') {
      logLine('\uD83D\uDCCB Running full lint (incremental plan forced full)');
      const result = run(pnpmCmd(SCRIPTS.LINT), { agentLog, cwd });
      return { ...result, fileCount: -1 };
    }

    const existingFiles = await filterExistingFiles(plan.files, cwd);
    if (existingFiles.length === 0) {
      logLine('\n> ESLint (incremental)\n');
      logLine('\u2705 All changed files were deleted - skipping lint');
      return { ok: true, duration: Date.now() - start, fileCount: 0 };
    }

    logLine(`\n> ESLint (incremental: ${existingFiles.length} files)\n`);
    logLine(`Files to lint:\n  ${existingFiles.join('\n  ')}\n`);

    const result = spawnSync(
      PKG_MANAGER,
      [
        ESLINT_COMMANDS.ESLINT,
        ESLINT_FLAGS.MAX_WARNINGS,
        ESLINT_DEFAULTS.MAX_WARNINGS,
        ESLINT_FLAGS.NO_WARN_IGNORED,
        ESLINT_FLAGS.CACHE,
        ESLINT_FLAGS.CACHE_STRATEGY,
        CACHE_STRATEGIES.CONTENT,
        ESLINT_FLAGS.CACHE_LOCATION,
        '.eslintcache',
        ESLINT_FLAGS.PASS_ON_UNPRUNED,
        ...existingFiles,
      ],
      agentLog
        ? {
            stdio: ['ignore', agentLog.logFd, agentLog.logFd] as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd,
          }
        : {
            stdio: 'inherit' as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd,
          },
    );

    const duration = Date.now() - start;
    return {
      ok: result.status === EXIT_CODES.SUCCESS,
      duration,
      fileCount: existingFiles.length,
    };
  } catch (error) {
    console.error(
      '\u26A0\uFE0F  Incremental lint failed, falling back to full lint:',
      error.message,
    );
    const result = run(pnpmCmd(SCRIPTS.LINT), { agentLog, cwd });
    return { ...result, fileCount: -1 };
  }
}

// ── Test gates ─────────────────────────────────────────────────────────

const DEFAULT_INCREMENTAL_BASE_BRANCH = GIT_REFS.ORIGIN_MAIN;

export function buildStableVitestIncrementalCommand(
  baseBranch = DEFAULT_INCREMENTAL_BASE_BRANCH,
): string {
  return pnpmCmd('vitest', 'run', ...buildVitestChangedArgs({ baseBranch }));
}

export function resolveIncrementalTestCommand({
  testRunner,
  configuredIncrementalCommand,
  baseBranch = DEFAULT_INCREMENTAL_BASE_BRANCH,
}: {
  testRunner: string;
  configuredIncrementalCommand?: string;
  baseBranch?: string;
}): string | null {
  const normalizedConfiguredCommand = configuredIncrementalCommand?.trim();

  if (testRunner === 'vitest') {
    if (!normalizedConfiguredCommand) {
      return buildStableVitestIncrementalCommand(baseBranch);
    }

    const isVitestChangedCommand =
      normalizedConfiguredCommand.includes('vitest') &&
      normalizedConfiguredCommand.includes('--changed');

    if (isVitestChangedCommand) {
      return buildStableVitestIncrementalCommand(baseBranch);
    }
  }

  return normalizedConfiguredCommand ?? null;
}

/**
 * Run changed tests using configured test runner's incremental mode.
 * WU-1356: Updated to use configured commands from gates-config.
 */
export async function runChangedTests({
  agentLog,
  cwd,
  scopedTestPaths = [],
}: {
  agentLog?: { logFd: number; logPath: string } | null;
  cwd: string;
  scopedTestPaths?: string[];
}) {
  const start = Date.now();
  // eslint-disable-next-line sonarjs/no-identical-functions -- Pre-existing: logLine helper duplicated across gate runners
  const logLine = (line: string) => {
    if (!agentLog) {
      console.log(line);
      return;
    }
    writeSync(agentLog.logFd, `${line}\n`);
  };

  // WU-1356: Get configured commands
  const gatesCommands = resolveGatesCommands(cwd);
  const testRunner = resolveTestRunner(cwd);
  const normalizedScopedTestPaths = scopedTestPaths
    .filter((testPath): testPath is string => typeof testPath === 'string')
    .map((testPath) => testPath.trim())
    .filter(Boolean);

  try {
    if (normalizedScopedTestPaths.length > 0) {
      const testPathsArg = quoteShellArgs(normalizedScopedTestPaths);
      logLine(
        `\n> Running scoped tests from WU tests.unit (${normalizedScopedTestPaths.length})\n`,
      );

      const result = run(pnpmCmd('vitest', 'run', testPathsArg, '--passWithNoTests'), {
        agentLog,
        cwd,
      });
      return { ...result, duration: Date.now() - start, isIncremental: true };
    }

    const git = createGitForPath(cwd);
    const currentBranch = await git.getCurrentBranch();
    const isMainBranch = currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER;

    if (isMainBranch) {
      logLine('\uD83D\uDCCB On main branch - running full test suite');
      const result = run(gatesCommands.test_full, { agentLog, cwd });
      return { ...result, isIncremental: false };
    }

    let changedFiles: string[] = [];
    let fileListError = false;

    try {
      changedFiles = await getChangedFilesForIncremental({ git });
    } catch (error) {
      fileListError = true;
      logLine(`\u26A0\uFE0F  Failed to determine changed files for tests: ${error.message}`);
    }

    const hasConfigChange = !fileListError && changedFiles.some(isTestConfigFile);

    const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard']);
    const untrackedFiles = untrackedOutput
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    const untrackedCodeFiles = untrackedFiles.filter(isCodeFilePath);
    const hasUntrackedCode = untrackedCodeFiles.length > 0;

    const plan = resolveTestPlan({
      isMainBranch,
      hasUntrackedCode,
      hasConfigChange,
      fileListError,
    });

    if (plan.mode === 'full') {
      if (plan.reason === 'untracked-code') {
        const preview = untrackedCodeFiles.slice(0, 5).join(', ');
        logLine(
          `\u26A0\uFE0F  Untracked code files detected (${untrackedCodeFiles.length}): ${preview}${untrackedCodeFiles.length > 5 ? '...' : ''}`,
        );
      } else if (plan.reason === 'test-config') {
        logLine('\u26A0\uFE0F  Test config changes detected - running full test suite');
      } else if (plan.reason === 'file-list-error') {
        logLine('\u26A0\uFE0F  Changed file list unavailable - running full test suite');
      }

      logLine('\uD83D\uDCCB Running full test suite to avoid missing coverage');
      const result = run(gatesCommands.test_full, { agentLog, cwd });
      return { ...result, duration: Date.now() - start, isIncremental: false };
    }

    // WU-1356: Use configured incremental test command
    logLine(`\n> Running tests (${testRunner} --changed)\n`);

    const incrementalCommand = resolveIncrementalTestCommand({
      testRunner,
      configuredIncrementalCommand: gatesCommands.test_incremental,
    });

    if (incrementalCommand) {
      if (
        testRunner === 'vitest' &&
        incrementalCommand !== gatesCommands.test_incremental?.trim()
      ) {
        logLine('ℹ️  Using hardened vitest incremental command for worker stability');
      }

      const result = run(incrementalCommand, { agentLog, cwd });
      return { ...result, duration: Date.now() - start, isIncremental: true };
    }

    // For other runners without configured incremental, fall back to full
    logLine('\u26A0\uFE0F  No incremental test command configured, running full suite');
    const result = run(gatesCommands.test_full, { agentLog, cwd });
    return { ...result, duration: Date.now() - start, isIncremental: false };
  } catch (error) {
    console.error('\u26A0\uFE0F  Changed tests failed, falling back to full suite:', error.message);
    const result = run(gatesCommands.test_full, { agentLog, cwd });
    return { ...result, isIncremental: false };
  }
}

/**
 * Safety-critical test file patterns (relative to apps/web).
 */
export const SAFETY_CRITICAL_TEST_FILES = [
  // Privacy detection tests
  'src/lib/llm/__tests__/privacyDetector.test.ts',
  // Escalation trigger tests
  'src/lib/llm/__tests__/escalationTrigger.test.ts',
  'src/components/escalation/__tests__/EscalationHistory.test.tsx',
  // Constitutional enforcer tests
  'src/lib/llm/__tests__/constitutionalEnforcer.test.ts',
  // Safe prompt wrapper tests
  'src/lib/llm/__tests__/safePromptWrapper.test.ts',
  // Crisis/emergency handling tests
  'src/lib/prompts/__tests__/golden-crisis.test.ts',
];

/**
 * WU-2062: Run safety-critical tests
 * These tests ALWAYS run regardless of which files changed.
 */
export async function runSafetyCriticalTests({
  agentLog,
  cwd,
}: {
  agentLog?: { logFd: number; logPath: string } | null;
  cwd: string;
}) {
  const start = Date.now();
  // eslint-disable-next-line sonarjs/no-identical-functions -- Pre-existing: logLine helper duplicated across gate runners
  const logLine = (line: string) => {
    if (!agentLog) {
      console.log(line);
      return;
    }
    writeSync(agentLog.logFd, `${line}\n`);
  };

  // WU-1006: Skip safety-critical tests if apps/web doesn't exist (repo-agnostic)
  const webDir = path.join(cwd, DIRECTORIES.APPS_WEB);
  try {
    await access(webDir);
  } catch {
    logLine('\n> Safety-critical tests skipped (apps/web not present)\n');
    return { ok: true, duration: Date.now() - start, testCount: 0 };
  }

  try {
    logLine('\n> Safety-critical tests (always run)\n');
    logLine(`Test files: ${SAFETY_CRITICAL_TEST_FILES.length} files\n`);

    const result = spawnSync(
      PKG_MANAGER,
      [
        'vitest',
        'run',
        '--project',
        PACKAGES.WEB,
        '--reporter=verbose',
        ...SAFETY_CRITICAL_TEST_FILES,
        '--passWithNoTests',
      ],
      agentLog
        ? {
            stdio: ['ignore', agentLog.logFd, agentLog.logFd] as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd,
          }
        : {
            stdio: 'inherit' as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd,
          },
    );

    const duration = Date.now() - start;
    return {
      ok: result.status === EXIT_CODES.SUCCESS,
      duration,
      testCount: SAFETY_CRITICAL_TEST_FILES.length,
    };
  } catch (error) {
    console.error('\u26A0\uFE0F  Safety-critical tests failed:', error.message);
    return { ok: false, duration: Date.now() - start, testCount: 0 };
  }
}

/**
 * WU-2062: Run integration tests for high-risk changes
 */
export async function runIntegrationTests({
  agentLog,
  cwd,
}: {
  agentLog?: { logFd: number; logPath: string } | null;
  cwd: string;
}) {
  const start = Date.now();
  // eslint-disable-next-line sonarjs/no-identical-functions -- Pre-existing: logLine helper duplicated across gate runners
  const logLine = (line: string) => {
    if (!agentLog) {
      console.log(line);
      return;
    }
    writeSync(agentLog.logFd, `${line}\n`);
  };

  try {
    logLine('\n> Integration tests (high-risk changes detected)\n');

    // WU-1415: vitest doesn't support --include flag
    const result = run(
      `RUN_INTEGRATION_TESTS=1 ${pnpmCmd(
        'vitest',
        'run',
        "'**/*.integration.*'",
        "'**/golden-*.test.*'",
      )}`,
      { agentLog, cwd },
    );

    const duration = Date.now() - start;
    return {
      ok: result.ok,
      duration,
    };
  } catch (error) {
    console.error('\u26A0\uFE0F  Integration tests failed:', error.message);
    return { ok: false, duration: Date.now() - start };
  }
}

// ── Co-change gate ────────────────────────────────────────────────────

const CoChangeRulesConfigSchema = CoChangeRuleConfigSchema.array();

export interface CoChangeEvaluationResult {
  errors: string[];
  warnings: string[];
}

function hasPatternMatch(changedFiles: string[], patterns: string[]): boolean {
  return changedFiles.some((filePath) => micromatch.isMatch(filePath, patterns));
}

export function evaluateCoChangeRules({
  changedFiles,
  rules,
}: {
  changedFiles: string[];
  rules: CoChangeRuleConfig[];
}): CoChangeEvaluationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    if (rule.severity === CO_CHANGE_SEVERITY.OFF) {
      continue;
    }

    const triggerMatched = hasPatternMatch(changedFiles, rule.trigger_patterns);
    if (!triggerMatched) {
      continue;
    }

    const requireMatched = hasPatternMatch(changedFiles, rule.require_patterns);
    if (requireMatched) {
      continue;
    }

    const message =
      `co-change "${rule.name}" violated: ` +
      `trigger matched (${rule.trigger_patterns.join(', ')}) but required patterns missing ` +
      `(${rule.require_patterns.join(', ')})`;

    if (rule.severity === CO_CHANGE_SEVERITY.WARN) {
      warnings.push(message);
      continue;
    }

    errors.push(message);
  }

  return { errors, warnings };
}

export async function runCoChangeGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const effectiveCwd = cwd ?? process.cwd();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> Co-change check\n');

  const gatesSection = getGatesSection(effectiveCwd) as { co_change?: unknown } | null;
  const parsedRules = CoChangeRulesConfigSchema.safeParse(gatesSection?.co_change ?? []);
  if (!parsedRules.success) {
    logLine('⚠️  Invalid gates.co_change config; skipping check.');
    return { ok: true, duration: Date.now() - start };
  }

  const rules = parsedRules.data;
  if (rules.length === 0) {
    logLine('ℹ️  No co-change rules configured; skipping.');
    return { ok: true, duration: Date.now() - start };
  }

  const git = createGitForPath(effectiveCwd);
  const changedFiles = await getChangedFilesForIncremental({ git });
  if (changedFiles.length === 0) {
    logLine('ℹ️  No changed files detected; skipping co-change checks.');
    return { ok: true, duration: Date.now() - start };
  }

  const evaluation = evaluateCoChangeRules({ changedFiles, rules });

  for (const warning of evaluation.warnings) {
    logLine(`⚠️  ${warning}`);
  }
  for (const error of evaluation.errors) {
    logLine(`❌ ${error}`);
  }

  if (evaluation.errors.length > 0) {
    logLine('co-change check failed.');
    return { ok: false, duration: Date.now() - start };
  }

  logLine('co-change check passed.');
  return { ok: true, duration: Date.now() - start };
}

// ── Spec linter gate ───────────────────────────────────────────────────

export async function runSpecLinterGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const wuId = await detectCurrentWUForCwd(cwd);
  const plan = resolveSpecLinterPlan(wuId);

  if (plan.scopedWuId) {
    const scopedCmd = pnpmCmd('wu:validate', '--id', plan.scopedWuId);
    const scopedResult = run(scopedCmd, { agentLog, cwd });
    if (!scopedResult.ok) {
      return { ok: false, duration: Date.now() - start };
    }
    return { ok: true, duration: Date.now() - start };
  }

  if (!useAgentMode) {
    console.log('\u26A0\uFE0F  Unable to detect current WU; skipping scoped validation.');
  } else if (agentLog) {
    writeSync(
      agentLog.logFd,
      '\u26A0\uFE0F  Unable to detect current WU; skipping scoped validation.\n',
    );
  }

  if (!plan.runGlobal) {
    return { ok: true, duration: Date.now() - start };
  }

  const fallbackResult = run(pnpmRun(SCRIPTS.SPEC_LINTER), { agentLog, cwd });
  return { ok: fallbackResult.ok, duration: Date.now() - start };
}

// ── Claim validation gate ───────────────────────────────────────────────

export async function runClaimValidationGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const effectiveCwd = cwd ?? process.cwd();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> Claim validation\n');

  const wuId = await detectCurrentWUForCwd(effectiveCwd);
  if (!wuId) {
    logLine('\u26A0\uFE0F  Unable to detect current WU; skipping claim validation.');
    return { ok: true, duration: Date.now() - start };
  }

  const result = await validateClaimValidation({ cwd: effectiveCwd, wuId });

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      logLine(`\u26A0\uFE0F  ${warning}`);
    }
  }

  if (result.ok) {
    logLine(
      `Claim validation passed (${result.checkedClaims} checked claim${
        result.checkedClaims === 1 ? '' : 's'
      }).`,
    );
    return { ok: true, duration: Date.now() - start };
  }

  logLine('\u274C Claim validation mismatches detected:');
  for (const mismatch of result.mismatches) {
    const specPath = path
      .relative(effectiveCwd, mismatch.specReference.filePath)
      .replaceAll(path.sep, '/');
    logLine(`  - Claim (${mismatch.claimId}): ${mismatch.claimText}`);
    logLine(
      `    Spec: ${specPath}:${mismatch.specReference.line} [${mismatch.specReference.id} ${mismatch.specReference.section}]`,
    );
    for (const evidence of mismatch.evidence) {
      logLine(`    Evidence: ${evidence.filePath}:${evidence.line} ${evidence.lineText}`);
    }
    logLine(`    Hint: ${mismatch.remediationHint}`);
  }

  return { ok: false, duration: Date.now() - start };
}

// ── Backlog sync gate ──────────────────────────────────────────────────

export async function runBacklogSyncGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> Backlog sync\n');

  const result = await validateBacklogSync({ cwd });

  if (result.errors.length > 0) {
    logLine('\u274C Backlog sync errors:');
    result.errors.forEach((error) => logLine(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    logLine('\u26A0\uFE0F  Backlog sync warnings:');
    result.warnings.forEach((warning) => logLine(`  - ${warning}`));
  }

  logLine(`Backlog sync summary: WU files=${result.wuCount}, Backlog refs=${result.backlogCount}`);

  return { ok: result.valid, duration: Date.now() - start };
}

// ── Supabase docs gate ─────────────────────────────────────────────────

export async function runSupabaseDocsGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> Supabase docs linter\n');

  const result = await runSupabaseDocsLinter({ cwd, logger: { log: logLine } });

  if (result.skipped) {
    logLine(`\u26A0\uFE0F  ${result.message ?? 'Supabase docs linter skipped.'}`);
  } else if (!result.ok) {
    logLine('\u274C Supabase docs linter failed.');
    (result.errors ?? []).forEach((error) => logLine(`  - ${error}`));
  } else {
    logLine(result.message ?? 'Supabase docs linter passed.');
  }

  return { ok: result.ok, duration: Date.now() - start };
}

// ── Lane health gate ───────────────────────────────────────────────────

/**
 * WU-1191: Run lane health check gate
 */
export async function runLaneHealthGate({
  agentLog,
  useAgentMode,
  mode,
  cwd,
}: GateLogContext & { mode: LaneHealthMode }) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });

  if (mode === 'off') {
    logLine('\n> Lane health check (skipped - mode: off)\n');
    return { ok: true, duration: Date.now() - start };
  }

  logLine(`\n> Lane health check (mode: ${mode})\n`);

  const report = runLaneHealthCheck({ projectRoot: cwd });

  if (!report.healthy) {
    logLine('\u26A0\uFE0F  Lane health issues detected:');
    if (report.overlaps.hasOverlaps) {
      logLine(`  - ${report.overlaps.overlaps.length} overlapping code_paths`);
    }
    if (report.gaps.hasGaps) {
      logLine(`  - ${report.gaps.uncoveredFiles.length} uncovered files`);
    }
    logLine(`  Run 'pnpm lane:health' for full report.`);

    if (mode === 'error') {
      return { ok: false, duration: Date.now() - start };
    }
    // mode === 'warn': report but don't fail
    logLine('  (mode: warn - not blocking)');
  } else {
    logLine('Lane health check passed.');
  }

  return { ok: true, duration: Date.now() - start };
}

// ── Docs-only filtered tests ───────────────────────────────────────────

/**
 * WU-1299: Run filtered tests for docs-only mode
 * WU-1356: Updated to use configured test command
 */
export async function runDocsOnlyFilteredTests({
  packages,
  agentLog,
  cwd = process.cwd(),
}: {
  packages: string[];
  agentLog?: { logFd: number; logPath: string } | null;
  cwd?: string;
}): Promise<{ ok: boolean; duration: number }> {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode: !!agentLog, cwd });

  if (packages.length === 0) {
    logLine('\uD83D\uDCDD docs-only mode: no packages to test, skipping');
    return { ok: true, duration: Date.now() - start };
  }

  logLine(`\n> Tests (docs-only filtered: ${packages.join(', ')})\n`);

  // WU-1356: Use configured test command with filter
  const gatesCommands = resolveGatesCommands(cwd);

  // If there's a configured test_docs_only command, use it
  if (gatesCommands.test_docs_only) {
    const result = run(gatesCommands.test_docs_only, { agentLog, cwd });
    return { ok: result.ok, duration: Date.now() - start };
  }

  // Otherwise, use the full test command with filter args
  const filterArgs = packages.map((pkg) => `--filter=${pkg}`);
  const baseCmd = gatesCommands.test_full;

  const filteredCmd = `${baseCmd} ${filterArgs.join(' ')}`;
  const result = run(filteredCmd, { agentLog });

  return { ok: result.ok, duration: Date.now() - start };
}
