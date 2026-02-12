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
 * - ✅ Run: format:check, spec:linter, backlog-sync
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
 *   node tools/gates.ts                        # Tiered gates (default)
 *   node tools/gates.ts --docs-only            # Docs-only gates
 *   node tools/gates.ts --full-lint            # Full lint (bypass incremental)
 *   node tools/gates.ts --full-tests           # Full tests (bypass incremental)
 *   node tools/gates.ts --coverage-mode=block  # Coverage gate in block mode
 */

import { execSync, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { emitGateEvent, getCurrentWU, getCurrentLane } from '@lumenflow/core/telemetry';
import { die } from '@lumenflow/core/error-handler';
// WU-1299: Import WU YAML reader to get code_paths for docs-only filtering
import { readWURaw } from '@lumenflow/core/wu-yaml';
import { createWuPaths } from '@lumenflow/core/wu-paths';
import { getChangedLintableFiles, isLintableFile } from '@lumenflow/core/incremental-lint';
import { buildVitestChangedArgs, isCodeFilePath } from '@lumenflow/core/incremental-test';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import { runCoverageGate, COVERAGE_GATE_MODES } from '@lumenflow/core/coverage-gate';
import {
  buildGatesLogPath,
  shouldUseGatesAgentMode,
  updateGatesLatestSymlink,
} from '@lumenflow/core/gates-agent-mode';
// WU-2062: Import risk detector for tiered test execution
import { detectRiskTier, RISK_TIERS } from '@lumenflow/core/risk-detector';
// WU-2252: Import invariants runner for first-check validation
import { runInvariants } from '@lumenflow/core/invariants-runner';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { validateBacklogSync } from '@lumenflow/core/validators/backlog-sync';
import { runSupabaseDocsLinter } from '@lumenflow/core/validators/supabase-docs-linter';
import { runSystemMapValidation } from '@lumenflow/core/system-map-validator';
// WU-1067: Config-driven gates support (partial implementation - unused imports removed)
// WU-1191: Lane health gate configuration
// WU-1262: Coverage config from methodology policy
// WU-1280: Test policy for tests_required (warn vs block on test failures)
// WU-1356: Configurable package manager and test commands
import {
  loadLaneHealthConfig,
  resolveTestPolicy,
  resolveGatesCommands,
  resolveTestRunner,
  type LaneHealthMode,
} from '@lumenflow/core/gates-config';
// WU-1191: Lane health check
import { runLaneHealthCheck } from './lane-health.js';
// WU-1315: Onboarding smoke test
import { runOnboardingSmokeTestGate } from './onboarding-smoke-test.js';
import {
  BRANCHES,
  PACKAGES,
  PKG_MANAGER,
  ESLINT_FLAGS,
  ESLINT_COMMANDS,
  ESLINT_DEFAULTS,
  SCRIPTS,
  CACHE_STRATEGIES,
  DIRECTORIES,
  GATE_NAMES,
  GATE_COMMANDS,
  EXIT_CODES,
  FILE_SYSTEM,
  PRETTIER_ARGS,
  PRETTIER_FLAGS,
} from '@lumenflow/core/wu-constants';
// WU-1520: Gates graceful degradation for missing optional scripts
import {
  buildMissingScriptWarning,
  loadPackageJsonScripts,
  resolveGateAction,
  formatGateSummary,
  type GateResult,
} from './gates-graceful-degradation.js';
import { runCLI } from './cli-entry-point.js';
// WU-1550: Gate registry for declarative gate registration
import { GateRegistry, type GateDefinition } from './gate-registry.js';
import { registerDocsOnlyGates, registerCodeGates } from './gate-defaults.js';

/**
 * WU-1087: Gates-specific option definitions for createWUParser.
 * Exported for testing and consistency with other CLI commands.
 */
export const GATES_OPTIONS = {
  docsOnly: {
    name: 'docsOnly',
    flags: '--docs-only',
    description: 'Run docs-only gates (format, spec-linter, backlog-sync)',
  },
  fullLint: {
    name: 'fullLint',
    flags: '--full-lint',
    description: 'Run full lint instead of incremental',
  },
  fullTests: {
    name: 'fullTests',
    flags: '--full-tests',
    description: 'Run full test suite instead of incremental',
  },
  fullCoverage: {
    name: 'fullCoverage',
    flags: '--full-coverage',
    description: 'Force full test suite and coverage gate (implies --full-tests)',
  },
  coverageMode: {
    name: 'coverageMode',
    flags: '--coverage-mode <mode>',
    description: 'Coverage gate mode: "warn" logs warnings, "block" fails gate',
    default: 'block',
  },
  verbose: {
    name: 'verbose',
    flags: '--verbose',
    description: 'Stream output in agent mode instead of logging to file',
  },
  // WU-1520: --strict flag makes missing scripts a hard failure for CI
  strict: {
    name: 'strict',
    flags: '--strict',
    description: 'Fail on missing gate scripts instead of skipping (for CI enforcement)',
  },
};

/**
 * WU-1087: Parse gates options using createWUParser for consistency.
 * Handles pnpm's `--` separator and provides automatic --help support.
 *
 * @returns Parsed options object
 */
export function parseGatesOptions(): {
  docsOnly?: boolean;
  fullLint?: boolean;
  fullTests?: boolean;
  fullCoverage?: boolean;
  coverageMode: string;
  verbose?: boolean;
  strict?: boolean;
} {
  // WU-2465: Pre-filter argv to handle pnpm's `--` separator
  // When invoked via `pnpm gates -- --docs-only`, pnpm passes ["--", "--docs-only"]
  // createWUParser's default filtering removes all `--`, but we need smarter handling:
  // Remove `--` only if it's followed by an option (starts with -)
  const originalArgv = process.argv;
  const filteredArgv = originalArgv.filter((arg, index, arr) => {
    if (arg === '--') {
      const nextArg = arr[index + 1];
      return nextArg && !nextArg.startsWith('-');
    }
    return true;
  });

  // Temporarily replace process.argv for createWUParser
  process.argv = filteredArgv;

  try {
    const opts = createWUParser({
      name: 'gates',
      description:
        'Run quality gates with support for docs-only mode, incremental linting, and tiered testing',
      options: Object.values(GATES_OPTIONS),
    });

    return {
      docsOnly: opts.docsOnly,
      fullLint: opts.fullLint,
      fullTests: opts.fullTests,
      fullCoverage: opts.fullCoverage,
      coverageMode: opts.coverageMode ?? 'block',
      verbose: opts.verbose,
      strict: opts.strict,
    };
  } finally {
    // Restore original process.argv
    process.argv = originalArgv;
  }
}

/**
 * @deprecated Use parseGatesOptions() instead (WU-1087)
 * Kept for backward compatibility during migration.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Pre-existing: argv kept for backwards compatibility
function parseGatesArgs(argv = process.argv) {
  return parseGatesOptions();
}

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

type FormatCheckPlan = {
  mode: 'full' | 'incremental' | 'skip';
  files: string[];
  reason?: 'file-list-error' | 'prettier-config';
};

type LintPlan = {
  mode: 'full' | 'incremental' | 'skip';
  files: string[];
};

type TestPlan = {
  mode: 'full' | 'incremental';
  reason?: 'untracked-code' | 'test-config' | 'file-list-error';
};

const PRETTIER_CONFIG_FILES = new Set([
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.ts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.ts',
  'prettier.config.mjs',
  '.prettierignore',
]);

// WU-1356: Extended to support multiple build tools and test runners
const TEST_CONFIG_BASENAMES = new Set([
  'turbo.json', // Turborepo
  'nx.json', // Nx
  'lerna.json', // Lerna
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'package.json',
]);
// WU-1356: Extended to support vitest, jest, and mocha config patterns
const TEST_CONFIG_PATTERNS = [
  /^vitest\.config\.(ts|mts|js|mjs|cjs)$/i,
  /^jest\.config\.(ts|js|mjs|cjs|json)$/i,
  /^\.mocharc\.(js|json|yaml|yml)$/i,
  // eslint-disable-next-line security/detect-unsafe-regex -- static tsconfig pattern; no backtracking risk
  /^tsconfig(\..+)?\.json$/i,
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function getBasename(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function quoteShellArgs(files: string[]): string {
  return files.map((file) => `"${file}"`).join(' ');
}

export function isPrettierConfigFile(filePath: string): boolean {
  if (!filePath) return false;
  const basename = getBasename(filePath);
  return PRETTIER_CONFIG_FILES.has(basename);
}

export function isTestConfigFile(filePath: string): boolean {
  if (!filePath) return false;
  const basename = getBasename(filePath);
  if (TEST_CONFIG_BASENAMES.has(basename)) {
    return true;
  }
  return TEST_CONFIG_PATTERNS.some((pattern) => pattern.test(basename));
}

/* eslint-disable sonarjs/no-duplicate-string -- Pre-existing: format check reasons are intentionally distinct string literals */
export function resolveFormatCheckPlan({
  changedFiles,
  fileListError = false,
}: {
  changedFiles: string[];
  fileListError?: boolean;
}): FormatCheckPlan {
  if (fileListError) {
    return { mode: 'full', files: [], reason: 'file-list-error' };
  }
  if (changedFiles.some(isPrettierConfigFile)) {
    return { mode: 'full', files: [], reason: 'prettier-config' };
  }
  if (changedFiles.length === 0) {
    return { mode: 'skip', files: [] };
  }
  return { mode: 'incremental', files: changedFiles };
}

export function resolveLintPlan({
  isMainBranch,
  changedFiles,
}: {
  isMainBranch: boolean;
  changedFiles: string[];
}): LintPlan {
  if (isMainBranch) {
    return { mode: 'full', files: [] };
  }

  const lintTargets = changedFiles.filter((filePath) => {
    const normalized = normalizePath(filePath);
    return (
      (normalized.startsWith('apps/') || normalized.startsWith('packages/')) &&
      isLintableFile(normalized)
    );
  });

  if (lintTargets.length === 0) {
    return { mode: 'skip', files: [] };
  }

  return { mode: 'incremental', files: lintTargets };
}
/* eslint-enable sonarjs/no-duplicate-string */

export function resolveTestPlan({
  isMainBranch,
  hasUntrackedCode,
  hasConfigChange,
  fileListError,
}: {
  isMainBranch: boolean;
  hasUntrackedCode: boolean;
  hasConfigChange: boolean;
  fileListError: boolean;
}): TestPlan {
  if (fileListError) {
    return { mode: 'full', reason: 'file-list-error' };
  }
  if (hasUntrackedCode) {
    return { mode: 'full', reason: 'untracked-code' };
  }
  if (hasConfigChange) {
    return { mode: 'full', reason: 'test-config' };
  }
  if (isMainBranch) {
    return { mode: 'full' };
  }
  return { mode: 'incremental' };
}

/**
 * WU-1299: Docs-only test plan type
 * Indicates how tests should be handled in docs-only mode based on code_paths
 */
export type DocsOnlyTestPlan = {
  mode: 'skip' | 'filtered';
  packages: string[];
  reason?: 'no-code-packages';
};

/**
 * WU-1299: Extract package name from a single code path
 *
 * @param codePath - Single code path to parse
 * @returns Package name or null if not a package/app path
 */
function extractPackageFromPath(codePath: string): string | null {
  if (!codePath || typeof codePath !== 'string') {
    return null;
  }

  const normalized = codePath.replace(/\\/g, '/');

  // Handle packages/@scope/name/... or packages/name/...
  if (normalized.startsWith('packages/')) {
    const parts = normalized.slice('packages/'.length).split('/');
    // Scoped package (@scope/name)
    if (parts[0]?.startsWith('@') && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    // Unscoped package
    if (parts[0]) {
      return parts[0];
    }
  }

  // WU-1415: Skip apps/ paths - they aren't valid turbo packages for test filtering
  // apps/ directories (e.g., apps/docs, apps/github-app) don't have turbo test tasks
  // and using directory names as --filter args causes "No package found" errors

  return null;
}

/**
 * WU-1299: Extract package/app names from code_paths
 *
 * Parses paths like:
 * - packages/@lumenflow/cli/src/file.ts -> @lumenflow/cli
 * - apps/web/src/file.ts -> web
 *
 * @param codePaths - Array of code paths from WU YAML
 * @returns Array of unique package/app names
 */
export function extractPackagesFromCodePaths(codePaths: string[]): string[] {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return [];
  }

  const packages = new Set<string>();

  for (const codePath of codePaths) {
    const pkg = extractPackageFromPath(codePath);
    if (pkg) {
      packages.add(pkg);
    }
  }

  return Array.from(packages);
}

/**
 * WU-1299: Resolve test plan for docs-only mode
 *
 * When --docs-only is passed, this determines whether to:
 * - Skip tests entirely (no code packages in code_paths)
 * - Run tests only for packages mentioned in code_paths
 *
 * @param options - Options including code_paths from WU YAML
 * @returns DocsOnlyTestPlan indicating how to handle tests
 */
export function resolveDocsOnlyTestPlan({ codePaths }: { codePaths: string[] }): DocsOnlyTestPlan {
  const packages = extractPackagesFromCodePaths(codePaths);

  if (packages.length === 0) {
    return {
      mode: 'skip',
      packages: [],
      reason: 'no-code-packages',
    };
  }

  return {
    mode: 'filtered',
    packages,
  };
}

/**
 * WU-1299: Format message for docs-only test skipping/filtering
 *
 * Provides clear messaging when tests are skipped or filtered in docs-only mode.
 *
 * @param plan - The docs-only test plan
 * @returns Human-readable message explaining what's happening
 */
export function formatDocsOnlySkipMessage(plan: DocsOnlyTestPlan): string {
  if (plan.mode === 'skip') {
    return '📝 docs-only mode: skipping all tests (no code packages in code_paths)';
  }

  const packageList = plan.packages.join(', ');
  return `📝 docs-only mode: running tests only for packages in code_paths: ${packageList}`;
}

/**
 * WU-1299: Load code_paths from current WU YAML
 *
 * Attempts to read the WU YAML file for the current WU (detected from git branch)
 * and return its code_paths. Returns empty array if WU cannot be determined or
 * YAML file doesn't exist.
 *
 * @param options - Options including optional cwd
 * @returns Array of code_paths from WU YAML, or empty array if unavailable
 */
export function loadCurrentWUCodePaths(options: { cwd?: string } = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const wuId = getCurrentWU();

  if (!wuId) {
    return [];
  }

  try {
    const wuPaths = createWuPaths({ projectRoot: cwd });
    const wuYamlPath = wuPaths.WU(wuId);
    const wuDoc = readWURaw(wuYamlPath);

    if (wuDoc && Array.isArray(wuDoc.code_paths)) {
      return wuDoc.code_paths.filter((p: unknown): p is string => typeof p === 'string');
    }
  } catch {
    // WU YAML not found or unreadable - return empty array
  }

  return [];
}

/**
 * WU-1299: Run filtered tests for docs-only mode
 * WU-1356: Updated to use configured test command
 *
 * When --docs-only is passed and code_paths contains packages, this runs tests
 * only for those specific packages. The filter syntax adapts to the configured
 * build tool (turbo, nx, or plain package manager).
 *
 * @param options - Options including packages to test and agent log context
 * @returns Result object with ok status and duration
 */
async function runDocsOnlyFilteredTests({
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
    logLine('📝 docs-only mode: no packages to test, skipping');
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
  // Build filter args for each package (works with turbo, nx, and pnpm/yarn workspaces)
  const filterArgs = packages.map((pkg) => `--filter=${pkg}`);
  const baseCmd = gatesCommands.test_full;

  // Append filter args to the base command
  const filteredCmd = `${baseCmd} ${filterArgs.join(' ')}`;
  const result = run(filteredCmd, { agentLog });

  return { ok: result.ok, duration: Date.now() - start };
}

export function parsePrettierListOutput(output: string): string[] {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\[error\]\s*/i, '').trim())
    .filter(
      (line) =>
        !line.toLowerCase().includes('code style issues found') &&
        !line.toLowerCase().includes('all matched files use prettier') &&
        !line.toLowerCase().includes('checking formatting'),
    );
}

