#!/usr/bin/env node
/**
 * Agent Session Start CLI
 *
 * Starts an agent session for tracking WU execution.
 *
 * Usage:
 *   pnpm agent:session --wu WU-1234 --tier 2
 */

import { Command } from 'commander';
import { startSession, getCurrentSession } from '@lumenflow/agent';
import { EXIT_CODES } from '@lumenflow/core/wu-constants';
import chalk from 'chalk';

const program = new Command()
  .name('agent:session')
  .description('Start an agent session')
  .requiredOption('--wu <id>', 'WU ID to work on (e.g., WU-1234)')
  .requiredOption('--tier <tier>', 'Context tier (1, 2, or 3)')
  .option('--agent-type <type>', 'Agent type', 'claude-code')
  .action(async (opts) => {
    try {
      // Check for existing session
      const existing = await getCurrentSession();
      if (existing) {
        console.error(chalk.red(`Session already active for ${existing.wu_id}`));
        console.error(`Run: pnpm agent:session:end to close it first.`);
        process.exit(EXIT_CODES.ERROR);
      }

      const tier = parseInt(opts.tier, 10);
      if (![1, 2, 3].includes(tier)) {
        console.error(chalk.red('Invalid tier. Must be 1, 2, or 3.'));
        process.exit(EXIT_CODES.ERROR);
      }

      const sessionId = await startSession(opts.wu, tier as 1 | 2 | 3, opts.agentType);

      console.log(chalk.green(`✓ Session started`));
      console.log(`  Session ID: ${chalk.cyan(sessionId.slice(0, 8))}...`);
      console.log(`  WU: ${chalk.cyan(opts.wu)}`);
      console.log(`  Tier: ${chalk.cyan(tier)}`);
      console.log(`  Agent: ${chalk.cyan(opts.agentType)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
