/**
 * GetDashboardData Use Case
 *
 * Orchestrates the collection of all dashboard metrics from the metrics collector.
 * Follows hexagonal architecture - depends on port interface, not concrete implementation.
 *
 * @module get-dashboard-data.usecase
 * @see {@link ../ports/metrics-collector.port.ts} - Port interface
 * @see {@link ../domain/orchestration.types.ts} - Domain types
 */

import type { IMetricsCollector } from '../ports/metrics-collector.port.js';
import type { DashboardData } from '../domain/orchestration.types.js';
import { TIMELINE_WINDOW_HOURS } from '../domain/orchestration.constants.js';

/**
 * Options for the GetDashboardData use case.
 */
export interface GetDashboardDataOptions {
  /**
   * Number of hours to include in the timeline.
   * @default TIMELINE_WINDOW_HOURS (24)
   */
  timelineHours?: number;
}

/**
 * Use case for collecting all dashboard data.
 *
 * Orchestrates parallel calls to the metrics collector to gather:
 * - Global status (active WUs, completed, blocked, etc.)
 * - Agent metrics (invocation counts, pass rates, timing)
 * - WU progress (DoD progress, agent statuses)
 * - Timeline events (recent activity)
 * - Alerts (items requiring attention)
 *
 * @example
 * const collector = new FileSystemMetricsCollector(basePath);
 * const useCase = new GetDashboardDataUseCase(collector);
 * const data = await useCase.execute();
 * console.log(data.globalStatus.activeWUs);
 */
export class GetDashboardDataUseCase {
  constructor(private readonly metricsCollector: IMetricsCollector) {}

  /**
   * Execute the use case to collect all dashboard data.
   *
   * Calls all collector methods in parallel for optimal performance.
   *
   * @param options - Optional configuration
   * @returns Promise resolving to complete dashboard data
   * @throws Error if any collector method fails
   */
  async execute(options: GetDashboardDataOptions = {}): Promise<DashboardData> {
    const { timelineHours = TIMELINE_WINDOW_HOURS } = options;

    const timelineSince = new Date();
    timelineSince.setHours(timelineSince.getHours() - timelineHours);

    const [globalStatus, agentMetrics, wuProgress, timeline, alerts] = await Promise.all([
      this.metricsCollector.getGlobalStatus(),
      this.metricsCollector.getAgentMetrics(),
      this.metricsCollector.getWUProgress(),
      this.metricsCollector.getTimeline(timelineSince),
      this.metricsCollector.getAlerts(),
    ]);

    return {
      globalStatus,
      agentMetrics,
      wuProgress,
      timeline,
      alerts,
    };
  }
}
