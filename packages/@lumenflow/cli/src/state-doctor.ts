#!/usr/bin/env node

/**
 * State Doctor CLI (WU-1209, WU-1420)
 *
 * Integrity checker for LumenFlow state that detects:
 * - Orphaned WUs (done status but no stamp)
 * - Dangling signals (reference non-existent WUs)
 * - Broken memory relationships (events for missing WU specs)
 * - Status mismatches between WU YAML and state store (WU-1420)
 *
 * Inspired by Beads bd doctor command.
 *
 * Features:
 * - Human-readable output with actionable suggestions
 * - --fix flag for safe auto-repair of resolvable issues
 * - --dry-run to preview what would be fixed
 * - --json for machine-readable output
 *
 * Usage:
 *   pnpm state:doctor                 # Run integrity checks
 *   pnpm state:doctor --fix           # Auto-repair safe issues
 *   pnpm state:doctor --fix --dry-run # Preview repairs
 *   pnpm state:doctor --json          # Output as JSON
 *
 * @see {@link packages/@lumenflow/core/src/state-doctor-core.ts} - Core logic
 * @see {@link packages/@lumenflow/core/src/__tests__/state-doctor-core.test.ts} - Tests
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import {
  diagnoseState,
  ISSUE_TYPES,
  ISSUE_SEVERITY,
  type StateDiagnosis,
  type StateDoctorDeps,
  type MockWU,
  type MockSignal,
  type MockEvent,
} from '@lumenflow/core/state-doctor-core';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { getConfig, getResolvedPaths } from '@lumenflow/core/config';
import { existsSync } from 'node:fs';
import { createStamp } from '@lumenflow/core/stamp-utils';
import { createStateDoctorFixDeps } from './state-doctor-fix.js';
import { runCLI } from './cli-entry-point.js';

/**
 * Log prefix for state:doctor output
 */
const LOG_PREFIX = '[state:doctor]';

// WU-1539/WU-1548: Use centralized LUMENFLOW_PATHS.MEMORY_SIGNALS and LUMENFLOW_PATHS.WU_EVENTS

/**
 * Tool name for audit logging
 */
const TOOL_NAME = 'state:doctor';

/**
 * Emoji constants for output formatting
 */
const EMOJI = {
  SUCCESS: '\u2705',
  FAILURE: '\u274C',
  WARNING: '\u26A0\uFE0F',
  FIX: '\u{1F527}',
  INFO: '\u2139\uFE0F',
} as const;

/**
 * CLI argument options for state:doctor
 */
const CLI_OPTIONS = {
  fix: {
    name: 'fix',
    flags: '--fix',
    description: 'Auto-repair safe issues',
  },
  dryRun: {
    name: 'dryRun',
    flags: '--dry-run',
    description: 'Preview repairs without making changes',
  },
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output as JSON',
  },
  quiet: {
    name: 'quiet',
    flags: '-q, --quiet',
    description: 'Suppress output except errors and summary',
  },
  baseDir: {
    name: 'baseDir',
    flags: '-b, --base-dir <path>',
    description: 'Base directory (defaults to current directory)',
  },
};

interface ParsedArgs {
  fix?: boolean;
  dryRun?: boolean;
  json?: boolean;
  quiet?: boolean;
  baseDir?: string;
}

/**
 * Write audit log entry for tool execution
 */
async function writeAuditLog(baseDir: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const logPath = path.join(baseDir, LUMENFLOW_PATHS.AUDIT_LOG);
    const logDir = path.dirname(logPath);

    await fs.mkdir(logDir, { recursive: true });

    const line = `${JSON.stringify(entry)}\n`;

    await fs.appendFile(logPath, line, 'utf-8');
  } catch {
    // Audit logging is non-fatal - silently ignore errors
  }
}

/**
 * Parse CLI arguments
 */
function parseArguments(): ParsedArgs {
  return createWUParser({
    name: 'state-doctor',
    description: 'Check state integrity and optionally repair issues',
    options: [
      CLI_OPTIONS.fix,
      CLI_OPTIONS.dryRun,
      CLI_OPTIONS.json,
      CLI_OPTIONS.quiet,
      CLI_OPTIONS.baseDir,
    ],
    required: [],
    allowPositionalId: false,
  }) as ParsedArgs;
}

