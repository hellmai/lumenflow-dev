// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import {
  agentIssuesQueryTool,
  agentLogIssueTool,
  agentSessionEndTool,
  agentSessionTool,
} from '../tool-impl/agent-tools.js';

const AGENT_SESSION_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/agent-session.js',
);
const AGENT_SESSION_END_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/agent-session-end.js',
);
const AGENT_LOG_ISSUE_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/agent-log-issue.js',
);
const AGENT_ISSUES_QUERY_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/agent-issues-query.js',
);

describe('agent tool adapters (WU-1903)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('maps agent:session arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'session started',
      stderr: '',
      error: undefined,
    });

    const output = await agentSessionTool({
      wu: 'WU-1903',
      tier: 2,
      agent_type: 'codex-cli',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [AGENT_SESSION_SCRIPT_PATH, '--wu', 'WU-1903', '--tier', '2', '--agent-type', 'codex-cli'],
      expect.any(Object),
    );
  });

  it('requires wu and tier for agent:session', async () => {
    const missingWu = await agentSessionTool({ tier: 2 });
    const missingTier = await agentSessionTool({ wu: 'WU-1903' });

    expect(missingWu.success).toBe(false);
    expect(missingWu.error?.code).toBe('MISSING_PARAMETER');
    expect(missingTier.success).toBe(false);
    expect(missingTier.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('maps agent:session-end to CLI command with no arguments', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '{"summary":"done"}',
      stderr: '',
      error: undefined,
    });

    const output = await agentSessionEndTool({});

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [AGENT_SESSION_END_SCRIPT_PATH],
      expect.any(Object),
    );
  });

  it('maps agent:log-issue arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'issue logged',
      stderr: '',
      error: undefined,
    });

    const output = await agentLogIssueTool({
      category: 'workflow',
      severity: 'minor',
      title: 'Missing trace',
      description: 'Trace payload was missing fields',
      resolution: 'retry command',
      tags: ['runtime', 'telemetry'],
      step: 'wu:prep',
      files: ['packages/@lumenflow/mcp/src/runtime-tool-resolver.ts'],
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        AGENT_LOG_ISSUE_SCRIPT_PATH,
        '--category',
        'workflow',
        '--severity',
        'minor',
        '--title',
        'Missing trace',
        '--description',
        'Trace payload was missing fields',
        '--resolution',
        'retry command',
        '--tag',
        'runtime',
        '--tag',
        'telemetry',
        '--step',
        'wu:prep',
        '--file',
        'packages/@lumenflow/mcp/src/runtime-tool-resolver.ts',
      ],
      expect.any(Object),
    );
  });

  it('requires category, severity, title, and description for agent:log-issue', async () => {
    const missingCategory = await agentLogIssueTool({
      severity: 'minor',
      title: 'Issue',
      description: 'Description',
    });
    const missingSeverity = await agentLogIssueTool({
      category: 'workflow',
      title: 'Issue',
      description: 'Description',
    });
    const missingTitle = await agentLogIssueTool({
      category: 'workflow',
      severity: 'minor',
      description: 'Description',
    });
    const missingDescription = await agentLogIssueTool({
      category: 'workflow',
      severity: 'minor',
      title: 'Issue',
    });

    expect(missingCategory.success).toBe(false);
    expect(missingCategory.error?.code).toBe('MISSING_PARAMETER');
    expect(missingSeverity.success).toBe(false);
    expect(missingSeverity.error?.code).toBe('MISSING_PARAMETER');
    expect(missingTitle.success).toBe(false);
    expect(missingTitle.error?.code).toBe('MISSING_PARAMETER');
    expect(missingDescription.success).toBe(false);
    expect(missingDescription.error?.code).toBe('MISSING_PARAMETER');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('maps agent:issues-query arguments to CLI flags', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'summary',
      stderr: '',
      error: undefined,
    });

    const output = await agentIssuesQueryTool({
      since: 30,
      category: 'workflow',
      severity: 'minor',
    });

    expect(output.success).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      [
        AGENT_ISSUES_QUERY_SCRIPT_PATH,
        'summary',
        '--since',
        '30',
        '--category',
        'workflow',
        '--severity',
        'minor',
      ],
      expect.any(Object),
    );
  });

  it('returns tool-specific error code when command fails', async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'agent:session failed',
      error: undefined,
    });

    const output = await agentSessionTool({
      wu: 'WU-1903',
      tier: 2,
    });

    expect(output.success).toBe(false);
    expect(output.error?.code).toBe('AGENT_SESSION_ERROR');
    expect(output.error?.message).toContain('agent:session failed');
  });
});
