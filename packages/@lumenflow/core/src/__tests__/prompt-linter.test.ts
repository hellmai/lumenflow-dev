// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';
import { ProcessExitError } from '../error-handler.js';
import { EXIT_CODES } from '../wu-constants.js';
import { PROMPT_LINTER_FAILURE_MESSAGE, runPromptLinterCli } from '../prompt-linter.js';

describe('runPromptLinterCli', () => {
  it('maps ProcessExitError exit intent to boundary exit code', async () => {
    const setExitCode = vi.fn();
    const logError = vi.fn();
    const runMain = vi.fn(async () => {
      throw new ProcessExitError('Prompt lint failed', EXIT_CODES.ERROR);
    });

    await runPromptLinterCli({ runMain, setExitCode, logError });

    expect(setExitCode).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs failure message and sets error code for unexpected errors', async () => {
    const setExitCode = vi.fn();
    const logError = vi.fn();
    const runMain = vi.fn(async () => {
      throw new Error('boom');
    });

    await runPromptLinterCli({ runMain, setExitCode, logError });

    expect(logError).toHaveBeenCalledWith(PROMPT_LINTER_FAILURE_MESSAGE, expect.any(Error));
    expect(setExitCode).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });
});

describe('prompt-linter source contract', () => {
  it('does not call process.exit directly', async () => {
    const content = await readFile(new URL('../prompt-linter.ts', import.meta.url), 'utf-8');
    expect(content).not.toContain('process.exit(');
  });
});