/**
 * Create dependencies for state doctor from filesystem
 */
async function createDeps(baseDir: string): Promise<StateDoctorDeps> {
  const config = getConfig({ projectRoot: baseDir });

  return {
    /**
     * List all WU YAML files
     */
    listWUs: async (): Promise<MockWU[]> => {
      try {
        const wuDir = path.join(baseDir, config.directories.wuDir);
        const wuFiles = await fg('WU-*.yaml', { cwd: wuDir });
        const wus: MockWU[] = [];

        for (const file of wuFiles) {
          try {
            const filePath = path.join(wuDir, file);

            const content = await fs.readFile(filePath, 'utf-8');
            const wu = parseYaml(content) as {
              id?: string;
              status?: string;
              lane?: string;
              title?: string;
            };

            if (wu.id && wu.status) {
              wus.push({
                id: wu.id,
                status: wu.status,
                lane: wu.lane,
                title: wu.title,
              });
            }
          } catch {
            // Skip files that fail to parse
            continue;
          }
        }

        return wus;
      } catch {
        return [];
      }
    },

    /**
     * List all stamp file IDs
     * WU-1301: Use config-based paths instead of LUMENFLOW_PATHS
     */
    listStamps: async (): Promise<string[]> => {
      try {
        const stampsDir = path.join(baseDir, config.state.stampsDir);
        const stampFiles = await fg('WU-*.done', { cwd: stampsDir });
        return stampFiles.map((file) => file.replace('.done', ''));
      } catch {
        return [];
      }
    },

    /**
     * List all signals from NDJSON file
     */
    listSignals: async (): Promise<MockSignal[]> => {
      try {
        const signalsPath = path.join(baseDir, LUMENFLOW_PATHS.MEMORY_SIGNALS);

        const content = await fs.readFile(signalsPath, 'utf-8');
        const signals: MockSignal[] = [];

        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const signal = JSON.parse(line) as {
              id?: string;
              wuId?: string;
              timestamp?: string;
              message?: string;
            };
            if (signal.id) {
              signals.push({
                id: signal.id,
                wuId: signal.wuId,
                timestamp: signal.timestamp,
                message: signal.message,
              });
            }
          } catch {
            // Skip malformed lines
            continue;
          }
        }

        return signals;
      } catch {
        return [];
      }
    },

    /**
     * List all events from NDJSON file
     */
    listEvents: async (): Promise<MockEvent[]> => {
      try {
        const eventsPath = path.join(baseDir, LUMENFLOW_PATHS.WU_EVENTS);

        const content = await fs.readFile(eventsPath, 'utf-8');
        const events: MockEvent[] = [];

        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as {
              wuId?: string;
              type?: string;
              timestamp?: string;
            };
            if (event.wuId && event.type) {
              events.push({
                wuId: event.wuId,
                type: event.type,
                timestamp: event.timestamp,
              });
            }
          } catch {
            // Skip malformed lines
            continue;
          }
        }

        return events;
      } catch {
        return [];
      }
    },

    /**
     * Remove a signal by ID (rewrite signals file without the target)
     */
    removeSignal: async (id: string): Promise<void> => {
      const signalsPath = path.join(baseDir, LUMENFLOW_PATHS.MEMORY_SIGNALS);

      const content = await fs.readFile(signalsPath, 'utf-8');
      const lines = content.split('\n').filter((line) => {
        if (!line.trim()) return false;
        try {
          const signal = JSON.parse(line) as { id?: string };
          return signal.id !== id;
        } catch {
          return true; // Keep malformed lines
        }
      });

      await fs.writeFile(signalsPath, lines.join('\n') + '\n', 'utf-8');
    },

    /**
     * Remove events for a WU (rewrite events file without the target WU)
     */
    removeEvent: async (wuId: string): Promise<void> => {
      const eventsPath = path.join(baseDir, LUMENFLOW_PATHS.WU_EVENTS);

      const content = await fs.readFile(eventsPath, 'utf-8');
      const lines = content.split('\n').filter((line) => {
        if (!line.trim()) return false;
        try {
          const event = JSON.parse(line) as { wuId?: string };
          return event.wuId !== wuId;
        } catch {
          return true; // Keep malformed lines
        }
      });

      await fs.writeFile(eventsPath, lines.join('\n') + '\n', 'utf-8');
    },

    /**
     * Create a stamp for a WU
     */
    createStamp: async (wuId: string, title: string): Promise<void> => {
      const stampsDir = path.join(baseDir, LUMENFLOW_PATHS.STAMPS_DIR);

      await fs.mkdir(stampsDir, { recursive: true });

      await createStamp({
        id: wuId,
        title,
      });
    },
  };
}

