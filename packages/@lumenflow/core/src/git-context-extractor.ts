/**
 * Git Context Extractor Module (WU-1190)
 *
 * Extracts git history insights for LLM context enrichment:
 * - Co-occurrence: files frequently changed together
 * - Ownership: primary contributors to file/directory
 * - Churn: change frequency metrics (hotspots)
 *
 * These signals help the LLM understand codebase relationships
 * without algorithmic clustering - the LLM interprets the patterns.
 */

import { execSync } from 'node:child_process';

/**
 * A pair of files frequently changed together
 */
export interface CoOccurrence {
  file1: string;
  file2: string;
  /** Number of commits where both files were changed */
  count: number;
}

/**
 * Ownership signal for a path (file or directory)
 */
export interface OwnershipSignal {
  /** The path being analyzed */
  path: string;
  /** Primary contributor (most commits), null if none */
  primaryOwner: string | null;
  /** All contributors with their commit counts */
  contributors: string[];
  /** Total commits touching this path */
  commitCount: number;
}

/**
 * Churn metric for a file
 */
export interface ChurnMetric {
  filePath: string;
  additions: number;
  deletions: number;
  /** Churn score = additions + deletions */
  churnScore: number;
  /** Number of commits modifying this file */
  commitCount: number;
}

/**
 * Complete git context extracted from repository
 */
export interface GitContext {
  coOccurrences: CoOccurrence[];
  ownership: OwnershipSignal[];
  churn: ChurnMetric[];
  hasLimitedHistory: boolean;
  error?: string;
}

/**
 * Options for git context extraction
 */
export interface GitContextOptions {
  /** Maximum number of commits to analyze */
  maxCommits?: number;
  /** Limit history to commits since this date */
  since?: string;
}

/**
 * Options for co-occurrence extraction
 */
interface CoOccurrenceOptions {
  maxResults?: number;
  maxCommits?: number;
  since?: string;
}

/**
 * Options for churn metrics extraction
 */
interface ChurnOptions {
  excludePatterns?: string[];
  maxResults?: number;
  maxCommits?: number;
  since?: string;
}

/**
 * Options for summarizing git context
 */
interface SummarizeOptions {
  /** Approximate max tokens (chars / 4 as rough estimate) */
  maxTokens?: number;
}

// Constants
const DEFAULT_MAX_COMMITS = 500;
const DEFAULT_MAX_RESULTS = 20;
const CHARS_PER_TOKEN = 4; // Rough approximation
const DEFAULT_EXCLUDE_PATTERNS = ['*.lock', '*.yaml', '*.yml', '*.json', '*.md', 'pnpm-lock.yaml'];

