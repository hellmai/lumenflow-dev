#!/usr/bin/env node
/**
 * Agent Issues Query CLI (WU-1018)
 *
 * Query and display logged agent incidents/issues.
 *
 * Usage:
 *   pnpm agent:issues-query summary                 # Summary of last 7 days
 *   pnpm agent:issues-query summary --since 30     # Summary of last 30 days
 *   pnpm agent:issues-query summary --category tooling
 *   pnpm agent:issues-query summary --severity blocker
 *
 * @module agent-issues-query
 * @see {@link @lumenflow/agent}
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { die } from '@lumenflow/core/error-handler';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[agent:issues-query]';

/** Default days to query */
const DEFAULT_SINCE_DAYS = 7;

/** Issues log file path - under base .lumenflow directory */
const ISSUES_LOG_PATH = `${LUMENFLOW_PATHS.BASE}/agent-issues.ndjson`;

/** Valid severity levels */
const SEVERITY_LEVELS = ['blocker', 'major', 'minor', 'trivial'] as const;
type Severity = (typeof SEVERITY_LEVELS)[number];

/** Issue record structure */
interface IssueRecord {
  timestamp: string;
  wuId?: string;
  sessionId?: string;
  category: string;
  severity: Severity;
  title: string;
  description?: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { since: number; category?: string; severity?: string } {
  const program = new Command()
    .name('agent-issues-query')
    .description('Query and display logged agent incidents')
    .command('summary', { isDefault: true })
    .description('Show summary of logged issues')
    .option(
      '--since <days>',
      `Days to include (default: ${DEFAULT_SINCE_DAYS})`,
      String(DEFAULT_SINCE_DAYS),
    )
    .option('--category <category>', 'Filter by category')
    .option('--severity <severity>', `Filter by severity: ${SEVERITY_LEVELS.join(', ')}`)
    .exitOverride();

  try {
    program.parse(process.argv);
    const opts = program.opts();
    return {
      since: parseInt(opts.since, 10),
      category: opts.category,
      severity: opts.severity,
    };
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exit(0);
    }
    throw err;
  }
}

/**
 * Read issues from NDJSON log file
 */
async function readIssues(
  baseDir: string,
  sinceDate: Date,
  category?: string,
  severity?: string,
): Promise<IssueRecord[]> {
  const logPath = join(baseDir, ISSUES_LOG_PATH);

  if (!existsSync(logPath)) {
    return [];
  }

  const content = await readFile(logPath, { encoding: 'utf-8' });
  const lines = content.split('\n').filter((line) => line.trim());
  const issues: IssueRecord[] = [];

  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;

      // Validate required fields
      if (
        typeof raw.timestamp !== 'string' ||
        typeof raw.category !== 'string' ||
        typeof raw.severity !== 'string' ||
        typeof raw.title !== 'string'
      ) {
        continue;
      }

      const issue: IssueRecord = {
        timestamp: raw.timestamp,
        wuId: raw.wu_id as string | undefined,
        sessionId: raw.session_id as string | undefined,
        category: raw.category,
        severity: raw.severity as Severity,
        title: raw.title,
        description: raw.description as string | undefined,
        stackTrace: raw.stack_trace as string | undefined,
        metadata: raw.metadata as Record<string, unknown> | undefined,
      };

      // Filter by date
      const issueDate = new Date(issue.timestamp);
      if (issueDate < sinceDate) {
        continue;
      }

      // Filter by category
      if (category && issue.category.toLowerCase() !== category.toLowerCase()) {
        continue;
      }

      // Filter by severity
      if (severity && issue.severity.toLowerCase() !== severity.toLowerCase()) {
        continue;
      }

      issues.push(issue);
    } catch {
      // Skip invalid JSON lines
    }
  }

  return issues;
}

/**
 * Group issues by a key
 */
function groupBy<T, K extends keyof T>(items: T[], key: K): Map<T[K], T[]> {
  const groups = new Map<T[K], T[]>();

  for (const item of items) {
    const groupKey = item[key];
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(item);
  }

  return groups;
}

