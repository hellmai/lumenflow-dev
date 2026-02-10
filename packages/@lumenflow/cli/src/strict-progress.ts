#!/usr/bin/env node

/**
 * Strict Progress CLI (WU-1573)
 *
 * Tracks strict-mode TypeScript backlog for @lumenflow/core and @lumenflow/cli,
 * writes a machine-readable baseline, and fails on regressions.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createWUParser } from '@lumenflow/core/arg-parser';
import { ProcessExitError } from '@lumenflow/core/error-handler';
import { EXIT_CODES, LUMENFLOW_PATHS, PKG_MANAGER } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[strict:progress]';
const DEFAULT_BASELINE_PATH = path.join(LUMENFLOW_PATHS.BASE, 'strict-progress-baseline.json');
const TARGET_PACKAGES = ['@lumenflow/cli', '@lumenflow/core'] as const;

interface StrictErrorSummary {
  totalErrors: number;
  errorCodes: Record<string, number>;
  fileErrors: Record<string, number>;
}

export interface StrictPackageSnapshot {
  packageName: string;
  totalErrors: number;
  errorCodes: Record<string, number>;
  fileErrors: Record<string, number>;
}

interface StrictPackageBaseline {
  total_errors: number;
  error_codes: Record<string, number>;
  file_errors: Record<string, number>;
}

export interface StrictBaseline {
  version: 1;
  generated_at: string;
  totals: {
    total_errors: number;
  };
  packages: Record<string, StrictPackageBaseline>;
}

interface StrictComparison {
  hasRegression: boolean;
  regressions: string[];
}

interface ParsedArgs {
  json?: boolean;
  writeBaseline?: boolean;
  baseline?: string;
  allowRegression?: boolean;
}

const CLI_OPTIONS = {
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output strict progress as JSON',
  },
  writeBaseline: {
    name: 'writeBaseline',
    flags: '--write-baseline',
    description: 'Write current snapshot to the strict baseline file',
  },
  baseline: {
    name: 'baseline',
    flags: '--baseline <path>',
    description: `Baseline path (default: ${DEFAULT_BASELINE_PATH})`,
  },
  allowRegression: {
    name: 'allowRegression',
    flags: '--allow-regression',
    description: 'Exit successfully even when regression is detected',
  },
};

/**
 * Parse tsc strict output into structured counts.
 */
export function parseTypeScriptErrors(output: string): StrictErrorSummary {
  const lines = output.split(/\r?\n/);
  const errorCodes: Record<string, number> = {};
  const fileErrors: Record<string, number> = {};
  let totalErrors = 0;

  // Example:
  // src/file.ts(10,2): error TS7006: Parameter 'x' implicitly has an 'any' type.
  const errorLine = /^(.+?)\(\d+,\d+\): error (TS\d+):/;

  for (const line of lines) {
    const match = line.match(errorLine);
    if (!match) {
      continue;
    }

    const filePath = match[1];
    const errorCode = match[2];

    totalErrors += 1;
    errorCodes[errorCode] = (errorCodes[errorCode] ?? 0) + 1;
    fileErrors[filePath] = (fileErrors[filePath] ?? 0) + 1;
  }

  return {
    totalErrors,
    errorCodes,
    fileErrors,
  };
}

function parseArgs(): ParsedArgs {
  return createWUParser({
    name: 'strict-progress',
    description: 'Track strict TypeScript backlog and guard regressions',
    options: [
      CLI_OPTIONS.json,
      CLI_OPTIONS.writeBaseline,
      CLI_OPTIONS.baseline,
      CLI_OPTIONS.allowRegression,
    ],
    required: [],
    allowPositionalId: false,
  }) as ParsedArgs;
}

function getCommandOutput(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const maybeError = error as {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };

  const stdout = maybeError.stdout ? String(maybeError.stdout) : '';
  const stderr = maybeError.stderr ? String(maybeError.stderr) : '';

  return [stdout, stderr].filter(Boolean).join('\n');
}

