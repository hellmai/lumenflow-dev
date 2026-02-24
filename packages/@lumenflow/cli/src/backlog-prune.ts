#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Backlog Prune Command
 *
 * Maintains backlog hygiene by:
 * - Auto-tagging stale WUs (in_progress/ready too long without activity)
 * - Archiving old completed WUs (done for > N days)
 *
 * WU-1106: INIT-003 Phase 3b - Migrate from ExampleApp tools/backlog-prune.ts
 *
 * Usage:
 *   pnpm backlog:prune           # Dry-run mode (shows what would be done)
 *   pnpm backlog:prune --execute # Apply changes
 */

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readWURaw, writeWU, appendNote } from '@lumenflow/core/wu-yaml';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import {} from '@lumenflow/core/error-handler';
import {
  CLI_FLAGS,
  EXIT_CODES,
  EMOJI,
  WU_STATUS,
  STRING_LITERALS,
} from '@lumenflow/core/wu-constants';

/** Log prefix for consistent output */
const LOG_PREFIX = '[backlog-prune]';

/**
 * Default configuration for backlog pruning
 */
export const BACKLOG_PRUNE_DEFAULTS = {
  /** Days without activity before in_progress WU is considered stale */
  staleDaysInProgress: 7,
  /** Days without activity before ready WU is considered stale */
  staleDaysReady: 30,
  /** Days after completion before done WU can be archived */
  archiveDaysDone: 90,
};

/**
 * Arguments for backlog-prune command
 */
export interface BacklogPruneArgs {
  dryRun: boolean;
  staleDaysInProgress: number;
  staleDaysReady: number;
  archiveDaysDone: number;
  help?: boolean;
}

/**
 * Minimal WU information needed for prune analysis
 */
export interface WuPruneInfo {
  id: string;
  status: string;
  title?: string;
  created?: string;
  updated?: string;
  completed?: string;
}

/**
 * Result of WU categorization
 */
export interface PruneCategorization {
  stale: WuPruneInfo[];
  archivable: WuPruneInfo[];
  healthy: WuPruneInfo[];
}

/**
 * Parse command line arguments for backlog-prune
 */
export function parseBacklogPruneArgs(argv: string[]): BacklogPruneArgs {
  const args: BacklogPruneArgs = {
    dryRun: true,
    staleDaysInProgress: BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress,
    staleDaysReady: BACKLOG_PRUNE_DEFAULTS.staleDaysReady,
    archiveDaysDone: BACKLOG_PRUNE_DEFAULTS.archiveDaysDone,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === CLI_FLAGS.EXECUTE) {
      args.dryRun = false;
    } else if (arg === CLI_FLAGS.DRY_RUN) {
      args.dryRun = true;
    } else if (arg === CLI_FLAGS.HELP || arg === CLI_FLAGS.HELP_SHORT) {
      args.help = true;
    } else if (arg === '--stale-days-in-progress' && argv[i + 1]) {
      args.staleDaysInProgress = parseInt(argv[++i], 10);
    } else if (arg === '--stale-days-ready' && argv[i + 1]) {
      args.staleDaysReady = parseInt(argv[++i], 10);
    } else if (arg === '--archive-days' && argv[i + 1]) {
      args.archiveDaysDone = parseInt(argv[++i], 10);
    }
  }

  return args;
}

/**
 * Calculate days since a date string
 * @returns Number of days since date, or null if invalid
 */