/**
 * Get emoji for issue severity
 */
function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case ISSUE_SEVERITY.ERROR:
      return EMOJI.FAILURE;
    case ISSUE_SEVERITY.WARNING:
      return EMOJI.WARNING;
    case ISSUE_SEVERITY.INFO:
      return EMOJI.INFO;
    default:
      return EMOJI.WARNING;
  }
}

/**
 * Get human-readable issue type label
 */
function getIssueTypeLabel(type: string): string {
  switch (type) {
    case ISSUE_TYPES.ORPHANED_WU:
      return 'Orphaned WU';
    case ISSUE_TYPES.DANGLING_SIGNAL:
      return 'Dangling Signal';
    case ISSUE_TYPES.BROKEN_EVENT:
      return 'Broken Event';
    case ISSUE_TYPES.STATUS_MISMATCH:
      return 'Status Mismatch';
    default:
      return type;
  }
}

/**
 * Print summary section
 */
function printSummary(result: StateDiagnosis): void {
  console.log('=== Summary ===');
  console.log(`  Orphaned WUs:      ${result.summary.orphanedWUs}`);
  console.log(`  Dangling Signals:  ${result.summary.danglingSignals}`);
  console.log(`  Broken Events:     ${result.summary.brokenEvents}`);
  console.log(`  Status Mismatches: ${result.summary.statusMismatches}`);
  console.log(`  Total Issues:      ${result.summary.totalIssues}`);
}

/**
 * Print fixed issues section
 */
function printFixedSection(result: StateDiagnosis): void {
  if (result.fixed.length > 0) {
    console.log('\n=== Fixed ===');
    for (const issue of result.fixed) {
      const id = issue.wuId || issue.signalId;
      console.log(`  ${EMOJI.SUCCESS} Fixed: ${getIssueTypeLabel(issue.type)} - ${id}`);
    }
  }

  if (result.fixErrors.length > 0) {
    console.log('\n=== Fix Errors ===');
    for (const err of result.fixErrors) {
      const id = err.wuId || err.signalId;
      console.log(`  ${EMOJI.FAILURE} Failed to fix: ${id} - ${err.error}`);
    }
  }
}

/**
 * Print dry-run section
 */
function printDryRunSection(result: StateDiagnosis): void {
  if (!result.dryRun || !result.wouldFix || result.wouldFix.length === 0) {
    return;
  }
  console.log('\n=== Would Fix (dry-run) ===');
  for (const issue of result.wouldFix) {
    const id = issue.wuId || issue.signalId;
    console.log(`  ${EMOJI.FIX} Would fix: ${getIssueTypeLabel(issue.type)} - ${id}`);
  }
  console.log('\n  To apply fixes, run without --dry-run');
}

/**
 * Print issues list
 */
function printIssues(result: StateDiagnosis): void {
  console.log(`${LOG_PREFIX} ${EMOJI.WARNING} Found ${result.summary.totalIssues} issue(s)\n`);
  console.log('=== Issues ===');
  for (const issue of result.issues) {
    const emoji = getSeverityEmoji(issue.severity);
    const label = getIssueTypeLabel(issue.type);
    console.log(`  ${emoji} [${label}] ${issue.description}`);
    console.log(`     ${EMOJI.FIX} ${issue.suggestion}`);
    if (issue.canAutoFix) {
      console.log(`     ${EMOJI.INFO} Can be auto-fixed with --fix`);
    }
    console.log('');
  }
}

