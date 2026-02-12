#!/usr/bin/env node

/**
 * Orchestrate Initiative CLI
 *
 * Orchestrate initiative execution with parallel agent spawning.
 * Builds execution plan based on WU dependencies and manages wave-based execution.
 *
 * Usage:
 *   pnpm orchestrate:initiative --initiative INIT-001
 *   pnpm orchestrate:initiative --initiative INIT-001 --dry-run
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadInitiativeWUs,
  loadMultipleInitiatives,
  buildExecutionPlanWithLockPolicy,
  resolveLaneConfigsFromConfig,
  formatExecutionPlan,
  formatExecutionPlanWithEmbeddedSpawns,
  calculateProgress,
  formatProgress,
  buildCheckpointWave,
  formatCheckpointOutput,
  validateCheckpointFlags,
  resolveCheckpointModeAsync,
  LOG_PREFIX,
  type InitiativeDoc,
  type WUEntry,
} from '@lumenflow/initiatives';
import { EXIT_CODES } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const program = new Command()
  .name('orchestrate-initiative')
  .description('Orchestrate initiative execution with parallel agent spawning')
  .option('-i, --initiative <ids...>', 'Initiative ID(s) to orchestrate')
  .option('-d, --dry-run', 'Show execution plan without spawning agents')
  .option('-p, --progress', 'Show current progress only')
  .option('-c, --checkpoint-per-wave', 'Spawn next wave then exit (no polling)')
  .option('--no-checkpoint', 'Force polling mode')
  .action(async (options) => {
    const {
      initiative: initIds,
      dryRun,
      progress: progressOnly,
      checkpointPerWave,
      checkpoint,
    } = options;
    const noCheckpoint = checkpoint === false;

    try {
      validateCheckpointFlags({ checkpointPerWave, dryRun, noCheckpoint });
    } catch (error) {
      console.error(chalk.red(`${LOG_PREFIX} Error: ${getErrorMessage(error)}`));
      process.exit(EXIT_CODES.ERROR);
    }

    if (!initIds || initIds.length === 0) {
      console.error(chalk.red(`${LOG_PREFIX} Error: --initiative is required`));
      console.error('');
      console.error('Usage:');
      console.error('  pnpm orchestrate:initiative --initiative INIT-001');
      console.error('  pnpm orchestrate:initiative --initiative INIT-001 --dry-run');
      process.exit(EXIT_CODES.ERROR);
    }

    try {
      console.log(chalk.cyan(`${LOG_PREFIX} Loading initiative(s): ${initIds.join(', ')}`));

      let wus: WUEntry[];
      let initiative: InitiativeDoc;

      if (initIds.length === 1) {
        const result = loadInitiativeWUs(initIds[0]);
        initiative = result.initiative;
        wus = result.wus;
      } else {
        wus = loadMultipleInitiatives(initIds);
        initiative = { id: 'MULTI', title: `Combined: ${initIds.join(', ')}` };
      }

      console.log(chalk.green(`${LOG_PREFIX} Loaded ${wus.length} WU(s)`));
      console.log('');

      const progress = calculateProgress(wus);
      console.log(chalk.bold('Progress:'));
      console.log(formatProgress(progress));
      console.log('');

      if (progressOnly) {
        return;
      }

      const checkpointDecision = await resolveCheckpointModeAsync(
        { checkpointPerWave, noCheckpoint, dryRun },
        wus,
      );

      if (checkpointDecision.enabled) {
        if (initIds.length > 1) {
          console.error(
            chalk.red(`${LOG_PREFIX} Error: Checkpoint mode only supports single initiative`),
          );
          process.exit(EXIT_CODES.ERROR);
        }

        const waveData = buildCheckpointWave(initIds[0], { dryRun });

        if (!waveData) {
          console.log(chalk.green(`${LOG_PREFIX} All WUs are complete! Nothing to spawn.`));
          return;
        }

        console.log(formatCheckpointOutput({ ...waveData, dryRun }));
        return;
      }

      console.log(chalk.cyan(`${LOG_PREFIX} Building execution plan...`));
      const laneConfigs = resolveLaneConfigsFromConfig(getConfig());
      const plan = buildExecutionPlanWithLockPolicy(wus, { laneConfigs });

      if (plan.waves.length === 0) {
        console.log(chalk.green(`${LOG_PREFIX} All WUs are complete! Nothing to execute.`));
        return;
      }

      console.log('');
      console.log(chalk.bold('Execution Plan:'));
      console.log(formatExecutionPlan(initiative, plan));

      if (dryRun) {
        console.log(chalk.yellow(`${LOG_PREFIX} Dry run mode - no agents spawned`));
        console.log('');
        console.log(chalk.bold('Next Steps (Recommended Defaults):'));
        console.log('');
        console.log(chalk.cyan('  Option 1 (Recommended): Checkpoint-per-wave mode'));
        console.log('    pnpm orchestrate:initiative -i ' + initIds[0] + ' -c');
        console.log('    Best for: Large initiatives, context management, idempotent resumption');
        console.log('');
        console.log(chalk.cyan('  Option 2: Full execution (polling mode)'));
        console.log('    pnpm orchestrate:initiative -i ' + initIds[0]);
        console.log('    Best for: Small initiatives (<4 WUs), quick execution');
        console.log('');
        console.log(chalk.cyan('  Option 3: Manual briefing/delegation per WU'));
        console.log('    pnpm wu:brief --id <WU-ID> --client claude-code');
        console.log(
          '    pnpm wu:delegate --id <WU-ID> --parent-wu <PARENT-WU-ID> --client claude-code',
        );
        console.log('    Best for: Testing, debugging, explicit lineage tracking');
        console.log('');
        console.log(chalk.bold('Monitoring Commands:'));
        console.log('  pnpm mem:inbox --since 10m          # Check for signals from agents');
        console.log('  pnpm orchestrate:init-status -i ' + initIds[0] + '   # Check progress');
        console.log('  pnpm orchestrate:monitor            # Live agent activity');
        return;
      }

      // WU-1202: Output spawn XML for actual execution (not dry-run)
      // formatExecutionPlan only shows the plan structure, not spawn commands
      // formatExecutionPlanWithEmbeddedSpawns includes Task XML for spawning agents
      console.log('');
      console.log(chalk.bold('Spawn Commands:'));
      console.log(formatExecutionPlanWithEmbeddedSpawns(plan));

      console.log(chalk.green(`${LOG_PREFIX} Execution plan output complete.`));
      console.log(chalk.cyan('Copy the spawn XML above to execute agents.'));
    } catch (error) {
      console.error(chalk.red(`${LOG_PREFIX} Error: ${getErrorMessage(error)}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
