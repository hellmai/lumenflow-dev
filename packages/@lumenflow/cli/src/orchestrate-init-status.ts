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
import {
  loadInitiativeWUs,
  calculateProgress,
  formatProgress,
  getLaneAvailability,
  resolveLaneConfigsFromConfig,
  type LaneAvailabilityResult,
  type LaneConfig,
} from '@lumenflow/initiatives';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';
import chalk from 'chalk';

const LOG_PREFIX = '[orchestrate:init-status]';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

function formatLaneAvailability(
  availability: Record<string, LaneAvailabilityResult>,
  laneConfigs: Record<string, LaneConfig>,
): string {
  const lanes = Object.keys(availability).sort((a, b) => a.localeCompare(b));
  if (lanes.length === 0) {
    return '  (no lanes found)';
  }

  return lanes
    .map((lane) => {
      const entry = availability[lane];
      const wipLimit = laneConfigs[lane]?.wip_limit ?? 1;
      const statusLabel = entry.available ? chalk.green('available') : chalk.red('occupied');
      const occupiedBy = entry.occupiedBy ?? 'none';
      return `  ${lane}: ${statusLabel} (wip_limit=${wipLimit}, lock_policy=${entry.policy}, in_progress=${entry.inProgressCount}, blocked=${entry.blockedCount}, occupied_by=${occupiedBy})`;
    })
    .join('\n');
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
        let status = chalk.gray('○ ready');
        if (completed.has(wu.id)) {
          status = chalk.green('✓ done');
        } else if (wu.doc.status === 'in_progress') {
          status = chalk.yellow('⟳ in_progress');
        } else if (wu.doc.status === 'blocked') {
          status = chalk.red('⛔ blocked');
        }

        console.log(`  ${wu.id}: ${wu.doc.title} [${status}]`);
      }

      const laneConfigs = resolveLaneConfigsFromConfig(getConfig());
      const availability = getLaneAvailability(wus, { laneConfigs });

      console.log('');
      console.log(chalk.bold('Lane Availability:'));
      console.log(formatLaneAvailability(availability, laneConfigs));
    } catch (err) {
      console.error(chalk.red(`${LOG_PREFIX} Error: ${getErrorMessage(err)}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
