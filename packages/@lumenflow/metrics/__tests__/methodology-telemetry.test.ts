/**
 * Methodology Telemetry Tests
 *
 * WU-1270: Test opt-in telemetry for methodology mode tracking.
 * Verifies telemetry captures methodology.testing and methodology.architecture values.
 *
 * @module @lumenflow/metrics/tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMethodologyTelemetryEmitter,
  type MethodologyTelemetryEmitter,
  type MethodologyTelemetryEvent,
  type MethodologyTelemetryInput,
  METHODOLOGY_TELEMETRY_PATHS,
  isMethodologyTelemetryEnabled,
} from '../src/methodology-telemetry.js';
import type { TelemetryEmitFn } from '../src/types.js';

describe('methodology-telemetry', () => {
  let mockEmit: ReturnType<typeof vi.fn<TelemetryEmitFn>>;
  let emitter: MethodologyTelemetryEmitter;

  beforeEach(() => {
    mockEmit = vi.fn();
    emitter = createMethodologyTelemetryEmitter(mockEmit);
  });

  describe('createMethodologyTelemetryEmitter', () => {
    it('should create an emitter with emitMethodologySelection method', () => {
      expect(emitter).toBeDefined();
      expect(emitter.emitMethodologySelection).toBeDefined();
      expect(typeof emitter.emitMethodologySelection).toBe('function');
    });
  });

  describe('emitMethodologySelection', () => {
    it('should emit methodology.testing value', () => {
      const input: MethodologyTelemetryInput = {
        testing: 'tdd',
        architecture: 'hexagonal',
        wuId: 'WU-1270',
        eventContext: 'spawn',
      };

      emitter.emitMethodologySelection(input);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      const [logPath, event] = mockEmit.mock.calls[0];
      expect(logPath).toBe(METHODOLOGY_TELEMETRY_PATHS.METHODOLOGY);
      expect(event).toMatchObject({
        methodology_testing: 'tdd',
        event_context: 'spawn',
      });
    });

    it('should emit methodology.architecture value', () => {
      const input: MethodologyTelemetryInput = {
        testing: 'test-after',
        architecture: 'layered',
        wuId: 'WU-1270',
        eventContext: 'spawn',
      };

      emitter.emitMethodologySelection(input);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      const [, event] = mockEmit.mock.calls[0];
      expect(event).toMatchObject({
        methodology_architecture: 'layered',
      });
    });

    it('should include timestamp in ISO format', () => {
      const input: MethodologyTelemetryInput = {
        testing: 'tdd',
        architecture: 'hexagonal',
        eventContext: 'spawn',
      };

      emitter.emitMethodologySelection(input);

      const [, event] = mockEmit.mock.calls[0];
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('string');
      // Verify it's a valid ISO date
      expect(() => new Date(event.timestamp as string)).not.toThrow();
    });

    it('should NOT include WU ID (no PII/project-identifying info)', () => {
      const input: MethodologyTelemetryInput = {
        testing: 'tdd',
        architecture: 'hexagonal',
        wuId: 'WU-SECRET-PROJECT-1270',
        eventContext: 'spawn',
      };

      emitter.emitMethodologySelection(input);

      const [, event] = mockEmit.mock.calls[0];
      // WU ID should NOT be in the emitted event (privacy requirement)
      expect(event.wu_id).toBeUndefined();
      expect((event as Record<string, unknown>).wuId).toBeUndefined();
    });

    it('should NOT include lane (no project-identifying info)', () => {
      const input: MethodologyTelemetryInput = {
        testing: 'tdd',
        architecture: 'hexagonal',
        lane: 'Framework: Core',
        eventContext: 'spawn',
      };

      emitter.emitMethodologySelection(input);

      const [, event] = mockEmit.mock.calls[0];
      expect(event.lane).toBeUndefined();
    });

    it('should include eventContext to distinguish spawn from other contexts', () => {
      const input: MethodologyTelemetryInput = {
        testing: 'none',
        architecture: 'none',
        eventContext: 'spawn',
      };

      emitter.emitMethodologySelection(input);

      const [, event] = mockEmit.mock.calls[0];
      expect(event).toMatchObject({
        event_context: 'spawn',
      });
    });

    it('should handle all testing methodology values', () => {
      const testingValues = ['tdd', 'test-after', 'none'] as const;

      for (const testing of testingValues) {
        mockEmit.mockClear();

        emitter.emitMethodologySelection({
          testing,
          architecture: 'hexagonal',
          eventContext: 'spawn',
        });

        const [, event] = mockEmit.mock.calls[0];
        expect(event.methodology_testing).toBe(testing);
      }
    });

    it('should handle all architecture methodology values', () => {
      const architectureValues = ['hexagonal', 'layered', 'none'] as const;

      for (const architecture of architectureValues) {
        mockEmit.mockClear();

        emitter.emitMethodologySelection({
          testing: 'tdd',
          architecture,
          eventContext: 'spawn',
        });

        const [, event] = mockEmit.mock.calls[0];
        expect(event.methodology_architecture).toBe(architecture);
      }
    });

    it('should use correct log path', () => {
      emitter.emitMethodologySelection({
        testing: 'tdd',
        architecture: 'hexagonal',
        eventContext: 'spawn',
      });

      const [logPath] = mockEmit.mock.calls[0];
      expect(logPath).toBe('.lumenflow/telemetry/methodology.ndjson');
    });

    it('should allow custom log path override', () => {
      const customPath = 'custom/telemetry/methodology.ndjson';

      emitter.emitMethodologySelection(
        {
          testing: 'tdd',
          architecture: 'hexagonal',
          eventContext: 'spawn',
        },
        customPath,
      );

      const [logPath] = mockEmit.mock.calls[0];
      expect(logPath).toBe(customPath);
    });
  });

  describe('METHODOLOGY_TELEMETRY_PATHS', () => {
    it('should export METHODOLOGY path constant', () => {
      expect(METHODOLOGY_TELEMETRY_PATHS.METHODOLOGY).toBe(
        '.lumenflow/telemetry/methodology.ndjson',
      );
    });
  });

  describe('isMethodologyTelemetryEnabled', () => {
    it('should return false when config flag is not set', () => {
      const config = {};
      expect(isMethodologyTelemetryEnabled(config)).toBe(false);
    });

    it('should return false when telemetry.methodology.enabled is false', () => {
      const config = {
        telemetry: {
          methodology: {
            enabled: false,
          },
        },
      };
      expect(isMethodologyTelemetryEnabled(config)).toBe(false);
    });

    it('should return true when telemetry.methodology.enabled is true', () => {
      const config = {
        telemetry: {
          methodology: {
            enabled: true,
          },
        },
      };
      expect(isMethodologyTelemetryEnabled(config)).toBe(true);
    });

    it('should return false when telemetry object exists but methodology is missing', () => {
      const config = {
        telemetry: {},
      };
      expect(isMethodologyTelemetryEnabled(config)).toBe(false);
    });
  });

  describe('MethodologyTelemetryEvent type', () => {
    it('should have required fields matching the emitted event structure', () => {
      emitter.emitMethodologySelection({
        testing: 'tdd',
        architecture: 'hexagonal',
        eventContext: 'spawn',
      });

      const [, event] = mockEmit.mock.calls[0] as [string, MethodologyTelemetryEvent];

      // Type-check: these fields should exist
      expect(event.timestamp).toBeDefined();
      expect(event.event_type).toBe('methodology.selection');
      expect(event.methodology_testing).toBe('tdd');
      expect(event.methodology_architecture).toBe('hexagonal');
      expect(event.event_context).toBe('spawn');
    });
  });
});
