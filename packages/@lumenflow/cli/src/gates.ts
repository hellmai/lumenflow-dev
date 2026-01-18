#!/usr/bin/env node
/**
 * Quality Gates Runner
 *
 * Runs quality gates with support for docs-only mode and incremental linting.
 *
 * WU-1304: Optimise ESLint gates performance
 * - Uses incremental linting (only files changed since branching from main)
 * - Full lint coverage maintained via CI workflow
 *
 * WU-1433: Coverage gate with mode flag
 * - Checks coverage thresholds for hex core files (≥90% for application layer)
 * - Mode: block (default) fails the gate, warn logs warnings only
 * WU-2334: Changed default from warn to block for TDD enforcement
 *
 * WU-1610: Supabase docs linter
 * - Verifies every table in migrations is documented in schema.md
 * - Fails if any table is missing documentation
 *
 * For type:documentation WUs:
 * - ✅ Run: format:check, spec:linter, prompts:lint, backlog-sync
 * - ❌ Skip: lint, typecheck, supabase-docs:linter, tests, coverage (no code changed)
 *
 * WU-1920: Incremental test execution
 * - Uses Vitest's --changed flag to run only tests for changed files
 * - Full test suite maintained via CI workflow and --full-tests flag
 *
 * WU-2062: Tiered test execution for faster wu:done
 * - Safety-critical tests (PHI, escalation, red-flag) ALWAYS run
 * - Docs-only WUs: lint/typecheck only (auto-detected or --docs-only flag)
 * - High-risk WUs (auth, PHI, RLS, migrations): run integration tests
 * - Standard WUs: changed tests + safety-critical tests
 *
 * Usage:
 *   node tools/gates.mjs                        # Tiered gates (default)
 *   node tools/gates.mjs --docs-only            # Docs-only gates
 *   node tools/gates.mjs --full-lint            # Full lint (bypass incremental)
 *   node tools/gates.mjs --full-tests           # Full tests (bypass incremental)
 *   node tools/gates.mjs --coverage-mode=block  # Coverage gate in block mode
 */

import { execSync, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { emitGateEvent, getCurrentWU, getCurrentLane } from '@lumenflow/core/dist/telemetry.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import {
  getChangedLintableFiles,
  convertToPackageRelativePaths,
} from '@lumenflow/core/dist/incremental-lint.js';
import { buildVitestChangedArgs, isCodeFilePath } from '@lumenflow/core/dist/incremental-test.js';
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { runCoverageGate, COVERAGE_GATE_MODES } from '@lumenflow/core/dist/coverage-gate.js';
import {
  buildGatesLogPath,
  shouldUseGatesAgentMode,
  updateGatesLatestSymlink,
} from '@lumenflow/core/dist/gates-agent-mode.js';
// WU-2062: Import risk detector for tiered test execution
// eslint-disable-next-line no-unused-vars -- Pre-existing: SAFETY_CRITICAL_TEST_PATTERNS imported for future use
import {
  detectRiskTier,
  RISK_TIERS,
  SAFETY_CRITICAL_TEST_PATTERNS,
} from '@lumenflow/core/dist/risk-detector.js';
// WU-2252: Import invariants runner for first-check validation
import { runInvariants } from '@lumenflow/core/dist/invariants-runner.js';
import { Command } from 'commander';
import {
  BRANCHES,
  PACKAGES,
  PKG_MANAGER,
  PKG_FLAGS,
  ESLINT_FLAGS,
  ESLINT_COMMANDS,
  ESLINT_DEFAULTS,
  SCRIPTS,
  CACHE_STRATEGIES,
  DIRECTORIES,
  GATE_NAMES,
  GATE_COMMANDS,
  TOOL_PATHS,
  CLI_MODES,
  STDIO_MODES,
  EXIT_CODES,
  FILE_SYSTEM,
} from '@lumenflow/core/dist/wu-constants.js';

