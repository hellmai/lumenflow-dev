/**
 * @file flow-tools.test.ts
 * @description Tests for flow/metrics MCP tool implementations
 *
 * WU-1426: MCP tools for flow:bottlenecks, flow:report, metrics:snapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flowBottlenecksTool, flowReportTool, metricsSnapshotTool } from '../tools.js';
import * as cliRunner from '../cli-runner.js';

// Mock cli-runner for all operations
vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

describe('Flow/Metrics MCP tools (WU-1426)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('flow_bottlenecks', () => {
    it('should identify flow bottlenecks via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: JSON.stringify({
          bottlenecks: [{ lane: 'Framework: Core', wip: 2, limit: 1 }],
        }),
        stderr: '',
        exitCode: 0,
      });

      const result = await flowBottlenecksTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'flow:bottlenecks',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should pass json flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      });

      await flowBottlenecksTool.execute({ json: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'flow:bottlenecks',
        expect.arrayContaining(['--json']),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Failed to analyze bottlenecks',
        exitCode: 1,
      });

      const result = await flowBottlenecksTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed');
    });
  });

  describe('flow_report', () => {
    it('should generate flow report via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Flow report generated',
        stderr: '',
        exitCode: 0,
      });

      const result = await flowReportTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'flow:report',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should accept date range parameters', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Flow report generated',
        stderr: '',
        exitCode: 0,
      });

      await flowReportTool.execute({ since: '7d', until: 'now' });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'flow:report',
        expect.arrayContaining(['--since', '7d', '--until', 'now']),
        expect.any(Object),
      );
    });

    it('should pass json flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      });

      await flowReportTool.execute({ json: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'flow:report',
        expect.arrayContaining(['--json']),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Flow report failed',
        exitCode: 1,
      });

      const result = await flowReportTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });

  describe('metrics_snapshot', () => {
    it('should capture metrics snapshot via CLI shell-out', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Metrics snapshot captured',
        stderr: '',
        exitCode: 0,
      });

      const result = await metricsSnapshotTool.execute({});

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'metrics:snapshot',
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should pass json flag when requested', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      });

      await metricsSnapshotTool.execute({ json: true });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'metrics:snapshot',
        expect.arrayContaining(['--json']),
        expect.any(Object),
      );
    });

    it('should return error on failure', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Metrics snapshot failed',
        exitCode: 1,
      });

      const result = await metricsSnapshotTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('failed');
    });
  });
});
