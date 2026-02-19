// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file flow-metrics-tools.test.ts
 * @description Tests for flow/metrics software-delivery pack handlers
 *
 * WU-1905: Migrate flow:bottlenecks, flow:report, metrics, and metrics:snapshot
 * from resolver fallback stubs to native software-delivery pack handlers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

import {
  flowBottlenecksTool,
  flowReportTool,
  metricsTool,
  metricsSnapshotTool,
} from '../tool-impl/flow-metrics-tools.js';

const CLI_ENTRY_SCRIPT_PATH = path.resolve(process.cwd(), 'tools/cli-entry.mjs');
const FLOW_BOTTLENECKS_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/flow-bottlenecks.js',
);
const FLOW_REPORT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/flow-report.js',
);
const METRICS_SNAPSHOT_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/metrics-snapshot.js',
);
const METRICS_CLI_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'packages/@lumenflow/cli/dist/metrics-cli.js',
);

describe('flow/metrics tool adapters (WU-1905)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  describe('flow:bottlenecks', () => {
    it('runs flow:bottlenecks with default arguments', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'No bottlenecks found',
        stderr: '',
        error: undefined,
      });

      const output = await flowBottlenecksTool({});

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_BOTTLENECKS_SCRIPT_PATH],
        expect.objectContaining({
          cwd: process.cwd(),
          encoding: 'utf8',
        }),
      );
    });

    it('passes --limit flag when limit is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Bottleneck analysis complete',
        stderr: '',
        error: undefined,
      });

      const output = await flowBottlenecksTool({ limit: 5 });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_BOTTLENECKS_SCRIPT_PATH, '--limit', '5'],
        expect.any(Object),
      );
    });

    it('passes --format flag when format is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '{"bottlenecks":[]}',
        stderr: '',
        error: undefined,
      });

      const output = await flowBottlenecksTool({ format: 'json' });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_BOTTLENECKS_SCRIPT_PATH, '--format', 'json'],
        expect.any(Object),
      );
    });

    it('returns tool-specific error code when command fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'flow:bottlenecks failed',
        error: undefined,
      });

      const output = await flowBottlenecksTool({});

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('FLOW_BOTTLENECKS_ERROR');
      expect(output.error?.message).toContain('flow:bottlenecks failed');
    });
  });

  describe('flow:report', () => {
    it('runs flow:report with default arguments', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Flow report generated',
        stderr: '',
        error: undefined,
      });

      const output = await flowReportTool({});

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_REPORT_SCRIPT_PATH],
        expect.objectContaining({
          cwd: process.cwd(),
          encoding: 'utf8',
        }),
      );
    });

    it('passes --days flag when days is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Flow report for 14 days',
        stderr: '',
        error: undefined,
      });

      const output = await flowReportTool({ days: 14 });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_REPORT_SCRIPT_PATH, '--days', '14'],
        expect.any(Object),
      );
    });

    it('passes --start and --end flags when date range is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Flow report for date range',
        stderr: '',
        error: undefined,
      });

      const output = await flowReportTool({
        start: '2026-01-01',
        end: '2026-02-01',
      });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_REPORT_SCRIPT_PATH, '--start', '2026-01-01', '--end', '2026-02-01'],
        expect.any(Object),
      );
    });

    it('passes --format flag when format is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '{"report":{}}',
        stderr: '',
        error: undefined,
      });

      const output = await flowReportTool({ format: 'json' });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [FLOW_REPORT_SCRIPT_PATH, '--format', 'json'],
        expect.any(Object),
      );
    });

    it('returns tool-specific error code when command fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'flow:report failed',
        error: undefined,
      });

      const output = await flowReportTool({});

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('FLOW_REPORT_ERROR');
      expect(output.error?.message).toContain('flow:report failed');
    });
  });

  describe('metrics', () => {
    it('runs metrics with default arguments', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Metrics summary',
        stderr: '',
        error: undefined,
      });

      const output = await metricsTool({});

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [METRICS_CLI_SCRIPT_PATH],
        expect.objectContaining({
          cwd: process.cwd(),
          encoding: 'utf8',
        }),
      );
    });

    it('passes subcommand when provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Flow metrics',
        stderr: '',
        error: undefined,
      });

      const output = await metricsTool({ subcommand: 'flow' });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [METRICS_CLI_SCRIPT_PATH, 'flow'],
        expect.any(Object),
      );
    });

    it('passes --days flag when days is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Weekly metrics',
        stderr: '',
        error: undefined,
      });

      const output = await metricsTool({ days: 7 });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [METRICS_CLI_SCRIPT_PATH, '--days', '7'],
        expect.any(Object),
      );
    });

    it('passes --format flag when format is provided', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: '{"metrics":{}}',
        stderr: '',
        error: undefined,
      });

      const output = await metricsTool({ format: 'json' });

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [METRICS_CLI_SCRIPT_PATH, '--format', 'json'],
        expect.any(Object),
      );
    });

    it('returns tool-specific error code when command fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'metrics command failed',
        error: undefined,
      });

      const output = await metricsTool({});

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('METRICS_ERROR');
      expect(output.error?.message).toContain('metrics command failed');
    });
  });

  describe('metrics:snapshot', () => {
    it('runs metrics:snapshot with no arguments', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Snapshot captured',
        stderr: '',
        error: undefined,
      });

      const output = await metricsSnapshotTool({});

      expect(output.success).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        process.execPath,
        [METRICS_SNAPSHOT_SCRIPT_PATH],
        expect.objectContaining({
          cwd: process.cwd(),
          encoding: 'utf8',
        }),
      );
    });

    it('returns tool-specific error code when command fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'metrics:snapshot failed',
        error: undefined,
      });

      const output = await metricsSnapshotTool({});

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('METRICS_SNAPSHOT_ERROR');
      expect(output.error?.message).toContain('metrics:snapshot failed');
    });

    it('handles spawn error gracefully', async () => {
      spawnSyncMock.mockReturnValue({
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('ENOENT: node not found'),
      });

      const output = await metricsSnapshotTool({});

      expect(output.success).toBe(false);
      expect(output.error?.code).toBe('METRICS_SNAPSHOT_ERROR');
    });
  });
});
