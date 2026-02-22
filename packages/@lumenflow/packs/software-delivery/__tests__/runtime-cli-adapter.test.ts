// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CLI_COMMANDS,
  createRuntimeCliAdapter,
  type RuntimeCliModule,
} from '../tool-impl/runtime-cli-adapter.js';

describe('runtime CLI adapter', () => {
  it('runs command main in-process and captures stdout/stderr', async () => {
    const capturedArgv: string[][] = [];

    const adapter = createRuntimeCliAdapter({
      loadModule: async () =>
        ({
          main: async () => {
            capturedArgv.push([...process.argv]);
            console.log('stdout line');
            console.error('stderr line');
          },
        }) satisfies RuntimeCliModule,
    });

    const result = await adapter.run(RUNTIME_CLI_COMMANDS.WU_STATUS, ['--id', 'WU-2047']);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stdout line');
    expect(result.stderr).toContain('stderr line');
    expect(capturedArgv).toEqual([[process.execPath, RUNTIME_CLI_COMMANDS.WU_STATUS, '--id', 'WU-2047']]);
  });

  it('maps process.exit(code) into non-throwing execution result', async () => {
    const adapter = createRuntimeCliAdapter({
      loadModule: async () =>
        ({
          main: async () => {
            process.exit(2);
          },
        }) satisfies RuntimeCliModule,
    });

    const result = await adapter.run(RUNTIME_CLI_COMMANDS.WU_STATUS, []);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(2);
    expect(result.executionError).toBeUndefined();
  });

  it('captures unexpected runtime errors as execution failures', async () => {
    const adapter = createRuntimeCliAdapter({
      loadModule: async () =>
        ({
          main: async () => {
            throw new Error('boom');
          },
        }) satisfies RuntimeCliModule,
    });

    const result = await adapter.run(RUNTIME_CLI_COMMANDS.WU_STATUS, []);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(1);
    expect(result.executionError).toBe('boom');
    expect(result.stderr).toContain('boom');
  });

  it('restores process state after execution', async () => {
    const originalArgv = [...process.argv];
    const originalExit = process.exit;

    const adapter = createRuntimeCliAdapter({
      loadModule: async () =>
        ({
          main: async () => {
            return undefined;
          },
        }) satisfies RuntimeCliModule,
    });

    await adapter.run(RUNTIME_CLI_COMMANDS.WU_STATUS, ['--json']);

    expect(process.argv).toEqual(originalArgv);
    expect(process.exit).toBe(originalExit);
  });

  it('serializes concurrent runs to avoid global process mutation overlap', async () => {
    const order: string[] = [];
    const releaseMap = new Map<string, () => void>();

    const adapter = createRuntimeCliAdapter({
      loadModule: async (command) =>
        ({
          main: async () => {
            order.push(`start:${command}`);
            await new Promise<void>((resolve) => {
              releaseMap.set(command, resolve);
            });
            order.push(`finish:${command}`);
          },
        }) satisfies RuntimeCliModule,
    });

    const runA = adapter.run(RUNTIME_CLI_COMMANDS.WU_STATUS, []);
    const runB = adapter.run(RUNTIME_CLI_COMMANDS.WU_VALIDATE, []);

    await vi.waitFor(() => {
      expect(order).toEqual([`start:${RUNTIME_CLI_COMMANDS.WU_STATUS}`]);
    });
    releaseMap.get(RUNTIME_CLI_COMMANDS.WU_STATUS)?.();
    await vi.waitFor(() => {
      expect(order).toContain(`start:${RUNTIME_CLI_COMMANDS.WU_VALIDATE}`);
    });
    releaseMap.get(RUNTIME_CLI_COMMANDS.WU_VALIDATE)?.();

    await Promise.all([runA, runB]);

    expect(order).toEqual([
      `start:${RUNTIME_CLI_COMMANDS.WU_STATUS}`,
      `finish:${RUNTIME_CLI_COMMANDS.WU_STATUS}`,
      `start:${RUNTIME_CLI_COMMANDS.WU_VALIDATE}`,
      `finish:${RUNTIME_CLI_COMMANDS.WU_VALIDATE}`,
    ]);
  });
});