/**
 * Print diagnosis result to console
 */
function printResult(result: StateDiagnosis, quiet: boolean): void {
  if (result.healthy) {
    console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} State is healthy - no issues found`);
    return;
  }

  if (!quiet) {
    printIssues(result);
  }

  printSummary(result);
  printFixedSection(result);
  printDryRunSection(result);

  if (result.issues.length > 0 && result.fixed.length === 0 && !result.dryRun) {
    console.log(`\n  ${EMOJI.INFO} Run with --fix to auto-repair fixable issues`);
  }
}

type AuditStatus = 'failed' | 'success' | 'partial';

/**
 * Determine audit log status from result
 */
function getAuditStatus(error: string | null, result: StateDiagnosis | null): AuditStatus {
  if (error) return 'failed';
  if (result?.healthy) return 'success';
  if (result?.fixErrors.length === 0 && result?.fixed.length > 0) return 'success';
  return 'partial';
}

/**
 * Build audit log output entry
 */
function buildAuditOutput(result: StateDiagnosis | null): Record<string, unknown> | null {
  if (!result) return null;
  return {
    healthy: result.healthy,
    totalIssues: result.summary.totalIssues,
    fixedCount: result.fixed.length,
    fixErrorCount: result.fixErrors.length,
    dryRun: result.dryRun,
  };
}

/**
 * WU-1301: Warn if configured paths don't exist
 * This helps consumers detect misconfiguration early.
 */
function warnMissingPaths(baseDir: string, quiet: boolean): void {
  if (quiet) return;

  const paths = getResolvedPaths({ projectRoot: baseDir });
  const missing: string[] = [];

  if (!existsSync(paths.wuDir)) {
    missing.push(`WU directory: ${paths.wuDir}`);
  }
  if (!existsSync(paths.stampsDir)) {
    missing.push(`Stamps directory: ${paths.stampsDir}`);
  }
  if (!existsSync(paths.stateDir)) {
    missing.push(`State directory: ${paths.stateDir}`);
  }

  if (missing.length > 0) {
    console.warn(`${LOG_PREFIX} ${EMOJI.WARNING} Configured paths not found:`);
    for (const p of missing) {
      console.warn(`  - ${p}`);
    }
    console.warn('  Tip: Run `pnpm setup` or check .lumenflow.config.yaml');
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArguments();
  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // WU-1301: Warn about missing configured paths
  warnMissingPaths(baseDir, args.quiet ?? false);

  let result: StateDiagnosis | null = null;
  let error: string | null = null;

  try {
    // Create base deps for read operations
    const baseDeps = await createDeps(baseDir);

    // WU-1230: When --fix is enabled, use micro-worktree isolation for all
    // tracked file modifications. This prevents direct modifications to main
    // and ensures changes are pushed via merge.
    const deps: StateDoctorDeps =
      args.fix && !args.dryRun
        ? {
            ...baseDeps,
            ...createStateDoctorFixDeps(baseDir),
          }
        : baseDeps;

    result = await diagnoseState(baseDir, deps, {
      fix: args.fix,
      dryRun: args.dryRun,
    });
  } catch (err) {
    error = (err as Error).message;
  }

  const durationMs = Date.now() - startTime;
  const auditStatus = getAuditStatus(error, result);

  await writeAuditLog(baseDir, {
    tool: TOOL_NAME,
    status: auditStatus,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    input: { baseDir, fix: args.fix, dryRun: args.dryRun },
    output: buildAuditOutput(result),
    error: error ? { message: error } : null,
  });

  if (error) {
    console.error(`${LOG_PREFIX} Error: ${error}`);
    process.exit(EXIT_CODES.ERROR);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result?.healthy ? EXIT_CODES.SUCCESS : EXIT_CODES.ERROR);
  }

  if (result) {
    printResult(result, args.quiet ?? false);
    const shouldError = !result.healthy && result.fixed.length === 0;
    if (shouldError) process.exit(EXIT_CODES.ERROR);
  }
}

// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  runCLI(main);
}