function runStrictTypecheck(packageName: string): StrictPackageSnapshot {
  try {
    const output = execFileSync(
      PKG_MANAGER,
      ['--filter', packageName, 'exec', 'tsc', '--noEmit', '--strict', '--pretty', 'false'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const parsed = parseTypeScriptErrors(output);
    return {
      packageName,
      totalErrors: parsed.totalErrors,
      errorCodes: parsed.errorCodes,
      fileErrors: parsed.fileErrors,
    };
  } catch (error: unknown) {
    const output = getCommandOutput(error);
    const parsed = parseTypeScriptErrors(output);

    return {
      packageName,
      totalErrors: parsed.totalErrors,
      errorCodes: parsed.errorCodes,
      fileErrors: parsed.fileErrors,
    };
  }
}

/**
 * Build baseline/snapshot shape from package metrics.
 */
export function buildStrictSnapshot(packageSnapshots: StrictPackageSnapshot[]): StrictBaseline {
  const packages: Record<string, StrictPackageBaseline> = {};
  let totalErrors = 0;

  for (const pkg of packageSnapshots) {
    packages[pkg.packageName] = {
      total_errors: pkg.totalErrors,
      error_codes: pkg.errorCodes,
      file_errors: pkg.fileErrors,
    };

    totalErrors += pkg.totalErrors;
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    totals: {
      total_errors: totalErrors,
    },
    packages,
  };
}

function readBaseline(baselinePath: string): StrictBaseline {
  const content = readFileSync(baselinePath, 'utf-8');
  return JSON.parse(content) as StrictBaseline;
}

function writeBaseline(baselinePath: string, snapshot: StrictBaseline): void {
  const dir = path.dirname(baselinePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
}

/**
 * Compare current snapshot against baseline and report regressions.
 */
export function compareSnapshotToBaseline(
  snapshot: StrictBaseline,
  baseline: StrictBaseline,
): StrictComparison {
  const regressions: string[] = [];

  if (snapshot.totals.total_errors > baseline.totals.total_errors) {
    regressions.push(
      `overall total errors increased: ${baseline.totals.total_errors} -> ${snapshot.totals.total_errors}`,
    );
  }

  for (const [packageName, currentPkg] of Object.entries(snapshot.packages)) {
    const baselinePkg = baseline.packages[packageName];

    if (!baselinePkg) {
      if (currentPkg.total_errors > 0) {
        regressions.push(
          `${packageName} has ${currentPkg.total_errors} errors with no baseline entry`,
        );
      }
      continue;
    }

    if (currentPkg.total_errors > baselinePkg.total_errors) {
      regressions.push(
        `${packageName} total errors increased: ${baselinePkg.total_errors} -> ${currentPkg.total_errors}`,
      );
    }

    for (const [errorCode, currentCount] of Object.entries(currentPkg.error_codes)) {
      const baselineCount = baselinePkg.error_codes[errorCode] ?? 0;
      if (currentCount > baselineCount) {
        regressions.push(
          `${packageName} ${errorCode} increased: ${baselineCount} -> ${currentCount}`,
        );
      }
    }

    for (const [filePath, currentCount] of Object.entries(currentPkg.file_errors)) {
      const baselineCount = baselinePkg.file_errors[filePath] ?? 0;
      if (currentCount > baselineCount) {
        regressions.push(
          `${packageName} file ${filePath} increased: ${baselineCount} -> ${currentCount}`,
        );
      }
    }
  }

  return {
    hasRegression: regressions.length > 0,
    regressions,
  };
}

function getTopEntries(counts: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function formatHumanSummary(
  snapshot: StrictBaseline,
  comparison: StrictComparison | null,
  baselinePath: string,
): string {
  const lines: string[] = [];

  lines.push(`${LOG_PREFIX} Strict backlog snapshot`);
  lines.push(`${LOG_PREFIX} Baseline: ${baselinePath}`);
  lines.push('');

  for (const [packageName, pkg] of Object.entries(snapshot.packages)) {
    lines.push(`${packageName}: ${pkg.total_errors} errors`);

    const topCodes = getTopEntries(pkg.error_codes, 3);
    if (topCodes.length > 0) {
      lines.push(`  top codes: ${topCodes.map(([code, count]) => `${code}=${count}`).join(', ')}`);
    }

    const topFiles = getTopEntries(pkg.file_errors, 3);
    if (topFiles.length > 0) {
      lines.push(`  top files: ${topFiles.map(([file, count]) => `${file}=${count}`).join(', ')}`);
    }

    lines.push('');
  }

  lines.push(`TOTAL: ${snapshot.totals.total_errors} errors`);

  if (comparison?.hasRegression) {
    lines.push('');
    lines.push('Regressions detected:');
    for (const regression of comparison.regressions) {
      lines.push(`  - ${regression}`);
    }
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs();
  const baselinePath = args.baseline ?? DEFAULT_BASELINE_PATH;

  const packageSnapshots = TARGET_PACKAGES.map((packageName) => runStrictTypecheck(packageName));
  const snapshot = buildStrictSnapshot(packageSnapshots);

  let comparison: StrictComparison | null = null;

  if (args.writeBaseline) {
    writeBaseline(baselinePath, snapshot);
  } else if (existsSync(baselinePath)) {
    const baseline = readBaseline(baselinePath);
    comparison = compareSnapshotToBaseline(snapshot, baseline);
  } else {
    throw new ProcessExitError(
      `${LOG_PREFIX} Baseline not found at ${baselinePath}. Run 'pnpm strict:progress --write-baseline' first.`,
      EXIT_CODES.FAILURE,
    );
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          baselinePath,
          snapshot,
          comparison,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatHumanSummary(snapshot, comparison, baselinePath));

    if (args.writeBaseline) {
      console.log(`${LOG_PREFIX} Baseline updated`);
    }
  }

  if (comparison?.hasRegression && !args.allowRegression) {
    throw new ProcessExitError(
      `${LOG_PREFIX} Strict regressions detected. Fix regressions or run with --allow-regression for diagnostics only.`,
      EXIT_CODES.FAILURE,
    );
  }
}

if (import.meta.main) {
  void runCLI(main);
}
