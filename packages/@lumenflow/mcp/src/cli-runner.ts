/**
 * @file cli-runner.ts
 * @description CLI runner utility for shelling out to LumenFlow CLI commands
 *
 * WU-1412: MCP server uses CLI shell-out for write operations (wu_create, wu_claim, wu_done, gates_run)
 * Read operations use @lumenflow/core directly for better performance and type safety.
 *
 * This module provides a safe, consistent way to execute CLI commands with:
 * - Timeout support
 * - Project root configuration
 * - Proper error handling
 * - Structured output
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * CLI runner options
 */
export interface CliRunnerOptions {
  /** Working directory for command execution (defaults to process.cwd()) */
  projectRoot?: string;
  /** Command timeout in milliseconds (defaults to 120000 = 2 minutes) */
  timeout?: number;
  /** Additional environment variables */
  env?: Record<string, string>;
}

/**
 * CLI runner result
 */
export interface CliRunnerResult {
  /** Whether the command succeeded (exit code 0) */
  success: boolean;
  /** Standard output */
  stdout: string;
  /** Standard error output */
  stderr: string;
  /** Exit code (if available) */
  exitCode?: number;
  /** Error object (if command failed) */
  error?: {
    message: string;
    code?: string | number;
  };
}

/**
 * Default timeout for CLI commands (2 minutes)
 */
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Canonical-first command fallback matrix.
 *
 * When a canonical command is unavailable in a target project (missing script),
 * retry with compatibility aliases to preserve low-cost backwards compatibility.
 */
const COMMAND_FALLBACKS: Record<string, string[]> = {
  'agent:session-end': ['agent:session:end'],
  'initiative:bulk-assign': ['initiative:bulk-assign-wus'],
  lumenflow: ['lumenflow:init', 'lumenflow-init'],
  gates: ['lumenflow:gates', 'lumenflow-gates'],
  validate: ['lumenflow:validate', 'lumenflow-validate'],
  'lumenflow:release': ['release'],
  'docs:sync': ['lumenflow:docs-sync', 'lumenflow-docs-sync'],
  'sync:templates': ['lumenflow:sync-templates', 'lumenflow-sync-templates'],
};

/**
 * Build ordered command candidates (canonical first, then compatibility aliases).
 */
export function getCommandCandidates(command: string): string[] {
  const seen = new Set<string>();
  const ordered = [command, ...(COMMAND_FALLBACKS[command] || [])];
  return ordered.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

/**
 * Returns true when the command failed because the script/command wasn't found.
 */
function isMissingCommandFailure(result: CliRunnerResult): boolean {
  const detail = `${result.stderr}\n${result.error?.message || ''}`;
  return (
    /ERR_PNPM_NO_SCRIPT/i.test(detail) ||
    /Command\s+["'][^"']+["']\s+not\s+found/i.test(detail) ||
    /Unknown command/i.test(detail) ||
    /No matching command found/i.test(detail)
  );
}

/**
 * Execute a single pnpm command without fallback behavior.
 */
async function runSingleCommand(
  command: string,
  args: string[] = [],
  options: CliRunnerOptions = {},
): Promise<CliRunnerResult> {
  const projectRoot = options.projectRoot || process.cwd();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  // Use pnpm to run the command
  const pnpmPath = 'pnpm';
  const pnpmArgs = [command, ...args];

  try {
    const { stdout, stderr } = await execFileAsync(pnpmPath, pnpmArgs, {
      cwd: projectRoot,
      timeout,
      env: {
        ...process.env,
        ...options.env,
        // Ensure we're in non-interactive mode
        CI: 'true',
        // Pass through project root
        LUMENFLOW_PROJECT_ROOT: projectRoot,
      },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (err: unknown) {
    const error = err as Error & {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    return {
      success: false,
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
      error: {
        message: error.message,
        code: error.code,
      },
    };
  }
}

/**
 * Execute a LumenFlow CLI command
 *
 * @param command - CLI command to execute (e.g., 'wu:status', 'wu:claim', 'gates')
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Command execution result
 *
 * @example
 * // Get WU status
 * const result = await runCliCommand('wu:status', ['--id', 'WU-1412', '--json']);
 *
 * @example
 * // Run gates
 * const result = await runCliCommand('gates', ['--docs-only']);
 */
export async function runCliCommand(
  command: string,
  args: string[] = [],
  options: CliRunnerOptions = {},
): Promise<CliRunnerResult> {
  const candidates = getCommandCandidates(command);
  let lastFailure: CliRunnerResult | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;
    const result = await runSingleCommand(candidate, args, options);

    if (result.success) {
      return result;
    }

    lastFailure = result;
    const hasFallbackRemaining = i < candidates.length - 1;
    if (!hasFallbackRemaining || !isMissingCommandFailure(result)) {
      return result;
    }
  }

  return (
    lastFailure || {
      success: false,
      stdout: '',
      stderr: 'Command execution failed',
      exitCode: 1,
      error: { message: 'Command execution failed' },
    }
  );
}

/**
 * Parse JSON output from a CLI command
 *
 * @param result - CLI runner result
 * @returns Parsed JSON data or null if parsing fails
 */
export function parseJsonOutput<T>(result: CliRunnerResult): T | null {
  if (!result.success || !result.stdout) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}
