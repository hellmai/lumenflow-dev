#!/usr/bin/env node
/**
 * Agent Log Issue CLI
 *
 * Logs a workflow issue or incident during agent execution.
 *
 * Usage:
 *   pnpm agent:log-issue --category workflow --severity minor --title "..." --description "..."
 */

import { Command } from 'commander';
import { logIncident, getCurrentSession } from '@lumenflow/agent';
import {
  EXIT_CODES,
  INCIDENT_SEVERITY,
  LUMENFLOW_PATHS,
} from '@lumenflow/core/dist/wu-constants.js';
import chalk from 'chalk';

const program = new Command()
  .name('agent:log-issue')
  .description('Log a workflow issue or incident')
  .requiredOption('--category <cat>', 'Issue category (workflow|tooling|confusion|violation|error)')
  .requiredOption('--severity <sev>', 'Severity level (blocker|major|minor|info)')
  .requiredOption('--title <title>', 'Short description (5-100 chars)')
  .requiredOption('--description <desc>', 'Detailed context (10-2000 chars)')
  .option('--resolution <res>', 'How the issue was resolved')
  .option('--tags <tags>', 'Comma-separated tags (e.g., worktree,gates)')
  .option('--step <step>', 'Current workflow step (e.g., wu:done, gates)')
  .option('--files <files>', 'Comma-separated related files')
  .action(async (opts) => {
    try {
      const session = await getCurrentSession();
      if (!session) {
        console.error(chalk.red('Error: No active session'));
        console.error('Run: pnpm agent:session --wu WU-XXX --tier N');
        process.exit(EXIT_CODES.ERROR);
      }

      const incident = {
        category: opts.category,
        severity: opts.severity,
        title: opts.title,
        description: opts.description,
        resolution: opts.resolution,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
        context: {
          current_step: opts.step,
          related_files: opts.files ? opts.files.split(',').map((f: string) => f.trim()) : [],
        },
      };

      await logIncident(incident);

      console.log(chalk.green(`✓ Issue logged`));
      console.log(`  Category: ${chalk.cyan(opts.category)}`);
      console.log(`  Severity: ${chalk.cyan(opts.severity)}`);
      console.log(`  File: ${chalk.gray(`${LUMENFLOW_PATHS.INCIDENTS}/${opts.category}.ndjson`)}`);

      if (
        opts.severity === INCIDENT_SEVERITY.MAJOR ||
        opts.severity === INCIDENT_SEVERITY.BLOCKER
      ) {
        console.log();
        console.log(chalk.yellow('  ⚠  Consider documenting this in your WU notes as well.'));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      if (err.issues) {
        console.error(chalk.red('Validation errors:'));
        err.issues.forEach((issue: any) => {
          console.error(chalk.red(`  - ${issue.path.join('.')}: ${issue.message}`));
        });
      }
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
