// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';
import { ProcessExitError } from '../error-handler.js';
import { EXIT_CODES } from '../wu-constants.js';
import { PROMPT_MONITOR_FAILURE_MESSAGE, runMonitorCli } from '../prompt-monitor.js';

describe('runMonitorCli', () => {
  it('maps ProcessExitError exit intent to boundary exit code', async () => {
    const setExitCode = vi.fn();
    const logError = vi.fn();
    const runMonitor = vi.fn(async () => {
      throw new ProcessExitError('Prompt alerts detected', EXIT_CODES.ERROR);
    });

    await runMonitorCli({ runMonitor, setExitCode, logError });

    expect(setExitCode).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs failure message and sets error code for unexpected errors', async () => {
    const setExitCode = vi.fn();
    const logError = vi.fn();
    const runMonitor = vi.fn(async () => {
      throw new Error('boom');
    });

    await runMonitorCli({ runMonitor, setExitCode, logError });

    expect(logError).toHaveBeenCalledWith(PROMPT_MONITOR_FAILURE_MESSAGE, expect.any(Error));
    expect(setExitCode).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });
});

describe('prompt-monitor source contract', () => {
  it('does not call process.exit directly', async () => {
    const content = await readFile(new URL('../prompt-monitor.ts', import.meta.url), 'utf-8');
    expect(content).not.toContain('process.exit(');
  });
});
