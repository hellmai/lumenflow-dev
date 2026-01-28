#!/usr/bin/env node
/**
 * @file validate-backlog-sync.ts
 * @description Validates backlog.md is in sync with WU YAML files (WU-1111)
 *
 * Checks that all WU YAML files are referenced in backlog.md and vice versa.
 * This is the TypeScript replacement for tools/validate-backlog-sync.js.
 *
 * Usage:
 *   validate-backlog-sync              # Validate sync
 *
 * Exit codes:
 *   0 - Backlog is in sync
 *   1 - Sync issues found
 *
 * @see {@link docs/04-operations/tasks/backlog.md} - Backlog file
 */

import { fileURLToPath } from 'node:url';
import {
  validateBacklogSync,
  type BacklogSyncResult,
} from '@lumenflow/core/dist/validators/backlog-sync.js';
import { EMOJI } from '@lumenflow/core/dist/wu-constants.js';

const LOG_PREFIX = '[validate-backlog-sync]';

export type { BacklogSyncResult };
export { validateBacklogSync };

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let cwd = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cwd' || arg === '-C') {
      cwd = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validate-backlog-sync [options]

Validate that backlog.md is in sync with WU YAML files.

Options:
  --cwd, -C DIR  Working directory (default: current directory)
  -h, --help     Show this help message

Examples:
  validate-backlog-sync
`);
      process.exit(0);
    }
  }

  console.log(`${LOG_PREFIX} Validating backlog sync...`);

  const result = await validateBacklogSync({ cwd });

  if (result.errors.length > 0) {
    console.log(`${EMOJI.FAILURE} Sync errors:`);
    result.errors.forEach((e) => console.log(`  ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log(`${EMOJI.WARNING} Warnings:`);
    result.warnings.forEach((w) => console.log(`  ${w}`));
  }

  console.log(
    `${LOG_PREFIX} WU files: ${result.wuCount}, Backlog references: ${result.backlogCount}`,
  );

  if (result.valid) {
    console.log(`${EMOJI.SUCCESS} Backlog is in sync`);
  } else {
    process.exit(1);
  }
}

// Guard main() for testability
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Unexpected error:`, error);
    process.exit(1);
  });
}
