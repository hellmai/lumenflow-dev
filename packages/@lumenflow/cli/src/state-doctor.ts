#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  diagnoseState,
  ISSUE_TYPES,
  ISSUE_SEVERITY,
  type StateDiagnosis,
  type StateDoctorDeps,
  type DiagnosisIssue,
  type MockWU,
  type MockSignal,
  type MockEvent,
} from '@lumenflow/core/state-doctor-core';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { EXIT_CODES, LUMENFLOW_PATHS, WU_STATUS } from '@lumenflow/core/wu-constants';
import {
  getConfig,
  getResolvedPaths,
  getConfigFilePresence,
  WORKSPACE_CONFIG_FILE_NAME,
} from '@lumenflow/core/config';
import { existsSync } from 'node:fs';
import { createStamp } from '@lumenflow/core/stamp-utils';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { createStateDoctorFixDeps } from './state-doctor-fix.js';
import { runCLI } from './cli-entry-point.js';
import { resolveStateDoctorStampIds } from './state-doctor-stamps.js';
import { deriveInitiativeLifecycleStatus } from './initiative-status.js';

/**
 * Log prefix for state:doctor output
 */
const LOG_PREFIX = '[state:doctor]';
const WORKSPACE_INIT_COMMAND = 'pnpm workspace-init --yes';
const INITIATIVE_FILE_GLOB = 'INIT-*.yaml';
const WU_FILE_GLOB = 'WU-*.yaml';
const STATUS_RECONCILIATION_OPERATION_ID = 'reconcile-initiative-status';
const STATUS_RECONCILIATION_COMMIT_MESSAGE =
  'fix(state-doctor): reconcile stale initiative lifecycle statuses';
const INITIATIVE_STATUS_RECONCILIATION_SUGGESTION = 'Run with --fix to reconcile initiative status';

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

interface InitiativeStatusMismatch {
  initiativeId: string;
  relativePath: string;
  currentStatus: string;
  derivedStatus: string;
}

interface InitiativePhaseShape {
  id: number;
  status?: string;
}

interface InitiativeDocShape {
  id?: string;
  slug?: string;
  status?: string;
  phases?: unknown;
}

interface InitiativeProgressContext {
  done: number;
  total: number;
}

interface WUDocShape {
  initiative?: string;
  status?: string;
}

function normalizeLifecycleStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toInitiativePhases(value: unknown): InitiativePhaseShape[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((phase): phase is Record<string, unknown> => phase != null && typeof phase === 'object')
    .flatMap((phase) => {
      if (typeof phase.id !== 'number') {
        return [];
      }
      const status = typeof phase.status === 'string' ? phase.status : undefined;
      return [{ id: phase.id, status }];
    });
}

function createInitiativeStatusMismatchIssue(mismatch: InitiativeStatusMismatch): DiagnosisIssue {
  return {
    type: ISSUE_TYPES.STATUS_MISMATCH,
    severity: ISSUE_SEVERITY.WARNING,
    wuId: mismatch.initiativeId,
    description: `Initiative ${mismatch.initiativeId} metadata status is '${mismatch.currentStatus}' but linked WUs derive '${mismatch.derivedStatus}'`,
    suggestion: INITIATIVE_STATUS_RECONCILIATION_SUGGESTION,
    canAutoFix: true,
    statusMismatch: {
      yamlStatus: mismatch.currentStatus,
      derivedStatus: mismatch.derivedStatus,
    },
  };
}

