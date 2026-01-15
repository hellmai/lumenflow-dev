/**
 * Telemetry Module
 *
 * Structured telemetry emission for gates, LLM classification, and WU flow events.
 *
 * @module @lumenflow/metrics/telemetry
 */

export {
  createTelemetryEmitter,
  TELEMETRY_PATHS,
  type TelemetryEmitter,
} from './emit-telemetry.js';
