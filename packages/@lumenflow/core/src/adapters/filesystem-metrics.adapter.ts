/**
 * FileSystem Metrics Collector Adapter
 *
 * Hexagonal Architecture - Adapter (Infrastructure Layer)
 * Implements MetricsCollector port by reading from filesystem:
 * - WU YAML files (docs/04-operations/tasks/wu/)
 * - status.md (active/blocked WUs)
 * - telemetry files (.lumenflow/telemetry/)
 *
 * Library-First Approach:
 * - fast-glob: File discovery
 * - yaml: YAML parsing
 * - date-fns: Time calculations
 *
 * @module filesystem-metrics.adapter
 * @see {@link ../ports/metrics-collector.port.ts} - Port interface
 * @see {@link ../domain/orchestration.types.ts} - Return types
 */

import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import { differenceInMilliseconds, subHours } from 'date-fns';
import { minimatch } from 'minimatch';
import type { IMetricsCollector } from '../ports/metrics-collector.port.js';
import type {
  GlobalStatus,
  AgentMetric,
  WUProgress,
  TimelineEvent,
  Alert,
} from '../domain/orchestration.types.js';
import {
  FILESYSTEM_PATHS,
  DOD_TOTAL,
  MANDATORY_TRIGGERS,
  TIMELINE_WINDOW_HOURS,
  MAX_ALERTS_DISPLAY,
} from '../domain/orchestration.constants.js';
import { FILE_SYSTEM, WU_STATUS } from '../wu-constants.js';

import { scanWorktrees } from '../worktree-scanner.js';

/**
 * FileSystem implementation of MetricsCollector.
 *
 * Reads orchestration data from local filesystem.
 * Suitable for development and single-machine deployments.
 *
 * @example
 * const collector = new FileSystemMetricsCollector('/path/to/repo');
 * const status = await collector.getGlobalStatus();
 * console.log(`Active WUs: ${status.activeWUs}`);
 */
export class FileSystemMetricsCollector implements IMetricsCollector {
  private readonly baseDir: string;

