/**
 * Terminal Dashboard Renderer Adapter
 *
 * Hexagonal Architecture - Infrastructure Layer
 * Implements the DashboardRenderer port for terminal/CLI output.
 *
 * Follows Edward Tufte's data visualisation principles:
 * - High data-ink ratio (minimal chartjunk)
 * - Small multiples for comparison (agent metrics table)
 * - 5-second scannable layout
 * - Headline sentences for context
 *
 * Library-First Approach:
 * - picocolors: Semantic ANSI colours (NOT raw escape codes)
 * - cli-table3: ASCII table rendering
 * - cli-progress: Progress bar rendering
 *
 * @module terminal-renderer.adapter
 * @see {@link ../ports/dashboard-renderer.port.ts} - Port interface
 * @see {@link ../domain/orchestration.types.ts} - Domain types
 */

import picocolors from 'picocolors';
import Table from 'cli-table3';
import type { IDashboardRenderer } from '../ports/dashboard-renderer.port.js';
import type {
  DashboardData,
  Suggestion,
  ExecutionPlan,
  UserChoice,
  GlobalStatus,
  AgentMetric,
  WUProgress,
  TimelineEvent,
  Alert,
} from '../domain/orchestration.types.js';
import type { AgentName } from '../domain/orchestration.constants.js';

// Constants for rendering (no magic strings)
const SECTION_SEPARATOR = '\n' + '─'.repeat(80) + '\n';
const HEADER_PREFIX = '▸';
const BULLET = '•';
const CHECK_MARK = '✓';
const CROSS_MARK = '✗';
const PENDING_MARK = '○';
const PROGRESS_BAR_WIDTH = 30;

// Severity colour mapping
const SEVERITY_COLOURS = {
  high: picocolors.red,
  medium: picocolors.yellow,
  low: picocolors.cyan,
} as const;

// Agent result colour mapping
const RESULT_COLOURS = {
  pass: picocolors.green,
  fail: picocolors.red,
  pending: picocolors.yellow,
  skipped: picocolors.gray,
} as const;

// Event severity colour mapping
const EVENT_SEVERITY_COLOURS = {
  info: picocolors.cyan,
  warning: picocolors.yellow,
  error: picocolors.red,
} as const;

/**
 * Terminal Dashboard Renderer
 *
 * Renders orchestration dashboard data to terminal using ANSI colours and ASCII tables.
 *
 * @example
 * const renderer = new TerminalDashboardRenderer();
 * const data = await metricsCollector.collect();
 * renderer.render(data);
 */
export class TerminalDashboardRenderer implements IDashboardRenderer {
  /**
   * Render the complete dashboard with all 5 sections.
   *
   * Sections:
   * 1. Global Status - High-level metrics
   * 2. Agent Small Multiples - Per-agent comparison table
   * 3. WU Progress - DoD progress bars with headlines
   * 4. Timeline - Recent events
   * 5. Alerts - Items requiring attention
   *
   * @param data - Complete dashboard data
   */
  render(data: DashboardData): void {
    this.clear();

    console.log(picocolors.bold(picocolors.cyan('\n🎯 Agent Orchestration Dashboard\n')));

    // Section 1: Global Status
    this.renderGlobalStatus(data.globalStatus);

    // Section 2: Agent Small Multiples
    this.renderAgentMetrics(data.agentMetrics);

    // Section 3: WU Progress
    this.renderWUProgress(data.wuProgress);

    // Section 4: Timeline
    this.renderTimeline(data.timeline);

    // Section 5: Alerts
    this.renderAlerts(data.alerts);

    console.log('\n');
  }