// WU-2457: Add Commander.js for --help support
// WU-2465: Pre-filter argv to handle pnpm's `--` separator
// When invoked via `pnpm gates -- --docs-only`, pnpm passes ["--", "--docs-only"]
// Commander treats `--` as "everything after is positional", causing errors.
// Solution: Remove standalone `--` from argv before parsing.
const filteredArgv = process.argv.filter((arg, index, arr) => {
  // Keep `--` only if it's followed by a non-option (actual positional arg)
  // Remove it if it's followed by an option (starts with -)
  if (arg === '--') {
    const nextArg = arr[index + 1];
    return nextArg && !nextArg.startsWith('-');
  }
  return true;
});

const program = new Command()
  .name('gates')
  .description(
    'Run quality gates with support for docs-only mode, incremental linting, and tiered testing',
  )
  .option('--docs-only', 'Run docs-only gates (format, spec-linter, prompts-lint, backlog-sync)')
  .option('--full-lint', 'Run full lint instead of incremental')
  .option('--full-tests', 'Run full test suite instead of incremental')
  .option('--full-coverage', 'Force full test suite and coverage gate (implies --full-tests)')
  .option(
    '--coverage-mode <mode>',
    'Coverage gate mode: "warn" logs warnings, "block" fails gate (default)',
    'block',
  )
  .option('--verbose', 'Stream output in agent mode instead of logging to file')
  .helpOption('-h, --help', 'Display help for command');

program.parse(filteredArgv);

const opts = program.opts();

// Parse command line arguments (now via Commander)
const isDocsOnly = opts.docsOnly || false;
const isFullLint = opts.fullLint || false;
const isFullTests = opts.fullTests || false;
// WU-2244: Full coverage flag forces full test suite and coverage gate (deterministic)
const isFullCoverage = opts.fullCoverage || false;
// WU-1433: Coverage gate mode (warn or block)
// WU-2334: Default changed from WARN to BLOCK for TDD enforcement
const coverageMode = opts.coverageMode || COVERAGE_GATE_MODES.BLOCK;

/**
 * Build a pnpm command string
 */
function pnpmCmd(...parts: string[]) {
  return `${PKG_MANAGER} ${parts.join(' ')}`;
}

/**
 * Build a pnpm run command string
 */
function pnpmRun(script: string, ...args: string[]) {
  const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';
  return `${PKG_MANAGER} ${SCRIPTS.RUN} ${script}${argsStr}`;
}

/**
 * Build a pnpm --filter command string
 */
function pnpmFilter(pkg: string, script: string) {
  return `${PKG_MANAGER} ${PKG_FLAGS.FILTER} ${pkg} ${script}`;
}

