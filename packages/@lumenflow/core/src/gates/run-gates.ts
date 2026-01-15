/**
 * Gates runner implementation.
 * @module @lumenflow/core/gates
 */

import { spawn } from 'node:child_process';
import type { GateName, GateResult, GatesResult, RunGatesOptions } from './types.js';

/** Default commands for each gate */
const DEFAULT_COMMANDS: Readonly<Record<GateName, string>> = {
  format: 'pnpm format:check',
  lint: 'pnpm lint',
  typecheck: 'pnpm typecheck',
  test: 'pnpm test',
};

/** Default gate order */
const DEFAULT_GATES: readonly GateName[] = ['format', 'lint', 'typecheck', 'test'];

/**
 * Parse a command string into command and args
 */
function parseCommand(cmd: string): { command: string; args: string[] } {
  const parts = cmd.split(' ');
  const command = parts[0] ?? '';
  const args = parts.slice(1);
  return { command, args };
}

/**
 * Get custom command for a gate
 */
function getCustomCommand(
  gate: GateName,
  commands: Partial<Record<GateName, string>>,
): string | undefined {
  switch (gate) {
    case 'format':
      return commands.format;
    case 'lint':
      return commands.lint;
    case 'typecheck':
      return commands.typecheck;
    case 'test':
      return commands.test;
  }
}

/**
 * Get default command for a gate
 */
function getDefaultCommand(gate: GateName): string {
  switch (gate) {
    case 'format':
      return DEFAULT_COMMANDS.format;
    case 'lint':
      return DEFAULT_COMMANDS.lint;
    case 'typecheck':
      return DEFAULT_COMMANDS.typecheck;
    case 'test':
      return DEFAULT_COMMANDS.test;
  }
}

/**
 * Get command for a gate safely
 */
function getGateCommand(gate: GateName, commands: Partial<Record<GateName, string>>): string {
  const customCommand = getCustomCommand(gate, commands);
  if (customCommand !== undefined) {
    return customCommand;
  }
  return getDefaultCommand(gate);
}

/**
 * Execute a single command and capture output
 */
function executeCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: false,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
      });
    });
  });
}

/**
 * Run quality gates in sequence.
 *
 * Executes format, lint, typecheck, and test gates by default.
 * Each gate runs a command and reports pass/fail based on exit code.
 *
 * @param options - Configuration options
 * @returns Promise resolving to gates result
 *
 * @example
 * ```typescript
 * const result = await runGates({ cwd: '/path/to/project' });
 * if (!result.passed) {
 *   console.error('Gates failed:', result.failedCount);
 *   process.exit(1);
 * }
 * ```
 */
export async function runGates(options: RunGatesOptions): Promise<GatesResult> {
  const { cwd, failFast = true, gates = DEFAULT_GATES, commands = {} } = options;

  const results: GateResult[] = [];
  const startTime = Date.now();

  for (const gate of gates) {
    const gateStart = Date.now();
    const cmd = getGateCommand(gate, commands);
    const { command, args } = parseCommand(cmd);

    const { exitCode, stdout, stderr } = await executeCommand(command, args, cwd);
    const passed = exitCode === 0;
    const durationMs = Date.now() - gateStart;

    results.push({
      gate,
      passed,
      exitCode,
      stdout,
      stderr,
      durationMs,
    });

    if (!passed && failFast) {
      break;
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    passed: failedCount === 0,
    passedCount,
    failedCount,
    totalDurationMs: Date.now() - startTime,
    results,
  };
}
