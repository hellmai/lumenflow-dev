import { describe, it, expect } from 'vitest';
import { GATE_CONFIG } from '../gate-constants.mjs';

describe('gate-constants', () => {
  describe('GATE_CONFIG', () => {
    it('has positive timeout', () => {
      expect(GATE_CONFIG.TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('has timeout of at least 30 seconds', () => {
      expect(GATE_CONFIG.TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
    });

    it('has positive file size limit', () => {
      expect(GATE_CONFIG.MAX_FILE_SIZE_BYTES).toBeGreaterThan(0);
    });

    it('has file size limit of at least 1MB', () => {
      expect(GATE_CONFIG.MAX_FILE_SIZE_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    });

    it('has reasonable gate count', () => {
      expect(GATE_CONFIG.TOTAL_GATES).toBeGreaterThan(0);
      expect(GATE_CONFIG.TOTAL_GATES).toBeLessThanOrEqual(20);
    });
  });
});
