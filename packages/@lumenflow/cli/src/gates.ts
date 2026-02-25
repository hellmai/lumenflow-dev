#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Quality Gates Runner
 *
 * Runs quality gates with support for docs-only mode and incremental linting.
 *
 * WU-1647: Refactored into focused modules:
 *   - gates-utils.ts: Shell helpers, logging, git helpers, WU helpers
 *   - gates-plan-resolvers.ts: Pure plan resolution (format, lint, test, spec-linter)
 *   - gates-runners.ts: Gate runner functions (format, lint, test, safety, integration, etc.)
 *   - gates.ts (this file): Orchestrator, CLI options, main entry point
 *
 * WU-1304: Optimise ESLint gates performance
 * - Uses incremental linting (only files changed since branching from main)
 * - Full lint coverage maintained via CI workflow
 *
 * WU-1433: Coverage gate with mode flag
 * - Checks coverage thresholds for hex core files (>=90% for application layer)
 * - Mode: block (default) fails the gate, warn logs warnings only
 * WU-2334: Changed default from warn to block for TDD enforcement
 *
 * WU-1610: Supabase docs linter
 * - Verifies every table in migrations is documented in schema.md
 * - Fails if UnsafeAny table is missing documentation
 *
 * For type:documentation WUs:
 * - Run: format:check, spec:linter, backlog-sync
 * - Skip: lint, typecheck, supabase-docs:linter, tests, coverage (no code changed)
 *
 * WU-1920: Incremental test execution
 * - Uses Vitest's --changed flag to run only tests for changed files
 * - Full test suite maintained via CI workflow and --full-tests flag
 *
 * WU-2062: Tiered test execution for faster wu:done
 * - Safety-critical tests (escalation, red-flag) ALWAYS run
 * - Docs-only WUs: lint/typecheck only (auto-detected or --docs-only flag)
 * - High-risk WUs (auth, RLS, migrations): run integration tests
 * - Standard WUs: changed tests + safety-critical tests
 *
 * Usage:
 *   node tools/gates.ts                        # Tiered gates (default)
 *   node tools/gates.ts --docs-only            # Docs-only gates
 *   node tools/gates.ts --full-lint            # Full lint (bypass incremental)
 *   node tools/gates.ts --full-tests           # Full tests (bypass incremental)
 *   node tools/gates.ts --coverage-mode=block  # Coverage gate in block mode
 */

import { writeSync } from 'node:fs';
import {
  emitGateEvent,
  getCurrentWU,
  getCurrentLane,
  syncNdjsonTelemetryToCloud,
  type TelemetryCloudSyncResult,
} from '@lumenflow/core/telemetry';
import { die } from '@lumenflow/core/error-handler';
import {
  shouldUseGatesAgentMode,
  updateGatesLatestSymlink,
} from '@lumenflow/core/gates-agent-mode';
// WU-2252: Import invariants runner for first-check validation
import { runInvariants } from '@lumenflow/core/invariants-runner';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { runCoverageGate, COVERAGE_GATE_MODES } from '@lumenflow/core/coverage-gate';
// WU-1067: Config-driven gates support
import {
  loadLaneHealthConfig,
  resolveTestPolicy,
  resolveGatesCommands,
} from '@lumenflow/core/gates-config';
import { GATE_NAMES, GATE_COMMANDS, EXIT_CODES } from '@lumenflow/core/wu-constants';
// WU-1520: Gates graceful degradation for missing optional scripts
import {
  buildMissingScriptWarning,
  loadPackageJsonScripts,
  resolveGateAction,
  formatGateSummary,
  type GateResult,
} from './gates-graceful-degradation.js';
import { runCLI } from './cli-entry-point.js';
// WU-1929: Import chalk for colored gate output
import chalk from 'chalk';
// WU-1550: Gate registry for declarative gate registration
import { GateRegistry, type GateDefinition } from './gate-registry.js';
import { registerDocsOnlyGates, registerCodeGates } from './gate-defaults.js';
// WU-1315: Onboarding smoke test
import { runOnboardingSmokeTestGate } from './onboarding-smoke-test.js';

// ── WU-1647: Import from extracted modules ─────────────────────────────

import {
  type GateLogContext,
  run,
  makeGateLogger,
  readLogTail,
  createAgentLogContext,
  emitFormatCheckGuidance,
  loadCurrentWUCodePaths,
} from './gates-utils.js';

import {
  type DocsOnlyTestPlan,
  resolveDocsOnlyTestPlan,
  formatDocsOnlySkipMessage,
} from './gates-plan-resolvers.js';

