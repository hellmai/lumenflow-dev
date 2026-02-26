#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU State Repair Tool (Unified - WU-1826, WU-2240)
 *
 * Layer 2 defense-in-depth: detect and repair WU state inconsistencies.
 *
 * This unified tool consolidates five repair modes:
 * - Consistency mode (default): detect/repair state inconsistencies
 * - Claim mode (--claim): repair missing claim metadata in worktrees
 * - Admin mode (--admin): administrative fixes for done WUs
 * - State mode (--repair-state): repair corrupted wu-events.jsonl (WU-2240)
 * - Duplicate ID mode (--duplicate-ids): detect and repair WU ID collisions (WU-2213)
 *
 * Usage:
 *   # Consistency mode (default)
 *   pnpm wu:repair --id WU-123           # Repair single WU
 *   pnpm wu:repair --id WU-123 --check   # Audit only, no changes
 *   pnpm wu:repair --all                 # Batch repair all WUs
 *   pnpm wu:repair --all --check         # Audit all WUs
 *
 *   # Claim mode
 *   pnpm wu:repair --claim --id WU-123           # Repair claim metadata
 *   pnpm wu:repair --claim --id WU-123 --check   # Check only
 *   pnpm wu:repair --claim --id WU-123 --worktree /path/to/worktree
 *
 *   # Admin mode
 *   pnpm wu:repair --admin --id WU-123 --lane "Operations: Tooling"
 *   pnpm wu:repair --admin --id WU-123 --status cancelled
 *   pnpm wu:repair --admin --id WU-123 --notes "Administrative fix"
 *   pnpm wu:repair --admin --id WU-123 --initiative INIT-001
 *
 *   # State mode (WU-2240)
 *   pnpm wu:repair --repair-state                    # Repair default state file
 *   pnpm wu:repair --repair-state --path /path/to/wu-events.jsonl  # Repair specific file
 *
 *   # Duplicate ID mode (WU-2213)
 *   pnpm wu:repair --duplicate-ids                   # Dry-run: detect collisions
 *   pnpm wu:repair --duplicate-ids --apply           # Apply: remap duplicate IDs
 *
 * Exit codes:
 *   0: Success (no issues or all repaired)
 *   1: Issues detected (--check mode)
 *   2: Repair failed
 *
 * DEPRECATION NOTICE:
 *   - pnpm wu:repair-claim is deprecated. Use: pnpm wu:repair --claim
 *   - pnpm wu:admin-repair is deprecated. Use: pnpm wu:repair --admin
 *
 * @see {@link packages/@lumenflow/cli/src/lib/wu-repair-core.ts} - Core repair logic
 * @see {@link packages/@lumenflow/cli/src/lib/wu-consistency-checker.ts} - Consistency detection/repair
 * @see {@link packages/@lumenflow/cli/src/lib/wu-state-store.ts} - State file repair (repairStateFile)
 */

import { Command } from 'commander';
import path from 'node:path';
import { EXIT_CODES, LOG_PREFIX, PATTERNS } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';
import {
  runConsistencyRepairMode,
  runClaimRepairMode,
  runAdminRepairMode,
  runDuplicateIdsMode,
} from '@lumenflow/core/wu-repair-core';
import { repairStateFile, WU_EVENTS_FILE_NAME } from '@lumenflow/core/wu-state-store';

const PREFIX = LOG_PREFIX.REPAIR;

/** Parsed CLI options for wu:repair */
interface RepairCliOptions {
  id?: string;
  check?: boolean;
  all?: boolean;
  claim?: boolean;
  admin?: boolean;
  repairState?: boolean;
  duplicateIds?: boolean;
  apply?: boolean;
  worktree?: string;
  lane?: string;
  status?: string;
  notes?: string;
  initiative?: string;
  path?: string;
}

/**
 * Normalise WU ID to uppercase with WU- prefix
 * @param {string} id - Raw WU ID
 * @returns {string} Normalised WU ID
 */
