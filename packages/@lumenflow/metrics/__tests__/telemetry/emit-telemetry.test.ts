/**
 * Tests for telemetry emission
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTelemetryEmitter, TELEMETRY_PATHS } from '../../src/telemetry/emit-telemetry.js';
import type { TelemetryEmitFn } from '../../src/types.js';

describe('createTelemetryEmitter', () => {
  let emitFn: ReturnType<typeof vi.fn>;
  let emitter: ReturnType<typeof createTelemetryEmitter>;

  beforeEach(() => {
    emitFn = vi.fn();
    emitter = createTelemetryEmitter(emitFn as unknown as TelemetryEmitFn);
  });

  describe('TELEMETRY_PATHS', () => {
    it('exports default paths', () => {
      expect(TELEMETRY_PATHS.GATES).toBe('.lumenflow/telemetry/gates.ndjson');
      expect(TELEMETRY_PATHS.LLM_CLASSIFICATION).toBe(
        '.lumenflow/telemetry/llm-classification.ndjson',
      );
      expect(TELEMETRY_PATHS.FLOW_LOG).toBe('.lumenflow/flow.log');
    });
  });

  describe('emitGateEvent', () => {
    it('emits gate event with required fields', () => {
      emitter.emitGateEvent({
        gateName: 'lint',
        passed: true,
        durationMs: 100,
      });

      expect(emitFn).toHaveBeenCalledTimes(1);
      const [path, event] = emitFn.mock.calls[0]!;
      expect(path).toBe(TELEMETRY_PATHS.GATES);
      expect(event.gate_name).toBe('lint');
      expect(event.passed).toBe(true);
      expect(event.duration_ms).toBe(100);
      expect(event.timestamp).toBeDefined();
    });

    it('includes optional wuId and lane', () => {
      emitter.emitGateEvent({
        gateName: 'typecheck',
        passed: false,
        durationMs: 200,
        wuId: 'WU-100',
        lane: 'Operations',
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.wu_id).toBe('WU-100');
      expect(event.lane).toBe('Operations');
    });

    it('uses custom log path', () => {
      const customPath = '/custom/gates.log';
      emitter.emitGateEvent({ gateName: 'lint', passed: true, durationMs: 50 }, customPath);

      const [path] = emitFn.mock.calls[0]!;
      expect(path).toBe(customPath);
    });
  });

  describe('emitLLMClassificationStart', () => {
    it('emits start event', () => {
      emitter.emitLLMClassificationStart({
        classificationType: 'mode_detection',
      });

      const [path, event] = emitFn.mock.calls[0]!;
      expect(path).toBe(TELEMETRY_PATHS.LLM_CLASSIFICATION);
      expect(event.event_type).toBe('llm.classification.start');
      expect(event.classification_type).toBe('mode_detection');
      expect(event.has_context).toBe(false);
    });

    it('includes hasContext', () => {
      emitter.emitLLMClassificationStart({
        classificationType: 'mode_detection',
        hasContext: true,
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.has_context).toBe(true);
    });
  });

  describe('emitLLMClassificationComplete', () => {
    it('emits complete event with all fields', () => {
      emitter.emitLLMClassificationComplete({
        classificationType: 'mode_detection',
        durationMs: 150,
        tokensUsed: 100,
        estimatedCostUsd: 0.001,
        confidence: 0.95,
        fallbackUsed: false,
      });

      const [path, event] = emitFn.mock.calls[0]!;
      expect(path).toBe(TELEMETRY_PATHS.LLM_CLASSIFICATION);
      expect(event.event_type).toBe('llm.classification.complete');
      expect(event.duration_ms).toBe(150);
      expect(event.tokens_used).toBe(100);
      expect(event.estimated_cost_usd).toBe(0.001);
      expect(event.confidence).toBe(0.95);
      expect(event.fallback_used).toBe(false);
    });

    it('includes fallback_reason when fallback used', () => {
      emitter.emitLLMClassificationComplete({
        classificationType: 'mode_detection',
        durationMs: 150,
        tokensUsed: 100,
        estimatedCostUsd: 0.001,
        confidence: 0.7,
        fallbackUsed: true,
        fallbackReason: 'confidence_below_threshold',
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.fallback_used).toBe(true);
      expect(event.fallback_reason).toBe('confidence_below_threshold');
    });

    it('omits fallback_reason when fallback not used', () => {
      emitter.emitLLMClassificationComplete({
        classificationType: 'mode_detection',
        durationMs: 150,
        tokensUsed: 100,
        estimatedCostUsd: 0.001,
        confidence: 0.95,
        fallbackUsed: false,
        fallbackReason: 'should_not_appear',
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.fallback_reason).toBeUndefined();
    });
  });

  describe('emitLLMClassificationError', () => {
    it('emits error event', () => {
      emitter.emitLLMClassificationError({
        classificationType: 'mode_detection',
        errorType: 'timeout',
        errorMessage: 'Request timed out after 30s',
      });

      const [path, event] = emitFn.mock.calls[0]!;
      expect(path).toBe(TELEMETRY_PATHS.LLM_CLASSIFICATION);
      expect(event.event_type).toBe('llm.classification.error');
      expect(event.error_type).toBe('timeout');
      expect(event.error_message).toBe('Request timed out after 30s');
    });

    it('includes optional durationMs', () => {
      emitter.emitLLMClassificationError({
        classificationType: 'mode_detection',
        errorType: 'timeout',
        errorMessage: 'timed out',
        durationMs: 30000,
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.duration_ms).toBe(30000);
    });

    it('redacts inputTextPreview for PII protection', () => {
      emitter.emitLLMClassificationError({
        classificationType: 'mode_detection',
        errorType: 'validation',
        errorMessage: 'Invalid input',
        inputTextPreview: 'User John Doe ID 123-45-6789',
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.input_text_preview).toBe('[REDACTED]');
    });
  });

  describe('emitWUFlowEvent', () => {
    it('emits flow event', () => {
      emitter.emitWUFlowEvent({
        script: 'wu-claim',
        wuId: 'WU-100',
        lane: 'Operations',
        step: 'claimed',
      });

      const [path, event] = emitFn.mock.calls[0]!;
      expect(path).toBe(TELEMETRY_PATHS.FLOW_LOG);
      expect(event.script).toBe('wu-claim');
      expect(event.wuId).toBe('WU-100');
      expect(event.lane).toBe('Operations');
      expect(event.step).toBe('claimed');
      expect(event.timestamp).toBeDefined();
    });

    it('allows additional properties', () => {
      emitter.emitWUFlowEvent({
        script: 'wu-done',
        wuId: 'WU-100',
        customField: 'custom-value',
        numericField: 42,
      });

      const [, event] = emitFn.mock.calls[0]!;
      expect(event.customField).toBe('custom-value');
      expect(event.numericField).toBe(42);
    });

    it('uses custom log path', () => {
      const customPath = '/custom/flow.log';
      emitter.emitWUFlowEvent({ script: 'test' }, customPath);

      const [path] = emitFn.mock.calls[0]!;
      expect(path).toBe(customPath);
    });
  });
});
