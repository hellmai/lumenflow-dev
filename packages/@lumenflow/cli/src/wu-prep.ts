#!/usr/bin/env node
 
/**
 * WU Prep Helper (WU-1223)
 *
 * Prepares a WU for completion by running gates and generating docs in the worktree.
 * After successful prep, prints copy-paste instruction to run wu:done from main.
 *
 * WU-1344: When gates fail on spec:linter due to pre-existing WU validation errors
 * (not caused by the current WU), prints a ready-to-copy wu:done --skip-gates
 * command with reason and fix-wu placeholders.
 *
 * Workflow:
 * 1. Verify we're in a worktree (error if in main checkout)
 * 2. Run gates in the worktree
 * 3. If gates fail, check if failures are pre-existing on main
 * 4. If pre-existing, print skip-gates command; otherwise, print fix guidance
 * 5. On success, print copy-paste instruction for wu:done from main
 *
 * Usage:
 *   pnpm wu:prep --id WU-XXX [--docs-only]
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { resolveLocation } from '@lumenflow/core/dist/context/location-resolver.js';
import { readWU } from '@lumenflow/core/dist/wu-yaml.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import {
  CONTEXT_VALIDATION,
  PATTERNS,
  EXIT_CODES,
  WU_STATUS,
  EMOJI,
} from '@lumenflow/core/dist/wu-constants.js';
import { runGates } from './gates.js';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;

/**
 * Log prefix for wu:prep command output.
 */
const PREP_PREFIX = '[wu-prep]';

/**
 * GATES_OPTIONS for wu:prep command.
 * Subset of gates options relevant for prep.
 */
const PREP_OPTIONS = {
  docsOnly: {
    name: 'docsOnly',
    flags: '--docs-only',
    description: 'Run docs-only gates (format, spec-linter)',
  },
};

/**
 * WU-1344: Check if a gate name is the spec:linter gate.
 * Used to identify when spec:linter fails so we can check for pre-existing failures.
 *
 * @param gateName - Name of the gate that failed
 * @returns true if this is the spec:linter gate
 */
export function isPreExistingSpecLinterFailure(gateName: string): boolean {
  const normalizedName = gateName.toLowerCase().replace(/[:-]/g, '');
  return normalizedName === 'speclinter';
}

/**
 * WU-1344: Format a skip-gates command for wu:done.
 * Includes --reason and --fix-wu placeholders.
 *
 * @param options - Configuration options
 * @param options.wuId - The WU ID being completed
 * @param options.mainCheckout - Path to main checkout
 * @returns Formatted command string ready to copy-paste
 */
export function formatSkipGatesCommand(options: { wuId: string; mainCheckout: string }): string {
  const { wuId, mainCheckout } = options;
  return `cd ${mainCheckout} && pnpm wu:done --id ${wuId} --skip-gates --reason "pre-existing on main" --fix-wu WU-XXXX`;
}

/**
 * WU-1344: Result of checking for pre-existing failures on main.
 */
export type PreExistingCheckResult = {
  hasPreExisting: boolean;
  error?: string;
};

/**
 * WU-1344: Type for the exec function used to run commands on main.
 */
export type ExecOnMainFn = (cmd: string) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

/**
 * WU-1344: Default implementation of execOnMain using spawnSync.
 * Uses spawnSync with pnpm executable for safety (no shell injection risk).
 */
