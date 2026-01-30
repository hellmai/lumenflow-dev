/**
 * Methodology Telemetry Module
 *
 * WU-1270: Opt-in telemetry for methodology mode tracking.
 * Captures methodology.testing and methodology.architecture values on wu:spawn.
 * Privacy-preserving: No PII or project-identifying information collected.
 *
 * @module @lumenflow/metrics/methodology-telemetry
 */

import type { TelemetryEmitFn } from './types.js';

/**
 * Telemetry paths for methodology tracking
 */
export const METHODOLOGY_TELEMETRY_PATHS = {
  METHODOLOGY: '.lumenflow/telemetry/methodology.ndjson',
} as const;

/**
 * Testing methodology values (from resolve-policy.ts)
 */
export type TestingMethodologyValue = 'tdd' | 'test-after' | 'none';

/**
 * Architecture methodology values (from resolve-policy.ts)
 */
export type ArchitectureMethodologyValue = 'hexagonal' | 'layered' | 'none';

/**
 * Event context indicating where the telemetry was triggered
 */
export type MethodologyEventContext = 'spawn';

/**
 * Input for methodology telemetry emission
 *
 * Note: wuId and lane are accepted as input but NOT emitted
 * to preserve privacy (no project-identifying information).
 */
export interface MethodologyTelemetryInput {
  /** Testing methodology value */
  testing: TestingMethodologyValue;
  /** Architecture methodology value */
  architecture: ArchitectureMethodologyValue;
  /** Context in which telemetry was triggered */
  eventContext: MethodologyEventContext;
  /** WU ID (not emitted - privacy) */
  wuId?: string;
  /** Lane name (not emitted - privacy) */
  lane?: string;
}

/**
 * Methodology telemetry event structure (emitted to NDJSON)
 *
 * Privacy-preserving: Does NOT include:
 * - WU ID
 * - Lane name
 * - Project name
 * - Any other project-identifying information
 */
export interface MethodologyTelemetryEvent {
  /** ISO timestamp */
  timestamp: string;
  /** Event type identifier */
  event_type: 'methodology.selection';
  /** Testing methodology value */
  methodology_testing: TestingMethodologyValue;
  /** Architecture methodology value */
  methodology_architecture: ArchitectureMethodologyValue;
  /** Context where telemetry was triggered */
  event_context: MethodologyEventContext;
  /** Index signature for Record compatibility */
  [key: string]: string;
}

/**
 * Methodology telemetry emitter interface
 */
export interface MethodologyTelemetryEmitter {
  /**
   * Emit a methodology selection event
   * @param data - Methodology telemetry input
   * @param logPath - Optional custom log path
   */
  emitMethodologySelection(data: MethodologyTelemetryInput, logPath?: string): void;
}

/**
 * Create a methodology telemetry emitter
 *
 * @param emit - Telemetry emit function (writes to NDJSON file)
 * @returns Methodology telemetry emitter
 *
 * @example
 * ```typescript
 * import { createMethodologyTelemetryEmitter } from '@lumenflow/metrics/methodology-telemetry';
 *
 * const emit = (path: string, event: Record<string, unknown>) => {
 *   fs.appendFileSync(path, JSON.stringify(event) + '\n');
 * };
 *
 * const emitter = createMethodologyTelemetryEmitter(emit);
 *
 * // Emit methodology selection (wuId is NOT included in output)
 * emitter.emitMethodologySelection({
 *   testing: 'tdd',
 *   architecture: 'hexagonal',
 *   eventContext: 'spawn',
 *   wuId: 'WU-1270', // Accepted but not emitted
 * });
 * ```
 */
export function createMethodologyTelemetryEmitter(
  emit: TelemetryEmitFn,
): MethodologyTelemetryEmitter {
  return {
    emitMethodologySelection(
      data: MethodologyTelemetryInput,
      logPath: string = METHODOLOGY_TELEMETRY_PATHS.METHODOLOGY,
    ): void {
      // Create event WITHOUT project-identifying information
      // wuId and lane are intentionally NOT included (privacy requirement)
      const event: MethodologyTelemetryEvent = {
        timestamp: new Date().toISOString(),
        event_type: 'methodology.selection',
        methodology_testing: data.testing,
        methodology_architecture: data.architecture,
        event_context: data.eventContext,
      };

      emit(logPath, event);
    },
  };
}

/**
 * Configuration structure for methodology telemetry opt-in
 */
export interface MethodologyTelemetryConfig {
  telemetry?: {
    methodology?: {
      /** Whether methodology telemetry is enabled (opt-in) */
      enabled?: boolean;
    };
  };
}

/**
 * Check if methodology telemetry is enabled in configuration
 *
 * Methodology telemetry is OPT-IN only. Returns false unless
 * explicitly enabled via config.
 *
 * @param config - Configuration object with optional telemetry settings
 * @returns true if methodology telemetry is enabled
 *
 * @example
 * ```yaml
 * # .lumenflow.config.yaml
 * telemetry:
 *   methodology:
 *     enabled: true  # Opt-in to methodology tracking
 * ```
 */
export function isMethodologyTelemetryEnabled(config: MethodologyTelemetryConfig): boolean {
  return config.telemetry?.methodology?.enabled === true;
}
