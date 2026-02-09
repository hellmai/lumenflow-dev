#!/usr/bin/env node
/**
 * Lane Health Command
 *
 * WU-1188: CLI command to diagnose lane configuration issues:
 * - Overlap detection between lane code_paths
 * - Coverage gaps (files not covered by any lane)
 * - Exit code 0 for healthy, 1 for issues
 *
 * Usage:
 *   pnpm lane:health              # Run health check
 *   pnpm lane:health --json       # Output as JSON
 *   pnpm lane:health --verbose    # Show all checked files
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import { parse as parseYAML } from 'yaml';
import chalk from 'chalk';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { findProjectRoot } from '@lumenflow/core/config';
import { runCLI } from './cli-entry-point.js';

/** Constants */
const LOG_PREFIX = '[lane:health]';
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';
const MAX_DISPLAY_FILES = 5;
const MAX_DISPLAY_GAPS = 10;

/** Default exclude patterns for coverage gap detection */
const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.turbo/**',
  '*.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  '.lumenflow/**',
  'worktrees/**',
];

/** File extensions to check for coverage (code files only) */
const CODE_FILE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
];

// ============================================================================
// Types
// ============================================================================

/** Lane definition from config */
export interface LaneDefinition {
  name: string;
  code_paths: string[];
  wip_limit?: number;
}

/** Overlap detection result for a pair of lanes */
export interface LaneOverlap {
  lanes: [string, string];
  pattern: string;
  files: string[];
}

/** Result of overlap detection */
export interface OverlapDetectionResult {
  hasOverlaps: boolean;
  overlaps: LaneOverlap[];
}

/** Result of coverage gap detection */
export interface CoverageGapResult {
  hasGaps: boolean;
  uncoveredFiles: string[];
}

/** Options for coverage gap detection */
export interface CoverageGapOptions {
  projectRoot: string;
  excludePatterns?: string[];
  codeOnly?: boolean;
}

/** Complete lane health report */
export interface LaneHealthReport {
  overlaps: OverlapDetectionResult;
  gaps: CoverageGapResult;
  healthy: boolean;
}

// ============================================================================
// Lane Loading
// ============================================================================

/**
 * Parse lane definition from raw object
 */
function parseLaneDefinition(lane: unknown): LaneDefinition | null {
  if (typeof lane !== 'object' || lane === null) {
    return null;
  }
  const laneObj = lane as Record<string, unknown>;
  if (typeof laneObj.name !== 'string' || !Array.isArray(laneObj.code_paths)) {
    return null;
  }
  return {
    name: laneObj.name,
    code_paths: laneObj.code_paths.filter((p): p is string => typeof p === 'string'),
    wip_limit: typeof laneObj.wip_limit === 'number' ? laneObj.wip_limit : undefined,
  };
}

/**
 * Load lane definitions from .lumenflow.config.yaml
 *
 * @param projectRoot - Project root directory
 * @returns Array of lane definitions
 */
export function loadLaneDefinitions(projectRoot: string): LaneDefinition[] {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const config = parseYAML(content) as Record<string, unknown>;

    const lanesConfig = config.lanes as Record<string, unknown> | undefined;
    if (!lanesConfig) {
      return [];
    }

    const definitions = (lanesConfig.definitions || lanesConfig) as unknown[];
    if (!Array.isArray(definitions)) {
      return [];
    }

    return definitions
      .map(parseLaneDefinition)
      .filter((lane): lane is LaneDefinition => lane !== null);
  } catch {
    return [];
  }
}

// ============================================================================
// Overlap Detection
// ============================================================================

/**
 * Check if two glob patterns can potentially overlap
 */
function patternsCanOverlap(patternA: string, patternB: string): boolean {
  const testPathA = patternA.replace(/\*\*/g, 'test/nested').replace(/\*/g, 'testfile');
  const testPathB = patternB.replace(/\*\*/g, 'test/nested').replace(/\*/g, 'testfile');
  return minimatch(testPathB, patternA) || minimatch(testPathA, patternB);
}

/**
 * Find concrete file intersection between two glob patterns
 */
