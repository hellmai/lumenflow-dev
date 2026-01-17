import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateLaneFormat, extractParent, getSubLanesForParent } from '../lane-checker.js';
import { ErrorCodes } from '../error-handler.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check if running in a project with config files
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../../..');
const hasConfig = existsSync(join(projectRoot, '.lumenflow.config.yaml'));
const hasLaneInference = existsSync(join(projectRoot, '.lumenflow.lane-inference.yaml'));
const hasFullConfig = hasConfig && hasLaneInference;

describe.skipIf(!hasFullConfig)('validateLaneFormat', () => {
  describe('sub-lane validation', () => {
    it('accepts known sub-lane from taxonomy', () => {
      const { valid, parent } = validateLaneFormat('Core Systems: API');
      expect(valid).toBe(true);
      expect(parent).toBe('Core Systems');
    });

    it('accepts another known sub-lane from taxonomy', () => {
      const { valid, parent } = validateLaneFormat('Operations: Tooling');
      expect(valid).toBe(true);
      expect(parent).toBe('Operations');
    });

    it('accepts Intelligence sub-lanes', () => {
      const { valid, parent } = validateLaneFormat('Intelligence: Prompts');
      expect(valid).toBe(true);
      expect(parent).toBe('Intelligence');
    });

    it('rejects unknown sub-lane for parent with taxonomy', () => {
      expect(() => validateLaneFormat('Core Systems: Foo')).toThrow(
        /Unknown sub-lane: "Foo" for parent lane "Core Systems"/
      );
    });

    it('rejects typo in sub-lane name', () => {
      expect(() => validateLaneFormat('Operations: Tool')).toThrow(
        /Unknown sub-lane: "Tool" for parent lane "Operations"/
      );
    });

    it('rejects sub-lane on parent without taxonomy (Discovery)', () => {
      expect(() => validateLaneFormat('Discovery: Spike')).toThrow(
        /Parent lane "Discovery" does not support sub-lanes/
      );
    });

    it('rejects sub-lane on parent without taxonomy (Customer)', () => {
      expect(() => validateLaneFormat('Customer: Research')).toThrow(
        /Parent lane "Customer" does not support sub-lanes/
      );
    });
  });

  describe('parent-only lane validation', () => {
    it('rejects parent-only lane when taxonomy exists (Core Systems)', () => {
      try {
        validateLaneFormat('Core Systems');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.INVALID_LANE);
        expect(/Sub-lane required/.test(err.message)).toBeTruthy();
        expect(err.details.validSubLanes.includes('API')).toBe(true);
        expect(err.details.validSubLanes.includes('Data')).toBe(true);
        expect(err.details.validSubLanes.includes('Infra')).toBe(true);
      }
    });

    it('rejects parent-only Operations lane', () => {
      try {
        validateLaneFormat('Operations');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.INVALID_LANE);
        expect(/Sub-lane required/.test(err.message)).toBeTruthy();
        expect(err.details.validSubLanes.includes('Tooling')).toBe(true);
      }
    });

    it('rejects parent-only Experience lane', () => {
      try {
        validateLaneFormat('Experience');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.INVALID_LANE);
        expect(err.details.validSubLanes.includes('Web')).toBe(true);
        expect(err.details.validSubLanes.includes('Mobile')).toBe(true);
      }
    });

    it('rejects parent-only Intelligence lane', () => {
      try {
        validateLaneFormat('Intelligence');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.INVALID_LANE);
        expect(err.details.validSubLanes.includes('Prompts')).toBe(true);
      }
    });

    it('allows parent-only Discovery (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Discovery');
      expect(valid).toBe(true);
      expect(parent).toBe('Discovery');
    });

    it('allows parent-only Customer (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Customer');
      expect(valid).toBe(true);
      expect(parent).toBe('Customer');
    });

    it('allows parent-only Revenue Ops (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Revenue Ops');
      expect(valid).toBe(true);
      expect(parent).toBe('Revenue Ops');
    });

    it('allows parent-only Comms (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Comms');
      expect(valid).toBe(true);
      expect(parent).toBe('Comms');
    });
  });

  describe('strict option', () => {
    it('strict: true (default) throws for parent-only with taxonomy', () => {
      try {
        validateLaneFormat('Operations');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.INVALID_LANE);
      }
    });

    it('strict: true explicit throws for parent-only with taxonomy', () => {
      try {
        validateLaneFormat('Operations', null, { strict: true });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCodes.INVALID_LANE);
      }
    });

    it('strict: false warns but does not throw for parent-only with taxonomy', () => {
      // Should not throw - returns valid result but logs warning
      const { valid, parent } = validateLaneFormat('Operations', null, { strict: false });
      expect(valid).toBe(true);
      expect(parent).toBe('Operations');
    });

    it('strict: false still allows lanes without taxonomy', () => {
      const { valid, parent } = validateLaneFormat('Discovery', null, { strict: false });
      expect(valid).toBe(true);
      expect(parent).toBe('Discovery');
    });

    it('strict option does not affect valid sub-lanes', () => {
      const result1 = validateLaneFormat('Operations: Tooling', null, { strict: true });
      const result2 = validateLaneFormat('Operations: Tooling', null, { strict: false });
      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe('getSubLanesForParent', () => {
    it('returns sub-lanes for Core Systems', () => {
      const subLanes = getSubLanesForParent('Core Systems');
      expect(subLanes).toContain('API');
      expect(subLanes).toContain('Data');
      expect(subLanes).toContain('Infra');
    });

    it('returns sub-lanes for Operations', () => {
      const subLanes = getSubLanesForParent('Operations');
      expect(subLanes).toContain('Tooling');
      expect(subLanes).toContain('CI/CD');
      expect(subLanes).toContain('Security');
      expect(subLanes).toContain('Governance');
    });

    it('returns sub-lanes for Experience', () => {
      const subLanes = getSubLanesForParent('Experience');
      expect(subLanes).toContain('Web');
      expect(subLanes).toContain('Mobile');
      expect(subLanes).toContain('Design System');
    });

    it('returns sub-lanes for Intelligence', () => {
      const subLanes = getSubLanesForParent('Intelligence');
      expect(subLanes).toContain('Prompts');
      expect(subLanes).toContain('Classifiers');
      expect(subLanes).toContain('Orchestrator');
      expect(subLanes).toContain('Evaluation');
    });

    it('returns empty array for lane without taxonomy', () => {
      const subLanes = getSubLanesForParent('Discovery');
      expect(subLanes).toEqual([]);
    });

    it('handles case-insensitive parent lookup', () => {
      const subLanes = getSubLanesForParent('operations');
      expect(subLanes).toContain('Tooling');
    });
  });

  describe('extractParent', () => {
    it('extracts parent from sub-lane format', () => {
      expect(extractParent('Operations: Tooling')).toBe('Operations');
    });

    it('extracts parent from Core Systems sub-lane', () => {
      expect(extractParent('Core Systems: API')).toBe('Core Systems');
    });

    it('returns parent-only lane as-is', () => {
      expect(extractParent('Operations')).toBe('Operations');
    });

    it('handles trimming whitespace', () => {
      expect(extractParent('  Operations: Tooling  ')).toBe('Operations');
    });
  });
});
