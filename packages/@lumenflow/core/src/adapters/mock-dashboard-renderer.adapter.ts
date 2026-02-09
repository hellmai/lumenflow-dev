/**
 * Mock Dashboard Renderer Adapter
 *
 * WU-1549: Extracted from production TerminalDashboardRenderer.
 * Provides a test-friendly implementation of IDashboardRenderer that
 * captures all calls for assertions instead of writing to stdout.
 *
 * Hexagonal Architecture - Infrastructure Layer (Test Double)
 * Implements the DashboardRenderer port for unit testing.
 *
 * @module mock-dashboard-renderer.adapter
 * @see {@link ../ports/dashboard-renderer.port.ts} - Port interface
 * @see {@link ./terminal-renderer.adapter.ts} - Production implementation
 */

import type { IDashboardRenderer } from '../ports/dashboard-renderer.port.js';
import type {
  DashboardData,
  Suggestion,
  ExecutionPlan,
  UserChoice,
} from '../domain/orchestration.types.js';

/**
 * Captured render call for test assertions
 */
export interface RenderCall {
  method: 'render' | 'renderSuggestions' | 'renderPlan' | 'clear';
  args: unknown[];
  timestamp: number;
}

/**
 * Mock Dashboard Renderer
 *
 * Captures all rendering calls for test verification.
 * Does not produce any console output.
 *
 * @example
 * const mock = new MockDashboardRenderer();
 * mock.render(dashboardData);
 * expect(mock.renderCalls).toHaveLength(1);
 * expect(mock.renderCalls[0].method).toBe('render');
 *
 * @example
 * // Configure plan approval response
 * const mock = new MockDashboardRenderer({ planChoice: { choice: 'reject' } });
 * const result = await mock.renderPlan(plan);
 * expect(result.choice).toBe('reject');
 */
export class MockDashboardRenderer implements IDashboardRenderer {
  /** All captured render calls in chronological order */
  readonly renderCalls: RenderCall[] = [];

  /** Configurable response for renderPlan */
  private readonly planChoice: UserChoice;

  constructor(options?: { planChoice?: UserChoice }) {
    this.planChoice = options?.planChoice ?? { choice: 'approve', modifications: undefined };
  }

  /**
   * Capture render call without producing output.
   *
   * @param data - Complete dashboard data
   */
  render(data: DashboardData): void {
    this.renderCalls.push({
      method: 'render',
      args: [data],
      timestamp: Date.now(),
    });
  }

  /**
   * Capture renderSuggestions call without producing output.
   *
   * @param suggestions - Ordered suggestions
   */
  renderSuggestions(suggestions: Suggestion[]): void {
    this.renderCalls.push({
      method: 'renderSuggestions',
      args: [suggestions],
      timestamp: Date.now(),
    });
  }

  /**
   * Capture renderPlan call and return configured choice.
   *
   * @param plan - Proposed execution plan
   * @returns Configured user choice (default: approve)
   */
  async renderPlan(plan: ExecutionPlan): Promise<UserChoice> {
    this.renderCalls.push({
      method: 'renderPlan',
      args: [plan],
      timestamp: Date.now(),
    });
    return this.planChoice;
  }

  /**
   * Capture clear call without producing output.
   */
  clear(): void {
    this.renderCalls.push({
      method: 'clear',
      args: [],
      timestamp: Date.now(),
    });
  }

  /**
   * Reset all captured calls (useful between test cases).
   */
  reset(): void {
    this.renderCalls.length = 0;
  }

  /**
   * Get calls filtered by method name.
   *
   * @param method - Method name to filter
   * @returns Filtered calls
   */
  getCallsByMethod(method: RenderCall['method']): RenderCall[] {
    return this.renderCalls.filter((call) => call.method === method);
  }
}