export function calculateStaleDays(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Check if a WU is stale based on its status and last activity date
 */
export function isWuStale(
  wu: WuPruneInfo,
  options: { staleDaysInProgress?: number; staleDaysReady?: number },
): boolean {
  const { staleDaysInProgress = BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress } = options;
  const { staleDaysReady = BACKLOG_PRUNE_DEFAULTS.staleDaysReady } = options;

  // Done/blocked WUs are not considered stale
  if (
    wu.status === WU_STATUS.DONE ||
    wu.status === WU_STATUS.COMPLETED ||
    wu.status === WU_STATUS.BLOCKED
  ) {
    return false;
  }

  // Get the relevant date for staleness check
  // Use updated date if available, otherwise fall back to created date
  const lastActivityDate = wu.updated || wu.created;
  const daysSinceActivity = calculateStaleDays(lastActivityDate);

  if (daysSinceActivity === null) return false;

  // Check against threshold based on status
  if (wu.status === WU_STATUS.IN_PROGRESS) {
    return daysSinceActivity > staleDaysInProgress;
  }

  if (
    wu.status === WU_STATUS.READY ||
    wu.status === WU_STATUS.BACKLOG ||
    wu.status === WU_STATUS.TODO
  ) {
    return daysSinceActivity > staleDaysReady;
  }

  return false;
}

/**
 * Check if a WU is archivable (done for more than N days)
 */
export function isWuArchivable(wu: WuPruneInfo, options: { archiveDaysDone?: number }): boolean {
  const { archiveDaysDone = BACKLOG_PRUNE_DEFAULTS.archiveDaysDone } = options;

  // Only done WUs can be archived
  if (wu.status !== WU_STATUS.DONE && wu.status !== WU_STATUS.COMPLETED) {
    return false;
  }

  // Must have a completed date
  if (!wu.completed) {
    return false;
  }

  const daysSinceCompletion = calculateStaleDays(wu.completed);
  if (daysSinceCompletion === null) return false;

  return daysSinceCompletion > archiveDaysDone;
}

/**
 * Categorize WUs into stale, archivable, and healthy
 */
export function categorizeWus(
  wus: WuPruneInfo[],
  options: { staleDaysInProgress: number; staleDaysReady: number; archiveDaysDone: number },
): PruneCategorization {
  const stale: WuPruneInfo[] = [];
  const archivable: WuPruneInfo[] = [];
  const healthy: WuPruneInfo[] = [];

  for (const wu of wus) {
    if (isWuStale(wu, options)) {
      stale.push(wu);
    } else if (isWuArchivable(wu, options)) {
      archivable.push(wu);
    } else {
      healthy.push(wu);
    }
  }

  return { stale, archivable, healthy };
}

/**
 * Load all WU YAML files from the WU directory
 * @internal Exported for testing
 */
export function loadAllWus(): WuPruneInfo[] {
  const wuDir = WU_PATHS.WU_DIR();
  if (!existsSync(wuDir)) {
    return [];
  }

  const files = readdirSync(wuDir).filter((f) => f.endsWith('.yaml'));
  const wus: WuPruneInfo[] = [];

  for (const file of files) {
    const filePath = path.join(wuDir, file);
    try {
      const doc = readWURaw(filePath);
      if (doc && doc.id) {
        wus.push({
          id: doc.id as string,
          status: (doc.status as string) || 'unknown',
          title: doc.title as string | undefined,
          created: doc.created as string | undefined,
          updated: doc.updated as string | undefined,
          completed: doc.completed as string | undefined,
        });
      }
    } catch {
      // Skip invalid YAML files
    }
  }

  return wus;
}

/**
 * Tag a stale WU by appending a note
 * @internal Exported for testing
 */
export function tagStaleWu(wu: WuPruneInfo, dryRun: boolean): void {
  const wuPath = WU_PATHS.WU(wu.id);
  const today = new Date().toISOString().split('T')[0];
  const note = `[${today}] Auto-tagged as stale by backlog:prune`;

  if (dryRun) {
    console.log(`${LOG_PREFIX} ${EMOJI.INFO} Would tag ${wu.id} as stale`);
    return;
  }

  try {
    const doc = readWURaw(wuPath);
    appendNote(doc, note);
    writeWU(wuPath, doc);
    console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} Tagged ${wu.id} as stale`);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} ${EMOJI.FAILURE} Failed to tag ${wu.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Print help text
 * @internal Exported for testing
 */
export function printHelp(): void {
  console.log(`
${LOG_PREFIX} Backlog Prune - Maintain backlog hygiene

Usage:
  pnpm backlog:prune           # Dry-run mode (default, shows what would be done)
  pnpm backlog:prune --execute # Apply changes

Options:
  --execute                    Execute changes (default is dry-run)
  --dry-run                    Show what would be done without making changes
  --stale-days-in-progress N   Days before in_progress WU is stale (default: ${BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress})
  --stale-days-ready N         Days before ready WU is stale (default: ${BACKLOG_PRUNE_DEFAULTS.staleDaysReady})
  --archive-days N             Days after completion before archiving (default: ${BACKLOG_PRUNE_DEFAULTS.archiveDaysDone})
  --help, -h                   Show this help message

This tool:
  ${EMOJI.SUCCESS} Identifies stale WUs (in_progress/ready too long without activity)
  ${EMOJI.SUCCESS} Identifies archivable WUs (completed > N days ago)
  ${EMOJI.SUCCESS} Auto-tags stale WUs with timestamped notes
  ${EMOJI.SUCCESS} Safe to run regularly (dry-run by default)
`);
}

/**
 * Main function
 */
export async function main(): Promise<void> {
  const args = parseBacklogPruneArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  console.log(`${LOG_PREFIX} Backlog Hygiene Check`);
  console.log(`${LOG_PREFIX} =====================${STRING_LITERALS.NEWLINE}`);

  if (args.dryRun) {
    console.log(
      `${LOG_PREFIX} ${EMOJI.INFO} DRY-RUN MODE (use --execute to apply changes)${STRING_LITERALS.NEWLINE}`,
    );
  }

  // Load all WUs
  const wus = loadAllWus();
  console.log(`${LOG_PREFIX} Found ${wus.length} WU(s)${STRING_LITERALS.NEWLINE}`);

  if (wus.length === 0) {
    console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} No WUs to analyze`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Categorize WUs
  const categorization = categorizeWus(wus, {
    staleDaysInProgress: args.staleDaysInProgress,
    staleDaysReady: args.staleDaysReady,
    archiveDaysDone: args.archiveDaysDone,
  });

  // Report stale WUs
  if (categorization.stale.length > 0) {
    console.log(`${LOG_PREFIX} ${EMOJI.WARNING} Stale WUs (${categorization.stale.length}):`);
    for (const wu of categorization.stale) {
      const lastActivity = wu.updated || wu.created;
      const days = calculateStaleDays(lastActivity);
      console.log(
        `    - ${wu.id}: ${wu.title || 'Untitled'} (${wu.status}, ${days} days since activity)`,
      );
      tagStaleWu(wu, args.dryRun);
    }
    console.log('');
  }

  // Report archivable WUs
  if (categorization.archivable.length > 0) {
    console.log(
      `${LOG_PREFIX} ${EMOJI.INFO} Archivable WUs (${categorization.archivable.length}):`,
    );
    for (const wu of categorization.archivable) {
      const days = calculateStaleDays(wu.completed);
      console.log(`    - ${wu.id}: ${wu.title || 'Untitled'} (completed ${days} days ago)`);
    }
    console.log(
      `${LOG_PREFIX} ${EMOJI.INFO} Archive functionality not yet implemented. Consider manual cleanup.`,
    );
    console.log('');
  }

  // Summary
  console.log(`${LOG_PREFIX} Summary`);
  console.log(`${LOG_PREFIX} ========`);
  console.log(`${LOG_PREFIX} Total WUs: ${wus.length}`);
  console.log(`${LOG_PREFIX} Stale: ${categorization.stale.length}`);
  console.log(`${LOG_PREFIX} Archivable: ${categorization.archivable.length}`);
  console.log(`${LOG_PREFIX} Healthy: ${categorization.healthy.length}`);

  if (categorization.stale.length === 0 && categorization.archivable.length === 0) {
    console.log(`${STRING_LITERALS.NEWLINE}${LOG_PREFIX} ${EMOJI.SUCCESS} Backlog is healthy!`);
  } else if (args.dryRun) {
    console.log(
      `${STRING_LITERALS.NEWLINE}${LOG_PREFIX} ${EMOJI.INFO} This was a dry-run. Use --execute to apply changes.`,
    );
  }

  process.exit(EXIT_CODES.SUCCESS);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
