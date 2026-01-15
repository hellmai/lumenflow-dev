import { describe, it, expect } from 'vitest';
import { LINTER_CONFIG } from '../linter-constants.mjs';

describe('linter-constants', () => {
  describe('LINTER_CONFIG', () => {
    it('has positive watchdog timeout', () => {
      expect(LINTER_CONFIG.WATCHDOG_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('has watchdog timeout of at least 30 seconds', () => {
      expect(LINTER_CONFIG.WATCHDOG_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
    });

    it('has positive glass surfaces limit', () => {
      expect(LINTER_CONFIG.MAX_GLASS_SURFACES).toBeGreaterThan(0);
    });

    it('has reasonable glass surfaces limit (UI constraint)', () => {
      // Glass surfaces should be limited for performance/UX
      expect(LINTER_CONFIG.MAX_GLASS_SURFACES).toBeLessThanOrEqual(10);
    });
  });
});