// Pre-compiled regex patterns for performance
// Note: Using atomic groups or possessive quantifiers isn't supported in JS,
// so some patterns are implemented as functions to avoid backtracking
const NUMSTAT_LINE_REGEX = /^(\d+|-)\t(\d+|-)\t(.+)$/;
const DANGEROUS_CHARS_REGEX = /[;&|`$]/;

/**
 * Parse shortlog line: "   10\tName <email>"
 * Manual parsing to avoid slow regex backtracking
 */
function parseShortlogFormat(line: string): { count: number; name: string } | null {
  // Skip leading whitespace
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i++;
  }

  // Parse digits
  const digitStart = i;
  while (i < line.length && line[i] >= '0' && line[i] <= '9') {
    i++;
  }
  if (i === digitStart) return null; // No digits found

  const count = parseInt(line.slice(digitStart, i), 10);

  // Skip whitespace after digits
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i++;
  }

  // Rest is the name
  const name = line.slice(i).trim();
  if (!name) return null;

  return { count, name };
}

/**
 * Check if a string is a git commit hash (40 hex chars)
 * Uses character-by-character check to avoid slow regex backtracking
 */
function isCommitHash(str: string): boolean {
  if (str.length !== 40) return false;
  for (const char of str) {
    if (!((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f'))) {
      return false;
    }
  }
  return true;
}
const SOURCE_FILE_EXCLUDE_PATTERNS = [
  /\.lock$/,
  /lock\.ya?ml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /\.gitignore$/,
  /\.env/,
  /node_modules/,
  /dist\//,
  /build\//,
  /\.min\./,
];

/**
 * Execute a git command safely, returning empty string on error.
 *
 * SECURITY: Commands are constructed from static arguments (no user input) to prevent injection.
 * The args array is joined into a command string for execSync.
 * All callers pass only internally-constructed arguments.
 */
function safeGitExec(args: string[], cwd: string): string {
  try {
    // Join args into a command string
    // SECURITY: all args are constructed internally (no user input)
    const cmd = ['git', ...args].join(' ');
    // SECURITY: execSync is safe here because:
    // 1. 'git' is a fixed command from PATH (trusted)
    // 2. args are internally constructed, not from user input
    // 3. cwd is validated by the caller (projectRoot from CLI)

    const result = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30000, // 30 seconds
    });
    return result;
  } catch {
    return '';
  }
}

/**
 * Check if commit count indicates limited history
 */
function hasLimitedCommitCount(projectRoot: string): { limited: boolean; count: number } {
  const commitCountStr = safeGitExec(['rev-list', '--count', 'HEAD'], projectRoot).trim();
  const count = parseInt(commitCountStr, 10) || 0;
  return { limited: count < 10, count };
}

/**
 * Extract complete git context from a repository
 */
export function extractGitContext(
  projectRoot: string,
  options: GitContextOptions = {},
): GitContext {
  const result: GitContext = {
    coOccurrences: [],
    ownership: [],
    churn: [],
    hasLimitedHistory: false,
  };

  try {
    // Check if this is a git repo using execSync directly
    // SECURITY: This is a static command with no user input

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    const { limited, count } = hasLimitedCommitCount(projectRoot);
    if (limited) {
      result.hasLimitedHistory = true;
      result.error = `Repository has fewer than 10 commits (found ${count})`;
      return result;
    }

    // Extract co-occurrences
    result.coOccurrences = getFileCoOccurrence(projectRoot, {
      maxCommits: options.maxCommits ?? DEFAULT_MAX_COMMITS,
      since: options.since,
    });

    // Get top-level directories for ownership analysis
    const topDirs = getTopLevelDirs(projectRoot);
    result.ownership = getOwnershipSignals(projectRoot, topDirs);

    // Extract churn metrics
    result.churn = getChurnMetrics(projectRoot, {
      maxCommits: options.maxCommits ?? DEFAULT_MAX_COMMITS,
      since: options.since,
    });
  } catch (error) {
    handleExtractionError(result, error);
  }

  return result;
}

/**
 * Handle extraction errors and set appropriate error messages
 */
function handleExtractionError(result: GitContext, error: unknown): void {
  result.hasLimitedHistory = true;
  if (error instanceof Error) {
    if (error.message.includes('not a git repository')) {
      result.error = 'not a git repository';
    } else if (error.message.includes('does not have any commits')) {
      result.error = 'no commits in repository';
    } else {
      result.error = error.message;
    }
  }
}

/**
 * Get top-level directories for ownership analysis
 */
function getTopLevelDirs(projectRoot: string): string[] {
  const output = safeGitExec(['ls-tree', '-d', '--name-only', 'HEAD'], projectRoot);
  return output
    .split('\n')
    .filter((d) => d.trim() && !d.startsWith('.'))
    .slice(0, 20); // Limit to first 20 directories
}

/**
 * Parse git log output into commits with their files
 */
function parseCommitsFromLog(output: string): string[][] {
  const commits: string[][] = [];
  let currentFiles: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentFiles.length > 0) {
        commits.push([...currentFiles]);
        currentFiles = [];
      }
      continue;
    }
    // Skip commit hashes (40 hex chars)
    if (isCommitHash(trimmed)) {
      if (currentFiles.length > 0) {
        commits.push([...currentFiles]);
        currentFiles = [];
      }
      continue;
    }
    // Only track source files
    if (isSourceFile(trimmed)) {
      currentFiles.push(trimmed);
    }
  }
  if (currentFiles.length > 0) {
    commits.push(currentFiles);
  }

  return commits;
}

/**
 * Count file pair co-occurrences from commits
 */
function countFilePairs(commits: string[][]): Map<string, number> {
  const pairCounts = new Map<string, number>();

  for (const files of commits) {
    if (files.length < 2) continue;

    // Generate all pairs
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const pair = [files[i], files[j]]
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .join('::');
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      }
    }
  }

  return pairCounts;
}

/**
 * Extract file co-occurrence patterns from git history
 */
export function getFileCoOccurrence(
  projectRoot: string,
  options: CoOccurrenceOptions = {},
): CoOccurrence[] {
  const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  // Build git log args array (safe - no user input in paths)
  const args = ['log', `-n`, String(maxCommits)];
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  args.push('--name-only', '--pretty=format:%H', '--diff-filter=ACMRT');

  const output = safeGitExec(args, projectRoot);

  if (!output.trim()) {
    return [];
  }

  const commits = parseCommitsFromLog(output);
  const pairCounts = countFilePairs(commits);

  // Convert to array and filter
  const coOccurrences: CoOccurrence[] = [];
  for (const [pair, count] of pairCounts.entries()) {
    if (count >= 2) {
      // Only include pairs that co-occurred at least twice
      const [file1, file2] = pair.split('::');
      coOccurrences.push({ file1, file2, count });
    }
  }

  // Sort by count descending and limit results (use toSorted to avoid mutation)
  return coOccurrences
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, maxResults);
}

/**
 * Check if a file is a source file (not config, lock, etc.)
 */
function isSourceFile(filePath: string): boolean {
  return !SOURCE_FILE_EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Parse a single contributor line from shortlog output
 */
function parseShortlogLine(line: string): { name: string; count: number } | null {
  const result = parseShortlogFormat(line);
  if (!result) return null;
  return {
    count: result.count,
    name: result.name,
  };
}

/**
 * Extract ownership signal for a single path
 */
function extractOwnershipForPath(projectRoot: string, targetPath: string): OwnershipSignal {
  // Validate path doesn't contain dangerous characters
  if (DANGEROUS_CHARS_REGEX.test(targetPath)) {
    return {
      path: targetPath,
      primaryOwner: null,
      contributors: [],
      commitCount: 0,
    };
  }

  // Use array form for safety
  const args = ['shortlog', '-sne', '--all', '--', targetPath];
  const output = safeGitExec(args, projectRoot);

  if (!output.trim()) {
    return {
      path: targetPath,
      primaryOwner: null,
      contributors: [],
      commitCount: 0,
    };
  }

  // Parse shortlog output
  const contributors: { name: string; count: number }[] = [];
  let totalCommits = 0;

  for (const line of output.split('\n')) {
    const parsed = parseShortlogLine(line);
    if (parsed) {
      contributors.push(parsed);
      totalCommits += parsed.count;
    }
  }

  // Sort by commit count descending (use toSorted to avoid mutation)
  const sorted = contributors.slice().sort((a, b) => b.count - a.count);

  return {
    path: targetPath,
    primaryOwner: sorted[0]?.name ?? null,
    contributors: sorted.map((c) => c.name),
    commitCount: totalCommits,
  };
}

/**
 * Extract ownership signals for specified paths.
 * Note: paths are validated internally and not derived from user input.
 */
export function getOwnershipSignals(projectRoot: string, paths: string[]): OwnershipSignal[] {
  return paths.map((path) => extractOwnershipForPath(projectRoot, path));
}

/**
 * Parse a single numstat line from git log output
 */
function parseNumstatLine(
  line: string,
): { additions: number; deletions: number; filePath: string } | null {
  const match = NUMSTAT_LINE_REGEX.exec(line);
  if (!match) return null;
  return {
    additions: match[1] === '-' ? 0 : parseInt(match[1], 10),
    deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
    filePath: match[3],
  };
}

/**
 * Check if a file matches any exclude pattern using simple glob matching
 */
function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Simple glob matching using a state machine approach
    // Avoids control characters and dynamic regex construction
    return globMatch(filePath, pattern);
  });
}

/**
 * Simple glob matching without regex
 * Supports * (match any) and ? (match single char)
 */
function globMatch(str: string, pattern: string): boolean {
  let si = 0; // string index
  let pi = 0; // pattern index
  let starIdx = -1;
  let matchIdx = 0;

  while (si < str.length) {
    if (pi < pattern.length && (pattern[pi] === '?' || pattern[pi] === str[si])) {
      // Character match or ? wildcard
      si++;
      pi++;
    } else if (pi < pattern.length && pattern[pi] === '*') {
      // Star found, mark position
      starIdx = pi;
      matchIdx = si;
      pi++;
    } else if (starIdx !== -1) {
      // Mismatch after star, backtrack
      pi = starIdx + 1;
      matchIdx++;
      si = matchIdx;
    } else {
      // Mismatch without star
      return false;
    }
  }

  // Skip trailing stars
  while (pi < pattern.length && pattern[pi] === '*') {
    pi++;
  }

  return pi === pattern.length;
}

/**
 * Aggregate file statistics from numstat output
 */
function aggregateFileStats(
  output: string,
  excludePatterns: string[],
): Map<string, { additions: number; deletions: number; commits: number }> {
  const fileStats = new Map<string, { additions: number; deletions: number; commits: number }>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = parseNumstatLine(trimmed);
    if (!parsed) continue;

    // Skip excluded patterns
    if (matchesExcludePattern(parsed.filePath, excludePatterns)) continue;

    // Skip non-source files
    if (!isSourceFile(parsed.filePath)) continue;

    const existing = fileStats.get(parsed.filePath) ?? { additions: 0, deletions: 0, commits: 0 };
    fileStats.set(parsed.filePath, {
      additions: existing.additions + parsed.additions,
      deletions: existing.deletions + parsed.deletions,
      commits: existing.commits + 1,
    });
  }

  return fileStats;
}

/**
 * Extract churn metrics for the repository
 */
export function getChurnMetrics(projectRoot: string, options: ChurnOptions = {}): ChurnMetric[] {
  const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;

  // Build git log args array
  const args = ['log', `-n`, String(maxCommits)];
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  args.push('--numstat', '--pretty=format:');

  let output: string;
  try {
    /// SECURITY: all args are constructed internally (no user input)
    const cmd = ['git', ...args].join(' ');

    output = execSync(cmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
  } catch {
    return [];
  }

  if (!output.trim()) {
    return [];
  }

  const fileStats = aggregateFileStats(output, excludePatterns);

  // Convert to array with churn scores
  const metrics: ChurnMetric[] = [];
  for (const [filePath, stats] of fileStats.entries()) {
    metrics.push({
      filePath,
      additions: stats.additions,
      deletions: stats.deletions,
      churnScore: stats.additions + stats.deletions,
      commitCount: stats.commits,
    });
  }

  // Sort by churn score descending and limit results (use toSorted to avoid mutation)
  return metrics
    .slice()
    .sort((a, b) => b.churnScore - a.churnScore)
    .slice(0, maxResults);
}

/**
 * Build co-occurrence section for summary
 */
function buildCoOccurrenceSection(coOccurrences: CoOccurrence[]): string {
  const lines = ['## Co-occurrence Patterns', 'Files frequently changed together:'];
  for (const co of coOccurrences.slice(0, 10)) {
    lines.push(`- ${co.file1} <-> ${co.file2} (${co.count} commits)`);
  }
  return lines.join('\n');
}

/**
 * Build ownership section for summary
 */
function buildOwnershipSection(ownership: OwnershipSignal[]): string {
  const lines = ['## Ownership Signals', 'Primary contributors by area:'];
  for (const own of ownership.filter((o) => o.primaryOwner)) {
    const ownerName = own.primaryOwner?.split(' <')[0] ?? 'unknown';
    lines.push(`- ${own.path}: ${ownerName} (${own.commitCount} commits)`);
  }
  return lines.join('\n');
}

/**
 * Build churn section for summary
 */
function buildChurnSection(churn: ChurnMetric[]): string {
  const lines = ['## Churn Hotspots', 'High-change files (potential complexity):'];
  for (const ch of churn.slice(0, 10)) {
    lines.push(`- ${ch.filePath}: ${ch.churnScore} lines changed across ${ch.commitCount} commits`);
  }
  return lines.join('\n');
}

/**
 * Truncate a section to fit within character limit
 */
function truncateSection(section: string, maxChars: number): string {
  if (section.length <= maxChars) return section;

  const lines = section.split('\n');
  const header = lines.slice(0, 2).join('\n');
  const items = lines.slice(2);
  const availableChars = maxChars - header.length - 20;
  const truncatedItems: string[] = [];
  let currentChars = 0;

  for (const item of items) {
    if (currentChars + item.length > availableChars) break;
    truncatedItems.push(item);
    currentChars += item.length + 1;
  }

  return [header, ...truncatedItems, '(truncated)'].join('\n');
}

/**
 * Summarize git context for LLM prompt inclusion
 *
 * Produces a token-efficient summary that fits within specified limits.
 */
export function summarizeGitContext(context: GitContext, options: SummarizeOptions = {}): string {
  const maxTokens = options.maxTokens ?? 500;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // Handle limited history case
  if (context.hasLimitedHistory) {
    return context.error
      ? `Git history analysis limited: ${context.error}`
      : 'Git history analysis limited due to sparse commit history.';
  }

  const sections: string[] = [];

  if (context.coOccurrences.length > 0) {
    sections.push(buildCoOccurrenceSection(context.coOccurrences));
  }

  if (context.ownership.length > 0) {
    sections.push(buildOwnershipSection(context.ownership));
  }

  if (context.churn.length > 0) {
    sections.push(buildChurnSection(context.churn));
  }

  let result = sections.join('\n\n');

  // Truncate if needed
  if (result.length > maxChars && sections.length > 0) {
    const charsPerSection = Math.floor(maxChars / sections.length) - 20;
    const truncatedSections = sections.map((s) => truncateSection(s, charsPerSection));
    result = truncatedSections.join('\n\n');
  }

  return result || 'Git history analysis limited due to sparse commit history.';
}
