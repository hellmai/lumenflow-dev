#!/usr/bin/env node
/**
 * Orchestrate Monitor CLI
 *
 * Monitors spawned agent progress using mem:inbox signals.
 * Designed to prevent context exhaustion by using compact signal output.
 *
 * Usage:
 *   pnpm orchestrate:monitor --since 30m
 */

import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CODES } from '@lumenflow/core/dist/wu-constants.js';
import chalk from 'chalk';
import ms from 'ms';

const LOG_PREFIX = '[orchestrate:monitor]';
const MEMORY_DIR = '.beacon/memory';

interface Signal {
  timestamp: string;
  type: string;
  wuId?: string;
  message?: string;
}

function parseTimeString(timeStr: string): Date {
  const msValue = ms(timeStr);
  if (typeof msValue === 'number') {
    return new Date(Date.now() - msValue);
  }
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }
  return date;
}

function loadRecentSignals(since: Date): Signal[] {
  const signals: Signal[] = [];

  if (!existsSync(MEMORY_DIR)) {
    return signals;
  }

  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.ndjson'));

  for (const file of files) {
    const filePath = join(MEMORY_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const signal = JSON.parse(line) as Signal;
        const signalTime = new Date(signal.timestamp);
        if (signalTime >= since) {
          signals.push(signal);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return signals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

const program = new Command()
  .name('orchestrate:monitor')
  .description('Monitor spawned agent progress')
  .option('--since <time>', 'Show signals since (e.g., 30m, 1h)', '30m')
  .option('--wu <id>', 'Filter by WU ID')
  .action((opts) => {
    try {
      const since = parseTimeString(opts.since);
      console.log(chalk.cyan(`${LOG_PREFIX} Loading signals since ${since.toISOString()}...`));

      const signals = loadRecentSignals(since);

      if (signals.length === 0) {
        console.log(chalk.yellow(`${LOG_PREFIX} No signals found.`));
        console.log(
          chalk.gray('Agents may still be starting up, or memory layer not initialized.'),
        );
        return;
      }

      const filtered = opts.wu ? signals.filter((s) => s.wuId === opts.wu) : signals;

      console.log(chalk.bold(`\nRecent Signals (${filtered.length}):\n`));

      for (const signal of filtered) {
        const time = new Date(signal.timestamp).toLocaleTimeString();
        const wu = signal.wuId ? chalk.cyan(signal.wuId) : chalk.gray('system');
        const type =
          signal.type === 'complete'
            ? chalk.green(signal.type)
            : signal.type === 'error'
              ? chalk.red(signal.type)
              : chalk.yellow(signal.type);

        console.log(`  ${chalk.gray(time)} [${wu}] ${type}: ${signal.message || ''}`);
      }

      console.log('');
      console.log(chalk.gray(`Use: pnpm mem:inbox --since ${opts.since} for more details`));
    } catch (err: any) {
      console.error(chalk.red(`${LOG_PREFIX} Error: ${err.message}`));
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
