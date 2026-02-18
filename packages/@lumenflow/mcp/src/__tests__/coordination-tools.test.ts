/**
 * @file coordination-tools.test.ts
 * @description Tests for Agent, Orchestration, and Delegation MCP tool implementations
 *
 * WU-1425: MCP tools for agent coordination and orchestration:
 * - Agent (4): agent_session, agent_session_end, agent_log_issue, agent_issues_query
 * - Orchestration (3): orchestrate_initiative, orchestrate_init_status, orchestrate_monitor
 * - Delegation (1): delegation_list
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  agentSessionTool,
  agentSessionEndTool,
  agentLogIssueTool,
  agentIssuesQueryTool,
  orchestrateInitiativeTool,
  orchestrateInitStatusTool,
  orchestrateMonitorTool,
  delegationListTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';
import * as runtimeCache from '../runtime-cache.js';
import * as toolsShared from '../tools-shared.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

vi.mock('../runtime-cache.js', () => ({
  getRuntimeForWorkspace: vi.fn(),
  resetMcpRuntimeCache: vi.fn(),
}));

vi.mock('../tools-shared.js', async () => {
  const actual = await vi.importActual<typeof import('../tools-shared.js')>('../tools-shared.js');
  return {
    ...actual,
    executeViaPack: vi.fn(actual.executeViaPack),
  };
});

describe('Agent MCP tools (WU-1425)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('agent_session', () => {
    it('should start agent session via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Session started',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentSessionTool.execute({ wu: 'WU-1425', tier: 2 });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:session',
        expect.arrayContaining(['--wu', 'WU-1425', '--tier', '2']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await agentSessionTool.execute({ tier: 2 });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should require tier parameter', async () => {
      const result = await agentSessionTool.execute({ wu: 'WU-1425' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('tier');
    });

    it('should support agent_type option', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Session started',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentSessionTool.execute({
        wu: 'WU-1425',
        tier: 2,
        agent_type: 'gemini-cli',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:session',
        expect.arrayContaining(['--wu', 'WU-1425', '--tier', '2', '--agent-type', 'gemini-cli']),
        expect.any(Object),
      );
    });
  });

  describe('agent_session_end', () => {
    it('should end agent session via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({
          wu_id: 'WU-1425',
          lane: 'Framework: CLI',
          incidents_logged: 0,
          incidents_major: 0,
        }),
        stderr: '',
        exitCode: 0,
      });

      const result = await agentSessionEndTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:session-end',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should handle no active session gracefully', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'No active session to end.',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentSessionEndTool.execute({});

      expect(result.success).toBe(true);
    });
  });

  describe('agent_log_issue', () => {
    it('should log issue via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Issue logged',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentLogIssueTool.execute({
        category: 'workflow',
        severity: 'minor',
        title: 'Test issue',
        description: 'Test description',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:log-issue',
        expect.arrayContaining([
          '--category',
          'workflow',
          '--severity',
          'minor',
          '--title',
          'Test issue',
          '--description',
          'Test description',
        ]),
        expect.any(Object),
      );
    });

    it('should require category parameter', async () => {
      const result = await agentLogIssueTool.execute({
        severity: 'minor',
        title: 'Test',
        description: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('category');
    });

    it('should require severity parameter', async () => {
      const result = await agentLogIssueTool.execute({
        category: 'workflow',
        title: 'Test',
        description: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('severity');
    });

    it('should require title parameter', async () => {
      const result = await agentLogIssueTool.execute({
        category: 'workflow',
        severity: 'minor',
        description: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('title');
    });

    it('should require description parameter', async () => {
      const result = await agentLogIssueTool.execute({
        category: 'workflow',
        severity: 'minor',
        title: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('description');
    });

    it('should support optional parameters', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Issue logged',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentLogIssueTool.execute({
        category: 'tooling',
        severity: 'major',
        title: 'Test issue',
        description: 'Test description',
        resolution: 'Fixed it',
        tags: ['worktree', 'gates'],
        step: 'wu:done',
        files: ['src/main.ts', 'src/utils.ts'],
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:log-issue',
        expect.arrayContaining([
          '--category',
          'tooling',
          '--severity',
          'major',
          '--title',
          'Test issue',
          '--description',
          'Test description',
          '--resolution',
          'Fixed it',
          '--tag',
          'worktree',
          '--tag',
          'gates',
          '--step',
          'wu:done',
          '--file',
          'src/main.ts',
          '--file',
          'src/utils.ts',
        ]),
        expect.any(Object),
      );
    });
  });

  describe('agent_issues_query', () => {
    it('should query issues via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Summary displayed',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentIssuesQueryTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:issues-query',
        expect.arrayContaining(['summary']),
        expect.any(Object),
      );
    });

    it('should support since parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Summary displayed',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentIssuesQueryTool.execute({ since: 30 });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:issues-query',
        expect.arrayContaining(['summary', '--since', '30']),
        expect.any(Object),
      );
    });

    it('should support category filter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Summary displayed',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentIssuesQueryTool.execute({ category: 'tooling' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:issues-query',
        expect.arrayContaining(['summary', '--category', 'tooling']),
        expect.any(Object),
      );
    });

    it('should support severity filter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Summary displayed',
        stderr: '',
        exitCode: 0,
      });

      const result = await agentIssuesQueryTool.execute({ severity: 'blocker' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'agent:issues-query',
        expect.arrayContaining(['summary', '--severity', 'blocker']),
        expect.any(Object),
      );
    });
  });
});

describe('Orchestration MCP tools (WU-1425)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockGetRuntimeForWorkspace = vi.mocked(runtimeCache.getRuntimeForWorkspace);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  function mockRuntimeExecution(result: {
    success: boolean;
    data?: unknown;
    error?: { message: string };
  }) {
    const executeTool = vi.fn().mockResolvedValue(result);
    mockGetRuntimeForWorkspace.mockResolvedValue({
      executeTool,
    } as unknown as Awaited<ReturnType<typeof runtimeCache.getRuntimeForWorkspace>>);
    return executeTool;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('orchestrate_initiative', () => {
    it('should orchestrate initiative via executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Execution plan displayed' },
      });

      const result = await orchestrateInitiativeTool.execute({ initiative: 'INIT-001' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'orchestrate:initiative',
        expect.objectContaining({ initiative: 'INIT-001' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'orchestrate:initiative',
            args: expect.arrayContaining(['--initiative', 'INIT-001']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require initiative parameter', async () => {
      const result = await orchestrateInitiativeTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('initiative');
    });

    it('should support dry_run flag', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Dry run plan' },
      });

      const result = await orchestrateInitiativeTool.execute({
        initiative: 'INIT-001',
        dry_run: true,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'orchestrate:initiative',
        expect.objectContaining({
          initiative: 'INIT-001',
          dry_run: true,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--initiative', 'INIT-001', '--dry-run']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support progress flag', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Progress displayed' },
      });

      const result = await orchestrateInitiativeTool.execute({
        initiative: 'INIT-001',
        progress: true,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'orchestrate:initiative',
        expect.objectContaining({
          initiative: 'INIT-001',
          progress: true,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--initiative', 'INIT-001', '--progress']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should support checkpoint_per_wave flag', async () => {
      mockExecuteViaPack.mockResolvedValue({
        success: true,
        data: { message: 'Checkpoint wave output' },
      });

      const result = await orchestrateInitiativeTool.execute({
        initiative: 'INIT-001',
        checkpoint_per_wave: true,
      });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'orchestrate:initiative',
        expect.objectContaining({
          initiative: 'INIT-001',
          checkpoint_per_wave: true,
        }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            args: expect.arrayContaining(['--initiative', 'INIT-001', '--checkpoint-per-wave']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('orchestrate_init_status', () => {
    it('should show initiative status via runtime pack execution', async () => {
      const executeTool = mockRuntimeExecution({
        success: true,
        data: { message: 'Initiative status displayed' },
      });

      const result = await orchestrateInitStatusTool.execute({ initiative: 'INIT-001' });

      expect(result.success).toBe(true);
      expect(executeTool).toHaveBeenCalledWith(
        'orchestrate:init-status',
        { initiative: 'INIT-001' },
        expect.any(Object),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require initiative parameter', async () => {
      const result = await orchestrateInitStatusTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('initiative');
    });
  });

  describe('orchestrate_monitor', () => {
    it('should run monitor via runtime pack execution', async () => {
      const executeTool = mockRuntimeExecution({
        success: true,
        data: { message: 'Monitor output' },
      });

      const result = await orchestrateMonitorTool.execute({});

      expect(result.success).toBe(true);
      expect(executeTool).toHaveBeenCalledWith(
        'orchestrate:monitor',
        {
          threshold: undefined,
          recover: undefined,
          dry_run: undefined,
          since: undefined,
          wu: undefined,
          signals_only: undefined,
        },
        expect.any(Object),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it.each([
      [{ threshold: 15 }, { threshold: 15 }],
      [{ recover: true }, { recover: true }],
      [{ dry_run: true }, { dry_run: true }],
      [{ since: '30m' }, { since: '30m' }],
      [{ signals_only: true }, { signals_only: true }],
      [{ wu: 'WU-1425' }, { wu: 'WU-1425' }],
    ])('passes runtime input through for %o', async (toolInput, expectedPartialInput) => {
      const executeTool = mockRuntimeExecution({
        success: true,
        data: { message: 'Monitor output' },
      });

      const result = await orchestrateMonitorTool.execute(toolInput);

      expect(result.success).toBe(true);
      expect(executeTool).toHaveBeenCalledWith(
        'orchestrate:monitor',
        expect.objectContaining(expectedPartialInput),
        expect.any(Object),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });
});

describe('Delegation MCP tools (WU-1425)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockGetRuntimeForWorkspace = vi.mocked(runtimeCache.getRuntimeForWorkspace);

  function mockRuntimeExecution(result: {
    success: boolean;
    data?: unknown;
    error?: { message: string };
  }) {
    const executeTool = vi.fn().mockResolvedValue(result);
    mockGetRuntimeForWorkspace.mockResolvedValue({
      executeTool,
    } as unknown as Awaited<ReturnType<typeof runtimeCache.getRuntimeForWorkspace>>);
    return executeTool;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('delegation_list', () => {
    it('should list delegations for WU via runtime pack execution', async () => {
      const executeTool = mockRuntimeExecution({
        success: true,
        data: { message: 'Spawn tree displayed' },
      });

      const result = await delegationListTool.execute({ wu: 'WU-1425' });

      expect(result.success).toBe(true);
      expect(executeTool).toHaveBeenCalledWith(
        'delegation:list',
        {
          wu: 'WU-1425',
          initiative: undefined,
          json: undefined,
        },
        expect.any(Object),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should list delegations for initiative via runtime pack execution', async () => {
      const executeTool = mockRuntimeExecution({
        success: true,
        data: { message: 'Initiative spawns displayed' },
      });

      const result = await delegationListTool.execute({ initiative: 'INIT-001' });

      expect(result.success).toBe(true);
      expect(executeTool).toHaveBeenCalledWith(
        'delegation:list',
        {
          wu: undefined,
          initiative: 'INIT-001',
          json: undefined,
        },
        expect.any(Object),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('should require either wu or initiative parameter', async () => {
      const result = await delegationListTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/wu|initiative/i);
    });

    it('should support json output', async () => {
      const mockDelegations = [{ id: 'dlg-1', targetWuId: 'WU-1426', status: 'pending' }];
      const executeTool = mockRuntimeExecution({
        success: true,
        data: mockDelegations,
      });

      const result = await delegationListTool.execute({ wu: 'WU-1425', json: true });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDelegations);
      expect(executeTool).toHaveBeenCalledWith(
        'delegation:list',
        {
          wu: 'WU-1425',
          initiative: undefined,
          json: true,
        },
        expect.any(Object),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });
});