export async function collectInitiativeLifecycleStatusMismatches(
  baseDir: string,
): Promise<InitiativeStatusMismatch[]> {
  const config = getConfig({ projectRoot: baseDir, strictWorkspace: true });
  const initiativesDir = path.join(baseDir, config.directories.initiativesDir);
  const wuDir = path.join(baseDir, config.directories.wuDir);

  const [initiativeFiles, wuFiles] = await Promise.all([
    fg(INITIATIVE_FILE_GLOB, { cwd: initiativesDir }),
    fg(WU_FILE_GLOB, { cwd: wuDir }),
  ]);

  if (initiativeFiles.length === 0) {
    return [];
  }

  const initiatives: Array<{
    id: string;
    slug: string;
    status: string;
    phases: InitiativePhaseShape[];
    relativePath: string;
  }> = [];

  const initiativeIdByReference = new Map<string, string>();
  const progressByInitiativeId = new Map<string, InitiativeProgressContext>();

  for (const file of initiativeFiles) {
    const relativePath = path.join(config.directories.initiativesDir, file);
    const fullPath = path.join(initiativesDir, file);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const doc = parseYaml(content) as InitiativeDocShape;
      const initiativeId = typeof doc.id === 'string' && doc.id.length > 0 ? doc.id : '';

      if (!initiativeId) {
        continue;
      }

      const slug = typeof doc.slug === 'string' ? doc.slug : '';
      const status = normalizeLifecycleStatus(doc.status);
      const phases = toInitiativePhases(doc.phases);

      initiatives.push({
        id: initiativeId,
        slug,
        status,
        phases,
        relativePath,
      });

      initiativeIdByReference.set(initiativeId, initiativeId);
      if (slug.length > 0) {
        initiativeIdByReference.set(slug, initiativeId);
      }
      progressByInitiativeId.set(initiativeId, { done: 0, total: 0 });
    } catch {
      // Skip malformed initiative YAML files during diagnosis.
    }
  }

  for (const file of wuFiles) {
    const fullPath = path.join(wuDir, file);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const doc = parseYaml(content) as WUDocShape;
      const initiativeRef = typeof doc.initiative === 'string' ? doc.initiative : '';
      if (!initiativeRef) {
        continue;
      }

      const initiativeId = initiativeIdByReference.get(initiativeRef);
      if (!initiativeId) {
        continue;
      }

      const current = progressByInitiativeId.get(initiativeId) || { done: 0, total: 0 };
      current.total += 1;
      if (normalizeLifecycleStatus(doc.status) === WU_STATUS.DONE) {
        current.done += 1;
      }
      progressByInitiativeId.set(initiativeId, current);
    } catch {
      // Skip malformed WU YAML files during diagnosis.
    }
  }

  const mismatches: InitiativeStatusMismatch[] = [];
  for (const initiative of initiatives) {
    if (![WU_STATUS.IN_PROGRESS, WU_STATUS.DONE].includes(initiative.status)) {
      continue;
    }

    const progress = progressByInitiativeId.get(initiative.id);
    const derivedStatus = deriveInitiativeLifecycleStatus(
      initiative.status,
      initiative.phases,
      progress,
    );

    if (derivedStatus !== initiative.status) {
      mismatches.push({
        initiativeId: initiative.id,
        relativePath: initiative.relativePath,
        currentStatus: initiative.status,
        derivedStatus,
      });
    }
  }

  return mismatches;
}

export async function applyInitiativeLifecycleStatusFixes(
  baseDir: string,
  mismatches: InitiativeStatusMismatch[],
): Promise<void> {
  if (mismatches.length === 0) {
    return;
  }

  const uniqueMismatches = Array.from(
    new Map(mismatches.map((mismatch) => [mismatch.relativePath, mismatch])).values(),
  );

  await withMicroWorktree({
    operation: TOOL_NAME,
    id: STATUS_RECONCILIATION_OPERATION_ID,
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    execute: async ({ worktreePath }) => {
      const modifiedFiles: string[] = [];

      for (const mismatch of uniqueMismatches) {
        const initiativePath = path.join(worktreePath, mismatch.relativePath);
        const content = await fs.readFile(initiativePath, 'utf-8');
        const doc = parseYaml(content) as InitiativeDocShape;
        doc.status = mismatch.derivedStatus;
        await fs.writeFile(initiativePath, stringifyYaml(doc), 'utf-8');
        modifiedFiles.push(mismatch.relativePath);
      }

      return {
        commitMessage: STATUS_RECONCILIATION_COMMIT_MESSAGE,
        files: modifiedFiles,
      };
    },
  });
}