/**
 * Get severity color function
 */
function getSeverityColor(severity: Severity): (text: string) => string {
  switch (severity) {
    case 'blocker':
      return chalk.red.bold;
    case 'major':
      return chalk.yellow;
    case 'minor':
      return chalk.blue;
    case 'trivial':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

/**
 * Format severity badge
 */
function formatSeverityBadge(severity: Severity): string {
  const color = getSeverityColor(severity);
  return color(`[${severity.toUpperCase()}]`);
}

/**
 * Display summary of issues
 */
function displaySummary(issues: IssueRecord[], sinceDays: number): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  AGENT ISSUES SUMMARY (last ${sinceDays} days)`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (issues.length === 0) {
    console.log('  No issues found in the specified time range.');
    console.log('');
    return;
  }

  console.log(`  Total issues: ${issues.length}`);
  console.log('');

  // Group by severity
  const bySeverity = groupBy(issues, 'severity');
  console.log('  By Severity:');
  for (const severity of SEVERITY_LEVELS) {
    const count = bySeverity.get(severity)?.length ?? 0;
    if (count > 0) {
      const color = getSeverityColor(severity);
      console.log(`    ${color(severity.toUpperCase().padEnd(10))} ${count}`);
    }
  }
  console.log('');

  // Group by category
  const byCategory = groupBy(issues, 'category');
  console.log('  By Category:');
  for (const [category, categoryIssues] of byCategory.entries()) {
    const severityCounts = SEVERITY_LEVELS.map((s) => {
      const count = categoryIssues.filter((i) => i.severity === s).length;
      return count > 0 ? `${s[0].toUpperCase()}:${count}` : '';
    })
      .filter(Boolean)
      .join(' ');
    console.log(
      `    ${String(category).padEnd(20)} ${categoryIssues.length} issues (${severityCounts})`,
    );
  }
  console.log('');

  // Top 5 most common issues
  const issueCount = new Map<string, number>();
  for (const issue of issues) {
    const key = `${issue.category}:${issue.title}`;
    issueCount.set(key, (issueCount.get(key) ?? 0) + 1);
  }

  const topIssues = Array.from(issueCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topIssues.length > 0) {
    console.log('  Top 5 Most Common:');
    for (const [key, count] of topIssues) {
      const [category, title] = key.split(':');
      const truncatedTitle = title.length > 40 ? title.slice(0, 37) + '...' : title;
      console.log(`    ${count}x  [${category}] ${truncatedTitle}`);
    }
    console.log('');
  }

  // Recent issues (last 5)
  const recentIssues = [...issues]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  console.log('  Recent Issues:');
  for (const issue of recentIssues) {
    const date = new Date(issue.timestamp).toISOString().split('T')[0];
    const badge = formatSeverityBadge(issue.severity);
    const wuInfo = issue.wuId ? ` (${issue.wuId})` : '';
    const truncatedTitle = issue.title.length > 40 ? issue.title.slice(0, 37) + '...' : issue.title;
    console.log(`    ${date} ${badge} ${truncatedTitle}${wuInfo}`);
  }
  console.log('');
}

/**
 * Main function
 */
async function main() {
  const opts = parseArgs();
  const baseDir = process.cwd();

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - opts.since);
  sinceDate.setHours(0, 0, 0, 0);

  console.log(`${LOG_PREFIX} Querying issues since ${sinceDate.toISOString().split('T')[0]}`);

  if (opts.category) {
    console.log(`${LOG_PREFIX} Category filter: ${opts.category}`);
  }

  if (opts.severity) {
    if (!SEVERITY_LEVELS.includes(opts.severity as Severity)) {
      die(`Invalid severity: ${opts.severity}\n\nValid values: ${SEVERITY_LEVELS.join(', ')}`);
    }
    console.log(`${LOG_PREFIX} Severity filter: ${opts.severity}`);
  }

  const issues = await readIssues(baseDir, sinceDate, opts.category, opts.severity);

  displaySummary(issues, opts.since);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
