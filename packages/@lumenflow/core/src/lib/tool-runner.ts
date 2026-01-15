/**
 * ToolRunner - Command execution utility (WU-2537)
 * @module @lumenflow/core/lib
 */

import { spawn } from 'node:child_process';

export interface ToolRunnerOptions {
  cwd?: string;
  timeout?: number;
}

export interface ToolRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ToolRunner {
  private readonly cwd: string;
  private readonly timeout: number;

  constructor(options: ToolRunnerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeout = options.timeout ?? 30000;
  }

  async run(command: string, args: string[] = []): Promise<ToolRunResult> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: this.cwd,
        shell: false,
        stdio: 'pipe',
        timeout: this.timeout,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });

      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      proc.on('error', (err) => {
        resolve({ exitCode: 1, stdout, stderr: err.message });
      });
    });
  }

  async runOrThrow(command: string, args: string[] = []): Promise<ToolRunResult> {
    const result = await this.run(command, args);
    if (result.exitCode !== 0) {
      throw new Error(`Command ${command} failed: ${result.stderr}`);
    }
    return result;
  }

  async runWithRetry(
    command: string,
    args: string[] = [],
    maxRetries = 3
  ): Promise<ToolRunResult> {
    let lastResult: ToolRunResult | undefined;
    for (let i = 0; i <= maxRetries; i++) {
      lastResult = await this.run(command, args);
      if (lastResult.exitCode === 0) {
        return lastResult;
      }
    }
    return lastResult!;
  }
}