import {
  runFormatCheckGate,
  runIncrementalLint,
  runChangedTests,
  runSafetyCriticalTests,
  runIntegrationTests,
  runSpecLinterGate,
  runClaimValidationGate,
  runBacklogSyncGate,
  runSupabaseDocsGate,
  runLaneHealthGate,
  runDocsOnlyFilteredTests,
} from './gates-runners.js';

// ── Re-exports for backward compatibility ──────────────────────────────
// Tests and other modules import these from gates.ts; preserve the public API.

export {
  parsePrettierListOutput,
  buildPrettierWriteCommand,
  formatFormatCheckGuidance,
  parseWUFromBranchName,
  extractPackagesFromCodePaths,
  loadCurrentWUCodePaths,
} from './gates-utils.js';

export {
  isPrettierConfigFile,
  isTestConfigFile,
  resolveFormatCheckPlan,
  resolveLintPlan,
  resolveTestPlan,
  resolveDocsOnlyTestPlan,
  formatDocsOnlySkipMessage,
  resolveSpecLinterPlan,
} from './gates-plan-resolvers.js';

export type { DocsOnlyTestPlan } from './gates-plan-resolvers.js';

// ── CLI options ────────────────────────────────────────────────────────

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
      return Boolean(nextArg && !nextArg.startsWith('-'));
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

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Run gates for a specific working directory without mutating global process cwd.
 */
