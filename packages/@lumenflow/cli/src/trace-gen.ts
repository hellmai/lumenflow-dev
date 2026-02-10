#!/usr/bin/env node
/**
 * Trace Generator CLI Command
 *
 * Creates traceability reports linking WUs to code changes.
 * Useful for audit trails, compliance documentation, and understanding
 * what code was changed as part of each WU.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 * WU-1534: Harden CLI command execution surfaces - argv-based git invocations
 *
 * Usage:
 *   pnpm trace:gen --wu WU-1112
 *   pnpm trace:gen --since 2024-01-01 --format json
 *   pnpm trace:gen --format markdown --output trace.md
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { EXIT_CODES, FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[trace:gen]';

/**
 * Regex for validating WU IDs.
 * Valid format: WU-<digits> (e.g., WU-1112, WU-1, WU-99999)
 */
const WU_ID_PATTERN = /^WU-\d+$/;

/**
 * Output formats for trace report
 */
export enum TraceFormat {
  JSON = 'json',
  MARKDOWN = 'markdown',
  CSV = 'csv',
}

/**
 * Arguments for trace-gen command
 */
export interface TraceArgs {
  /** Specific WU ID to trace */
  wuId?: string;
  /** Output format */
  format?: TraceFormat | string;
  /** Output file path */
  output?: string;
  /** Since date (ISO format) */
  since?: string;
  /** Show help */
  help?: boolean;
}

/**
 * Commit information
 */
export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
}

/**
 * Input data for building trace entry
 */
export interface TraceInput {
  wuId: string;
  title: string;
  status: string;
  commits: CommitInfo[];
  files: string[];
}

/**
 * Trace entry for a WU
 */
export interface TraceEntry {
  wuId: string;
  title: string;
  status: string;
  commitCount: number;
  fileCount: number;
  firstCommit?: string;
  lastCommit?: string;
  commits?: CommitInfo[];
  files?: string[];
}

/**
 * Validate a WU ID to ensure it matches the expected format.
 *
 * WU-1534: Input validation layer (defense-in-depth alongside argv-based execution).
 *
 * @param wuId - WU ID to validate
 * @returns true if the WU ID matches the WU-<digits> pattern
 */
export function validateWuId(wuId: string): boolean {
  if (!wuId) {
    return false;
  }
  return WU_ID_PATTERN.test(wuId);
}

/**
 * Build argv array for git log commit lookup.
 *
 * WU-1534: Returns an argv array for use with execFileSync (no shell).
 * The WU ID is passed as a literal --grep= value, not interpolated into a shell string.
 *
 * @param wuId - WU ID to search for in commit messages
 * @returns Argv array for execFileSync('git', args)
 */
export function buildGitLogArgs(wuId: string): string[] {
  return ['log', '--all', '--oneline', '--date=iso-strict', '--format=%H|%ad|%s', `--grep=${wuId}`];
}

/**
 * Build argv array for git log file listing.
 *
 * WU-1534: Returns an argv array for use with execFileSync (no shell).
 * Replaces the previous shell pipe `| sort -u` with in-process dedup.
 *
 * @param wuId - WU ID to search for in commit messages
 * @returns Argv array for execFileSync('git', args)
 */
export function buildGitFilesArgs(wuId: string): string[] {
  return ['log', '--all', '--name-only', '--format=', `--grep=${wuId}`];
}

/**
 * Parse command line arguments for trace-gen
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseTraceArgs(argv: string[]): TraceArgs {
  const args: TraceArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--wu' || arg === '-w') {
      args.wuId = cliArgs[++i];
    } else if (arg === '--format' || arg === '-f') {
      args.format = cliArgs[++i] as TraceFormat;
    } else if (arg === '--output' || arg === '-o') {
      args.output = cliArgs[++i];
    } else if (arg === '--since' || arg === '-s') {
      args.since = cliArgs[++i];
    }
  }

  return args;
}

/**
 * Build a trace entry from WU and commit data
 *
 * @param input - Input data containing WU info, commits, and files
 * @returns Trace entry with summary statistics
 */