function findOverlappingFiles(patternA: string, patternB: string): string[] {
  const globOptions = {
    dot: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/worktrees/**'],
    followSymbolicLinks: false,
    suppressErrors: true,
  };

  const filesA = new Set(fg.sync(patternA, globOptions));
  const filesB = new Set(fg.sync(patternB, globOptions));

  return [...filesA].filter((file) => filesB.has(file));
}

/**
 * Check overlap between two lanes' code paths
 */
function checkLanePairOverlap(laneA: LaneDefinition, laneB: LaneDefinition): LaneOverlap[] {
  const overlaps: LaneOverlap[] = [];

  for (const pathA of laneA.code_paths) {
    for (const pathB of laneB.code_paths) {
      if (patternsCanOverlap(pathA, pathB)) {
        let files: string[] = [];
        try {
          files = findOverlappingFiles(pathA, pathB);
        } catch {
          // Ignore filesystem errors
        }

        overlaps.push({
          lanes: [laneA.name, laneB.name],
          pattern: `${pathA} <-> ${pathB}`,
          files,
        });
      }
    }
  }

  return overlaps;
}

/**
 * Detect overlapping code_paths between lane definitions
 */
export function detectLaneOverlaps(lanes: LaneDefinition[]): OverlapDetectionResult {
  const overlaps: LaneOverlap[] = [];

  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const pairOverlaps = checkLanePairOverlap(lanes[i], lanes[j]);
      overlaps.push(...pairOverlaps);
    }
  }

  return {
    hasOverlaps: overlaps.length > 0,
    overlaps,
  };
}

// ============================================================================
// Coverage Gap Detection
// ============================================================================

/**
 * Build pattern for code files
 */
function buildCodeFilesPattern(): string {
  const extensions = CODE_FILE_EXTENSIONS.map((ext) => ext.replace('.', '')).join(',');
  return `**/*.{${extensions}}`;
}

/**
 * Detect files not covered by any lane
 */
export function detectCoverageGaps(
  lanes: LaneDefinition[],
  options: CoverageGapOptions,
): CoverageGapResult {
  const { projectRoot, excludePatterns = DEFAULT_EXCLUDE_PATTERNS, codeOnly = true } = options;

  const allFilesPattern = codeOnly ? buildCodeFilesPattern() : '**/*';

  const globOptions = {
    cwd: projectRoot,
    dot: true,
    ignore: excludePatterns,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  };

  const allFiles = fg.sync(allFilesPattern, globOptions);
  const coveredFiles = new Set<string>();

  for (const lane of lanes) {
    for (const pattern of lane.code_paths) {
      const matchedFiles = fg.sync(pattern, {
        ...globOptions,
        ignore: ['**/node_modules/**', '**/.git/**', '**/worktrees/**'],
      });
      matchedFiles.forEach((file) => coveredFiles.add(file));
    }
  }

  const uncoveredFiles = allFiles.filter((file) => !coveredFiles.has(file));

  return {
    hasGaps: uncoveredFiles.length > 0,
    uncoveredFiles,
  };
}

// ============================================================================
// Report Formatting
// ============================================================================

/**
 * Get exit code based on report health
 */
export function getExitCode(report: LaneHealthReport): number {
  return report.healthy ? 0 : 1;
}

/**
 * Format overlap section
 */
function formatOverlapSection(overlap: LaneOverlap): string[] {
  const lines: string[] = [];
  lines.push(`    ${chalk.cyan(overlap.lanes[0])} <-> ${chalk.cyan(overlap.lanes[1])}`);
  lines.push(`    Pattern: ${overlap.pattern}`);
  lines.push(`    Files (${overlap.files.length}):`);

  const displayFiles = overlap.files.slice(0, MAX_DISPLAY_FILES);
  displayFiles.forEach((file) => lines.push(`      - ${file}`));

  if (overlap.files.length > MAX_DISPLAY_FILES) {
    lines.push(`      ... and ${overlap.files.length - MAX_DISPLAY_FILES} more`);
  }
  lines.push('');
  return lines;
}

/**
 * Format lane health report as human-readable text
 */