function normaliseWUId(id: string | undefined): string | undefined {
  if (!id) return id;
  let normalised = id.toUpperCase();
  if (!normalised.startsWith('WU-')) {
    normalised = `WU-${normalised}`;
  }
  return normalised;
}

/**
 * Validate WU ID format
 * @param {string} id - WU ID to validate
 * @returns {boolean} True if valid
 */
function isValidWUId(id: string): boolean {
  return PATTERNS.WU_ID.test(id);
}

/**
 * Create and configure the CLI program
 */
function createProgram(): RepairCliOptions {
  const program = new Command();

  program
    .name('wu-repair')
    .description(
      'Unified WU repair tool - detect and fix WU state issues\n\n' +
        'Modes:\n' +
        '  (default)        Consistency repair - detect/repair state inconsistencies\n' +
        '  --claim          Claim repair - fix missing claim metadata in worktrees\n' +
        '  --admin          Admin repair - fix done WUs (lane, status, notes, initiative)\n' +
        '  --repair-state   State repair - fix corrupted wu-events.jsonl (WU-2240)\n' +
        '  --duplicate-ids  Detect and repair duplicate WU IDs (WU-2213)',
    )
    // Mode selection flags
    .option('--claim', 'Claim repair mode: fix missing claim metadata in worktrees')
    .option('--admin', 'Admin repair mode: fix done WUs (lane, status, notes, initiative)')
    .option('--repair-state', 'State repair mode: fix corrupted wu-events.jsonl (WU-2240)')
    .option(
      '--duplicate-ids',
      'Duplicate ID repair mode: detect and fix WU ID collisions (WU-2213)',
    )
    // Common flags
    .option('--id <wuId>', 'WU ID to check/repair (e.g., WU-123)')
    .option('--check', 'Audit only, no changes (exits 1 if issues found)')
    // Consistency mode flags
    .option('--all', 'Check/repair all WUs (consistency mode only)')
    // Claim mode flags
    .option('--worktree <path>', 'Override worktree path (claim mode only)')
    // Admin mode flags
    .option('--lane <lane>', 'New lane assignment (admin mode only)')
    .option('--status <status>', 'New status value (admin mode only)')
    .option('--notes <text>', 'Add/update notes (admin mode only)')
    .option('--initiative <ref>', 'New initiative reference (admin mode only)')
    // State repair mode flags
    .option('--path <path>', 'Path to state file to repair (state mode only)')
    // Duplicate ID mode flags
    .option('--apply', 'Apply repairs (duplicate-ids mode; default is dry-run)')
    .parse(process.argv);

  return program.opts() as RepairCliOptions;
}

/**
 * Validate options and exit with error if invalid
 */
function validateOptions(options: RepairCliOptions) {
  // Validate mode selection - only one mode at a time
  const modes = [options.claim, options.admin, options.repairState, options.duplicateIds].filter(
    Boolean,
  );
  if (modes.length > 1) {
    console.error(
      `${PREFIX} Error: Cannot specify multiple modes (--claim, --admin, --repair-state, --duplicate-ids are mutually exclusive)`,
    );
    process.exit(EXIT_CODES.FAILURE);
  }

  // Normalise and validate WU ID if provided
  if (options.id) {
    const normalised = normaliseWUId(options.id);
    options.id = normalised;
    if (normalised && !isValidWUId(normalised)) {
      console.error(`${PREFIX} Error: Invalid WU ID format '${options.id}'`);
      console.error(`${PREFIX} Expected format: WU-123`);
      process.exit(EXIT_CODES.FAILURE);
    }
  }
}

/**
 * Validate mode-specific requirements
 */