export function buildPrettierWriteCommand(files: string[]): string {
  const quotedFiles = files.map((file) => `"${file}"`).join(' ');
  const base = pnpmCmd(SCRIPTS.PRETTIER, PRETTIER_FLAGS.WRITE);
  return quotedFiles ? `${base} ${quotedFiles}` : base;
}

function buildPrettierCheckCommand(files: string[]): string {
  const filesArg = files.length > 0 ? quoteShellArgs(files) : '.';
  return pnpmCmd(SCRIPTS.PRETTIER, PRETTIER_ARGS.CHECK, filesArg);
}

export function formatFormatCheckGuidance(files: string[]): string[] {
  if (!files.length) return [];
  const command = buildPrettierWriteCommand(files);
  return [
    '',
    '❌ format:check failed',
    'Fix with:',
    `  ${command}`,
    '',
    'Affected files:',
    ...files.map((file) => `  - ${file}`),
    '',
  ];
}

function collectPrettierListDifferent(cwd: string, files: string[] = []): string[] {
  const filesArg = files.length > 0 ? quoteShellArgs(files) : '.';
  const cmd = pnpmCmd(SCRIPTS.PRETTIER, PRETTIER_ARGS.LIST_DIFFERENT, filesArg);

  const result = spawnSync(cmd, [], {
    shell: true,
    cwd,
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return parsePrettierListOutput(output);
}

function emitFormatCheckGuidance({
  agentLog,
  useAgentMode,
  files,
  cwd,
}: {
  agentLog?: { logFd: number; logPath: string } | null;
  useAgentMode: boolean;
  files?: string[] | null;
  cwd: string;
}) {
  const formattedFiles = collectPrettierListDifferent(cwd, files ?? []);
  if (!formattedFiles.length) return;

  const lines = formatFormatCheckGuidance(formattedFiles);
  const logLine =
    useAgentMode && agentLog
      ? (line: string) => writeSync(agentLog.logFd, `${line}\n`)
      : (line: string) => console.log(line);

  for (const line of lines) {
    logLine(line);
  }
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

function createAgentLogContext({
  wuId,
  lane,
  cwd,
}: {
  wuId: string | null;
  lane: string | null;
  cwd: string;
}) {
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
  {
    agentLog,
    cwd = process.cwd(),
  }: { agentLog?: { logFd: number; logPath: string } | null; cwd?: string } = {},
) {
  const start = Date.now();

  if (!agentLog) {
    console.log(`\n> ${cmd}\n`);
    try {
      execSync(cmd, {
        stdio: 'inherit',
        encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
        cwd,
      });
      return { ok: true, duration: Date.now() - start };
    } catch {
      return { ok: false, duration: Date.now() - start };
    }
  }

  writeSync(agentLog.logFd, `\n> ${cmd}\n\n`);

  const result = spawnSync(cmd, [], {
    shell: true,
    stdio: ['ignore', agentLog.logFd, agentLog.logFd],
    cwd,
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });

  return { ok: result.status === EXIT_CODES.SUCCESS, duration: Date.now() - start };
}

/**
 * Parse a WU ID from a branch name.
 * Returns canonical upper-case ID (e.g., WU-123) or null when not present.
 */
export function parseWUFromBranchName(branchName: string | null | undefined): string | null {
  if (!branchName) {
    return null;
  }

  const match = branchName.match(/wu-(\d+)/i);
  if (!match) {
    return null;
  }

  return `WU-${match[1]}`.toUpperCase();
}

/**
 * Resolve spec-linter execution strategy.
 * If current WU is known, run scoped validation only.
 * If unknown, fall back to global validation.
 */
export function resolveSpecLinterPlan(wuId: string | null): {
  scopedWuId: string | null;
  runGlobal: boolean;
} {
  if (wuId) {
    return {
      scopedWuId: wuId,
      runGlobal: false,
    };
  }

  return {
    scopedWuId: null,
    runGlobal: true,
  };
}

async function detectCurrentWUForCwd(cwd?: string): Promise<string | null> {
  const workingDir = cwd ?? process.cwd();

  try {
    const branch = await createGitForPath(workingDir).getCurrentBranch();
    const parsed = parseWUFromBranchName(branch);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall back to legacy process-cwd based resolver below.
  }

  return getCurrentWU();
}

async function runSpecLinterGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
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
    console.log('⚠️  Unable to detect current WU; skipping scoped validation.');
  } else if (agentLog) {
    writeSync(agentLog.logFd, '⚠️  Unable to detect current WU; skipping scoped validation.\n');
  }

  if (!plan.runGlobal) {
    return { ok: true, duration: Date.now() - start };
  }

  const fallbackResult = run(pnpmRun(SCRIPTS.SPEC_LINTER), { agentLog, cwd });
  return { ok: fallbackResult.ok, duration: Date.now() - start };
}

type GateLogContext = {
  agentLog?: { logFd: number; logPath: string } | null;
  useAgentMode: boolean;
  cwd?: string;
};

function makeGateLogger({ agentLog, useAgentMode }: GateLogContext) {
  return (line: string) => {
    if (!useAgentMode) {
      console.log(line);
      return;
    }
    if (agentLog) {
      writeSync(agentLog.logFd, `${line}\n`);
    }
  };
}

async function runBacklogSyncGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> Backlog sync\n');

  const result = await validateBacklogSync({ cwd });

  if (result.errors.length > 0) {
    logLine('❌ Backlog sync errors:');
    result.errors.forEach((error) => logLine(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    logLine('⚠️  Backlog sync warnings:');
    result.warnings.forEach((warning) => logLine(`  - ${warning}`));
  }

  logLine(`Backlog sync summary: WU files=${result.wuCount}, Backlog refs=${result.backlogCount}`);

  return { ok: result.valid, duration: Date.now() - start };
}

async function runSupabaseDocsGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> Supabase docs linter\n');

  const result = await runSupabaseDocsLinter({ cwd, logger: { log: logLine } });

  if (result.skipped) {
    logLine(`⚠️  ${result.message ?? 'Supabase docs linter skipped.'}`);
  } else if (!result.ok) {
    logLine('❌ Supabase docs linter failed.');
    (result.errors ?? []).forEach((error) => logLine(`  - ${error}`));
  } else {
    logLine(result.message ?? 'Supabase docs linter passed.');
  }

  return { ok: result.ok, duration: Date.now() - start };
}

async function runSystemMapGate({ agentLog, useAgentMode, cwd }: GateLogContext) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });
  logLine('\n> System map validation\n');

  const result = await runSystemMapValidation({
    cwd,
    logger: { log: logLine, warn: logLine, error: logLine },
  });

  if (!result.valid) {
    logLine('❌ System map validation failed');
    (result.pathErrors ?? []).forEach((error) => logLine(`  - ${error}`));
    (result.orphanDocs ?? []).forEach((error) => logLine(`  - ${error}`));
    (result.audienceErrors ?? []).forEach((error) => logLine(`  - ${error}`));
    (result.queryErrors ?? []).forEach((error) => logLine(`  - ${error}`));
    (result.classificationErrors ?? []).forEach((error) => logLine(`  - ${error}`));
  } else {
    logLine('System map validation passed.');
  }

  return { ok: result.valid, duration: Date.now() - start };
}

