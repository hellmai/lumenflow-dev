/**
 * Gates Graceful Degradation
 *
 * WU-1520: When gate scripts (format:check, lint, typecheck, spec:linter)
 * are missing from package.json, emit a warning and skip instead of failing.
 *
 * Defense in depth: even if scaffold adds scripts, gates should degrade
 * gracefully for any missing script.
 *
 * @module gates-graceful-degradation
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Gate execution status
 */
export type GateStatus = 'passed' | 'failed' | 'skipped' | 'warned';

/**
 * Result of a single gate execution
 */
export interface GateResult {
  /** Gate name (e.g., 'lint', 'format:check') */
  name: string;
  /** Execution status */
  status: GateStatus;
  /** Duration in milliseconds */
  durationMs: number;
  /** Reason for skip or warning */
  reason?: string;
}

/**
 * Scripts that can be skipped when missing from package.json.
 * These are optional tooling scripts that not every project configures.
 */
export const SKIPPABLE_GATE_SCRIPTS: readonly string[] = [
  'format:check',
  'lint',
  'typecheck',
  'spec:linter',
] as const;

/**
 * Gates that are never skippable, regardless of configuration.
 * These enforce critical invariants and must always run.
 */
export const NON_SKIPPABLE_GATES: readonly string[] = ['invariants'] as const;

/**
 * Check whether a script exists in a package.json scripts object.
 *
 * @param scriptName - The script name to check (e.g., 'lint', 'format:check')
 * @param scripts - The scripts object from package.json, or undefined
 * @returns true if the script exists
 */
export function checkScriptExists(
  scriptName: string,
  scripts: Record<string, string> | undefined,
): boolean {
  if (!scripts) return false;
  return Object.prototype.hasOwnProperty.call(scripts, scriptName);
}

/**
 * Load the scripts object from a package.json file.
 *
 * @param projectRoot - Project root directory containing package.json
 * @returns The scripts object, or undefined if package.json is missing or unreadable
 */
export function loadPackageJsonScripts(projectRoot: string): Record<string, string> | undefined {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return undefined;

  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    return pkg.scripts;
  } catch {
    return undefined;
  }
}

/**
 * Build a human-readable warning message for a missing gate script.
 * Includes instructions on how to add the missing script.
 *
 * @param scriptName - The missing script name
 * @returns Warning message string
 */
export function buildMissingScriptWarning(scriptName: string): string {
  const suggestions: Record<string, string> = {
    'format:check': '"format:check": "prettier --check ."',
    lint: '"lint": "eslint ."',
    typecheck: '"typecheck": "tsc --noEmit"',
    'spec:linter': '"spec:linter": "node tools/spec-linter.js"',
  };

  const suggestion = suggestions[scriptName] ?? `"${scriptName}": "<your-command>"`;

  return [
    `Warning: "${scriptName}" script not found in package.json - skipping gate.`,
    `  To enable this gate, add to your package.json scripts:`,
    `    ${suggestion}`,
  ].join('\n');
}

/**
 * Determine whether a gate should be skipped due to a missing script.
 *
 * @param gateName - The gate name (e.g., 'lint', 'invariants')
 * @param scriptName - The underlying script name, or null for non-script gates
 * @param scripts - The scripts object from package.json
 * @param strict - When true, missing scripts cause a hard failure instead of skip
 * @returns 'skip' if the gate should be skipped, 'run' if it should run, 'fail' if strict mode failure
 */
export function resolveGateAction(
  gateName: string,
  scriptName: string | null,
  scripts: Record<string, string> | undefined,
  strict: boolean,
): 'skip' | 'run' | 'fail' {
  // Non-skippable gates always run
  if (NON_SKIPPABLE_GATES.includes(gateName)) {
    return 'run';
  }

  // If no script name is associated (e.g., custom run functions), always run
  if (!scriptName) {
    return 'run';
  }

  // If script exists, run it
  if (checkScriptExists(scriptName, scripts)) {
    return 'run';
  }

  // Script is missing
  if (strict) {
    return 'fail';
  }

  return 'skip';
}

/**
 * Format a summary of gate results showing passed, skipped, and failed gates.
 *
 * @param results - Array of gate results
 * @returns Formatted summary string
 */
export function formatGateSummary(results: GateResult[]): string {
  if (results.length === 0) {
    return 'No gates were executed.';
  }

  const passed = results.filter((r) => r.status === 'passed');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failed = results.filter((r) => r.status === 'failed');
  const warned = results.filter((r) => r.status === 'warned');

  const lines: string[] = [];

  lines.push('Gate Summary:');
  lines.push('');

  for (const result of results) {
    const statusIcon =
      result.status === 'passed'
        ? 'PASS'
        : result.status === 'skipped'
          ? 'SKIP'
          : result.status === 'warned'
            ? 'WARN'
            : 'FAIL';

    const duration = result.durationMs > 0 ? ` (${result.durationMs}ms)` : '';
    const reason = result.reason ? ` - ${result.reason}` : '';

    lines.push(`  [${statusIcon}] ${result.name}${duration}${reason}`);
  }

  lines.push('');

  const parts: string[] = [];
  if (passed.length > 0) parts.push(`${passed.length} passed`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  if (warned.length > 0) parts.push(`${warned.length} warned`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);

  lines.push(parts.join(', '));

  return lines.join('\n');
}
