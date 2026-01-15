/**
 * Tests for @lumenflow/metrics main exports
 */
import { describe, it, expect } from 'vitest';
import * as metrics from '../src/index.js';

describe('@lumenflow/metrics exports', () => {
  describe('version', () => {
    it('exports METRICS_VERSION', () => {
      expect(metrics.METRICS_VERSION).toBeDefined();
      expect(typeof metrics.METRICS_VERSION).toBe('string');
    });
  });

  describe('DORA exports', () => {
    it('exports calculateDORAMetrics', () => {
      expect(metrics.calculateDORAMetrics).toBeDefined();
      expect(typeof metrics.calculateDORAMetrics).toBe('function');
    });

    it('exports calculateDeploymentFrequency', () => {
      expect(metrics.calculateDeploymentFrequency).toBeDefined();
      expect(typeof metrics.calculateDeploymentFrequency).toBe('function');
    });

    it('exports calculateLeadTime', () => {
      expect(metrics.calculateLeadTime).toBeDefined();
      expect(typeof metrics.calculateLeadTime).toBe('function');
    });

    it('exports calculateCFR', () => {
      expect(metrics.calculateCFR).toBeDefined();
      expect(typeof metrics.calculateCFR).toBe('function');
    });

    it('exports calculateMTTR', () => {
      expect(metrics.calculateMTTR).toBeDefined();
      expect(typeof metrics.calculateMTTR).toBe('function');
    });

    it('exports identifyEmergencyFixes', () => {
      expect(metrics.identifyEmergencyFixes).toBeDefined();
      expect(typeof metrics.identifyEmergencyFixes).toBe('function');
    });

    it('exports DORA constants', () => {
      expect(metrics.DEPLOYMENT_FREQUENCY).toBeDefined();
      expect(metrics.LEAD_TIME_HOURS).toBeDefined();
      expect(metrics.CFR_PERCENT).toBeDefined();
      expect(metrics.MTTR_HOURS).toBeDefined();
      expect(metrics.STATISTICS).toBeDefined();
    });
  });

  describe('Flow exports', () => {
    it('exports calculateFlowState', () => {
      expect(metrics.calculateFlowState).toBeDefined();
      expect(typeof metrics.calculateFlowState).toBe('function');
    });

    it('exports analyzeBottlenecks', () => {
      expect(metrics.analyzeBottlenecks).toBeDefined();
      expect(typeof metrics.analyzeBottlenecks).toBe('function');
    });

    it('exports criticalPath', () => {
      expect(metrics.criticalPath).toBeDefined();
      expect(typeof metrics.criticalPath).toBe('function');
    });

    it('exports impactScore', () => {
      expect(metrics.impactScore).toBeDefined();
      expect(typeof metrics.impactScore).toBe('function');
    });

    it('exports topologicalSort', () => {
      expect(metrics.topologicalSort).toBeDefined();
      expect(typeof metrics.topologicalSort).toBe('function');
    });

    it('exports getBottleneckAnalysis', () => {
      expect(metrics.getBottleneckAnalysis).toBeDefined();
      expect(typeof metrics.getBottleneckAnalysis).toBe('function');
    });

    it('exports generateFlowReport', () => {
      expect(metrics.generateFlowReport).toBeDefined();
      expect(typeof metrics.generateFlowReport).toBe('function');
    });

    it('exports captureMetricsSnapshot', () => {
      expect(metrics.captureMetricsSnapshot).toBeDefined();
      expect(typeof metrics.captureMetricsSnapshot).toBe('function');
    });
  });

  describe('Telemetry exports', () => {
    it('exports createTelemetryEmitter', () => {
      expect(metrics.createTelemetryEmitter).toBeDefined();
      expect(typeof metrics.createTelemetryEmitter).toBe('function');
    });

    it('exports TELEMETRY_PATHS', () => {
      expect(metrics.TELEMETRY_PATHS).toBeDefined();
      expect(metrics.TELEMETRY_PATHS.GATES).toBeDefined();
      expect(metrics.TELEMETRY_PATHS.LLM_CLASSIFICATION).toBeDefined();
      expect(metrics.TELEMETRY_PATHS.FLOW_LOG).toBeDefined();
    });
  });
});
