#!/usr/bin/env node
/**
 * Agent Log Issue CLI
 *
 * Logs a workflow issue or incident during agent execution.
 *
 * Usage:
 *   pnpm agent:log-issue --category workflow --severity minor --title "..." --description "..."
 *   pnpm agent:log-issue --category tooling --severity major --title "..." --description "..." \
 *     --tag worktree --tag gates --file src/main.ts --file src/utils.ts
 *
 * WU-1182: Uses Commander.js repeatable options pattern for --tag and --file.
 * Use --tag multiple times instead of comma-separated --tags.
 */

import { Command } from 'commander';
import { logIncident, getCurrentSession } from '@lumenflow/agent';
import { EXIT_CODES, INCIDENT_SEVERITY, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import chalk from 'chalk';

/**
 * WU-1182: Collector function for Commander.js repeatable options.
 * Accumulates multiple flag values into an array.
 *
 * Usage: --tag a --tag b → ['a', 'b']
 *
 * This follows Commander.js best practices - use repeatable pattern for
 * multi-value options instead of comma-separated splits.
 *
 * @param value - New value from CLI
 * @param previous - Previously accumulated values
 * @returns Updated array with new value appended
 */
function collectRepeatable(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

const program = new Command()
  .name('agent:log-issue')
  .description('Log a workflow issue or incident')
  .requiredOption('--category <cat>', 'Issue category (workflow|tooling|confusion|violation|error)')
  .requiredOption('--severity <sev>', 'Severity level (blocker|major|minor|info)')
  .requiredOption('--title <title>', 'Short description (5-100 chars)')
  .requiredOption('--description <desc>', 'Detailed context (10-2000 chars)')
  .option('--resolution <res>', 'How the issue was resolved')
  .option('--tag <tag>', 'Tag for categorization (repeatable)', collectRepeatable, [])
  .option('--step <step>', 'Current workflow step (e.g., wu:done, gates)')
  .option('--file <file>', 'Related file path (repeatable)', collectRepeatable, [])
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
        tags: opts.tag,
        context: {
          current_step: opts.step,
          related_files: opts.file,
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
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        issues?: Array<{ path: string[]; message: string }>;
      };
      console.error(chalk.red(`Error: ${error.message ?? 'Unknown error'}`));
      if (error.issues) {
        console.error(chalk.red('Validation errors:'));
        error.issues.forEach((issue) => {
          console.error(chalk.red(`  - ${issue.path.join('.')}: ${issue.message}`));
        });
      }
      process.exit(EXIT_CODES.ERROR);
    }
  });

program.parse();
