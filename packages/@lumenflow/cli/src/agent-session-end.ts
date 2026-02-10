#!/usr/bin/env node
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
import chalk from 'chalk';

const program = new Command()
  .name('agent:session:end')
  .description('End the current agent session')
  .action(async () => {
    try {
      const session = await getCurrentSession();
      if (!session) {
        console.error(chalk.yellow('No active session to end.'));
        process.exit(EXIT_CODES.SUCCESS);
      }

      const summary = await endSession();

      console.log(chalk.green(`✓ Session ended`));
      console.log(`  WU: ${chalk.cyan(summary.wu_id)}`);
      console.log(`  Lane: ${chalk.cyan(summary.lane)}`);
      console.log(`  Duration: ${chalk.cyan(summary.started)} → ${chalk.cyan(summary.completed)}`);
      console.log(`  Incidents: ${summary.incidents_logged} (${summary.incidents_major} major)`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