export async function runGates(
  options: {
    cwd?: string;
    docsOnly?: boolean;
    fullLint?: boolean;
    fullTests?: boolean;
    scopedTestPaths?: string[];
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

export async function syncGatesTelemetryToCloud(
  input: {
    cwd?: string;
    fetchFn?: typeof fetch;
    logger?: Pick<Console, 'warn'>;
    now?: () => number;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<TelemetryCloudSyncResult> {
  return syncNdjsonTelemetryToCloud({
    workspaceRoot: input.cwd ?? process.cwd(),
    fetchFn: input.fetchFn,
    logger: input.logger,
    now: input.now,
    environment: input.environment,
  });
}

// ── Main orchestrator ──────────────────────────────────────────────────

// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing: main() orchestrates multi-step gate workflow
async function executeGates(opts: {
  cwd?: string;
  docsOnly?: boolean;
  fullLint?: boolean;
  fullTests?: boolean;
  scopedTestPaths?: string[];
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
  if (useAgentMode && !agentLog) {
    die('Failed to initialize agent-mode gate log context');
  }
  // Parse command line arguments (now via Commander)
  const isDocsOnly = opts.docsOnly || false;
  const isFullLint = opts.fullLint || false;
  const isFullTests = opts.fullTests || false;
  // WU-2244: Full coverage flag forces full test suite and coverage gate (deterministic)
  const isFullCoverage = opts.fullCoverage || false;
  // WU-1262: Resolve coverage config from methodology policy
  // WU-1280: Use resolveTestPolicy to also get tests_required for test failure handling
  const resolvedTestPolicy = resolveTestPolicy(cwd);
  // WU-1433: Coverage gate mode (warn or block)
  // WU-2334: Default changed from WARN to BLOCK for TDD enforcement
  // WU-1262: CLI flag overrides resolved policy, which overrides methodology defaults
  const coverageMode = opts.coverageMode || resolvedTestPolicy.mode || COVERAGE_GATE_MODES.BLOCK;
  const coverageThreshold = resolvedTestPolicy.threshold;
  // WU-1280: Determine if tests are required (affects whether test failures block or warn)
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
  const telemetrySyncLogger: Pick<Console, 'warn'> = {
    warn: (message: string) => {
      if (useAgentMode) {
        writeSync(agentLog!.logFd, `${message}\n`);
        return;
      }
      console.warn(message);
    },
  };

  async function flushTelemetryToCloud(): Promise<void> {
    try {
      await syncGatesTelemetryToCloud({
        cwd,
        logger: telemetrySyncLogger,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      telemetrySyncLogger.warn(`[gates] cloud telemetry sync failed unexpectedly: ${message}`);
    }
  }

  if (useAgentMode) {
    console.log(
      `\uD83E\uDDFE gates (agent mode): output -> ${agentLog!.logPath} (use --verbose for streaming)\n`,
    );
  }

  // WU-2062: Risk tier defaults to standard (risk detector removed)
  let riskTier = null;

  if (!isDocsOnly) {
    riskTier = {
      tier: 'standard',
      isDocsOnly: false,
      shouldRunIntegration: false,
      highRiskPaths: [],
    };
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
  const gateRunFunctions: Record<string, GateDefinition['run']> = {
    [GATE_NAMES.FORMAT_CHECK]: runFormatCheckGate,
    [GATE_NAMES.SPEC_LINTER]: runSpecLinterGate,
    [GATE_NAMES.CLAIM_VALIDATION]: runClaimValidationGate,
    [GATE_NAMES.BACKLOG_SYNC]: runBacklogSyncGate,
    [GATE_NAMES.SUPABASE_DOCS_LINTER]: runSupabaseDocsGate,
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
        : '\uD83D\uDCDD Docs-only mode: skipping lint, typecheck, and all tests (no code packages in code_paths)';

    if (!useAgentMode) {
      console.log(`${docsOnlyMessage}\n`);
    } else {
      writeSync(agentLog!.logFd, `${docsOnlyMessage}\n`);
    }
  }

  // Run all gates sequentially
  // WU-1920: Track last test result to skip coverage gate on changed tests
  let lastTestResult: {
    ok: boolean;
    duration: number;
    filesChecked?: string[];
    isIncremental?: boolean;
  } | null = null;
  let lastFormatCheckFiles: string[] | null = null;

  for (const gate of gates) {
    let result: {
      ok: boolean;
      duration: number;
      filesChecked?: string[];
      isIncremental?: boolean;
    };

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
      logLine(`\n\u274C "${gateScriptName}" script not found in package.json (--strict mode)\n`);
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
        ? (line: string) => writeSync(agentLog!.logFd, `${line}\n`)
        : (line: string) => console.log(line);

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
      result = await runChangedTests({
        agentLog,
        cwd,
        scopedTestPaths: opts.scopedTestPaths,
      });
      lastTestResult = result;
    } else if (gate.cmd === GATE_COMMANDS.TIERED_TEST) {
      // WU-2062: Integration tests for high-risk changes
      result = await runIntegrationTests({ agentLog, cwd });
    } else if (gate.cmd === GATE_COMMANDS.COVERAGE_GATE) {
      // WU-1920: Skip coverage gate when tests were changed (partial coverage)
      // WU-2244: --full-coverage overrides incremental skip behavior
      if (!isFullCoverage && lastTestResult?.isIncremental) {
        const msg = '\u23ED\uFE0F  Skipping coverage gate (changed tests - coverage is partial)';
        if (!useAgentMode) {
          console.log(`\n${msg}\n`);
        } else {
          writeSync(agentLog!.logFd, `\n${msg}\n\n`);
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
          agentLog!.logFd,
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
                writeSync(agentLog!.logFd, `${msg}\n`);
              },
            }
          : console,
      });
    } else if (gate.cmd === GATE_COMMANDS.ONBOARDING_SMOKE_TEST) {
      // WU-1315: Onboarding smoke test (init + wu:create validation)
      const logLine = useAgentMode
        ? (line: string) => writeSync(agentLog!.logFd, `${line}\n`)
        : (line: string) => console.log(line);

      logLine('\n> Onboarding smoke test\n');

      result = await runOnboardingSmokeTestGate({
        logger: { log: logLine },
      });
    } else {
      if (!gate.cmd) {
        die(`${gate.name} failed: gate command is not configured`);
      }
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
        const warnMsg = `\u26A0\uFE0F  ${gate.name} failed (warn-only, not blocking)`;
        if (!useAgentMode) {
          console.log(`\n${warnMsg}\n`);
        } else {
          writeSync(agentLog!.logFd, `\n${warnMsg}\n\n`);
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
        const tail = readLogTail(agentLog!.logPath);
        console.error(`\n\u274C ${gate.name} failed (agent mode). Log: ${agentLog!.logPath}\n`);
        if (tail) {
          console.error(`Last log lines:\n${tail}\n`);
        }
      }
      await flushTelemetryToCloud();
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

  // WU-1929: Use colored output for gate results
  if (!useAgentMode) {
    console.log(`\n${chalk.green('\u2705 All gates passed!')}\n`);
  } else {
    console.log(
      `${chalk.green('\u2705 All gates passed')} (agent mode). Log: ${agentLog!.logPath}\n`,
    );
  }

  await flushTelemetryToCloud();

  return true;
}

// WU-1537: Wrap executeGates in a standard main() for runCLI consistency
export async function main(): Promise<void> {
  const opts = parseGatesOptions();
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
