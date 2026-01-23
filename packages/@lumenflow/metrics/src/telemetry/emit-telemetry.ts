/**
 * Telemetry Emission Module
 *
 * Emits structured NDJSON telemetry for gates execution, LLM classification,
 * and WU flow metrics.
 *
 * @module @lumenflow/metrics/telemetry
 */

import type {
  TelemetryEmitFn,
  GateEventInput,
  LLMClassificationStartInput,
  LLMClassificationCompleteInput,
  LLMClassificationErrorInput,
  WUFlowEventInput,
} from '../types.js';

/** Default telemetry paths */
export const TELEMETRY_PATHS = {
  GATES: '.lumenflow/telemetry/gates.ndjson',
  LLM_CLASSIFICATION: '.lumenflow/telemetry/llm-classification.ndjson',
  FLOW_LOG: '.lumenflow/flow.log',
} as const;

/**
 * Telemetry emitter interface
 */
export interface TelemetryEmitter {
  emitGateEvent(data: GateEventInput, logPath?: string): void;
  emitLLMClassificationStart(data: LLMClassificationStartInput, logPath?: string): void;
  emitLLMClassificationComplete(data: LLMClassificationCompleteInput, logPath?: string): void;
  emitLLMClassificationError(data: LLMClassificationErrorInput, logPath?: string): void;
  emitWUFlowEvent(data: WUFlowEventInput, logPath?: string): void;
}

/**
 * Create a telemetry emitter with the given emit function.
 * This allows consumers to provide their own filesystem implementation.
 */
export function createTelemetryEmitter(emit: TelemetryEmitFn): TelemetryEmitter {
  return {
    /**
     * Emit a gates execution event
     */
    emitGateEvent(data: GateEventInput, logPath: string = TELEMETRY_PATHS.GATES): void {
      const event = {
        timestamp: new Date().toISOString(),
        wu_id: data.wuId ?? null,
        lane: data.lane ?? null,
        gate_name: data.gateName,
        passed: data.passed,
        duration_ms: data.durationMs,
      };
      emit(logPath, event);
    },

    /**
     * Emit LLM classification start event
     */
    emitLLMClassificationStart(
      data: LLMClassificationStartInput,
      logPath: string = TELEMETRY_PATHS.LLM_CLASSIFICATION,
    ): void {
      const event = {
        timestamp: new Date().toISOString(),
        event_type: 'llm.classification.start',
        classification_type: data.classificationType,
        has_context: data.hasContext ?? false,
        wu_id: data.wuId ?? null,
        lane: data.lane ?? null,
      };
      emit(logPath, event);
    },

    /**
     * Emit LLM classification complete event
     */
    emitLLMClassificationComplete(
      data: LLMClassificationCompleteInput,
      logPath: string = TELEMETRY_PATHS.LLM_CLASSIFICATION,
    ): void {
      const event: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        event_type: 'llm.classification.complete',
        classification_type: data.classificationType,
        duration_ms: data.durationMs,
        tokens_used: data.tokensUsed,
        estimated_cost_usd: data.estimatedCostUsd,
        confidence: data.confidence,
        fallback_used: data.fallbackUsed,
        wu_id: data.wuId ?? null,
        lane: data.lane ?? null,
      };

      if (data.fallbackUsed && data.fallbackReason) {
        event['fallback_reason'] = data.fallbackReason;
      }

      emit(logPath, event);
    },

    /**
     * Emit LLM classification error event
     */
    emitLLMClassificationError(
      data: LLMClassificationErrorInput,
      logPath: string = TELEMETRY_PATHS.LLM_CLASSIFICATION,
    ): void {
      const event: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        event_type: 'llm.classification.error',
        classification_type: data.classificationType,
        error_type: data.errorType,
        error_message: data.errorMessage,
        wu_id: data.wuId ?? null,
        lane: data.lane ?? null,
      };

      if (data.durationMs !== undefined) {
        event['duration_ms'] = data.durationMs;
      }

      if (data.inputTextPreview) {
        event['input_text_preview'] = '[REDACTED]';
      }

      emit(logPath, event);
    },

    /**
     * Emit WU flow telemetry event
     */
    emitWUFlowEvent(data: WUFlowEventInput, logPath: string = TELEMETRY_PATHS.FLOW_LOG): void {
      const event = {
        timestamp: new Date().toISOString(),
        ...data,
      };
      emit(logPath, event);
    },
  };
}