/**
 * WU-1191: Run lane health check gate
 *
 * Checks lane configuration for overlaps and coverage gaps.
 * Mode is configurable via gates.lane_health in .lumenflow.config.yaml:
 * - 'warn': Log warnings but don't fail (default)
 * - 'error': Fail the gate if issues detected
 * - 'off': Skip the check entirely
 */
async function runLaneHealthGate({
  agentLog,
  useAgentMode,
  mode,
  cwd,
}: GateLogContext & { mode: LaneHealthMode }) {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });

  // Skip if mode is 'off'
  if (mode === 'off') {
    logLine('\n> Lane health check (skipped - mode: off)\n');
    return { ok: true, duration: Date.now() - start };
  }

  logLine(`\n> Lane health check (mode: ${mode})\n`);

  const report = runLaneHealthCheck({ projectRoot: cwd });

  if (!report.healthy) {
    logLine('⚠️  Lane health issues detected:');
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

async function filterExistingFiles(files: string[]): Promise<string[]> {
  const existingFiles = await Promise.all(
    files.map(async (file) => {
      try {
        await access(file);
        return file;
      } catch {
        return null;
      }
    }),
  );

  return existingFiles.filter((file): file is string => Boolean(file));
}

async function runFormatCheckGate({ agentLog, useAgentMode, cwd }: GateLogContext): Promise<{
  ok: boolean;
  duration: number;
  fileCount: number;
  filesChecked?: string[];
}> {
  const start = Date.now();
  const logLine = makeGateLogger({ agentLog, useAgentMode });

  let git;
  let isMainBranch = false;

  try {
    git = createGitForPath(cwd);
    const currentBranch = await git.getCurrentBranch();
    isMainBranch = currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER;
  } catch (error) {
    logLine(`⚠️  Failed to determine branch for format check: ${error.message}`);
    const result = run(pnpmCmd(SCRIPTS.FORMAT_CHECK), { agentLog, cwd });
    return { ...result, duration: Date.now() - start, fileCount: -1 };
  }

  if (isMainBranch) {
    logLine('📋 On main branch - running full format check');
    const result = run(pnpmCmd(SCRIPTS.FORMAT_CHECK), { agentLog, cwd });
    return { ...result, duration: Date.now() - start, fileCount: -1 };
  }

  let changedFiles: string[] = [];
  let fileListError = false;

  try {
    changedFiles = await getChangedFilesForIncremental({ git });
  } catch (error) {
    fileListError = true;
    logLine(`⚠️  Failed to determine changed files for format check: ${error.message}`);
  }

  const plan = resolveFormatCheckPlan({ changedFiles, fileListError });

  if (plan.mode === 'skip') {
    logLine('\n> format:check (incremental)\n');
    logLine('✅ No files changed - skipping format check');
    return { ok: true, duration: Date.now() - start, fileCount: 0, filesChecked: [] };
  }

  if (plan.mode === 'full') {
    const reason =
      plan.reason === 'prettier-config'
        ? ' (prettier config changed)'
        : plan.reason === 'file-list-error'
          ? ' (file list unavailable)'
          : '';

    logLine(`📋 Running full format check${reason}`);
    const result = run(pnpmCmd(SCRIPTS.FORMAT_CHECK), { agentLog, cwd });
    return { ...result, duration: Date.now() - start, fileCount: -1 };
  }

  const existingFiles = await filterExistingFiles(plan.files);
  if (existingFiles.length === 0) {
    logLine('\n> format:check (incremental)\n');
    logLine('✅ All changed files were deleted - skipping format check');
    return { ok: true, duration: Date.now() - start, fileCount: 0, filesChecked: [] };
  }

  logLine(`\n> format:check (incremental: ${existingFiles.length} files)\n`);
  const result = run(buildPrettierCheckCommand(existingFiles), { agentLog, cwd });
  return {
    ...result,
    duration: Date.now() - start,
    fileCount: existingFiles.length,
    filesChecked: existingFiles,
  };
}

/**
 * Run incremental ESLint on changed files only
 * Falls back to full lint if on main branch or if incremental fails
 * @returns {{ ok: boolean, duration: number, fileCount: number }}
 */
async function runIncrementalLint({
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
      logLine('📋 On main branch - running full lint');
      const result = run(pnpmCmd(SCRIPTS.LINT), { agentLog, cwd });
      return { ...result, fileCount: -1 };
    }

    const changedFiles = await getChangedLintableFiles({ git });
    const plan = resolveLintPlan({ isMainBranch, changedFiles });

    if (plan.mode === 'skip') {
      logLine('\n> ESLint (incremental)\n');
      logLine('✅ No lintable files changed - skipping lint');
      return { ok: true, duration: Date.now() - start, fileCount: 0 };
    }

    if (plan.mode === 'full') {
      logLine('📋 Running full lint (incremental plan forced full)');
      const result = run(pnpmCmd(SCRIPTS.LINT), { agentLog, cwd });
      return { ...result, fileCount: -1 };
    }

    const existingFiles = await filterExistingFiles(plan.files);
    if (existingFiles.length === 0) {
      logLine('\n> ESLint (incremental)\n');
      logLine('✅ All changed files were deleted - skipping lint');
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
    console.error('⚠️  Incremental lint failed, falling back to full lint:', error.message);
    const result = run(pnpmCmd(SCRIPTS.LINT), { agentLog, cwd });
    return { ...result, fileCount: -1 };
  }
}

/**
 * Run changed tests using configured test runner's incremental mode.
 * WU-1356: Updated to use configured commands from gates-config.
 * Falls back to full test suite if on main branch or if the run fails.
 *
 * @returns {{ ok: boolean, duration: number, isIncremental: boolean }}
 */
async function runChangedTests({
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

  // WU-1356: Get configured commands
  const gatesCommands = resolveGatesCommands(cwd);
  const testRunner = resolveTestRunner(cwd);

  try {
    const git = createGitForPath(cwd);
    const currentBranch = await git.getCurrentBranch();
    const isMainBranch = currentBranch === BRANCHES.MAIN || currentBranch === BRANCHES.MASTER;

    if (isMainBranch) {
      logLine('📋 On main branch - running full test suite');
      const result = run(gatesCommands.test_full, { agentLog, cwd });
      return { ...result, isIncremental: false };
    }

    let changedFiles: string[] = [];
    let fileListError = false;

    try {
      changedFiles = await getChangedFilesForIncremental({ git });
    } catch (error) {
      fileListError = true;
      logLine(`⚠️  Failed to determine changed files for tests: ${error.message}`);
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
          `⚠️  Untracked code files detected (${untrackedCodeFiles.length}): ${preview}${untrackedCodeFiles.length > 5 ? '...' : ''}`,
        );
      } else if (plan.reason === 'test-config') {
        logLine('⚠️  Test config changes detected - running full test suite');
      } else if (plan.reason === 'file-list-error') {
        logLine('⚠️  Changed file list unavailable - running full test suite');
      }

      logLine('📋 Running full test suite to avoid missing coverage');
      const result = run(gatesCommands.test_full, { agentLog, cwd });
      return { ...result, duration: Date.now() - start, isIncremental: false };
    }

    // WU-1356: Use configured incremental test command
    logLine(`\n> Running tests (${testRunner} --changed)\n`);

    // If test_incremental is configured, use it directly
    if (gatesCommands.test_incremental) {
      const result = run(gatesCommands.test_incremental, { agentLog, cwd });
      return { ...result, duration: Date.now() - start, isIncremental: true };
    }

    // Fallback: For vitest, use the built-in changed args helper
    if (testRunner === 'vitest') {
      const result = run(
        pnpmCmd('vitest', 'run', ...buildVitestChangedArgs({ baseBranch: 'origin/main' })),
        { agentLog, cwd },
      );
      return { ...result, duration: Date.now() - start, isIncremental: true };
    }

    // For other runners without configured incremental, fall back to full
    logLine('⚠️  No incremental test command configured, running full suite');
    const result = run(gatesCommands.test_full, { agentLog, cwd });
    return { ...result, duration: Date.now() - start, isIncremental: false };
  } catch (error) {
    console.error('⚠️  Changed tests failed, falling back to full suite:', error.message);
    const result = run(gatesCommands.test_full, { agentLog, cwd });
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
    // Pass glob patterns as positional arguments instead
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
    console.error('⚠️  Integration tests failed:', error.message);
    return { ok: false, duration: Date.now() - start };
  }
}

