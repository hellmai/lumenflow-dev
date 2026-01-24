/**
 * @file color-support.test.ts
 * Test suite for NO_COLOR/FORCE_COLOR/--no-color support (WU-1085)
 *
 * Tests the initColorSupport function that respects:
 * - NO_COLOR environment variable (https://no-color.org/)
 * - FORCE_COLOR environment variable (chalk standard)
 * - --no-color CLI flag
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('color-support (WU-1085)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear color-related env vars
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    // Reset module cache to get fresh chalk state
    vi.resetModules();
  });

  describe('initColorSupport', () => {
    it('should disable colors when NO_COLOR is set (https://no-color.org/)', async () => {
      process.env.NO_COLOR = '1';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(0);
    });

    it('should disable colors when NO_COLOR is empty string (presence check)', async () => {
      process.env.NO_COLOR = '';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(0);
    });

    it('should disable colors when --no-color flag is passed', async () => {
      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport(['node', 'script.js', '--no-color']);

      expect(getColorLevel()).toBe(0);
    });

    it('should set color level from FORCE_COLOR=0', async () => {
      process.env.FORCE_COLOR = '0';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(0);
    });

    it('should set color level from FORCE_COLOR=1', async () => {
      process.env.FORCE_COLOR = '1';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(1);
    });

    it('should set color level from FORCE_COLOR=2', async () => {
      process.env.FORCE_COLOR = '2';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(2);
    });

    it('should set color level from FORCE_COLOR=3', async () => {
      process.env.FORCE_COLOR = '3';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(3);
    });

    it('should prioritize NO_COLOR over FORCE_COLOR', async () => {
      process.env.NO_COLOR = '1';
      process.env.FORCE_COLOR = '3';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport();

      expect(getColorLevel()).toBe(0);
    });

    it('should prioritize --no-color flag over FORCE_COLOR', async () => {
      process.env.FORCE_COLOR = '3';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      initColorSupport(['node', 'script.js', '--no-color']);

      expect(getColorLevel()).toBe(0);
    });

    it('should ignore invalid FORCE_COLOR values', async () => {
      process.env.FORCE_COLOR = 'invalid';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      const originalLevel = getColorLevel();
      initColorSupport();

      // Should not change from default
      expect(getColorLevel()).toBe(originalLevel);
    });

    it('should ignore FORCE_COLOR values outside 0-3 range', async () => {
      process.env.FORCE_COLOR = '5';

      const { initColorSupport, getColorLevel } = await import('../src/color-support.js');
      const originalLevel = getColorLevel();
      initColorSupport();

      // Should not change from default
      expect(getColorLevel()).toBe(originalLevel);
    });
  });
});
