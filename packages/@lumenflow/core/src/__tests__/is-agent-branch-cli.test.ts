// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';
import { ProcessExitError } from '../error-handler.js';
import { EXIT_CODES } from '../wu-constants.js';
import { AGENT_BRANCH_CHECK_FAILURE_MESSAGE, runIsAgentBranchCli } from '../cli/is-agent-branch.js';

describe('runIsAgentBranchCli', () => {
  it('maps ProcessExitError exit intent to boundary exit code', async () => {
    const setExitCode = vi.fn();
    const logError = vi.fn();
    const runMain = vi.fn(async () => {
      throw new ProcessExitError('Not an agent branch', EXIT_CODES.ERROR);
    });

    await runIsAgentBranchCli({ runMain, setExitCode, logError });

    expect(setExitCode).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs failure message and sets fail-closed code for unexpected errors', async () => {
    const setExitCode = vi.fn();
    const logError = vi.fn();
    const runMain = vi.fn(async () => {
      throw new Error('registry failure');
    });

    await runIsAgentBranchCli({ runMain, setExitCode, logError });

    expect(logError).toHaveBeenCalledWith(AGENT_BRANCH_CHECK_FAILURE_MESSAGE, 'registry failure');
    expect(setExitCode).toHaveBeenCalledWith(EXIT_CODES.ERROR);
  });
});

describe('is-agent-branch source contract', () => {
  it('does not call process.exit directly', async () => {
    const content = await readFile(new URL('../cli/is-agent-branch.ts', import.meta.url), 'utf-8');
    expect(content).not.toContain('process.exit(');
  });
});
