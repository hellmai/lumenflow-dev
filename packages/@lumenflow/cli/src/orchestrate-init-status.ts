#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
  analyseScopeShape,
  formatScopeAdvisory,
  type LaneAvailabilityResult,
  type LaneConfig,
} from '@lumenflow/initiatives';
import { EXIT_CODES, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { getConfig } from '@lumenflow/core/config';
import { getErrorMessage, ProcessExitError } from '@lumenflow/core/error-handler';
import chalk from 'chalk';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[orchestrate:init-status]';

function normalizeLifecycleStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasIncompletePhase(phases: unknown): boolean {
  if (!Array.isArray(phases) || phases.length === 0) {
    return false;
  }
  return phases.some((phase) => {
    if (phase === null || typeof phase !== 'object') {
      return true;
    }
    const status = normalizeLifecycleStatus((phase as { status?: unknown }).status);
    return status !== 'done';
  });
}

function deriveInitiativeLifecycleStatus(status: unknown, phases: unknown): string {
  const normalizedStatus = normalizeLifecycleStatus(status);
  if (normalizedStatus === 'done' && hasIncompletePhase(phases)) {
    return 'in_progress';
  }
  return normalizedStatus || 'in_progress';
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
      const lifecycleStatus = deriveInitiativeLifecycleStatus(initiative.status, initiative.phases);
      const rawStatus = normalizeLifecycleStatus(initiative.status);

      console.log(chalk.bold(`\nInitiative: ${initiative.id} - ${initiative.title}`));
      console.log(chalk.bold(`Lifecycle Status: ${lifecycleStatus}`));
      if (rawStatus && rawStatus !== lifecycleStatus) {
        console.log(
          chalk.yellow(
            `Lifecycle mismatch: metadata status '${initiative.status}' conflicts with phase state; reporting '${lifecycleStatus}'.`,
          ),
        );
      }
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

      // WU-2155: Scope advisory analysis
      const scopeResult = analyseScopeShape(wus);
      const scopeOutput = formatScopeAdvisory(scopeResult);
      if (scopeOutput) {
        console.log('');
        console.log(chalk.bold('Scope Advisory:'));
        console.log(chalk.yellow(scopeOutput));
      }

      const laneConfigs = resolveLaneConfigsFromConfig(getConfig());
      const availability = getLaneAvailability(wus, { laneConfigs });

      console.log('');
      console.log(chalk.bold('Lane Availability:'));
      console.log(formatLaneAvailability(availability, laneConfigs));
    } catch (err) {
      if (err instanceof ProcessExitError) {
        throw err;
      }
      const message = `${LOG_PREFIX} Error: ${getErrorMessage(err)}`;
      console.error(chalk.red(message));
      throw new ProcessExitError(message, EXIT_CODES.ERROR);
    }
  });

export async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

if (import.meta.main) {
  void runCLI(main);
}