export function buildTraceEntry(input: TraceInput): TraceEntry {
  const { wuId, title, status, commits, files } = input;

  const entry: TraceEntry = {
    wuId,
    title,
    status,
    commitCount: commits.length,
    fileCount: files.length,
  };

  if (commits.length > 0) {
    // Sort commits by date
    const sorted = [...commits].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    entry.firstCommit = sorted[0].date;
    entry.lastCommit = sorted[sorted.length - 1].date;
    entry.commits = sorted;
  }

  if (files.length > 0) {
    entry.files = files;
  }

  return entry;
}

/**
 * Get commits for a WU by searching git log.
 *
 * WU-1534: Uses execFileSync with argv array (no shell interpolation).
 */
function getWuCommits(wuId: string): CommitInfo[] {
  try {
    const gitArgs = buildGitLogArgs(wuId);
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const output = execFileSync('git', gitArgs, {
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });

    const commits: CommitInfo[] = [];
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const [sha, date, ...messageParts] = line.split('|');
      commits.push({
        sha: sha.slice(0, 8),
        date,
        message: messageParts.join('|'),
      });
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Get files changed by a WU.
 *
 * WU-1534: Uses execFileSync with argv array (no shell interpolation).
 * Dedup/sort done in-process instead of shell pipe `| sort -u`.
 */
function getWuFiles(wuId: string): string[] {
  try {
    const gitArgs = buildGitFilesArgs(wuId);
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; CLI tool requires git
    const output = execFileSync('git', gitArgs, {
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });

    // In-process dedup and sort (replaces shell `| sort -u`)
    const files = output
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
    return [...new Set(files)].sort();
  } catch {
    return [];
  }
}

/**
 * Get WU info from YAML file
 */
function getWuInfo(wuId: string): { title: string; status: string } | null {
  // WU-1301: Use config-based paths
  const yamlPath = join(process.cwd(), WU_PATHS.WU(wuId));
  if (!existsSync(yamlPath)) {
    return null;
  }

  try {
    const content = readFileSync(yamlPath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    const yaml = parseYaml(content);
    return {
      title: yaml?.title || wuId,
      status: yaml?.status || 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Format trace report as JSON
 */
function formatJson(entries: TraceEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * Format trace report as Markdown
 */
function formatMarkdown(entries: TraceEntry[]): string {
  const lines: string[] = [
    '# Traceability Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## WU Summary',
    '',
    '| WU ID | Title | Status | Commits | Files |',
    '|-------|-------|--------|---------|-------|',
  ];

  for (const entry of entries) {
    lines.push(
      `| ${entry.wuId} | ${entry.title.slice(0, 30)} | ${entry.status} | ${entry.commitCount} | ${entry.fileCount} |`,
    );
  }

  lines.push('', '## Details', '');

  for (const entry of entries) {
    lines.push(`### ${entry.wuId}: ${entry.title}`, '');
    lines.push(`- **Status:** ${entry.status}`);
    lines.push(`- **Commits:** ${entry.commitCount}`);
    lines.push(`- **Files:** ${entry.fileCount}`);

    if (entry.firstCommit) {
      lines.push(`- **First commit:** ${entry.firstCommit}`);
      lines.push(`- **Last commit:** ${entry.lastCommit}`);
    }

    if (entry.files && entry.files.length > 0) {
      lines.push('', '**Files changed:**');
      for (const file of entry.files.slice(0, 20)) {
        lines.push(`- ${file}`);
      }
      if (entry.files.length > 20) {
        lines.push(`- ... and ${entry.files.length - 20} more`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format trace report as CSV
 */
function formatCsv(entries: TraceEntry[]): string {
  const lines: string[] = ['WU ID,Title,Status,Commits,Files,First Commit,Last Commit'];

  for (const entry of entries) {
    const title = entry.title.replace(/,/g, ';');
    lines.push(
      `${entry.wuId},"${title}",${entry.status},${entry.commitCount},${entry.fileCount},${entry.firstCommit || ''},${entry.lastCommit || ''}`,
    );
  }

  return lines.join('\n');
}

/**
 * Print help message for trace-gen
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: trace-gen [options]

Generate traceability reports linking WUs to code changes.

Options:
  -w, --wu <id>       Trace specific WU (otherwise traces all)
  -f, --format <fmt>  Output format: json, markdown, csv (default: json)
  -o, --output <file> Write output to file (default: stdout)
  -s, --since <date>  Only trace WUs modified since date (ISO format)
  -h, --help          Show this help message

Examples:
  trace:gen --wu WU-1112                    # Trace single WU
  trace:gen --format markdown --output report.md  # Markdown report
  trace:gen --since 2024-01-01 --format csv       # CSV report since date

Output includes:
  - WU ID and title
  - Status
  - Number of commits
  - Number of files changed
  - First and last commit dates
  - List of changed files
`);
}

/**
 * Main entry point for trace-gen command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseTraceArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  // WU-1534: Validate WU ID if provided
  if (args.wuId && !validateWuId(args.wuId)) {
    console.error(`${LOG_PREFIX} Error: Invalid WU ID format: ${args.wuId}`);
    console.error(`${LOG_PREFIX} Expected format: WU-<number> (e.g., WU-1112)`);
    process.exit(EXIT_CODES.ERROR);
  }

  const format = (args.format as TraceFormat) || TraceFormat.JSON;
  const entries: TraceEntry[] = [];

  if (args.wuId) {
    // Trace single WU
    console.error(`${LOG_PREFIX} Tracing ${args.wuId}...`);

    const info = getWuInfo(args.wuId);
    if (!info) {
      console.error(`${LOG_PREFIX} Error: WU ${args.wuId} not found`);
      process.exit(EXIT_CODES.ERROR);
    }

    const commits = getWuCommits(args.wuId);
    const files = getWuFiles(args.wuId);

    entries.push(
      buildTraceEntry({
        wuId: args.wuId,
        title: info.title,
        status: info.status,
        commits,
        files,
      }),
    );
  } else {
    // Trace all WUs
    console.error(`${LOG_PREFIX} Scanning all WUs...`);

    // WU-1301: Use config-based paths
    const wuDir = join(process.cwd(), WU_PATHS.WU_DIR());
    if (!existsSync(wuDir)) {
      console.error(`${LOG_PREFIX} Error: WU directory not found`);
      process.exit(EXIT_CODES.ERROR);
    }

    const files = readdirSync(wuDir);
    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

      const wuId = file.replace(/\.ya?ml$/, '');
      const info = getWuInfo(wuId);
      if (!info) continue;

      // Filter by since date if specified
      if (args.since) {
        const commits = getWuCommits(wuId);
        if (commits.length === 0) continue;

        const lastCommitDate = new Date(commits[commits.length - 1]?.date || 0);
        if (lastCommitDate < new Date(args.since)) continue;
      }

      const commits = getWuCommits(wuId);
      const wuFiles = getWuFiles(wuId);

      entries.push(
        buildTraceEntry({
          wuId,
          title: info.title,
          status: info.status,
          commits,
          files: wuFiles,
        }),
      );
    }

    console.error(`${LOG_PREFIX} Found ${entries.length} WU(s)`);
  }

  // Format output
  let output: string;
  switch (format) {
    case TraceFormat.MARKDOWN:
      output = formatMarkdown(entries);
      break;
    case TraceFormat.CSV:
      output = formatCsv(entries);
      break;
    case TraceFormat.JSON:
    default:
      output = formatJson(entries);
      break;
  }

  // Write output
  if (args.output) {
    writeFileSync(args.output, output, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    console.error(`${LOG_PREFIX} Report written to ${args.output}`);
  } else {
    console.log(output);
  }
}

// Run main if executed directly
if (import.meta.main) {
  void runCLI(main);
}
