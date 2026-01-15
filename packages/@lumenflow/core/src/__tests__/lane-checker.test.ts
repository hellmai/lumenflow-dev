import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateLaneFormat, extractParent, getSubLanesForParent } from '../lane-checker.js';
import { ErrorCodes } from '../error-handler.js';

describe('validateLaneFormat', () => {
  describe('sub-lane validation', () => {
    it('accepts known sub-lane from taxonomy', () => {
      const { valid, parent } = validateLaneFormat('Core Systems: API');
      assert.equal(valid, true);
      assert.equal(parent, 'Core Systems');
    });

    it('accepts another known sub-lane from taxonomy', () => {
      const { valid, parent } = validateLaneFormat('Operations: Tooling');
      assert.equal(valid, true);
      assert.equal(parent, 'Operations');
    });

    it('accepts Intelligence sub-lanes', () => {
      const { valid, parent } = validateLaneFormat('Intelligence: Prompts');
      assert.equal(valid, true);
      assert.equal(parent, 'Intelligence');
    });

    it('rejects unknown sub-lane for parent with taxonomy', () => {
      assert.throws(
        () => validateLaneFormat('Core Systems: Foo'),
        /Unknown sub-lane: "Foo" for parent lane "Core Systems"/
      );
    });

    it('rejects typo in sub-lane name', () => {
      assert.throws(
        () => validateLaneFormat('Operations: Tool'),
        /Unknown sub-lane: "Tool" for parent lane "Operations"/
      );
    });

    it('rejects sub-lane on parent without taxonomy (Discovery)', () => {
      assert.throws(
        () => validateLaneFormat('Discovery: Spike'),
        /Parent lane "Discovery" does not support sub-lanes/
      );
    });

    it('rejects sub-lane on parent without taxonomy (Customer)', () => {
      assert.throws(
        () => validateLaneFormat('Customer: Research'),
        /Parent lane "Customer" does not support sub-lanes/
      );
    });
  });

  describe('parent-only lane validation', () => {
    it('rejects parent-only lane when taxonomy exists (Core Systems)', () => {
      assert.throws(
        () => validateLaneFormat('Core Systems'),
        (err) => {
          assert.equal(err.code, ErrorCodes.INVALID_LANE);
          assert.ok(/Sub-lane required/.test(err.message));
          assert.ok(err.details.validSubLanes.includes('API'));
          assert.ok(err.details.validSubLanes.includes('Data'));
          assert.ok(err.details.validSubLanes.includes('Infra'));
          return true;
        }
      );
    });

    it('rejects parent-only Operations lane', () => {
      assert.throws(
        () => validateLaneFormat('Operations'),
        (err) => {
          assert.equal(err.code, ErrorCodes.INVALID_LANE);
          assert.ok(/Sub-lane required/.test(err.message));
          assert.ok(err.details.validSubLanes.includes('Tooling'));
          return true;
        }
      );
    });

    it('rejects parent-only Experience lane', () => {
      assert.throws(
        () => validateLaneFormat('Experience'),
        (err) => {
          assert.equal(err.code, ErrorCodes.INVALID_LANE);
          assert.ok(err.details.validSubLanes.includes('Web'));
          assert.ok(err.details.validSubLanes.includes('Mobile'));
          return true;
        }
      );
    });

    it('rejects parent-only Intelligence lane', () => {
      assert.throws(
        () => validateLaneFormat('Intelligence'),
        (err) => {
          assert.equal(err.code, ErrorCodes.INVALID_LANE);
          assert.ok(err.details.validSubLanes.includes('Prompts'));
          return true;
        }
      );
    });

    it('allows parent-only Discovery (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Discovery');
      assert.equal(valid, true);
      assert.equal(parent, 'Discovery');
    });

    it('allows parent-only Customer (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Customer');
      assert.equal(valid, true);
      assert.equal(parent, 'Customer');
    });

    it('allows parent-only Revenue Ops (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Revenue Ops');
      assert.equal(valid, true);
      assert.equal(parent, 'Revenue Ops');
    });

    it('allows parent-only Comms (no taxonomy)', () => {
      const { valid, parent } = validateLaneFormat('Comms');
      assert.equal(valid, true);
      assert.equal(parent, 'Comms');
    });
  });

  describe('strict option', () => {
    it('strict: true (default) throws for parent-only with taxonomy', () => {
      assert.throws(
        () => validateLaneFormat('Operations'),
        (err) => err.code === ErrorCodes.INVALID_LANE
      );
    });

    it('strict: true explicit throws for parent-only with taxonomy', () => {
      assert.throws(
        () => validateLaneFormat('Operations', null, { strict: true }),
        (err) => err.code === ErrorCodes.INVALID_LANE
      );
    });

    it('strict: false warns but does not throw for parent-only with taxonomy', () => {
      // Should not throw - returns valid result but logs warning
      const { valid, parent } = validateLaneFormat('Operations', null, { strict: false });
      assert.equal(valid, true);
      assert.equal(parent, 'Operations');
    });

    it('strict: false still allows lanes without taxonomy', () => {
      const { valid, parent } = validateLaneFormat('Discovery', null, { strict: false });
      assert.equal(valid, true);
      assert.equal(parent, 'Discovery');
    });

    it('strict option does not affect valid sub-lanes', () => {
      const result1 = validateLaneFormat('Operations: Tooling', null, { strict: true });
      const result2 = validateLaneFormat('Operations: Tooling', null, { strict: false });
      assert.equal(result1.valid, true);
      assert.equal(result2.valid, true);
    });
  });

  describe('getSubLanesForParent', () => {
    it('returns sub-lanes for Core Systems', () => {
      const subLanes = getSubLanesForParent('Core Systems');
      assert.ok(subLanes.includes('API'));
      assert.ok(subLanes.includes('Data'));
      assert.ok(subLanes.includes('Infra'));
    });

    it('returns sub-lanes for Operations', () => {
      const subLanes = getSubLanesForParent('Operations');
      assert.ok(subLanes.includes('Tooling'));
      assert.ok(subLanes.includes('CI/CD'));
      assert.ok(subLanes.includes('Security'));
      assert.ok(subLanes.includes('Governance'));
    });

    it('returns sub-lanes for Experience', () => {
      const subLanes = getSubLanesForParent('Experience');
      assert.ok(subLanes.includes('Web'));
      assert.ok(subLanes.includes('Mobile'));
      assert.ok(subLanes.includes('Design System'));
    });

    it('returns sub-lanes for Intelligence', () => {
      const subLanes = getSubLanesForParent('Intelligence');
      assert.ok(subLanes.includes('Prompts'));
      assert.ok(subLanes.includes('Classifiers'));
      assert.ok(subLanes.includes('Orchestrator'));
      assert.ok(subLanes.includes('Evaluation'));
    });

    it('returns empty array for lane without taxonomy', () => {
      const subLanes = getSubLanesForParent('Discovery');
      assert.deepEqual(subLanes, []);
    });

    it('handles case-insensitive parent lookup', () => {
      const subLanes = getSubLanesForParent('operations');
      assert.ok(subLanes.includes('Tooling'));
    });
  });

  describe('extractParent', () => {
    it('extracts parent from sub-lane format', () => {
      assert.equal(extractParent('Operations: Tooling'), 'Operations');
    });

    it('extracts parent from Core Systems sub-lane', () => {
      assert.equal(extractParent('Core Systems: API'), 'Core Systems');
    });

    it('returns parent-only lane as-is', () => {
      assert.equal(extractParent('Operations'), 'Operations');
    });

    it('handles trimming whitespace', () => {
      assert.equal(extractParent('  Operations: Tooling  '), 'Operations');
    });
  });
});
