/**
 * Orchestration Dependency Injection Composition Root
 *
 * Factory functions that wire infrastructure adapters to application use cases.
 * Follows hexagonal architecture - this is the only place where concrete
 * implementations are coupled.
 *
 * @module orchestration-di
 * @see {@link ./ports/metrics-collector.port.mjs} - Input port
 * @see {@link ./ports/dashboard-renderer.port.mjs} - Output port
 * @see {@link ./adapters/filesystem-metrics.adapter.mjs} - Input adapter
 * @see {@link ./adapters/terminal-renderer.adapter.mjs} - Output adapter
 */

import { FileSystemMetricsCollector } from './adapters/filesystem-metrics.adapter';
import { TerminalDashboardRenderer } from './adapters/terminal-renderer.adapter';
import { GetDashboardDataUseCase } from './usecases/get-dashboard-data.usecase';
import { GetSuggestionsUseCase } from './usecases/get-suggestions.usecase';
import type { IDashboardRenderer } from './ports/dashboard-renderer.port';

/**
 * Create a GetDashboardDataUseCase with FileSystemMetricsCollector.
 *
 * @param baseDir - Base directory for filesystem operations (default: process.cwd())
 * @returns Configured use case instance
 *
 * @example
 * const useCase = createDashboardUseCase();
 * const data = await useCase.execute();
 */
export function createDashboardUseCase(baseDir?: string): GetDashboardDataUseCase {
  const collector = new FileSystemMetricsCollector(baseDir);
  return new GetDashboardDataUseCase(collector);
}

/**
 * Create a GetSuggestionsUseCase with FileSystemMetricsCollector.
 *
 * @param baseDir - Base directory for filesystem operations (default: process.cwd())
 * @returns Configured use case instance
 *
 * @example
 * const useCase = createSuggestionsUseCase();
 * const suggestions = await useCase.execute({ codePaths: ['src/auth/login.js'] });
 */
export function createSuggestionsUseCase(baseDir?: string): GetSuggestionsUseCase {
  const collector = new FileSystemMetricsCollector(baseDir);
  return new GetSuggestionsUseCase(collector);
}

/**
 * Create a TerminalDashboardRenderer for CLI output.
 *
 * @returns Configured renderer instance
 *
 * @example
 * const renderer = createRenderer();
 * renderer.render(dashboardData);
 */
export function createRenderer(): IDashboardRenderer {
  return new TerminalDashboardRenderer();
}
