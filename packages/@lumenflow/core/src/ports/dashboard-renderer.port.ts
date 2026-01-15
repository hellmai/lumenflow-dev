/**
 * Dashboard Renderer Port
 *
 * Hexagonal Architecture - Output Port
 * Defines the contract for rendering orchestration dashboard data to any UI.
 * This abstraction allows the application layer to remain independent of
 * specific rendering implementations.
 *
 * Current Implementations:
 * - TerminalDashboardRenderer (WU-1322) - ASCII/ANSI terminal output
 *
 * Future Implementations:
 * - WebDashboardRenderer - Browser-based UI
 * - VSCodeWebviewRenderer - VS Code extension panel
 *
 * SOLID Principles:
 * - Dependency Inversion: Use cases depend on this abstraction, not concrete renderers
 * - Interface Segregation: Focused on rendering, no data fetching concerns
 * - Open/Closed: New renderers can be added without modifying existing code
 *
 * @module dashboard-renderer.port
 * @see {@link ../domain/orchestration.types.ts} - Types used in this interface
 * @see {@link ../../adapters/terminal-renderer.adapter.ts} - Terminal implementation (WU-1322)
 */

import type {
  DashboardData,
  Suggestion,
  ExecutionPlan,
  UserChoice,
} from '../domain/orchestration.types.js';

/**
 * Dashboard Renderer Port Interface
 *
 * Implementers must provide methods to render all dashboard sections
 * and handle user interactions for execution plan approval.
 *
 * @example
 * // Implementing a custom renderer
 * class CustomRenderer implements IDashboardRenderer {
 *   render(data: DashboardData): void {
 *     // Render global status, agent metrics, WU progress, timeline, alerts
 *   }
 *
 *   renderSuggestions(suggestions: Suggestion[]): void {
 *     // Display prioritised suggestions
 *   }
 *
 *   renderPlan(plan: ExecutionPlan): Promise<UserChoice> {
 *     // Show plan and get user approval
 *   }
 *
 *   clear(): void {
 *     // Clear previous output
 *   }
 * }
 *
 * @example
 * // Using in a use case
 * class GetDashboardDataUseCase {
 *   constructor(
 *     private readonly renderer: IDashboardRenderer,
 *     private readonly collector: IMetricsCollector,
 *   ) {}
 *
 *   async execute(): Promise<void> {
 *     const data = await this.collectData();
 *     this.renderer.render(data);
 *   }
 * }
 */
export interface IDashboardRenderer {
  /**
   * Render the complete dashboard with all sections.
   *
   * Sections to render:
   * 1. Global Status - Active WUs, completed, blocked, gates failing
   * 2. Agent Small Multiples - Per-agent metrics comparison
   * 3. WU Progress - DoD progress bars with agent status
   * 4. Timeline - Recent orchestration events
   * 5. Alerts - Items requiring attention
   *
   * @param data - Complete dashboard data from metrics collector
   */
  render(data: DashboardData): void;

  /**
   * Render a list of prioritised suggestions.
   *
   * Suggestions should be displayed with:
   * - Priority indicator (HIGH/MEDIUM/LOW)
   * - Action description
   * - Reason for suggestion
   * - Command to execute
   *
   * @param suggestions - Ordered list of suggestions (highest priority first)
   */
  renderSuggestions(suggestions: Suggestion[]): void;

  /**
   * Render an execution plan and get user approval.
   *
   * Should display:
   * - WU being executed
   * - Ordered list of steps
   * - Estimated token cost
   * - Approval prompt (approve/reject/edit)
   *
   * @param plan - Proposed execution plan
   * @returns User's choice (approve, reject, or edit with modifications)
   */
  renderPlan(plan: ExecutionPlan): Promise<UserChoice>;

  /**
   * Clear any previous dashboard output.
   *
   * Used before re-rendering to prevent stale data display.
   * Implementation depends on output medium (e.g., clear terminal, DOM update).
   */
  clear(): void;
}
