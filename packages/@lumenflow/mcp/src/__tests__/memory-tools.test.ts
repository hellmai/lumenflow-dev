/**
 * @file memory-tools.test.ts
 * @description Tests for Memory MCP tool implementations
 *
 * WU-1424: 13 memory tools: mem_init, mem_start, mem_ready, mem_checkpoint, mem_cleanup,
 * mem_context, mem_create, mem_delete, mem_export, mem_inbox, mem_signal, mem_summarize, mem_triage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  memInitTool,
  memStartTool,
  memReadyTool,
  memCheckpointTool,
  memCleanupTool,
  memContextTool,
  memCreateTool,
  memDeleteTool,
  memExportTool,
  memInboxTool,
  memSignalTool,
  memSummarizeTool,
  memTriageTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('Memory MCP tools (WU-1424)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mem_init', () => {
    it('should initialize memory via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Memory initialized for WU-1424',
        stderr: '',
        exitCode: 0,
      });

      const result = await memInitTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:init',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memInitTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });
  });

  describe('mem_start', () => {
    it('should start memory session via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Session started for WU-1424',
        stderr: '',
        exitCode: 0,
      });

      const result = await memStartTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:start',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memStartTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support lane parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Session started',
        stderr: '',
        exitCode: 0,
      });

      const result = await memStartTool.execute({ wu: 'WU-1424', lane: 'Framework: CLI' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:start',
        expect.arrayContaining(['--wu', 'WU-1424', '--lane', 'Framework: CLI']),
        expect.any(Object),
      );
    });
  });

  describe('mem_ready', () => {
    it('should check pending nodes via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ pending: 3, nodes: [] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memReadyTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:ready',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memReadyTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });
  });

  describe('mem_checkpoint', () => {
    it('should save checkpoint via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Checkpoint saved',
        stderr: '',
        exitCode: 0,
      });

      const result = await memCheckpointTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:checkpoint',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memCheckpointTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support message parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Checkpoint saved with message',
        stderr: '',
        exitCode: 0,
      });

      const result = await memCheckpointTool.execute({
        wu: 'WU-1424',
        message: 'Before risky operation',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:checkpoint',
        expect.arrayContaining(['--wu', 'WU-1424', '--message', 'Before risky operation']),
        expect.any(Object),
      );
    });
  });

  describe('mem_cleanup', () => {
    it('should cleanup memory via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Stale memory data cleaned',
        stderr: '',
        exitCode: 0,
      });

      const result = await memCleanupTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith('mem:cleanup', [], expect.any(Object));
    });

    it('should support dry-run mode', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Would clean 5 stale nodes',
        stderr: '',
        exitCode: 0,
      });

      const result = await memCleanupTool.execute({ dry_run: true });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:cleanup',
        expect.arrayContaining(['--dry-run']),
        expect.any(Object),
      );
    });
  });

  describe('mem_context', () => {
    it('should get context via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ wu: 'WU-1424', lane: 'Framework: CLI', signals: [] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memContextTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:context',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memContextTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support lane filter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ lane: 'Framework: CLI' }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memContextTool.execute({ wu: 'WU-1424', lane: 'Framework: CLI' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:context',
        expect.arrayContaining(['--wu', 'WU-1424', '--lane', 'Framework: CLI']),
        expect.any(Object),
      );
    });
  });

  describe('mem_create', () => {
    it('should create memory node via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Node created: node-123',
        stderr: '',
        exitCode: 0,
      });

      const result = await memCreateTool.execute({
        message: 'Bug: Found issue in parser',
        wu: 'WU-1424',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:create',
        expect.arrayContaining(['Bug: Found issue in parser', '--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require message parameter', async () => {
      const result = await memCreateTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('message');
    });

    it('should require wu parameter', async () => {
      const result = await memCreateTool.execute({ message: 'Test message' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support type and tags parameters', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Node created',
        stderr: '',
        exitCode: 0,
      });

      const result = await memCreateTool.execute({
        message: 'Bug: Parser issue',
        wu: 'WU-1424',
        type: 'discovery',
        tags: ['bug', 'parser'],
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:create',
        expect.arrayContaining([
          'Bug: Parser issue',
          '--wu',
          'WU-1424',
          '--type',
          'discovery',
          '--tags',
          'bug,parser',
        ]),
        expect.any(Object),
      );
    });
  });

  describe('mem_delete', () => {
    it('should delete memory node via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Node deleted',
        stderr: '',
        exitCode: 0,
      });

      const result = await memDeleteTool.execute({ id: 'node-123' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:delete',
        expect.arrayContaining(['--id', 'node-123']),
        expect.any(Object),
      );
    });

    it('should require id parameter', async () => {
      const result = await memDeleteTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('id');
    });
  });

  describe('mem_export', () => {
    it('should export memory as markdown via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '# Memory Export\n\n## WU-1424...',
        stderr: '',
        exitCode: 0,
      });

      const result = await memExportTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:export',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memExportTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support format parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{"wu":"WU-1424",...}',
        stderr: '',
        exitCode: 0,
      });

      const result = await memExportTool.execute({ wu: 'WU-1424', format: 'json' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:export',
        expect.arrayContaining(['--wu', 'WU-1424', '--format', 'json']),
        expect.any(Object),
      );
    });
  });

  describe('mem_inbox', () => {
    it('should check coordination signals via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ signals: [{ type: 'progress', wu: 'WU-1424' }] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memInboxTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith('mem:inbox', [], expect.any(Object));
    });

    it('should support since parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ signals: [] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memInboxTool.execute({ since: '30m' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:inbox',
        expect.arrayContaining(['--since', '30m']),
        expect.any(Object),
      );
    });

    it('should support wu filter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ signals: [] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memInboxTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:inbox',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should support lane filter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ signals: [] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memInboxTool.execute({ lane: 'Framework: CLI' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:inbox',
        expect.arrayContaining(['--lane', 'Framework: CLI']),
        expect.any(Object),
      );
    });
  });

  describe('mem_signal', () => {
    it('should broadcast signal via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Signal broadcast',
        stderr: '',
        exitCode: 0,
      });

      const result = await memSignalTool.execute({
        message: 'AC1 complete: tests passing',
        wu: 'WU-1424',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:signal',
        expect.arrayContaining(['AC1 complete: tests passing', '--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require message parameter', async () => {
      const result = await memSignalTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('message');
    });

    it('should require wu parameter', async () => {
      const result = await memSignalTool.execute({ message: 'Test signal' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });
  });

  describe('mem_summarize', () => {
    it('should summarize memory context via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Summary: WU-1424 has 3 checkpoints...',
        stderr: '',
        exitCode: 0,
      });

      const result = await memSummarizeTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:summarize',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memSummarizeTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });
  });

  describe('mem_triage', () => {
    it('should triage discovered bugs via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({ discoveries: [{ id: 'node-1', message: 'Bug found' }] }),
        stderr: '',
        exitCode: 0,
      });

      const result = await memTriageTool.execute({ wu: 'WU-1424' });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:triage',
        expect.arrayContaining(['--wu', 'WU-1424']),
        expect.any(Object),
      );
    });

    it('should require wu parameter', async () => {
      const result = await memTriageTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('wu');
    });

    it('should support promote parameter', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Bug promoted to WU',
        stderr: '',
        exitCode: 0,
      });

      const result = await memTriageTool.execute({
        wu: 'WU-1424',
        promote: 'node-123',
        lane: 'Framework: Core',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'mem:triage',
        expect.arrayContaining([
          '--wu',
          'WU-1424',
          '--promote',
          'node-123',
          '--lane',
          'Framework: Core',
        ]),
        expect.any(Object),
      );
    });
  });
});
