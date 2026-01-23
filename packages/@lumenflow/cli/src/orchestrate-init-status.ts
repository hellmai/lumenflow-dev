#!/usr/bin/env node
/**
 * Orchestrate Initiative Status CLI
 *
 * Compact status view for initiative orchestration.
 * Shows progress of WUs in an initiative.
 *
 * Usage:
 *   pnpm orchestrate:init-status --initiative INIT-001
 */

import { Command } from 'commander';
import { existsSync, readdirSync } from 'node:fs';
import { loadInitiativeWUs, calculateProgress, formatProgress } from '@lumenflow/initiatives';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/dist/wu-constants.js';
import chalk from 'chalk';

const LOG_PREFIX = '[orchestrate:init-status]';

function getCompletedWUs(wuIds: string[]): Set<string> {
  const completed = new Set<string>();

  if (!existsSync(LUMENFLOW_PATHS.STAMPS_DIR)) {
    return completed;
  }

  const files = readdirSync(LUMENFLOW_PATHS.STAMPS_DIR);
  for (const wuId of wuIds) {
    if (files.includes(`${wuId}.done`)) {
      completed.add(wuId);
    }
  }

  return completed;
}

const program = new Command()
  .name('orchestrate:init-status')
  .description('Show initiative progress status')
  .requiredOption('-i, --initiative <id>', 'Initiative ID (e.g., INIT-001)')
  .action(async (opts) => {
    try {
      console.log(chalk.cyan(`${LOG_PREFIX} Loading initiative ${opts.initiative}...`));

      const { initiative, wus } = loadInitiativeWUs(opts.initiative);

      console.log(chalk.bold(`\nInitiative: ${initiative.id} - ${initiative.title}`));
      console.log('');

      const progress = calculateProgress(wus);
      console.log(chalk.bold('Progress:'));
      console.log(formatProgress(progress));
      console.log('');

      // Show WU status breakdown
      const completed = getCompletedWUs(wus.map((w) => w.id));

      console.log(chalk.bold('WUs:'));
      for (const wu of wus) {
        const status = completed.has(wu.id)
          ? chalk.green('✓ done')
          : wu.doc.status === 'in_progress'
            ? chalk.yellow('⟳ in_progress')
            : wu.doc.status === 'blocked'
              ? chalk.red('⛔ blocked')
              : chalk.gray('○ ready');
        console.log(`  ${wu.id}: ${wu.doc.title} [${status}]`);
      }
    } catch (err: any) {
      console.error(chalk.red(`${LOG_PREFIX} Error: ${err.message}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