function defaultExecOnMain(mainCheckout: string): ExecOnMainFn {
  return async (cmd: string) => {
    // Parse command to extract pnpm script name and args
    // Expected format: "pnpm spec:linter" or similar
    const parts = cmd.split(/\s+/);
    const executable = parts[0];
    const args = parts.slice(1);

    const result = spawnSync(executable, args, {
      cwd: mainCheckout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}

/**
 * WU-1344: Check if spec:linter failures are pre-existing on main branch.
 *
 * Runs spec:linter on the main checkout to determine if the failures
 * already exist there (i.e., not caused by the current WU).
 *
 * @param options - Configuration options
 * @param options.mainCheckout - Path to main checkout
 * @param options.execOnMain - Optional function to execute commands on main (for testing)
 * @returns Result indicating whether failures are pre-existing
 */
export async function checkPreExistingFailures(options: {
  mainCheckout: string;
  execOnMain?: ExecOnMainFn;
}): Promise<PreExistingCheckResult> {
  const { mainCheckout, execOnMain = defaultExecOnMain(mainCheckout) } = options;

  try {
    // Run spec:linter on main checkout
    const result = await execOnMain('pnpm spec:linter');

    // If spec:linter fails on main, the failures are pre-existing
    if (result.exitCode !== 0) {
      return { hasPreExisting: true };
    }

    return { hasPreExisting: false };
  } catch (error) {
    // If we can't check main, assume failures are NOT pre-existing
    // (safer to require fixing rather than skipping)
    return {
      hasPreExisting: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Print success message with copy-paste instruction.
 */
function printSuccessMessage(wuId: string, mainCheckout: string): void {
  console.log('');
  console.log(`${PREP_PREFIX} ${EMOJI.SUCCESS} ${wuId}: Prep completed successfully!`);
  console.log('');
  console.log(`${PREP_PREFIX} Gates passed in worktree.`);
  console.log('');
  console.log(`${PREP_PREFIX} Next step - copy and paste this command:`);
  console.log('');
  console.log(`    cd ${mainCheckout} && pnpm wu:done --id ${wuId}`);
  console.log('');
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Parse arguments
  const args = createWUParser({
    name: 'wu-prep',
    description: 'Prepare WU for completion (run gates in worktree)',
    options: [WU_OPTIONS.id, PREP_OPTIONS.docsOnly],
    required: ['id'],
    allowPositionalId: true,
  });

  const id = args.id.toUpperCase();
  if (!PATTERNS.WU_ID.test(id)) {
    die(`Invalid WU id '${args.id}'. Expected format WU-123`);
  }

  // Detect location
  const location = await resolveLocation();

  // WU-1223: wu:prep MUST be run from worktree, not main
  if (location.type !== LOCATION_TYPES.WORKTREE) {
    die(
      `${EMOJI.FAILURE} wu:prep must be run from a worktree, not ${location.type}.\n\n` +
        `Current location: ${location.cwd}\n\n` +
        `If you have a worktree for ${id}, navigate to it first:\n` +
        `  cd worktrees/<lane>-${id.toLowerCase()}\n\n` +
        `If you don't have a worktree yet, claim the WU first:\n` +
        `  pnpm wu:claim --id ${id} --lane "<lane>"`,
    );
  }

  // Verify the worktree is for the correct WU
  if (location.worktreeWuId && location.worktreeWuId !== id) {
    console.warn(
      `${PREP_PREFIX} ${EMOJI.WARNING} Worktree is for ${location.worktreeWuId}, but you specified ${id}.`,
    );
    console.warn(`${PREP_PREFIX} Proceeding with ${id} as specified.`);
  }

  // Read WU YAML to validate it exists and check status
  const wuPath = WU_PATHS.WU(id);
  let doc;
  try {
    doc = readWU(wuPath, id);
  } catch (error) {
    die(
      `Failed to read WU ${id}: ${(error as Error).message}\n\n` +
        `Options:\n` +
        `  1. Check if WU file exists: ls -la ${wuPath}\n` +
        `  2. Validate YAML syntax: pnpm wu:validate --id ${id}`,
    );
  }

  // Validate WU status is in_progress
  if (doc.status !== WU_STATUS.IN_PROGRESS) {
    die(
      `${EMOJI.FAILURE} WU ${id} status is '${doc.status}', expected '${WU_STATUS.IN_PROGRESS}'.\n\n` +
        `wu:prep can only be run on WUs that are in progress.`,
    );
  }

  console.log(`${PREP_PREFIX} Preparing ${id} for completion...`);
  console.log(`${PREP_PREFIX} Location: ${location.cwd}`);
  console.log(`${PREP_PREFIX} Main checkout: ${location.mainCheckout}`);
  console.log('');

  // WU-1344: Check for pre-existing spec:linter failures on main BEFORE running gates.
  // We do this first because runGates() calls die() on failure, which exits the process
  // before we can check. By checking first, we can set up an exit handler to show
  // the skip-gates command if gates fail.
  console.log(`${PREP_PREFIX} Checking for pre-existing spec:linter failures on main...`);
  const preExistingCheck = await checkPreExistingFailures({
    mainCheckout: location.mainCheckout,
  });

  if (preExistingCheck.hasPreExisting) {
    console.log(`${PREP_PREFIX} ${EMOJI.WARNING} Pre-existing failures detected on main.`);

    // Set up an exit handler to print the skip-gates command when gates fail
    // This runs before process.exit() fully terminates the process
    process.on('exit', (code) => {
      if (code !== EXIT_CODES.SUCCESS) {
        console.log('');
        console.log(
          `${PREP_PREFIX} ${EMOJI.WARNING} Since failures are pre-existing on main, you can skip gates:`,
        );
        console.log('');
        console.log(
          `    ${formatSkipGatesCommand({ wuId: id, mainCheckout: location.mainCheckout })}`,
        );
        console.log('');
        console.log(`${PREP_PREFIX} Replace WU-XXXX with the WU that will fix these spec issues.`);
        console.log('');
      }
    });
  } else {
    console.log(`${PREP_PREFIX} No pre-existing failures on main.`);
  }

  console.log('');

  // Run gates in the worktree
  console.log(`${PREP_PREFIX} Running gates in worktree...`);
  const gatesResult = await runGates({
    cwd: location.cwd,
    docsOnly: args.docsOnly,
  });

  if (!gatesResult) {
    // Gates failed - if pre-existing check was already done and showed failures,
    // the exit handler above will print the skip-gates command.
    // Otherwise, tell the user to fix the failures.
    if (!preExistingCheck.hasPreExisting) {
      die(
        `${EMOJI.FAILURE} Gates failed in worktree.\n\n` +
          `Fix the gate failures and run wu:prep again.`,
      );
    }
    // Pre-existing failures - exit with error, handler will print skip-gates command
    process.exit(EXIT_CODES.ERROR);
  }

  // Success - print copy-paste instruction
  printSuccessMessage(id, location.mainCheckout);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
