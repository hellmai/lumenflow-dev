#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Agent Session End CLI
 *
 * Ends the current agent session and returns summary.
 *
 * Usage:
 *   pnpm agent:session:end
 */

import { Command } from 'commander';
import { endSession, getCurrentSession } from '@lumenflow/agent';
import { EXIT_CODES } from '@lumenflow/core/wu-constants';
import { ProcessExitError } from '@lumenflow/core/error-handler';
import chalk from 'chalk';
import { runCLI } from './cli-entry-point.js';

const program = new Command()
  .name('agent:session:end')
  .description('End the current agent session')
  .action(async () => {
    try {
      const session = await getCurrentSession();
      if (!session) {
        const message = 'No active session to end.';
        console.error(chalk.yellow(message));
        throw new ProcessExitError(message, EXIT_CODES.SUCCESS);
      }

      const summary = await endSession();

      console.log(chalk.green(`✓ Session ended`));
      console.log(`  WU: ${chalk.cyan(summary.wu_id)}`);
      console.log(`  Lane: ${chalk.cyan(summary.lane)}`);
      console.log(`  Duration: ${chalk.cyan(summary.started)} → ${chalk.cyan(summary.completed)}`);
      console.log(`  Incidents: ${summary.incidents_logged} (${summary.incidents_major} major)`);
    } catch (err: unknown) {
      if (err instanceof ProcessExitError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      throw new ProcessExitError(message, EXIT_CODES.ERROR);
    }
  });

export async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  void runCLI(main);
}