function validateModeRequirements(options: RepairCliOptions) {
  if (options.claim && !options.id) {
    console.error(`${PREFIX} Error: --id is required for claim mode`);
    console.error(`${PREFIX} Usage: pnpm wu:repair --claim --id WU-123`);
    process.exit(EXIT_CODES.FAILURE);
  }

  if (options.admin && !options.id) {
    console.error(`${PREFIX} Error: --id is required for admin mode`);
    console.error(
      `${PREFIX} Usage: pnpm wu:repair --admin --id WU-123 --lane "Operations: Tooling"`,
    );
    process.exit(EXIT_CODES.FAILURE);
  }

  // State repair mode has no required options (uses default path if not specified)
  if (options.repairState) {
    return; // No additional validation needed
  }

  // Duplicate ID mode has no required options
  if (options.duplicateIds) {
    return; // No additional validation needed
  }

  if (!options.claim && !options.admin) {
    // Consistency mode requirements
    if (!options.id && !options.all) {
      console.error(`${PREFIX} Error: Must specify either --id <WU-ID> or --all`);
      process.exit(EXIT_CODES.FAILURE);
    }
    if (options.id && options.all) {
      console.error(`${PREFIX} Error: Cannot specify both --id and --all`);
      process.exit(EXIT_CODES.FAILURE);
    }
  }
}

/**
 * Run state file repair mode (WU-2240)
 *
 * @param {object} options - CLI options
 * @param {string} [options.path] - Path to state file (defaults to .lumenflow/state/wu-events.jsonl)
 * @returns {Promise<{success: boolean, exitCode: number}>}
 */
async function runStateRepairMode(options: RepairCliOptions) {
  const config = getConfig({ projectRoot: process.cwd() });
  const defaultPath = path.join(process.cwd(), config.state.stateDir, WU_EVENTS_FILE_NAME);
  const filePath = options.path || defaultPath;

  console.log(`${PREFIX} Repairing state file: ${filePath}`);

  try {
    const result = await repairStateFile(filePath);

    if (result.linesRemoved === 0 && result.linesKept === 0 && result.backupPath === null) {
      // File didn't exist
      console.log(`${PREFIX} File does not exist, nothing to repair`);
      return { success: true, exitCode: EXIT_CODES.SUCCESS };
    }

    console.log(`${PREFIX} Repair complete:`);
    console.log(`${PREFIX}   Lines kept: ${result.linesKept}`);
    console.log(`${PREFIX}   Lines removed: ${result.linesRemoved}`);

    if (result.backupPath) {
      console.log(`${PREFIX}   Backup created: ${result.backupPath}`);
    }

    if (result.warnings.length > 0) {
      console.log(`${PREFIX} Warnings:`);
      for (const warning of result.warnings) {
        console.log(`${PREFIX}   - ${warning}`);
      }
    }

    return { success: true, exitCode: EXIT_CODES.SUCCESS };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${PREFIX} Error repairing state file: ${message}`);
    return { success: false, exitCode: EXIT_CODES.FAILURE };
  }
}

/**
 * Route to appropriate repair mode
 */
async function routeToRepairMode(options: RepairCliOptions) {
  if (options.claim) {
    // id is guaranteed by validateModeRequirements
    return runClaimRepairMode({
      id: options.id as string,
      check: options.check,
      worktree: options.worktree,
    });
  }
  if (options.admin) {
    // id is guaranteed by validateModeRequirements
    return runAdminRepairMode({
      id: options.id as string,
      lane: options.lane,
      status: options.status,
      notes: options.notes,
      initiative: options.initiative,
    });
  }
  if (options.repairState) {
    return runStateRepairMode(options);
  }
  if (options.duplicateIds) {
    return runDuplicateIdsMode({
      apply: options.apply,
    });
  }
  return runConsistencyRepairMode({
    id: options.id,
    all: options.all,
    check: options.check,
  });
}

export async function main() {
  const options = createProgram();

  validateOptions(options);
  validateModeRequirements(options);

  const result = await routeToRepairMode(options);
  process.exit(result.exitCode);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}

// Export for testing
export { normaliseWUId, isValidWUId, runStateRepairMode };