async function getChangedFilesForIncremental({
  git,
  baseBranch = 'origin/main',
}: {
  git: ReturnType<typeof createGitForPath>;
  baseBranch?: string;
}) {
  const mergeBase = await git.mergeBase('HEAD', baseBranch);
  const committedOutput = await git.raw(['diff', '--name-only', `${mergeBase}...HEAD`]);
  const committedFiles = committedOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const unstagedOutput = await git.raw(['diff', '--name-only']);
  const unstagedFiles = unstagedOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard']);
  const untrackedFiles = untrackedOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  return [...new Set([...committedFiles, ...unstagedFiles, ...untrackedFiles])];
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
  git?: ReturnType<typeof createGitForPath>;
  cwd?: string;
}

async function getAllChangedFiles(options: GetAllChangedFilesOptions = {}) {
  const { git = createGitForPath(options.cwd ?? process.cwd()) } = options;

  try {
    return await getChangedFilesForIncremental({ git });
  } catch (error) {
    console.error('⚠️  Failed to get changed files:', error.message);
    return [];
  }
}

/**
 * Run gates for a specific working directory without mutating global process cwd.
 */
export async function runGates(
  options: {
    cwd?: string;
    docsOnly?: boolean;
    fullLint?: boolean;
    fullTests?: boolean;
    fullCoverage?: boolean;
    coverageMode?: string;
    verbose?: boolean;
    strict?: boolean;
    argv?: string[];
  } = {},
): Promise<boolean> {
  try {
    return await executeGates({
      ...options,
      cwd: options.cwd ?? process.cwd(),
      coverageMode: options.coverageMode ?? COVERAGE_GATE_MODES.BLOCK,
    });
  } catch {
    return false;
  }
}

