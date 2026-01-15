// WU-2537: Tests for wu-state-schema module
import { describe, it, expect } from 'vitest';
import {
  validateWUEvent,
  WU_EVENT_TYPES,
  WU_STATUSES,
  WU_PATTERNS,
} from '../../src/state/wu-state-schema';

describe('wu-state-schema', () => {
  describe('WU_EVENT_TYPES', () => {
    it('exports valid event types', () => {
      expect(WU_EVENT_TYPES).toContain('create');
      expect(WU_EVENT_TYPES).toContain('claim');
      expect(WU_EVENT_TYPES).toContain('block');
      expect(WU_EVENT_TYPES).toContain('unblock');
      expect(WU_EVENT_TYPES).toContain('complete');
      expect(WU_EVENT_TYPES).toContain('checkpoint');
      expect(WU_EVENT_TYPES).toContain('spawn');
    });
  });

  describe('WU_STATUSES', () => {
    it('exports valid status values', () => {
      expect(WU_STATUSES).toContain('ready');
      expect(WU_STATUSES).toContain('in_progress');
      expect(WU_STATUSES).toContain('blocked');
      expect(WU_STATUSES).toContain('waiting');
      expect(WU_STATUSES).toContain('done');
    });
  });

  describe('WU_PATTERNS', () => {
    it('exports WU ID pattern', () => {
      expect(WU_PATTERNS.WU_ID).toBeDefined();
      expect(WU_PATTERNS.WU_ID.test('WU-1570')).toBe(true);
      expect(WU_PATTERNS.WU_ID.test('WU-100')).toBe(true);
      expect(WU_PATTERNS.WU_ID.test('InvalidID')).toBe(false);
    });
  });

  describe('validateWUEvent', () => {
    it('validates claim events', () => {
      const event = {
        type: 'claim',
        wuId: 'WU-1570',
        lane: 'Operations: Tooling',
        title: 'Test WU',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(true);
    });

    it('rejects invalid event types', () => {
      const event = {
        type: 'invalid-type',
        wuId: 'WU-1570',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(false);
    });

    it('rejects invalid WU ID format', () => {
      const event = {
        type: 'claim',
        wuId: 'INVALID-ID',
        lane: 'Operations',
        title: 'Test',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(false);
    });

    it('validates complete events', () => {
      const event = {
        type: 'complete',
        wuId: 'WU-1570',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(true);
    });

    it('validates block events with reason', () => {
      const event = {
        type: 'block',
        wuId: 'WU-1570',
        reason: 'Blocked by dependency',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(true);
    });

    it('validates checkpoint events', () => {
      const event = {
        type: 'checkpoint',
        wuId: 'WU-1570',
        note: 'Implementation complete',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(true);
    });

    it('validates spawn events', () => {
      const event = {
        type: 'spawn',
        wuId: 'WU-200',
        parentWuId: 'WU-100',
        spawnId: 'spawn-abc123',
        timestamp: new Date().toISOString(),
      };
      const result = validateWUEvent(event);
      expect(result.success).toBe(true);
    });
  });
});