function appendInitiativeStatusMismatchIssues(
  result: StateDiagnosis,
  mismatches: InitiativeStatusMismatch[],
): DiagnosisIssue[] {
  if (mismatches.length === 0) {
    return [];
  }

  const issues = mismatches.map((mismatch) => createInitiativeStatusMismatchIssue(mismatch));
  result.issues.push(...issues);
  result.summary.statusMismatches += issues.length;
  result.summary.totalIssues += issues.length;
  result.healthy = false;
  return issues;
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
  const config = getConfig({ projectRoot: baseDir, strictWorkspace: true });

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
        return await resolveStateDoctorStampIds(baseDir, config.state.stampsDir);
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
     * List WU IDs referenced in backlog.md (WU-2229)
     */
    listBacklogRefs: async (): Promise<string[]> => {
      try {
        const backlogPath = path.join(baseDir, config.directories.backlogPath);
        const content = await fs.readFile(backlogPath, 'utf-8');
        const wuIds: string[] = [];
        const pattern = /WU-\d+/g;
        let match: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((match = pattern.exec(content)) !== null) {
          const wuId = match[0].toUpperCase();
          if (!seen.has(wuId)) {
            seen.add(wuId);
            wuIds.push(wuId);
          }
        }
        return wuIds;
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
 * Enforce canonical workspace config before running state-doctor checks.
 *
 * @param baseDir - Target repository directory
 * @throws Error when workspace.yaml is missing
 */
function assertCanonicalWorkspace(baseDir: string): void {
  const { workspaceConfigExists } = getConfigFilePresence(baseDir);
  if (workspaceConfigExists) {
    return;
  }

  throw createError(
    ErrorCodes.WORKSPACE_NOT_FOUND,
    `${LOG_PREFIX} Missing ${WORKSPACE_CONFIG_FILE_NAME}. Run \`${WORKSPACE_INIT_COMMAND}\`.`,
  );
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
    case ISSUE_TYPES.ORPHAN_BACKLOG_REF:
      return 'Orphan Backlog Reference';
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
  console.log(`  Orphan Backlog:    ${result.summary.orphanBacklogRefs}`);
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

  const paths = getResolvedPaths({ projectRoot: baseDir, strictWorkspace: true });
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
    console.warn(
      `  Tip: Run \`${WORKSPACE_INIT_COMMAND}\` and verify ${WORKSPACE_CONFIG_FILE_NAME}`,
    );
  }
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const args = parseArguments();
  const baseDir = args.baseDir || process.cwd();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  let result: StateDiagnosis | null = null;
  let error: string | null = null;

  try {
    // Hard-cut enforcement: require canonical workspace configuration.
    assertCanonicalWorkspace(baseDir);

    // WU-1301: Warn about missing configured paths
    warnMissingPaths(baseDir, args.quiet ?? false);

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

    const initiativeMismatches = await collectInitiativeLifecycleStatusMismatches(baseDir);
    const initiativeIssues = appendInitiativeStatusMismatchIssues(result, initiativeMismatches);

    if (initiativeIssues.length > 0) {
      if (args.fix && args.dryRun) {
        result.dryRun = true;
        const existingWouldFix = result.wouldFix || [];
        result.wouldFix = [...existingWouldFix, ...initiativeIssues];
      } else if (args.fix) {
        try {
          await applyInitiativeLifecycleStatusFixes(baseDir, initiativeMismatches);
          result.fixed.push(...initiativeIssues);
        } catch (fixErr) {
          const message = fixErr instanceof Error ? fixErr.message : String(fixErr);
          for (const issue of initiativeIssues) {
            result.fixErrors.push({
              type: issue.type,
              wuId: issue.wuId,
              signalId: issue.signalId,
              error: message,
            });
          }
        }
      }
    }
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
  void runCLI(main);
}