// Main execution
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing: main() orchestrates multi-step gate workflow
async function executeGates(opts: {
  cwd?: string;
  docsOnly?: boolean;
  fullLint?: boolean;
  fullTests?: boolean;
  fullCoverage?: boolean;
  coverageMode?: string;
  verbose?: boolean;
  strict?: boolean;
  argv?: string[];
}): Promise<boolean> {
  const cwd = opts.cwd ?? process.cwd();
  const argv = opts.argv ?? process.argv.slice(2);
  // Get context for telemetry
  const wu_id = getCurrentWU();
  const lane = getCurrentLane();
  const useAgentMode = shouldUseGatesAgentMode({ argv, env: process.env });
  const agentLog = useAgentMode ? createAgentLogContext({ wuId: wu_id, lane, cwd }) : null;
  // Parse command line arguments (now via Commander)
  const isDocsOnly = opts.docsOnly || false;
  const isFullLint = opts.fullLint || false;
  const isFullTests = opts.fullTests || false;
  // WU-2244: Full coverage flag forces full test suite and coverage gate (deterministic)
  const isFullCoverage = opts.fullCoverage || false;
  // WU-1262: Resolve coverage config from methodology policy
  // This derives coverage threshold and mode from methodology.testing setting
  // WU-1280: Use resolveTestPolicy to also get tests_required for test failure handling
  const resolvedTestPolicy = resolveTestPolicy(cwd);
  // WU-1433: Coverage gate mode (warn or block)
  // WU-2334: Default changed from WARN to BLOCK for TDD enforcement
  // WU-1262: CLI flag overrides resolved policy, which overrides methodology defaults
  const coverageMode = opts.coverageMode || resolvedTestPolicy.mode || COVERAGE_GATE_MODES.BLOCK;
  const coverageThreshold = resolvedTestPolicy.threshold;
  // WU-1280: Determine if tests are required (affects whether test failures block or warn)
  // When tests_required=false (methodology.testing: none), test failures produce warnings only
  const testsRequired = resolvedTestPolicy.tests_required;
  // WU-1191: Lane health gate mode (warn, error, or off)
  const laneHealthMode = loadLaneHealthConfig(cwd);
  // WU-1356: Resolve configured gates commands for test execution
  const configuredGatesCommands = resolveGatesCommands(cwd);
  // WU-1520: Strict mode and script existence checking for graceful degradation
  const isStrict = opts.strict || false;
  const packageJsonScripts = loadPackageJsonScripts(cwd);
  // WU-1520: Track gate results for summary
  const gateResults: GateResult[] = [];

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
      changedFiles = await getAllChangedFiles({ cwd });
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

  // WU-1299: Load code_paths and compute docs-only test plan
  let docsOnlyTestPlan: DocsOnlyTestPlan | null = null;
  if (effectiveDocsOnly) {
    const codePaths = loadCurrentWUCodePaths({ cwd });
    docsOnlyTestPlan = resolveDocsOnlyTestPlan({ codePaths });
  }

  // WU-1550: Build gate list via GateRegistry (declarative, Open-Closed Principle)
  // New gates can be added by calling registry.register() without modifying this function.
  // WU-2252: Invariants gate runs FIRST and is included in both docs-only and regular modes
  // WU-1520: scriptName field maps gates to their package.json script for existence checking
  const gateRegistry = new GateRegistry();

  if (effectiveDocsOnly) {
    registerDocsOnlyGates(gateRegistry, {
      laneHealthMode,
      testsRequired,
      docsOnlyTestPlan,
    });
  } else {
    registerCodeGates(gateRegistry, {
      isFullLint,
      isFullTests,
      isFullCoverage,
      laneHealthMode,
      testsRequired,
      shouldRunIntegration: !!(riskTier && riskTier.shouldRunIntegration),
      configuredTestFullCmd: configuredGatesCommands.test_full,
    });
  }

  // WU-1550: Inject run functions for gates that need them.
  // The registry stores declarative metadata; run functions are bound here
  // because they depend on local gate-runner functions in this module.
  const gateRunFunctions: Record<string, GateDefinition['run']> = {
    [GATE_NAMES.FORMAT_CHECK]: runFormatCheckGate,
    [GATE_NAMES.SPEC_LINTER]: runSpecLinterGate,
    [GATE_NAMES.BACKLOG_SYNC]: runBacklogSyncGate,
    [GATE_NAMES.SUPABASE_DOCS_LINTER]: runSupabaseDocsGate,
    [GATE_NAMES.SYSTEM_MAP_VALIDATE]: runSystemMapGate,
    [GATE_NAMES.LANE_HEALTH]: (ctx: GateLogContext) =>
      runLaneHealthGate({ ...ctx, mode: laneHealthMode }),
  };

  // WU-1299: Docs-only filtered tests get a custom run function
  if (docsOnlyTestPlan && docsOnlyTestPlan.mode === 'filtered') {
    gateRunFunctions[GATE_NAMES.TEST] = (ctx: GateLogContext) => {
      const pkgs = docsOnlyTestPlan.packages;
      return runDocsOnlyFilteredTests({
        packages: pkgs,
        agentLog: ctx.agentLog,
        cwd: ctx.cwd,
      });
    };
  }

  // Apply run functions to registered gates
  const gates = gateRegistry.getAll().map((gate) => {
    const runFn = gateRunFunctions[gate.name];
    if (runFn && !gate.run) {
      return { ...gate, run: runFn };
    }
    return gate;
  });

  if (effectiveDocsOnly) {
    // WU-1299: Show clear messaging about what's being skipped/run in docs-only mode
    const docsOnlyMessage =
      docsOnlyTestPlan && docsOnlyTestPlan.mode === 'filtered'
        ? formatDocsOnlySkipMessage(docsOnlyTestPlan)
        : '📝 Docs-only mode: skipping lint, typecheck, and all tests (no code packages in code_paths)';

    if (!useAgentMode) {
      console.log(`${docsOnlyMessage}\n`);
    } else {
      writeSync(agentLog.logFd, `${docsOnlyMessage}\n`);
    }
  }

  // Run all gates sequentially
  // WU-1920: Track last test result to skip coverage gate on changed tests
  let lastTestResult = null;
  let lastFormatCheckFiles: string[] | null = null;

  for (const gate of gates) {
    let result: { ok: boolean; duration: number; filesChecked?: string[] };

    // WU-1520: Check if the gate's underlying script exists in package.json
    const gateScriptName = (gate as { scriptName?: string }).scriptName ?? null;
    const gateAction = resolveGateAction(gate.name, gateScriptName, packageJsonScripts, isStrict);

    if (gateAction === 'skip') {
      const logLine = makeGateLogger({ agentLog, useAgentMode, cwd });
      const warningMsg = buildMissingScriptWarning(gateScriptName!);
      logLine(`\n${warningMsg}\n`);
      gateResults.push({
        name: gate.name,
        status: 'skipped',
        durationMs: 0,
        reason: 'script not found in package.json',
      });
      continue;
    }

    if (gateAction === 'fail') {
      const logLine = makeGateLogger({ agentLog, useAgentMode, cwd });
      logLine(`\n❌ "${gateScriptName}" script not found in package.json (--strict mode)\n`);
      gateResults.push({
        name: gate.name,
        status: 'failed',
        durationMs: 0,
        reason: 'script not found in package.json (strict mode)',
      });
      die(
        `${gate.name} failed: missing script "${gateScriptName}" in package.json (--strict mode requires all gate scripts)`,
      );
    }

    if (gate.run) {
      result = await gate.run({ agentLog, useAgentMode, cwd });
      if (gate.name === GATE_NAMES.FORMAT_CHECK) {
        lastFormatCheckFiles = result.filesChecked ?? null;
      }
    } else if (gate.cmd === GATE_COMMANDS.INVARIANTS) {
      // WU-2252: Invariants check runs first (non-bypassable)
      const logLine = useAgentMode
        ? (line) => writeSync(agentLog.logFd, `${line}\n`)
        : (line) => console.log(line);

      logLine('\n> Invariants check\n');

      const invariantsResult = runInvariants({ baseDir: cwd, silent: false });
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
      result = await runIncrementalLint({ agentLog, cwd });
    } else if (gate.cmd === GATE_COMMANDS.SAFETY_CRITICAL_TEST) {
      // WU-2062: Safety-critical tests always run
      result = await runSafetyCriticalTests({ agentLog, cwd });
    } else if (gate.cmd === GATE_COMMANDS.INCREMENTAL_TEST) {
      // WU-1920: Special handling for changed tests
      result = await runChangedTests({ agentLog, cwd });
      lastTestResult = result;
    } else if (gate.cmd === GATE_COMMANDS.TIERED_TEST) {
      // WU-2062: Integration tests for high-risk changes
      result = await runIntegrationTests({ agentLog, cwd });
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
        // WU-1520: Track skipped coverage gate in summary
        gateResults.push({
          name: gate.name,
          status: 'skipped',
          durationMs: 0,
          reason: 'changed tests - coverage is partial',
        });
        continue;
      }

      // WU-1433: Special handling for coverage gate
      // WU-1262: Include threshold from resolved policy in log
      if (!useAgentMode) {
        console.log(
          `\n> Coverage gate (mode: ${coverageMode}, threshold: ${coverageThreshold}%)\n`,
        );
      } else {
        writeSync(
          agentLog.logFd,
          `\n> Coverage gate (mode: ${coverageMode}, threshold: ${coverageThreshold}%)\n\n`,
        );
      }
      result = await runCoverageGate({
        mode: coverageMode,
        // WU-1262: Pass resolved threshold from methodology policy
        threshold: coverageThreshold,
        logger: useAgentMode
          ? {
              log: (msg) => {
                writeSync(agentLog.logFd, `${msg}\n`);
              },
            }
          : console,
      });
    } else if (gate.cmd === GATE_COMMANDS.ONBOARDING_SMOKE_TEST) {
      // WU-1315: Onboarding smoke test (init + wu:create validation)
      const logLine = useAgentMode
        ? (line: string) => writeSync(agentLog.logFd, `${line}\n`)
        : (line: string) => console.log(line);

      logLine('\n> Onboarding smoke test\n');

      result = await runOnboardingSmokeTestGate({
        logger: { log: logLine },
      });
    } else {
      result = run(gate.cmd, { agentLog, cwd });
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
        // WU-1520: Track warned gates in summary
        gateResults.push({
          name: gate.name,
          status: 'warned',
          durationMs: result.duration,
        });
        continue;
      }

      if (gate.name === GATE_NAMES.FORMAT_CHECK) {
        emitFormatCheckGuidance({ agentLog, useAgentMode, files: lastFormatCheckFiles, cwd });
      }

      // WU-1520: Track failed gate before dying
      gateResults.push({
        name: gate.name,
        status: 'failed',
        durationMs: result.duration,
      });

      // WU-1520: Print summary before failing
      const logLine = makeGateLogger({ agentLog, useAgentMode, cwd });
      logLine(`\n${formatGateSummary(gateResults)}\n`);

      if (useAgentMode) {
        const tail = readLogTail(agentLog.logPath);
        console.error(`\n❌ ${gate.name} failed (agent mode). Log: ${agentLog.logPath}\n`);
        if (tail) {
          console.error(`Last log lines:\n${tail}\n`);
        }
      }
      die(`${gate.name} failed`);
    }

    // WU-1520: Track passed gate
    gateResults.push({
      name: gate.name,
      status: 'passed',
      durationMs: result.duration,
    });
  }

  // WU-2064: Create/update gates-latest.log symlink for easy agent access
  if (agentLog) {
    updateGatesLatestSymlink({ logPath: agentLog.logPath, cwd, env: process.env });
  }

  // WU-1520: Print gate summary showing passed/skipped/failed/warned
  const summaryLogLine = makeGateLogger({ agentLog, useAgentMode, cwd });
  summaryLogLine(`\n${formatGateSummary(gateResults)}`);

  if (!useAgentMode) {
    console.log('\n✅ All gates passed!\n');
  } else {
    console.log(`✅ All gates passed (agent mode). Log: ${agentLog.logPath}\n`);
  }

  return true;
}

// WU-1537: Wrap executeGates in a standard main() for runCLI consistency
async function main(): Promise<void> {
  const opts = parseGatesArgs();
  const ok = await executeGates({ ...opts, argv: process.argv.slice(2) });
  if (!ok) {
    process.exit(EXIT_CODES.ERROR);
  }
}

// WU-1071: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
if (import.meta.main) {
  void runCLI(main);
}