  /**
   * Create a new FileSystemMetricsCollector.
   *
   * @param baseDir - Base directory of the repository (default: process.cwd())
   */
  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.cwd();
  }

  /**
   * Get global orchestration status.
   *
   * Reads status.md to count active/blocked WUs.
   * Reads stamp files to count completed WUs in last 24h.
   * Reads WU YAMLs to check for failing gates and mandatory agents.
   */
  async getGlobalStatus(): Promise<GlobalStatus> {
    try {
      const [statusContent, activeWUs, stamps] = await Promise.all([
        this.readStatusFile(),
        this.readAllWUs(),
        this.readStamps(),
      ]);

      const activeWUsList = activeWUs.filter((wu) => wu.status === WU_STATUS.IN_PROGRESS);
      const blockedWUs = activeWUs.filter((wu) => wu.status === WU_STATUS.BLOCKED);

      // Count completed WUs in last 24 hours
      const twentyFourHoursAgo = subHours(new Date(), TIMELINE_WINDOW_HOURS);
      const completed24h = stamps.filter((stamp) => {
        const stampDate = new Date(stamp.completedAt);
        return stampDate >= twentyFourHoursAgo;
      }).length;

      // Find longest running WU
      let longestRunning: GlobalStatus['longestRunning'] = null;
      if (activeWUsList.length > 0) {
        const sorted = [...activeWUsList].sort((a, b) => {
          const aDuration = differenceInMilliseconds(
            new Date(),
            new Date(a.claimed_at ?? a.created),
          );
          const bDuration = differenceInMilliseconds(
            new Date(),
            new Date(b.claimed_at ?? b.created),
          );
          return bDuration - aDuration;
        });

        const longest = sorted[0];
        if (longest) {
          longestRunning = {
            wuId: longest.id,
            lane: longest.lane,
            durationMs: differenceInMilliseconds(
              new Date(),
              new Date(longest.claimed_at ?? longest.created),
            ),
          };
        }
      }

      // Detect pending mandatory agents
      const pendingMandatory: GlobalStatus['pendingMandatory'] = [];
      for (const wu of activeWUsList) {
        const codePaths = wu.code_paths ?? [];
        for (const [agentName, patterns] of Object.entries(MANDATORY_TRIGGERS)) {
          const shouldTrigger = patterns.some((pattern) =>
            codePaths.some((path) => this.matchesPattern(path, pattern)),
          );

          if (shouldTrigger) {
            // Check if agent has been invoked (would be in telemetry)
            const hasRun = await this.hasAgentRun(wu.id, agentName);
            if (!hasRun) {
              pendingMandatory.push({
                wuId: wu.id,
                agent: agentName as GlobalStatus['pendingMandatory'][number]['agent'],
              });
            }
          }
        }
      }

      // WU-1438: Read active session
      const activeSession = await this.readActiveSession();

      // WU-1748: Scan worktrees for uncommitted changes
      const worktreesWithUncommittedChanges = await this.scanWorktreesForUncommittedChanges();

      return {
        activeWUs: activeWUsList.length,
        completed24h,
        blocked: blockedWUs.length,
        gatesFailing: 0, // Gate failures will be tracked in future WU
        longestRunning,
        pendingMandatory,
        activeSession,
        worktreesWithUncommittedChanges,
      };
    } catch (error) {
      // Return empty status if files not found (e.g., in test fixtures)
      return {
        activeWUs: 0,
        completed24h: 0,
        blocked: 0,
        gatesFailing: 0,
        longestRunning: null,
        pendingMandatory: [],
        activeSession: null,
        worktreesWithUncommittedChanges: [],
      };
    }
  }

  /**
   * Get metrics for all known agents.
   *
   * Reads telemetry files to aggregate agent invocations.
   */
  async getAgentMetrics(): Promise<Record<string, AgentMetric>> {
    const metrics: Record<string, AgentMetric> = {};

    try {
      const telemetryEvents = await this.readTelemetry();

      // Group events by agent
      const agentEvents = telemetryEvents.filter((e) => e.event === 'agent');

      const agentGroups = new Map<
        string,
        Array<{ result: 'pass' | 'fail'; timestamp: string; wuId: string; durationMs?: number }>
      >();

      for (const event of agentEvents) {
        // Extract agent name from detail (format: "Agent {name} {result}")
        const match = event.detail.match(/Agent ([a-z-]+) (passed|failed)/i);
        if (!match) continue;

        const [, agentName, resultStr] = match;
        const result = resultStr.toLowerCase() === 'passed' ? 'pass' : 'fail';

        if (!agentGroups.has(agentName)) {
          agentGroups.set(agentName, []);
        }

        agentGroups.get(agentName)!.push({
          result,
          timestamp: event.timestamp,
          wuId: event.wuId,
          durationMs: 0, // Would need to parse from telemetry
        });
      }

      // Calculate metrics for each agent
      for (const [agentName, runs] of agentGroups.entries()) {
        const invoked = runs.length;
        const passed = runs.filter((r) => r.result === 'pass').length;
        const passRate = invoked > 0 ? (passed / invoked) * 100 : 0;
        const avgDurationMs = 0; // Would need duration data from telemetry

        const sortedRuns = [...runs].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const lastRun = sortedRuns[0]
          ? {
              wuId: sortedRuns[0].wuId,
              timestamp: sortedRuns[0].timestamp,
              result: sortedRuns[0].result,
            }
          : null;

        metrics[agentName] = {
          invoked,
          passRate,
          avgDurationMs,
          lastRun,
        };
      }

      return metrics;
    } catch {
      return {};
    }
  }

  /**
   * Get progress for all active WUs.
   *
   * Parses WU YAML files and calculates DoD progress.
   */
  async getWUProgress(): Promise<WUProgress[]> {
    try {
      const allWUs = await this.readAllWUs();
      const activeWUs = allWUs.filter(
        (wu) => wu.status === WU_STATUS.IN_PROGRESS || wu.status === WU_STATUS.BLOCKED,
      );

      const progress: WUProgress[] = [];

      for (const wu of activeWUs) {
        // Calculate DoD progress (simplified - would need actual DoD tracking)
        const dodProgress = this.calculateDoDProgress(wu);

        // Get agent statuses
        const agents: Record<string, 'pending' | 'pass' | 'fail' | 'skipped'> = {};
        const codePaths = wu.code_paths ?? [];

        for (const [agent, patterns] of Object.entries(MANDATORY_TRIGGERS)) {
          const shouldTrigger = patterns.some((pattern) =>
            codePaths.some((path) => this.matchesPattern(path, pattern)),
          );

          if (shouldTrigger) {
            const hasRun = await this.hasAgentRun(wu.id, agent);
            agents[agent] = hasRun ? 'pass' : 'pending';
          }
        }

        // Generate Tufte-style headline
        const headline = this.generateHeadline(wu, agents);

        progress.push({
          wuId: wu.id,
          lane: wu.lane,
          title: wu.title,
          dodProgress,
          dodTotal: DOD_TOTAL,
          agents,
          headline,
        });
      }

      // Sort by lane then WU ID
      progress.sort((a, b) => {
        const laneCompare = a.lane.localeCompare(b.lane);
        return laneCompare !== 0 ? laneCompare : a.wuId.localeCompare(b.wuId);
      });

      return progress;
    } catch {
      return [];
    }
  }

  /**
   * Get timeline events since a given date.
   *
   * Reads and aggregates telemetry files.
   */
  async getTimeline(since: Date): Promise<TimelineEvent[]> {
    try {
      const allEvents = await this.readTelemetry();

      // Filter events after 'since' date
      const filtered = allEvents.filter((event) => {
        const eventDate = new Date(event.timestamp);
        return eventDate >= since;
      });

      // Sort by timestamp descending
      filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return filtered;
    } catch {
      return [];
    }
  }

  /**
   * Get current alerts requiring attention.
   *
   * Generates alerts based on WU state and mandatory agents.
   */
  async getAlerts(): Promise<Alert[]> {
    const alerts: Alert[] = [];

    try {
      const allWUs = await this.readAllWUs();
      const activeWUs = allWUs.filter((wu) => wu.status === WU_STATUS.IN_PROGRESS);

      // HIGH: Mandatory agents not invoked
      for (const wu of activeWUs) {
        const codePaths = wu.code_paths ?? [];

        for (const [agent, patterns] of Object.entries(MANDATORY_TRIGGERS)) {
          const shouldTrigger = patterns.some((pattern) =>
            codePaths.some((path) => this.matchesPattern(path, pattern)),
          );

          if (shouldTrigger) {
            const hasRun = await this.hasAgentRun(wu.id, agent);
            if (!hasRun) {
              alerts.push({
                severity: 'high',
                message: `Mandatory agent not yet invoked`,
                wuId: wu.id,
                action: `Run ${agent} before wu:done`,
              });
            }
          }
        }
      }

      // MEDIUM: WUs near completion (DoD > 8/11)
      for (const wu of activeWUs) {
        const dodProgress = this.calculateDoDProgress(wu);
        if (dodProgress >= 8) {
          alerts.push({
            severity: 'medium',
            message: `WU near completion - ready for review`,
            wuId: wu.id,
            action: `Run code-reviewer`,
          });
        }
      }

      // MEDIUM: Worktrees with uncommitted changes (WU-1748)
      const worktreesWithChanges = await this.scanWorktreesForUncommittedChanges();
      for (const wt of worktreesWithChanges) {
        alerts.push({
          severity: 'medium',
          message: `Abandoned work: ${wt.uncommittedFileCount} uncommitted files`,
          wuId: wt.wuId,
          action: `pnpm wu:takeover --id ${wt.wuId} (see recovery workflow)`,
        });
      }

      // LOW: Available lanes with ready WUs
      const readyWUs = allWUs.filter((wu) => wu.status === WU_STATUS.READY);
      const readyByLane = new Map<string, number>();

      for (const wu of readyWUs) {
        readyByLane.set(wu.lane, (readyByLane.get(wu.lane) ?? 0) + 1);
      }

      for (const [lane, count] of readyByLane.entries()) {
        if (count > 0) {
          alerts.push({
            severity: 'low',
            message: `${count} ready WU(s) in ${lane} lane`,
            wuId: readyWUs.find((wu) => wu.lane === lane)!.id,
            action: `pnpm wu:claim --id ${readyWUs.find((wu) => wu.lane === lane)!.id} --lane "${lane}"`,
          });
        }
      }

      // Sort by severity (high first)
      const severityOrder = { high: 0, medium: 1, low: 2 };
      alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      // Limit to MAX_ALERTS_DISPLAY
      return alerts.slice(0, MAX_ALERTS_DISPLAY);
    } catch {
      return [];
    }
  }

  // Private helper methods

  private async readStatusFile(): Promise<string> {
    const statusPath = join(this.baseDir, FILESYSTEM_PATHS.STATUS_FILE);
    return await readFile(statusPath, { encoding: 'utf-8' });
  }

  private async readAllWUs(): Promise<Array<any>> {
    const wuDir = join(this.baseDir, FILESYSTEM_PATHS.WU_DIR);
    const wuFiles = await fg('WU-*.yaml', { cwd: wuDir, absolute: true });

    const wus = await Promise.all(
      wuFiles.map(async (file) => {
        const content = await readFile(file, { encoding: 'utf-8' });
        return parseYaml(content);
      }),
    );

    return wus;
  }

  private async readStamps(): Promise<Array<{ wuId: string; completedAt: string }>> {
    const stampsDir = join(this.baseDir, FILESYSTEM_PATHS.STAMPS_DIR);
    const stampFiles = await fg('WU-*.done', { cwd: stampsDir, absolute: true });

    const stamps = await Promise.all(
      stampFiles.map(async (file) => {
        const content = await readFile(file, { encoding: 'utf-8' });
        const data = parseYaml(content);
        return {
          wuId: data.id ?? '',
          completedAt: data.completed_at ?? data.timestamp ?? new Date().toISOString(),
        };
      }),
    );

    return stamps;
  }

  private async readTelemetry(): Promise<TimelineEvent[]> {
    const telemetryDir = join(this.baseDir, FILESYSTEM_PATHS.TELEMETRY_DIR);
    const telemetryFiles = await fg('*.{ndjson,json}', {
      cwd: telemetryDir,
      absolute: true,
    });

    const events: TimelineEvent[] = [];

    for (const file of telemetryFiles) {
      const content = await readFile(file, { encoding: 'utf-8' });

      // Handle NDJSON (newline-delimited JSON)
      if (file.endsWith('.ndjson')) {
        const lines = content.split('\n').filter((line) => line.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (this.isTimelineEvent(event)) {
              events.push(event);
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      } else {
        // Handle regular JSON
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            events.push(...data.filter((e) => this.isTimelineEvent(e)));
          } else if (this.isTimelineEvent(data)) {
            events.push(data);
          }
        } catch {
          // Skip invalid JSON files
        }
      }
    }

    return events;
  }

  private isTimelineEvent(obj: any): obj is TimelineEvent {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.timestamp === 'string' &&
      typeof obj.event === 'string' &&
      typeof obj.wuId === 'string' &&
      typeof obj.detail === 'string' &&
      typeof obj.severity === 'string'
    );
  }

  private async hasAgentRun(wuId: string, agentName: string): Promise<boolean> {
    const events = await this.readTelemetry();
    return events.some(
      (e) => e.wuId === wuId && e.event === 'agent' && e.detail.includes(agentName),
    );
  }

  /**
   * Match a path against a glob pattern.
   * WU-1849: Replaced custom regex with minimatch library.
   *
   * @param path - Path to match
   * @param pattern - Glob pattern
   * @returns True if path matches pattern
   */
  private matchesPattern(path: string, pattern: string): boolean {
    return minimatch(path, pattern);
  }

  private calculateDoDProgress(wu: any): number {
    // Simplified DoD calculation
    // In reality, would parse actual DoD checkpoints from WU YAML or telemetry
    let progress = 0;

    // Basic heuristics
    if (wu.code_paths && wu.code_paths.length > 0) progress += 2;
    if (wu.test_paths && wu.test_paths.unit && wu.test_paths.unit.length > 0) progress += 2;
    if (wu.claimed_at) progress += 2;
    if (wu.worktree_path) progress += 1;

    // Cap at DOD_TOTAL
    return Math.min(progress, DOD_TOTAL);
  }

  private generateHeadline(wu: any, agents: Record<string, string>): string {
    // Tufte-style: data-dense, narrative sentence
    const pendingAgents = Object.entries(agents)
      .filter(([, status]) => status === 'pending')
      .map(([agent]) => agent);

    if (wu.status === WU_STATUS.BLOCKED) {
      return `Blocked: ${wu.blocked_reason ?? 'Unknown reason'}`;
    }

    if (pendingAgents.length > 0) {
      return `Awaiting ${pendingAgents.join(', ')} - ${this.calculateDoDProgress(wu)}/${DOD_TOTAL} DoD complete`;
    }

    return `${this.calculateDoDProgress(wu)}/${DOD_TOTAL} DoD complete - ready for gates`;
  }

  /**
   * Read active session from session file (WU-1438).
   *
   * Transforms snake_case session file format to camelCase TypeScript types.
   *
   * @private
   * @returns Active session data or null if no session active
   */
  private async readActiveSession(): Promise<GlobalStatus['activeSession']> {
    const sessionPath = join(this.baseDir, FILESYSTEM_PATHS.SESSION_FILE);

    try {
      const content = await readFile(sessionPath, { encoding: 'utf-8' });
      const session = JSON.parse(content);

      // Transform snake_case to camelCase (session file -> TypeScript types)
      return {
        sessionId: session.session_id,
        wuId: session.wu_id,
        started: session.started,
        contextTier: session.context_tier as 1 | 2 | 3,
        incidentsLogged: session.incidents_logged ?? 0,
      };
    } catch {
      // Return null on any read/parse error (file may not exist, corrupted, or mid-write)
      return null;
    }
  }

  /**
   * Scan worktrees for uncommitted changes (WU-1748).
   *
   * Uses worktree-scanner module to detect abandoned WU work.
   * Extracts WU ID from worktree path/branch name.
   *
   * @private
   * @returns Array of worktrees with uncommitted changes
   */
  private async scanWorktreesForUncommittedChanges(): Promise<
    GlobalStatus['worktreesWithUncommittedChanges']
  > {
    try {
      const scanResult = await scanWorktrees(this.baseDir);
      const worktrees = scanResult.worktrees ?? [];

      // Filter to only worktrees with uncommitted changes and extract WU ID
      const result: GlobalStatus['worktreesWithUncommittedChanges'] = [];

      for (const wt of worktrees) {
        if (!wt.hasUncommittedChanges) continue;

        // Extract WU ID from branch name (e.g., "operations-tooling-wu-1748" -> "WU-1748")
        const wuIdMatch = wt.branchName.match(/wu-(\d+)/i);
        if (!wuIdMatch) continue;

        const wuId = `WU-${wuIdMatch[1]}`;

        result.push({
          wuId,
          worktreePath: wt.worktreePath,
          uncommittedFileCount: wt.uncommittedFileCount,
          lastActivityTimestamp: wt.lastActivityTimestamp,
        });
      }

      return result;
    } catch {
      // Non-fatal: return empty array if worktree scanning fails
      return [];
    }
  }
}
