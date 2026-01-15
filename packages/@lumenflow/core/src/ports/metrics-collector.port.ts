/**
 * Metrics Collector Port
 *
 * Hexagonal Architecture - Input Port
 * Defines the contract for collecting orchestration metrics from various sources.
 * This abstraction allows the application layer to remain independent of
 * specific data sources (filesystem, database, API, etc.).
 *
 * Current Implementations:
 * - FileSystemMetricsCollector (WU-1321) - Reads WU YAML, status.md, telemetry
 *
 * Future Implementations:
 * - DatabaseMetricsCollector - Query from Supabase
 * - APIMetricsCollector - Fetch from external service
 * - MockMetricsCollector - Testing purposes
 *
 * SOLID Principles:
 * - Dependency Inversion: Use cases depend on this abstraction, not concrete collectors
 * - Interface Segregation: Each method has a single responsibility
 * - Open/Closed: New collectors can be added without modifying existing code
 *
 * @module metrics-collector.port
 * @see {@link ../domain/orchestration.types.ts} - Types returned by this interface
 * @see {@link ../../adapters/filesystem-metrics.adapter.ts} - Filesystem implementation (WU-1321)
 */

import type {
  GlobalStatus,
  AgentMetric,
  WUProgress,
  TimelineEvent,
  Alert,
} from '../domain/orchestration.types.js';

/**
 * Metrics Collector Port Interface
 *
 * Implementers must provide methods to collect all metrics needed
 * for dashboard rendering. Each method should be independently callable
 * to allow selective data fetching.
 *
 * @example
 * // Implementing a custom collector
 * class CustomCollector implements IMetricsCollector {
 *   async getGlobalStatus(): Promise<GlobalStatus> {
 *     // Collect active WUs, completed count, blocked count, etc.
 *   }
 *
 *   async getAgentMetrics(): Promise<Record<string, AgentMetric>> {
 *     // Collect per-agent invocation counts, pass rates, timing
 *   }
 *
 *   // ... other methods
 * }
 *
 * @example
 * // Using in a use case
 * class GetDashboardDataUseCase {
 *   constructor(private readonly collector: IMetricsCollector) {}
 *
 *   async execute(): Promise<DashboardData> {
 *     const [globalStatus, agentMetrics, wuProgress, timeline, alerts] =
 *       await Promise.all([
 *         this.collector.getGlobalStatus(),
 *         this.collector.getAgentMetrics(),
 *         this.collector.getWUProgress(),
 *         this.collector.getTimeline(this.since24h()),
 *         this.collector.getAlerts(),
 *       ]);
 *
 *     return { globalStatus, agentMetrics, wuProgress, timeline, alerts };
 *   }
 * }
 */
export interface IMetricsCollector {
  /**
   * Get global orchestration status.
   *
   * Should aggregate:
   * - Count of WUs in 'in_progress' state
   * - Count of WUs completed in last 24 hours
   * - Count of currently blocked WUs
   * - Count of WUs with failing gates
   * - Longest running WU information
   * - List of WUs with pending mandatory agents
   *
   * @returns Global status metrics
   */
  getGlobalStatus(): Promise<GlobalStatus>;

  /**
   * Get metrics for all known agents.
   *
   * Should collect for each agent:
   * - Total invocation count
   * - Pass rate (percentage)
   * - Average duration in milliseconds
   * - Information about most recent run
   *
   * @returns Record mapping agent names to their metrics
   */
  getAgentMetrics(): Promise<Record<string, AgentMetric>>;

  /**
   * Get progress for all active WUs.
   *
   * Should collect for each active WU:
   * - WU ID and title
   * - Lane assignment
   * - DoD checkpoint progress
   * - Agent run statuses
   * - Headline sentence (Tufte principle)
   *
   * @returns Array of WU progress records, sorted by lane then WU ID
   */
  getWUProgress(): Promise<WUProgress[]>;

  /**
   * Get timeline events since a given date.
   *
   * Should collect events of types:
   * - claim: WU claimed
   * - done: WU completed
   * - block: WU blocked
   * - agent: Agent invoked with result
   * - gates: Gates run with result
   *
   * @param since - Only return events after this timestamp
   * @returns Array of timeline events, sorted by timestamp descending
   */
  getTimeline(since: Date): Promise<TimelineEvent[]>;

  /**
   * Get current alerts requiring attention.
   *
   * Should generate alerts for:
   * - Mandatory agents not yet invoked (HIGH)
   * - WUs near completion needing review (MEDIUM)
   * - Available lanes with ready WUs (LOW)
   *
   * @returns Array of alerts, sorted by severity (high first)
   */
  getAlerts(): Promise<Alert[]>;
}