export function formatLaneHealthReport(report: LaneHealthReport): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold('='.repeat(60)));
  lines.push(chalk.bold.cyan('  Lane Health Report'));
  lines.push(chalk.bold('='.repeat(60)));
  lines.push('');

  // Status
  if (report.healthy) {
    lines.push(chalk.green.bold('  Status: healthy'));
    lines.push('');
    lines.push('  All lane configurations are valid:');
    lines.push('    - No overlapping code_paths detected');
    lines.push('    - All code files covered by lanes');
  } else {
    lines.push(chalk.red.bold('  Status: Issues detected'));
  }
  lines.push('');

  // Overlaps
  if (report.overlaps.hasOverlaps) {
    lines.push(chalk.yellow.bold('  Overlapping Code Paths'));
    lines.push('  ' + '-'.repeat(40));
    lines.push('');
    report.overlaps.overlaps.forEach((overlap) => {
      lines.push(...formatOverlapSection(overlap));
    });
  }

  // Coverage gaps
  if (report.gaps.hasGaps) {
    lines.push(chalk.yellow.bold('  Coverage Gaps'));
    lines.push('  ' + '-'.repeat(40));
    lines.push('');
    lines.push(`    ${report.gaps.uncoveredFiles.length} files not covered by any lane:`);
    lines.push('');

    const displayFiles = report.gaps.uncoveredFiles.slice(0, MAX_DISPLAY_GAPS);
    displayFiles.forEach((file) => lines.push(`      - ${file}`));

    if (report.gaps.uncoveredFiles.length > MAX_DISPLAY_GAPS) {
      lines.push(`      ... and ${report.gaps.uncoveredFiles.length - MAX_DISPLAY_GAPS} more`);
    }
    lines.push('');
  }

  lines.push(chalk.bold('='.repeat(60)));
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/** Logger for CLI output */

const log = console.log.bind(console);

const warn = console.warn.bind(console);

/**
 * Run lane health check
 */
export function runLaneHealthCheck(options: {
  projectRoot?: string;
  checkCoverage?: boolean;
  excludePatterns?: string[];
}): LaneHealthReport {
  const { projectRoot = findProjectRoot(), checkCoverage = true, excludePatterns } = options;

  const lanes = loadLaneDefinitions(projectRoot);

  if (lanes.length === 0) {
    warn(`${LOG_PREFIX} No lane definitions found in ${CONFIG_FILE_NAME}`);
    return {
      overlaps: { hasOverlaps: false, overlaps: [] },
      gaps: { hasGaps: false, uncoveredFiles: [] },
      healthy: true,
    };
  }

  const overlaps = detectLaneOverlaps(lanes);
  let gaps: CoverageGapResult = { hasGaps: false, uncoveredFiles: [] };

  if (checkCoverage) {
    gaps = detectCoverageGaps(lanes, { projectRoot, excludePatterns });
  }

  return {
    overlaps,
    gaps,
    healthy: !overlaps.hasOverlaps && !gaps.hasGaps,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = createWUParser({
    name: 'lane-health',
    description: 'Check lane configuration health (WU-1188)',
    options: [
      { name: 'json', flags: '-j, --json', type: 'boolean', description: 'Output as JSON' },
      {
        name: 'verbose',
        flags: '-v, --verbose',
        type: 'boolean',
        description: 'Show verbose output',
      },
      {
        name: 'no-coverage',
        flags: '--no-coverage',
        type: 'boolean',
        description: 'Skip coverage gap detection',
      },
    ],
    required: [],
  });

  const {
    json,
    verbose,
    'no-coverage': noCoverage,
  } = args as {
    json?: boolean;
    verbose?: boolean;
    'no-coverage'?: boolean;
  };

  const projectRoot = findProjectRoot();

  if (verbose) {
    log(`${LOG_PREFIX} Checking lane health in: ${projectRoot}`);
  }

  const report = runLaneHealthCheck({
    projectRoot,
    checkCoverage: !noCoverage,
  });

  if (json) {
    log(JSON.stringify(report, null, 2));
  } else {
    log(formatLaneHealthReport(report));
  }

  process.exit(getExitCode(report));
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
if (import.meta.main) {
  void runCLI(main);
}
