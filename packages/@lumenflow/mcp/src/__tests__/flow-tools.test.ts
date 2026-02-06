/**
 * @file flow-tools.test.ts
 * @description Tests for flow/metrics MCP tool implementations
 *
 * WU-1426: MCP tools for flow:bottlenecks, flow:report, metrics:snapshot
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  flowBottlenecksTool,
  flowReportTool,
  metricsSnapshotTool,
  metricsTool,
  lumenflowMetricsTool,
} from '../tools.js';
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

    // WU-1452: flow_bottlenecks must use --format json, not --json
    it('should use --format json flag (not --json) for CLI parity (WU-1452)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      });

      await flowBottlenecksTool.execute({ json: true });

      const calledArgs = mockRunCliCommand.mock.calls[0][1] as string[];
      // Must use --format json
      expect(calledArgs).toContain('--format');
      expect(calledArgs).toContain('json');
      // Must NOT use --json (CLI does not support it)
      expect(calledArgs).not.toContain('--json');
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

      // WU-1457: shared schema uses start/end (matching CLI flags, not the old since/until)
      await flowReportTool.execute({ start: '7d', end: 'now' });

      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'flow:report',
        expect.arrayContaining(['--start', '7d', '--end', 'now']),
        expect.any(Object),
      );
    });

    // WU-1452: flow_report must use --format json, not --json
    it('should use --format json flag (not --json) for CLI parity (WU-1452)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      });

      await flowReportTool.execute({ json: true });

      const calledArgs = mockRunCliCommand.mock.calls[0][1] as string[];
      // Must use --format json
      expect(calledArgs).toContain('--format');
      expect(calledArgs).toContain('json');
      // Must NOT use --json (CLI does not support it)
      expect(calledArgs).not.toContain('--json');
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

    // WU-1452: metrics_snapshot must NOT pass --json (CLI has no such flag)
    it('should not pass any json flag to CLI (WU-1452)', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
      });

      await metricsSnapshotTool.execute({ json: true });

      const calledArgs = mockRunCliCommand.mock.calls[0][1] as string[];
      // Must NOT pass --json or --format (CLI always outputs JSON, no flag needed)
      expect(calledArgs).not.toContain('--json');
      expect(calledArgs).not.toContain('--format');
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

  describe('metrics aliases (WU-1482)', () => {
    it('should run metrics command with subcommand and flags', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Metrics generated',
        stderr: '',
        exitCode: 0,
      });

      const result = await metricsTool.execute({
        subcommand: 'flow',
        days: 14,
        format: 'json',
        dry_run: true,
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'metrics',
        expect.arrayContaining(['flow', '--days', '14', '--format', 'json', '--dry-run']),
        expect.any(Object),
      );
    });

    it('should run lumenflow_metrics alias', async () => {
      mockRunCliCommand.mockResolvedValue({
        success: true,
        stdout: 'Alias metrics generated',
        stderr: '',
        exitCode: 0,
      });

      const result = await lumenflowMetricsTool.execute({
        subcommand: 'dora',
        format: 'table',
      });

      expect(result.success).toBe(true);
      expect(mockRunCliCommand).toHaveBeenCalledWith(
        'metrics',
        expect.arrayContaining(['dora', '--format', 'table']),
        expect.any(Object),
      );
    });
  });
});