  /**
   * Render prioritised suggestions.
   *
   * @param suggestions - Ordered suggestions (highest priority first)
   */
  renderSuggestions(suggestions: Suggestion[]): void {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} Suggestions\n`));

    if (suggestions.length === 0) {
      console.log(picocolors.gray('No suggestions at this time.\n'));
      return;
    }

    for (const suggestion of suggestions) {
      const priorityColour = SEVERITY_COLOURS[suggestion.priority];
      const priorityLabel = suggestion.priority.toUpperCase().padEnd(6);

      console.log(
        `${BULLET} ${priorityColour(priorityLabel)} ${picocolors.bold(suggestion.action)}`,
      );
      console.log(`  ${picocolors.gray('Reason:')} ${suggestion.reason}`);
      console.log(`  ${picocolors.gray('Command:')} ${picocolors.cyan(suggestion.command)}\n`);
    }
  }

  /**
   * Render execution plan and prompt for user approval.
   *
   * @param plan - Proposed execution plan
   * @returns User's choice (approve/reject/edit)
   */
  async renderPlan(plan: ExecutionPlan): Promise<UserChoice> {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} Execution Plan\n`));

    console.log(`${picocolors.gray('WU:')} ${picocolors.cyan(plan.wuId)}`);
    console.log(
      `${picocolors.gray('Estimated Tokens:')} ${picocolors.yellow(plan.estimatedTokens.toString())}\n`,
    );

    console.log(picocolors.bold('Steps:'));
    for (const step of plan.steps) {
      const label =
        'agent' in step
          ? `Run agent: ${step.agent}`
          : 'action' in step
            ? `Run: ${step.action}`
            : 'Unknown step';
      const statusIcon = step.status === 'pending' ? PENDING_MARK : CHECK_MARK;
      console.log(`  ${statusIcon} ${label}`);
    }

    console.log('');

    // Prompt user (mocked in tests via promptUser)
    return this.promptUser();
  }

  /**
   * Clear terminal output.
   *
   * Uses ANSI escape sequence to clear screen.
   */
  clear(): void {
    // ANSI escape sequence: clear screen and move cursor to top-left
    console.log('\x1Bc');
  }

  /**
   * Render global status section.
   *
   * @private
   */
  private renderGlobalStatus(status: GlobalStatus): void {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} Global Status\n`));

    console.log(
      `${picocolors.gray('Active WUs:')} ${picocolors.cyan(status.activeWUs.toString())}`,
    );
    console.log(
      `${picocolors.gray('Completed (24h):')} ${picocolors.green(status.completed24h.toString())}`,
    );
    console.log(
      `${picocolors.gray('Blocked:')} ${status.blocked > 0 ? picocolors.yellow(status.blocked.toString()) : picocolors.gray(status.blocked.toString())}`,
    );
    console.log(
      `${picocolors.gray('Gates Failing:')} ${status.gatesFailing > 0 ? picocolors.red(status.gatesFailing.toString()) : picocolors.gray(status.gatesFailing.toString())}`,
    );

    if (status.longestRunning) {
      const durationHours = Math.floor(status.longestRunning.durationMs / (1000 * 60 * 60));
      const durationMinutes = Math.floor(
        (status.longestRunning.durationMs % (1000 * 60 * 60)) / (1000 * 60),
      );
      console.log(
        `${picocolors.gray('Longest Running:')} ${picocolors.cyan(status.longestRunning.wuId)} ${picocolors.gray(`(${durationHours}h ${durationMinutes}m)`)}`,
      );
    }

    if (status.pendingMandatory.length > 0) {
      console.log(`\n${picocolors.yellow(BULLET)} ${picocolors.bold('Pending Mandatory Agents:')}`);
      for (const pending of status.pendingMandatory) {
        console.log(`  ${picocolors.gray('-')} ${picocolors.cyan(pending.wuId)}: ${pending.agent}`);
      }
    }

    // WU-1438: Display active agent session
    if (status.activeSession) {
      const session = status.activeSession;
      const startTime = new Date(session.started);
      const durationMs = Date.now() - startTime.getTime();
      const durationMinutes = Math.floor(durationMs / (1000 * 60));
      const durationSeconds = Math.floor((durationMs % (1000 * 60)) / 1000);

      console.log(`\n${picocolors.green(BULLET)} ${picocolors.bold('Active Agent Session:')}`);
      console.log(
        `  ${picocolors.gray('Session ID:')} ${picocolors.cyan(session.sessionId.slice(0, 8))}...`,
      );
      console.log(`  ${picocolors.gray('WU:')} ${picocolors.cyan(session.wuId)}`);
      console.log(`  ${picocolors.gray('Context Tier:')} ${session.contextTier}`);
      console.log(`  ${picocolors.gray('Duration:')} ${durationMinutes}m ${durationSeconds}s`);
      console.log(`  ${picocolors.gray('Incidents Logged:')} ${session.incidentsLogged}`);
    } else {
      console.log(`\n${picocolors.gray(BULLET)} ${picocolors.gray('No active agent session')}`);
    }

    // WU-1748: Display worktrees with uncommitted changes
    if (status.worktreesWithUncommittedChanges.length > 0) {
      console.log(
        `\n${picocolors.yellow(BULLET)} ${picocolors.bold('Worktrees with Uncommitted Changes:')}`,
      );
      for (const wt of status.worktreesWithUncommittedChanges) {
        const lastActivity = wt.lastActivityTimestamp
          ? new Date(wt.lastActivityTimestamp).toLocaleString('en-GB')
          : 'Unknown';
        console.log(
          `  ${picocolors.gray('-')} ${picocolors.cyan(wt.wuId)}: ${picocolors.yellow(wt.uncommittedFileCount.toString())} uncommitted files`,
        );
        console.log(`    ${picocolors.gray('Last activity:')} ${lastActivity}`);
        console.log(`    ${picocolors.gray('Path:')} ${wt.worktreePath}`);
      }
    }

    console.log('');
  }

  /**
   * Render agent metrics as small multiples table.
   *
   * @private
   */
  private renderAgentMetrics(metrics: Partial<Record<AgentName, AgentMetric>>): void {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} Agent Metrics\n`));

    if (Object.keys(metrics).length === 0) {
      console.log(picocolors.gray('No agent metrics available.\n'));
      return;
    }

    const table = new Table({
      head: ['Agent', 'Invoked', 'Pass Rate', 'Avg Duration', 'Last Run'],
      style: {
        head: ['cyan'],
        border: ['gray'],
      },
    });

    for (const [agentName, metric] of Object.entries(metrics)) {
      const passRateColour =
        metric.passRate >= 90
          ? picocolors.green
          : metric.passRate >= 50
            ? picocolors.yellow
            : picocolors.red;

      const avgDurationMs = metric.avgDurationMs;
      const avgDurationMinutes = Math.floor(avgDurationMs / (1000 * 60));
      const avgDurationSeconds = Math.floor((avgDurationMs % (1000 * 60)) / 1000);

      const lastRunResult = metric.lastRun
        ? RESULT_COLOURS[metric.lastRun.result](metric.lastRun.result)
        : picocolors.gray('N/A');

      table.push([
        agentName,
        metric.invoked.toString(),
        passRateColour(`${metric.passRate}%`),
        `${avgDurationMinutes}m ${avgDurationSeconds}s`,
        lastRunResult,
      ]);
    }

    console.log(table.toString());
    console.log('');
  }

  /**
   * Render WU progress with DoD bars and headlines.
   *
   * @private
   */
  private renderWUProgress(progress: WUProgress[]): void {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} WU Progress\n`));

    if (progress.length === 0) {
      console.log(picocolors.gray('No active WUs.\n'));
      return;
    }

    for (const wu of progress) {
      // WU header
      console.log(
        `${picocolors.bold(picocolors.cyan(wu.wuId))} ${picocolors.gray('-')} ${wu.title}`,
      );
      console.log(`${picocolors.gray('Lane:')} ${wu.lane}`);

      // DoD progress bar
      const percentage = (wu.dodProgress / wu.dodTotal) * 100;
      const filledWidth = Math.floor((percentage / 100) * PROGRESS_BAR_WIDTH);
      const emptyWidth = PROGRESS_BAR_WIDTH - filledWidth;

      const progressBar =
        picocolors.green('█'.repeat(filledWidth)) + picocolors.gray('░'.repeat(emptyWidth));

      console.log(
        `${picocolors.gray('DoD:')} [${progressBar}] ${picocolors.cyan(`${wu.dodProgress}/${wu.dodTotal}`)}`,
      );

      // Agent status
      const agentStatuses = Object.entries(wu.agents)
        .map(([agent, status]) => {
          const statusIcon =
            status === 'pass'
              ? picocolors.green(CHECK_MARK)
              : status === 'fail'
                ? picocolors.red(CROSS_MARK)
                : status === 'skipped'
                  ? picocolors.gray('-')
                  : picocolors.yellow(PENDING_MARK);
          return `${statusIcon} ${agent}`;
        })
        .join('  ');

      console.log(`${picocolors.gray('Agents:')} ${agentStatuses}`);

      // Headline sentence (Tufte principle)
      console.log(`${picocolors.italic(picocolors.gray(`"${wu.headline}"`))}\n`);
    }
  }

  /**
   * Render timeline of recent events.
   *
   * @private
   */
  private renderTimeline(timeline: TimelineEvent[]): void {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} Timeline\n`));

    if (timeline.length === 0) {
      console.log(picocolors.gray('No recent events.\n'));
      return;
    }

    for (const event of timeline) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const severityColour = EVENT_SEVERITY_COLOURS[event.severity];

      console.log(
        `${picocolors.gray(timestamp)} ${severityColour(BULLET)} ${picocolors.cyan(event.wuId)} ${picocolors.gray('-')} ${event.detail}`,
      );
    }

    console.log('');
  }

  /**
   * Render alerts requiring attention.
   *
   * @private
   */
  private renderAlerts(alerts: Alert[]): void {
    console.log(SECTION_SEPARATOR);
    console.log(picocolors.bold(`${HEADER_PREFIX} Alerts\n`));

    if (alerts.length === 0) {
      console.log(picocolors.green(`${CHECK_MARK} No alerts - all clear.\n`));
      return;
    }

    for (const alert of alerts) {
      const severityColour = SEVERITY_COLOURS[alert.severity];
      const severityLabel = alert.severity.toUpperCase().padEnd(6);

      console.log(
        `${severityColour(BULLET)} ${severityColour(severityLabel)} ${picocolors.bold(alert.message)}`,
      );
      console.log(`  ${picocolors.gray('WU:')} ${picocolors.cyan(alert.wuId)}`);
      console.log(`  ${picocolors.gray('Action:')} ${alert.action}\n`);
    }
  }

  /**
   * Prompt user for execution plan approval.
   *
   * This is a simplified implementation for testing.
   * Production version would use @inquirer/prompts for interactive input.
   *
   * @private
   */
  private async promptUser(): Promise<UserChoice> {
    // Mock implementation for testing
    // Production: use @inquirer/prompts select + input
    return {
      choice: 'approve',
      modifications: undefined,
    };
  }
}
