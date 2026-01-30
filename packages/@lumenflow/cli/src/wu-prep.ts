#!/usr/bin/env node
/**
 * WU Prep Helper (WU-1223)
 *
 * Prepares a WU for completion by running gates and generating docs in the worktree.
 * After successful prep, prints copy-paste instruction to run wu:done from main.
 *
 * Workflow:
 * 1. Verify we're in a worktree (error if in main checkout)
 * 2. Run gates in the worktree
 * 3. Generate docs (if applicable)
 * 4. Print copy-paste instruction for wu:done from main
 *
 * Usage:
 *   pnpm wu:prep --id WU-XXX [--docs-only]
 *
 * @module
 */

import path from 'node:path';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { resolveLocation } from '@lumenflow/core/dist/context/location-resolver.js';
import { readWU } from '@lumenflow/core/dist/wu-yaml.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import {
  CONTEXT_VALIDATION,
  PATTERNS,
  LOG_PREFIX,
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
 * Print success message with copy-paste instruction.
 */
function printSuccessMessage(wuId: string, mainCheckout: string): void {
  console.log('');
  console.log(`${PREP_PREFIX} ${EMOJI.SUCCESS} WU-1223: Prep completed successfully!`);
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

  // Run gates in the worktree
  console.log(`${PREP_PREFIX} Running gates in worktree...`);
  const gatesResult = await runGates({
    cwd: location.cwd,
    docsOnly: args.docsOnly,
  });

  if (!gatesResult) {
    die(
      `${EMOJI.FAILURE} Gates failed in worktree.\n\n` +
        `Fix the gate failures and run wu:prep again.`,
    );
  }

  // Success - print copy-paste instruction
  printSuccessMessage(id, location.mainCheckout);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(EXIT_CODES.ERROR);
});
