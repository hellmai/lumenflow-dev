/**
 * @file metrics-cli.test.ts
 * @description Tests for unified metrics CLI with subcommands (WU-1110)
 *
 * TDD: RED phase - Write tests before implementation.
 *
 * Acceptance criteria:
 * - metrics-cli.ts exists with subcommands (lanes, dora, flow)
 * - All metrics/application modules migrated
 * - Existing tests ported to Vitest
 * - >80% coverage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('metrics-cli module', () => {
  it('should have the CLI source file', () => {
    const srcPath = join(__dirname, '../metrics-cli.ts');
    expect(existsSync(srcPath)).toBe(true);
  });

  it('should be buildable (dist file exists after build)', () => {
    const distPath = join(__dirname, '../../dist/metrics-cli.js');
    expect(existsSync(distPath)).toBe(true);
  });
});

describe('metrics-cli subcommands', () => {
  // Mock console output
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.resetModules();
  });

  describe('parseCommand', () => {
    it('should export parseCommand function', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      expect(typeof parseCommand).toBe('function');
    });

    it('should parse "lanes" subcommand', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', 'lanes']);
      expect(result.subcommand).toBe('lanes');
    });

    it('should parse "dora" subcommand', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', 'dora']);
      expect(result.subcommand).toBe('dora');
    });

    it('should parse "flow" subcommand', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', 'flow']);
      expect(result.subcommand).toBe('flow');
    });

    it('should default to "all" when no subcommand given', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics']);
      expect(result.subcommand).toBe('all');
    });

    it('should parse --days option', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', 'dora', '--days', '30']);
      expect(result.days).toBe(30);
    });

    it('should parse --format option', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', 'lanes', '--format', 'table']);
      expect(result.format).toBe('table');
    });

    it('should parse --output option', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', '--output', 'custom.json']);
      expect(result.output).toBe('custom.json');
    });

    it('should parse --dry-run flag', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', '--dry-run']);
      expect(result.dryRun).toBe(true);
    });
  });

  describe('MetricsCommandResult type', () => {
    it('should have proper subcommand type', async () => {
      const { parseCommand } = await import('../metrics-cli.js');
      const result = parseCommand(['node', 'metrics', 'dora']);

      // Type check: subcommand should be one of 'lanes' | 'dora' | 'flow' | 'all'
      expect(['lanes', 'dora', 'flow', 'all']).toContain(result.subcommand);
    });
  });

  describe('runLanesSubcommand', () => {
    it('should export runLanesSubcommand function', async () => {
      const { runLanesSubcommand } = await import('../metrics-cli.js');
      expect(typeof runLanesSubcommand).toBe('function');
    });
  });

  describe('runDoraSubcommand', () => {
    it('should export runDoraSubcommand function', async () => {
      const { runDoraSubcommand } = await import('../metrics-cli.js');
      expect(typeof runDoraSubcommand).toBe('function');
    });
  });

  describe('runFlowSubcommand', () => {
    it('should export runFlowSubcommand function', async () => {
      const { runFlowSubcommand } = await import('../metrics-cli.js');
      expect(typeof runFlowSubcommand).toBe('function');
    });
  });

  describe('runAllSubcommand', () => {
    it('should export runAllSubcommand function', async () => {
      const { runAllSubcommand } = await import('../metrics-cli.js');
      expect(typeof runAllSubcommand).toBe('function');
    });
  });
});

describe('metrics-cli integration', () => {
  describe('lanes subcommand', () => {
    it('should calculate lane health from WU data', async () => {
      const { calculateLaneHealthFromWUs } = await import('../metrics-cli.js');

      const wuMetrics = [
        { id: 'WU-1', title: 'A', lane: 'Framework: Core', status: 'done' as const },
        { id: 'WU-2', title: 'B', lane: 'Framework: Core', status: 'in_progress' as const },
        { id: 'WU-3', title: 'C', lane: 'Framework: CLI', status: 'blocked' as const },
      ];

      const result = calculateLaneHealthFromWUs(wuMetrics);

      expect(result.lanes).toBeDefined();
      expect(result.lanes.length).toBeGreaterThan(0);
      expect(result.totalActive).toBeGreaterThanOrEqual(0);
      expect(result.totalBlocked).toBe(1);
    });
  });

  describe('dora subcommand', () => {
    it('should calculate DORA metrics from commits and WUs', async () => {
      const { calculateDoraFromData } = await import('../metrics-cli.js');

      const commits = [
        { hash: 'a1', timestamp: new Date('2026-01-02'), message: 'feat: add feature' },
        { hash: 'a2', timestamp: new Date('2026-01-03'), message: 'fix: bug fix' },
      ];

      const wuMetrics = [
        {
          id: 'WU-1',
          title: 'A',
          lane: 'Ops',
          status: 'done' as const,
          cycleTimeHours: 12,
        },
      ];

      const skipGatesEntries: Array<{
        timestamp: Date;
        wuId: string;
        reason: string;
        gate: string;
      }> = [];

      const weekStart = new Date('2026-01-01');
      const weekEnd = new Date('2026-01-07');

      const result = calculateDoraFromData({
        commits,
        wuMetrics,
        skipGatesEntries,
        weekStart,
        weekEnd,
      });

      expect(result.deploymentFrequency).toBeDefined();
      expect(result.leadTimeForChanges).toBeDefined();
      expect(result.changeFailureRate).toBeDefined();
      expect(result.meanTimeToRecovery).toBeDefined();
    });
  });

  describe('flow subcommand', () => {
    it('should calculate flow state from WU data', async () => {
      const { calculateFlowFromWUs } = await import('../metrics-cli.js');

      const wuMetrics = [
        { id: 'WU-1', title: 'A', lane: 'Ops', status: 'ready' as const },
        { id: 'WU-2', title: 'B', lane: 'Ops', status: 'in_progress' as const },
        { id: 'WU-3', title: 'C', lane: 'Ops', status: 'blocked' as const },
        { id: 'WU-4', title: 'D', lane: 'Ops', status: 'done' as const },
      ];

      const result = calculateFlowFromWUs(wuMetrics);

      expect(result.ready).toBe(1);
      expect(result.inProgress).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.done).toBe(1);
      expect(result.totalActive).toBe(3); // ready + in_progress + blocked
    });
  });
});

describe('metrics-cli formatters', () => {
  describe('formatLanesOutput', () => {
    it('should export formatLanesOutput function', async () => {
      const { formatLanesOutput } = await import('../metrics-cli.js');
      expect(typeof formatLanesOutput).toBe('function');
    });

    it('should format lanes as JSON by default', async () => {
      const { formatLanesOutput } = await import('../metrics-cli.js');
      const lanes = {
        lanes: [
          {
            lane: 'Framework: Core',
            wusCompleted: 5,
            wusInProgress: 2,
            wusBlocked: 0,
            averageCycleTimeHours: 24,
            medianCycleTimeHours: 20,
            status: 'healthy' as const,
          },
        ],
        totalActive: 7,
        totalBlocked: 0,
        totalCompleted: 5,
      };

      const result = formatLanesOutput(lanes, 'json');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('should format lanes as table', async () => {
      const { formatLanesOutput } = await import('../metrics-cli.js');
      const lanes = {
        lanes: [
          {
            lane: 'Framework: Core',
            wusCompleted: 5,
            wusInProgress: 2,
            wusBlocked: 0,
            averageCycleTimeHours: 24,
            medianCycleTimeHours: 20,
            status: 'healthy' as const,
          },
        ],
        totalActive: 7,
        totalBlocked: 0,
        totalCompleted: 5,
      };

      const result = formatLanesOutput(lanes, 'table');
      expect(result).toContain('Framework: Core');
      expect(result).toContain('[ok]'); // [ok] = healthy, [!] = at-risk, [x] = blocked
    });
  });

  describe('formatDoraOutput', () => {
    it('should export formatDoraOutput function', async () => {
      const { formatDoraOutput } = await import('../metrics-cli.js');
      expect(typeof formatDoraOutput).toBe('function');
    });

    it('should format DORA as JSON', async () => {
      const { formatDoraOutput } = await import('../metrics-cli.js');
      const dora = {
        deploymentFrequency: { deploysPerWeek: 5, status: 'elite' as const },
        leadTimeForChanges: {
          averageHours: 12,
          medianHours: 10,
          p90Hours: 20,
          status: 'elite' as const,
        },
        changeFailureRate: {
          failurePercentage: 5,
          totalDeployments: 100,
          failures: 5,
          status: 'elite' as const,
        },
        meanTimeToRecovery: { averageHours: 1, incidents: 2, status: 'elite' as const },
      };

      const result = formatDoraOutput(dora, 'json');
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.deploymentFrequency.deploysPerWeek).toBe(5);
    });

    it('should format DORA as table', async () => {
      const { formatDoraOutput } = await import('../metrics-cli.js');
      const dora = {
        deploymentFrequency: { deploysPerWeek: 5, status: 'elite' as const },
        leadTimeForChanges: {
          averageHours: 12,
          medianHours: 10,
          p90Hours: 20,
          status: 'elite' as const,
        },
        changeFailureRate: {
          failurePercentage: 5,
          totalDeployments: 100,
          failures: 5,
          status: 'elite' as const,
        },
        meanTimeToRecovery: { averageHours: 1, incidents: 2, status: 'elite' as const },
      };

      const result = formatDoraOutput(dora, 'table');
      expect(result).toContain('DORA METRICS');
      expect(result).toContain('Deployment Frequency');
      expect(result).toContain('elite');
      expect(result).toContain('Lead Time');
      expect(result).toContain('MTTR');
    });
  });

  describe('formatFlowOutput', () => {
    it('should export formatFlowOutput function', async () => {
      const { formatFlowOutput } = await import('../metrics-cli.js');
      expect(typeof formatFlowOutput).toBe('function');
    });

    it('should format flow as JSON', async () => {
      const { formatFlowOutput } = await import('../metrics-cli.js');
      const flow = {
        ready: 5,
        inProgress: 3,
        blocked: 1,
        waiting: 0,
        done: 10,
        totalActive: 9,
      };

      const result = formatFlowOutput(flow, 'json');
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.ready).toBe(5);
      expect(parsed.totalActive).toBe(9);
    });

    it('should format flow as table', async () => {
      const { formatFlowOutput } = await import('../metrics-cli.js');
      const flow = {
        ready: 5,
        inProgress: 3,
        blocked: 1,
        waiting: 0,
        done: 10,
        totalActive: 9,
      };

      const result = formatFlowOutput(flow, 'table');
      expect(result).toContain('FLOW STATE');
      expect(result).toContain('Ready: 5');
      expect(result).toContain('In Progress: 3');
      expect(result).toContain('Blocked: 1');
      expect(result).toContain('Done: 10');
    });
  });

  describe('formatLanesOutput edge cases', () => {
    it('should handle at-risk status', async () => {
      const { formatLanesOutput } = await import('../metrics-cli.js');
      const lanes = {
        lanes: [
          {
            lane: 'Framework: CLI',
            wusCompleted: 2,
            wusInProgress: 1,
            wusBlocked: 1,
            averageCycleTimeHours: 48,
            medianCycleTimeHours: 40,
            status: 'at-risk' as const,
          },
        ],
        totalActive: 4,
        totalBlocked: 1,
        totalCompleted: 2,
      };

      const result = formatLanesOutput(lanes, 'table');
      expect(result).toContain('[!]'); // at-risk indicator
    });

    it('should handle blocked status', async () => {
      const { formatLanesOutput } = await import('../metrics-cli.js');
      const lanes = {
        lanes: [
          {
            lane: 'Operations',
            wusCompleted: 0,
            wusInProgress: 0,
            wusBlocked: 3,
            averageCycleTimeHours: 0,
            medianCycleTimeHours: 0,
            status: 'blocked' as const,
          },
        ],
        totalActive: 3,
        totalBlocked: 3,
        totalCompleted: 0,
      };

      const result = formatLanesOutput(lanes, 'table');
      expect(result).toContain('[x]'); // blocked indicator
    });

    it('should handle empty lanes array', async () => {
      const { formatLanesOutput } = await import('../metrics-cli.js');
      const lanes = {
        lanes: [],
        totalActive: 0,
        totalBlocked: 0,
        totalCompleted: 0,
      };

      const result = formatLanesOutput(lanes, 'table');
      expect(result).toContain('LANE HEALTH');
      expect(result).toContain('Total Active: 0');
    });
  });
});

describe('metrics-cli parseCommand edge cases', () => {
  it('should handle invalid subcommand gracefully', async () => {
    const { parseCommand } = await import('../metrics-cli.js');
    const result = parseCommand(['node', 'metrics', 'invalid']);
    // Invalid subcommand should default to 'all'
    expect(result.subcommand).toBe('all');
  });

  it('should handle explicit "all" subcommand', async () => {
    const { parseCommand } = await import('../metrics-cli.js');
    const result = parseCommand(['node', 'metrics', 'all']);
    expect(result.subcommand).toBe('all');
  });

  it('should use default days when not specified', async () => {
    const { parseCommand } = await import('../metrics-cli.js');
    const result = parseCommand(['node', 'metrics']);
    expect(result.days).toBe(7);
  });

  it('should use default format when not specified', async () => {
    const { parseCommand } = await import('../metrics-cli.js');
    const result = parseCommand(['node', 'metrics']);
    expect(result.format).toBe('json');
  });

  it('should use default output path when not specified', async () => {
    const { parseCommand } = await import('../metrics-cli.js');
    const result = parseCommand(['node', 'metrics']);
    expect(result.output).toContain('.lumenflow/snapshots/metrics-latest.json');
  });

  it('should handle dryRun false by default', async () => {
    const { parseCommand } = await import('../metrics-cli.js');
    const result = parseCommand(['node', 'metrics']);
    expect(result.dryRun).toBe(false);
  });
});

describe('metrics-cli calculation functions', () => {
  describe('calculateLaneHealthFromWUs', () => {
    it('should handle empty WU list', async () => {
      const { calculateLaneHealthFromWUs } = await import('../metrics-cli.js');
      const result = calculateLaneHealthFromWUs([]);
      expect(result.lanes).toEqual([]);
      expect(result.totalActive).toBe(0);
    });

    it('should correctly count ready WUs as active', async () => {
      const { calculateLaneHealthFromWUs } = await import('../metrics-cli.js');
      const wuMetrics = [{ id: 'WU-1', title: 'A', lane: 'Test', status: 'ready' as const }];

      const result = calculateLaneHealthFromWUs(wuMetrics);
      expect(result.totalActive).toBe(1);
    });

    it('should correctly count waiting WUs as active', async () => {
      const { calculateLaneHealthFromWUs } = await import('../metrics-cli.js');
      const wuMetrics = [{ id: 'WU-1', title: 'A', lane: 'Test', status: 'waiting' as const }];

      const result = calculateLaneHealthFromWUs(wuMetrics);
      expect(result.totalActive).toBe(1);
    });
  });

  describe('calculateDoraFromData', () => {
    it('should handle empty commit list', async () => {
      const { calculateDoraFromData } = await import('../metrics-cli.js');
      const result = calculateDoraFromData({
        commits: [],
        wuMetrics: [],
        skipGatesEntries: [],
        weekStart: new Date('2026-01-01'),
        weekEnd: new Date('2026-01-07'),
      });

      expect(result.deploymentFrequency.deploysPerWeek).toBe(0);
    });

    it('should handle skip gates entries', async () => {
      const { calculateDoraFromData } = await import('../metrics-cli.js');
      const commits = [
        { hash: 'a1', timestamp: new Date('2026-01-02'), message: 'feat: a' },
        { hash: 'a2', timestamp: new Date('2026-01-03'), message: 'feat: b' },
      ];

      const skipGatesEntries = [
        { timestamp: new Date(), wuId: 'WU-1', reason: 'test', gate: 'lint' },
      ];

      const result = calculateDoraFromData({
        commits,
        wuMetrics: [],
        skipGatesEntries,
        weekStart: new Date('2026-01-01'),
        weekEnd: new Date('2026-01-07'),
      });

      expect(result.changeFailureRate.failures).toBe(1);
    });
  });

  describe('calculateFlowFromWUs', () => {
    it('should handle all WU statuses', async () => {
      const { calculateFlowFromWUs } = await import('../metrics-cli.js');
      const wuMetrics = [
        { id: 'WU-1', title: 'A', lane: 'Ops', status: 'ready' as const },
        { id: 'WU-2', title: 'B', lane: 'Ops', status: 'in_progress' as const },
        { id: 'WU-3', title: 'C', lane: 'Ops', status: 'blocked' as const },
        { id: 'WU-4', title: 'D', lane: 'Ops', status: 'waiting' as const },
        { id: 'WU-5', title: 'E', lane: 'Ops', status: 'done' as const },
      ];

      const result = calculateFlowFromWUs(wuMetrics);
      expect(result.ready).toBe(1);
      expect(result.inProgress).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.waiting).toBe(1);
      expect(result.done).toBe(1);
      expect(result.totalActive).toBe(4); // ready + in_progress + blocked + waiting
    });

    it('should handle empty WU list', async () => {
      const { calculateFlowFromWUs } = await import('../metrics-cli.js');
      const result = calculateFlowFromWUs([]);
      expect(result.ready).toBe(0);
      expect(result.totalActive).toBe(0);
    });
  });
});

describe('metrics-cli run* subcommand functions', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('runLanesSubcommand', () => {
    it('should run lanes subcommand with dry-run', async () => {
      const { runLanesSubcommand } = await import('../metrics-cli.js');

      // Run with dry-run to avoid file writes
      await runLanesSubcommand({
        subcommand: 'lanes',
        days: 7,
        format: 'json',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      // Verify console output was called
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should run lanes subcommand with table format', async () => {
      const { runLanesSubcommand } = await import('../metrics-cli.js');

      await runLanesSubcommand({
        subcommand: 'lanes',
        days: 7,
        format: 'table',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      // Verify table format was used (contains LANE HEALTH header)
      const calls = consoleSpy.mock.calls;
      const output = calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('LANE HEALTH');
    });
  });

  describe('runDoraSubcommand', () => {
    it('should run dora subcommand with dry-run', async () => {
      const { runDoraSubcommand } = await import('../metrics-cli.js');

      await runDoraSubcommand({
        subcommand: 'dora',
        days: 7,
        format: 'json',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should run dora subcommand with custom days', async () => {
      const { runDoraSubcommand } = await import('../metrics-cli.js');

      await runDoraSubcommand({
        subcommand: 'dora',
        days: 30,
        format: 'table',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      // Verify output includes DORA METRICS header
      const calls = consoleSpy.mock.calls;
      const output = calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('DORA METRICS');
    });
  });

  describe('runFlowSubcommand', () => {
    it('should run flow subcommand with dry-run', async () => {
      const { runFlowSubcommand } = await import('../metrics-cli.js');

      await runFlowSubcommand({
        subcommand: 'flow',
        days: 7,
        format: 'json',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should run flow subcommand with table format', async () => {
      const { runFlowSubcommand } = await import('../metrics-cli.js');

      await runFlowSubcommand({
        subcommand: 'flow',
        days: 7,
        format: 'table',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      const calls = consoleSpy.mock.calls;
      const output = calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('FLOW STATE');
    });
  });

  describe('runAllSubcommand', () => {
    it('should run all subcommand with dry-run', async () => {
      const { runAllSubcommand } = await import('../metrics-cli.js');

      await runAllSubcommand({
        subcommand: 'all',
        days: 7,
        format: 'json',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should run all subcommand with table format', async () => {
      const { runAllSubcommand } = await import('../metrics-cli.js');

      await runAllSubcommand({
        subcommand: 'all',
        days: 7,
        format: 'table',
        output: '.lumenflow/snapshots/test.json',
        dryRun: true,
      });

      const calls = consoleSpy.mock.calls;
      const output = calls.map((c) => String(c[0])).join('\n');
      // Should contain all three sections
      expect(output).toContain('DORA METRICS');
      expect(output).toContain('LANE HEALTH');
      expect(output).toContain('FLOW STATE');
    });
  });
});