function readLogTail(logPath: string, { maxLines = 40, maxBytes = 64 * 1024 } = {}) {
  try {
    const stats = statSync(logPath);
    const startPos = Math.max(0, stats.size - maxBytes);
    const bytesToRead = stats.size - startPos;
    const fd = openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      readSync(fd, buffer, 0, bytesToRead, startPos);
      const text = buffer.toString(FILE_SYSTEM.ENCODING as BufferEncoding);
      const lines = text.split(/\r?\n/).filter(Boolean);
      return lines.slice(-maxLines).join('\n');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

function createAgentLogContext({ wuId, lane }: { wuId: string | null; lane: string | null }) {
  const cwd = process.cwd();
  const logPath = buildGatesLogPath({ cwd, env: process.env, wuId, lane });
  mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');

  const header = `# gates log\n# lane: ${lane || 'unknown'}\n# wu: ${wuId || 'unknown'}\n# started: ${new Date().toISOString()}\n\n`;
  writeSync(logFd, header);

  // Ensure we close the FD even if gates exit via die().
  process.on('exit', () => {
    try {
      closeSync(logFd);
    } catch {
      // ignore
    }
  });

  return { logPath, logFd };
}

function run(
  cmd: string,
  { agentLog }: { agentLog?: { logFd: number; logPath: string } | null } = {},
) {
  const start = Date.now();

  if (!agentLog) {
    console.log(`\n> ${cmd}\n`);
    try {
      execSync(cmd, { stdio: 'inherit', encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
      return { ok: true, duration: Date.now() - start };
    } catch {
      return { ok: false, duration: Date.now() - start };
    }
  }

  writeSync(agentLog.logFd, `\n> ${cmd}\n\n`);
  const result = spawnSync(cmd, [], {
    shell: true,
    stdio: ['ignore', agentLog.logFd, agentLog.logFd],
    cwd: process.cwd(),
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });

  return { ok: result.status === EXIT_CODES.SUCCESS, duration: Date.now() - start };
}

/**
 * Run incremental ESLint on changed files only
 * Falls back to full lint if on main branch or if incremental fails
 * @returns {{ ok: boolean, duration: number, fileCount: number }}
 */
async function runIncrementalLint({
  agentLog,
}: { agentLog?: { logFd: number; logPath: string } | null } = {}) {
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
    const git = getGitForCwd();
    const currentBranch = await git.getCurrentBranch();

    if (currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER) {
      logLine('📋 On main branch - running full lint');
      const result = run(pnpmFilter(PACKAGES.WEB, SCRIPTS.LINT), { agentLog });
      return { ...result, fileCount: -1 };
    }

    // Get changed files in apps/web
    const changedFiles = await getChangedLintableFiles({
      git,
      filterPath: DIRECTORIES.APPS_WEB,
    });

    if (changedFiles.length === 0) {
      logLine('\n> ESLint (incremental)\n');
      logLine('✅ No lintable files changed - skipping lint');
      return { ok: true, duration: Date.now() - start, fileCount: 0 };
    }

    // Filter to files that still exist (in case of deletions)
    const existingFiles = (
      await Promise.all(
        changedFiles.map(async (f) => {
          try {
            await access(f);
            return f;
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);

    if (existingFiles.length === 0) {
      logLine('\n> ESLint (incremental)\n');
      logLine('✅ All changed files were deleted - skipping lint');
      return { ok: true, duration: Date.now() - start, fileCount: 0 };
    }

    // WU-2571: Convert repo-relative paths to package-relative paths
    // ESLint runs from apps/web/ where repo-relative paths don't exist
    const packageRelativeFiles = convertToPackageRelativePaths(existingFiles, DIRECTORIES.APPS_WEB);

    logLine(`\n> ESLint (incremental: ${packageRelativeFiles.length} files)\n`);
    logLine(`Files to lint:\n  ${packageRelativeFiles.join('\n  ')}\n`);

    // WU-2571: Run ESLint from apps/web directory with package-relative paths
    const webDir = path.join(process.cwd(), DIRECTORIES.APPS_WEB);
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
        ...packageRelativeFiles,
      ],
      agentLog
        ? {
            stdio: ['ignore', agentLog.logFd, agentLog.logFd] as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd: webDir,
          }
        : {
            stdio: 'inherit' as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd: webDir,
          },
    );

    const duration = Date.now() - start;
    return {
      ok: result.status === EXIT_CODES.SUCCESS,
      duration,
      fileCount: packageRelativeFiles.length,
    };
  } catch (error) {
    console.error('⚠️  Incremental lint failed, falling back to full lint:', error.message);
    const result = run(pnpmFilter(PACKAGES.WEB, SCRIPTS.LINT), { agentLog });
    return { ...result, fileCount: -1 };
  }
}

/**
 * Run changed tests using Vitest's --changed flag from the repo root.
 * Falls back to full test suite if on main branch or if the run fails.
 *
 * @returns {{ ok: boolean, duration: number, isIncremental: boolean }}
 */
async function runChangedTests({
  agentLog,
}: { agentLog?: { logFd: number; logPath: string } | null } = {}) {
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
    const git = getGitForCwd();
    const currentBranch = await git.getCurrentBranch();

    if (currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER) {
      logLine('📋 On main branch - running full test suite');
      const result = run(pnpmCmd('turbo', 'run', 'test'), { agentLog });
      return { ...result, isIncremental: false };
    }

    const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard']);
    const untrackedFiles = untrackedOutput
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    const untrackedCodeFiles = untrackedFiles.filter(isCodeFilePath);

    if (untrackedCodeFiles.length > 0) {
      const preview = untrackedCodeFiles.slice(0, 5).join(', ');
      logLine(
        `⚠️  Untracked code files detected (${untrackedCodeFiles.length}): ${preview}${untrackedCodeFiles.length > 5 ? '...' : ''}`,
      );
      logLine('📋 Running full test suite to avoid missing coverage');
      const result = run(pnpmCmd('turbo', 'run', 'test'), { agentLog });
      return { ...result, duration: Date.now() - start, isIncremental: false };
    }

    logLine('\n> Vitest (changed: tools project)\n');
    const toolsArgs = ['--project', 'tools', ...buildVitestChangedArgs()];
    const toolsResult = run(pnpmCmd('vitest', ...toolsArgs), { agentLog });
    if (!toolsResult.ok) {
      return { ...toolsResult, duration: Date.now() - start, isIncremental: true };
    }

    logLine('\n> Vitest (changed: turbo --affected)\n');
    const result = run(pnpmCmd('turbo', 'run', 'test:changed', '--affected'), { agentLog });

    return { ...result, duration: Date.now() - start, isIncremental: true };
  } catch (error) {
    console.error('⚠️  Changed tests failed, falling back to full suite:', error.message);
    const result = run(pnpmCmd('turbo', 'run', 'test'), { agentLog });
    return { ...result, isIncremental: false };
  }
}

/**
 * Safety-critical test file patterns (relative to apps/web).
 * These patterns are passed as positional arguments to vitest run.
 * Must match the vitest include patterns in the workspace config.
 * @type {string[]}
 */
const SAFETY_CRITICAL_TEST_FILES = [
  // PHI protection tests
  'src/components/ui/__tests__/PHIGuard.test.tsx',
  'src/components/ui/__tests__/WidgetPHIConsentDialog.test.tsx',
  'src/components/ui/__tests__/Composer.phi.test.tsx',
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
 * Includes: PHI, escalation, privacy, red-flag, constitutional enforcer tests
 *
 * Runs from apps/web directory with explicit file paths to ensure
 * compatibility with vitest workspace include patterns.
 *
 * @param {object} options - Options
 * @param {object} [options.agentLog] - Agent log context
 * @returns {Promise<{ ok: boolean, duration: number, testCount: number }>}
 */
async function runSafetyCriticalTests({
  agentLog,
}: { agentLog?: { logFd: number; logPath: string } | null } = {}) {
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
    logLine('\n> Safety-critical tests (always run)\n');
    logLine(`Test files: ${SAFETY_CRITICAL_TEST_FILES.length} files\n`);

    // Run vitest with --project web to target the web workspace
    // Using explicit file paths for compatibility with workspace include patterns
    const result = spawnSync(
      PKG_MANAGER,
      [
        'vitest',
        'run',
        '--project',
        PACKAGES.WEB,
        '--reporter=verbose',
        ...SAFETY_CRITICAL_TEST_FILES,
        '--passWithNoTests', // Don't fail if some files don't exist
      ],
      agentLog
        ? {
            stdio: ['ignore', agentLog.logFd, agentLog.logFd] as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd: process.cwd(),
          }
        : {
            stdio: 'inherit' as const,
            encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
            cwd: process.cwd(),
          },
    );

    const duration = Date.now() - start;
    return {
      ok: result.status === EXIT_CODES.SUCCESS,
      duration,
      testCount: SAFETY_CRITICAL_TEST_FILES.length,
    };
  } catch (error) {
    console.error('⚠️  Safety-critical tests failed:', error.message);
    return { ok: false, duration: Date.now() - start, testCount: 0 };
  }
}

/**
 * WU-2062: Run integration tests for high-risk changes
 * Only runs when auth, PHI, RLS, or migration files are modified.
 *
 * @param {object} options - Options
 * @param {object} [options.agentLog] - Agent log context
 * @returns {Promise<{ ok: boolean, duration: number }>}
 */
async function runIntegrationTests({
  agentLog,
}: { agentLog?: { logFd: number; logPath: string } | null } = {}) {
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

    const result = run(
      `RUN_INTEGRATION_TESTS=1 ${pnpmCmd(
        'vitest',
        'run',
        "--include='**/*.integration.*'",
        "--include='**/golden-*.test.*'",
      )}`,
      { agentLog },
    );

    const duration = Date.now() - start;
    return {
      ok: result.ok,
      duration,
    };
  } catch (error) {
    console.error('⚠️  Integration tests failed:', error.message);
    return { ok: false, duration: Date.now() - start };
  }
}

/**
 * WU-2062: Get all changed files for risk detection
 * Combines committed, unstaged, and untracked files.
 *
 * @param {object} options - Options
 * @param {object} [options.git] - Git adapter instance
 * @returns {Promise<string[]>} List of all changed files
 */
interface GetAllChangedFilesOptions {
  git?: ReturnType<typeof getGitForCwd>;
}

async function getAllChangedFiles(options: GetAllChangedFilesOptions = {}) {
  const { git = getGitForCwd() } = options;

  try {
    // Get merge base
    const mergeBase = await git.mergeBase('HEAD', 'origin/main');

    // Get committed changes
    const committedOutput = await git.raw(['diff', '--name-only', `${mergeBase}...HEAD`]);
    const committedFiles = committedOutput
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    // Get unstaged changes
    const unstagedOutput = await git.raw(['diff', '--name-only']);
    const unstagedFiles = unstagedOutput
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    // Get untracked files
    const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard']);
    const untrackedFiles = untrackedOutput
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    // Combine and deduplicate
    return [...new Set([...committedFiles, ...unstagedFiles, ...untrackedFiles])];
  } catch (error) {
    console.error('⚠️  Failed to get changed files:', error.message);
    return [];
  }
}

// Get context for telemetry
const wu_id = getCurrentWU();
const lane = getCurrentLane();
const useAgentMode = shouldUseGatesAgentMode({ argv: process.argv.slice(2), env: process.env });
const agentLog = useAgentMode ? createAgentLogContext({ wuId: wu_id, lane }) : null;

// Main execution
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing: main() orchestrates multi-step gate workflow
async function main() {
  if (useAgentMode) {
    console.log(
      `🧾 gates (agent mode): output -> ${agentLog.logPath} (use --verbose for streaming)\n`,
    );
  }

  // WU-2062: Detect risk tier from changed files (unless explicit --docs-only flag)
  let riskTier = null;
  let changedFiles = [];

  if (!isDocsOnly) {
    try {
      changedFiles = await getAllChangedFiles();
      riskTier = detectRiskTier({ changedFiles });

      const logLine = useAgentMode
        ? (line) => writeSync(agentLog.logFd, `${line}\n`)
        : (line) => console.log(line);

      logLine(`\n🎯 Risk tier detected: ${riskTier.tier}`);
      if (riskTier.highRiskPaths.length > 0) {
        logLine(
          `   High-risk paths: ${riskTier.highRiskPaths.slice(0, 3).join(', ')}${riskTier.highRiskPaths.length > 3 ? '...' : ''}`,
        );
      }
      logLine('');
    } catch (error) {
      console.error('⚠️  Risk detection failed, defaulting to standard tier:', error.message);
      riskTier = {
        tier: RISK_TIERS.STANDARD,
        isDocsOnly: false,
        shouldRunIntegration: false,
        highRiskPaths: [],
      };
    }
  }

  // Determine effective docs-only mode (explicit flag OR detected from changed files)
  const effectiveDocsOnly = isDocsOnly || (riskTier && riskTier.isDocsOnly);

  // Determine which gates to run
  // WU-2252: Invariants gate runs FIRST and is included in both docs-only and regular modes
  const gates = effectiveDocsOnly
    ? [
        // WU-2252: Invariants check runs first (non-bypassable)
        { name: GATE_NAMES.INVARIANTS, cmd: GATE_COMMANDS.INVARIANTS },
        { name: GATE_NAMES.FORMAT_CHECK, cmd: pnpmCmd(SCRIPTS.FORMAT_CHECK) },
        { name: GATE_NAMES.SPEC_LINTER, cmd: pnpmRun(SCRIPTS.SPEC_LINTER) },
        {
          name: GATE_NAMES.PROMPTS_LINT,
          cmd: pnpmRun(SCRIPTS.PROMPTS_LINT, CLI_MODES.LOCAL, '--quiet'),
        },
        { name: GATE_NAMES.BACKLOG_SYNC, cmd: TOOL_PATHS.VALIDATE_BACKLOG_SYNC },
        // WU-2315: System map validation (warn-only until orphan docs are indexed)
        {
          name: GATE_NAMES.SYSTEM_MAP_VALIDATE,
          cmd: TOOL_PATHS.SYSTEM_MAP_VALIDATE,
          warnOnly: true,
        },
      ]
    : [
        // WU-2252: Invariants check runs first (non-bypassable)
        { name: GATE_NAMES.INVARIANTS, cmd: GATE_COMMANDS.INVARIANTS },
        { name: GATE_NAMES.FORMAT_CHECK, cmd: pnpmCmd(SCRIPTS.FORMAT_CHECK) },
        {
          name: GATE_NAMES.LINT,
          cmd: isFullLint ? pnpmFilter(PACKAGES.WEB, SCRIPTS.LINT) : GATE_COMMANDS.INCREMENTAL,
        },
        { name: GATE_NAMES.TYPECHECK, cmd: pnpmCmd(SCRIPTS.TYPECHECK) },
        { name: GATE_NAMES.SPEC_LINTER, cmd: pnpmRun(SCRIPTS.SPEC_LINTER) },
        {
          name: GATE_NAMES.PROMPTS_LINT,
          cmd: pnpmRun(SCRIPTS.PROMPTS_LINT, CLI_MODES.LOCAL, '--quiet'),
        },
        { name: GATE_NAMES.BACKLOG_SYNC, cmd: TOOL_PATHS.VALIDATE_BACKLOG_SYNC },
        { name: GATE_NAMES.SUPABASE_DOCS_LINTER, cmd: TOOL_PATHS.SUPABASE_DOCS_LINTER },
        // WU-2315: System map validation (warn-only until orphan docs are indexed)
        {
          name: GATE_NAMES.SYSTEM_MAP_VALIDATE,
          cmd: TOOL_PATHS.SYSTEM_MAP_VALIDATE,
          warnOnly: true,
        },
        // WU-2062: Safety-critical tests ALWAYS run
        { name: GATE_NAMES.SAFETY_CRITICAL_TEST, cmd: GATE_COMMANDS.SAFETY_CRITICAL_TEST },
        // WU-1920: Use changed tests by default, full suite with --full-tests
        // WU-2244: --full-coverage implies --full-tests for accurate coverage
        {
          name: GATE_NAMES.TEST,
          cmd:
            isFullTests || isFullCoverage
              ? pnpmCmd('turbo', 'run', 'test')
              : GATE_COMMANDS.INCREMENTAL_TEST,
        },
        // WU-2062: Integration tests only for high-risk changes
        ...(riskTier && riskTier.shouldRunIntegration
          ? [{ name: GATE_NAMES.INTEGRATION_TEST, cmd: GATE_COMMANDS.TIERED_TEST }]
          : []),
        // WU-1433: Coverage gate with configurable mode (warn/block)
        { name: GATE_NAMES.COVERAGE, cmd: GATE_COMMANDS.COVERAGE_GATE },
      ];

  if (effectiveDocsOnly) {
    if (!useAgentMode) {
      console.log('📝 Docs-only mode: skipping lint, typecheck, and tests\n');
    } else {
      writeSync(agentLog.logFd, '📝 Docs-only mode: skipping lint, typecheck, and tests\n');
    }
  }

  // Run all gates sequentially
  // WU-1920: Track last test result to skip coverage gate on changed tests
  let lastTestResult = null;

  for (const gate of gates) {
    let result;

    if (gate.cmd === GATE_COMMANDS.INVARIANTS) {
      // WU-2252: Invariants check runs first (non-bypassable)
      const logLine = useAgentMode
        ? (line) => writeSync(agentLog.logFd, `${line}\n`)
        : (line) => console.log(line);

      logLine('\n> Invariants check\n');

      const invariantsResult = runInvariants({ baseDir: process.cwd(), silent: false });
      result = {
        ok: invariantsResult.success,
        duration: 0, // runInvariants doesn't track duration
      };

      if (!result.ok) {
        logLine('');
        logLine(invariantsResult.formatted);
      }
    } else if (gate.cmd === GATE_COMMANDS.INCREMENTAL) {
      // Special handling for incremental lint
      result = await runIncrementalLint({ agentLog });
    } else if (gate.cmd === GATE_COMMANDS.SAFETY_CRITICAL_TEST) {
      // WU-2062: Safety-critical tests always run
      result = await runSafetyCriticalTests({ agentLog });
    } else if (gate.cmd === GATE_COMMANDS.INCREMENTAL_TEST) {
      // WU-1920: Special handling for changed tests
      result = await runChangedTests({ agentLog });
      lastTestResult = result;
    } else if (gate.cmd === GATE_COMMANDS.TIERED_TEST) {
      // WU-2062: Integration tests for high-risk changes
      result = await runIntegrationTests({ agentLog });
    } else if (gate.cmd === GATE_COMMANDS.COVERAGE_GATE) {
      // WU-1920: Skip coverage gate when tests were changed (partial coverage)
      // WU-2244: --full-coverage overrides incremental skip behavior
      if (!isFullCoverage && lastTestResult?.isIncremental) {
        const msg = '⏭️  Skipping coverage gate (changed tests - coverage is partial)';
        if (!useAgentMode) {
          console.log(`\n${msg}\n`);
        } else {
          writeSync(agentLog.logFd, `\n${msg}\n\n`);
        }
        continue;
      }

      // WU-1433: Special handling for coverage gate
      if (!useAgentMode) {
        console.log(`\n> Coverage gate (mode: ${coverageMode})\n`);
      } else {
        writeSync(agentLog.logFd, `\n> Coverage gate (mode: ${coverageMode})\n\n`);
      }
      result = await runCoverageGate({
        mode: coverageMode,
        logger: useAgentMode
          ? {
              log: (msg) => {
                writeSync(agentLog.logFd, `${msg}\n`);
              },
            }
          : console,
      });
    } else {
      result = run(gate.cmd, { agentLog });
    }

    // Emit telemetry event
    emitGateEvent({
      wu_id,
      lane,
      gate_name: gate.name,
      passed: result.ok,
      duration_ms: result.duration,
    });

    if (!result.ok) {
      // WU-2315: Warn-only gates log warning but don't block
      if (gate.warnOnly) {
        const warnMsg = `⚠️  ${gate.name} failed (warn-only, not blocking)`;
        if (!useAgentMode) {
          console.log(`\n${warnMsg}\n`);
        } else {
          writeSync(agentLog.logFd, `\n${warnMsg}\n\n`);
        }
        continue;
      }

      if (useAgentMode) {
        const tail = readLogTail(agentLog.logPath);
        console.error(`\n❌ ${gate.name} failed (agent mode). Log: ${agentLog.logPath}\n`);
        if (tail) {
          console.error(`Last log lines:\n${tail}\n`);
        }
      }
      die(`${gate.name} failed`);
    }
  }

  // WU-2064: Create/update gates-latest.log symlink for easy agent access
  if (agentLog) {
    updateGatesLatestSymlink({ logPath: agentLog.logPath, cwd: process.cwd(), env: process.env });
  }

  if (!useAgentMode) {
    console.log('\n✅ All gates passed!\n');
  } else {
    console.log(`✅ All gates passed (agent mode). Log: ${agentLog.logPath}\n`);
  }
  process.exit(EXIT_CODES.SUCCESS);
}

main().catch((error) => {
  console.error('Gates failed:', error);
  process.exit(EXIT_CODES.ERROR);
});
