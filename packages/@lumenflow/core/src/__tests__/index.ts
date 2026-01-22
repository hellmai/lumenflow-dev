/* global structuredClone */
/**
 * Test Fixtures Entry Point
 *
 * Main entry point for test fixtures. Provides:
 * - Extended test with fixture injection via test.extend()
 * - Re-exports all fixtures for easy importing
 *
 * Part of WU-1244: Implement test fixtures best practice with Vitest test.extend
 *
 * @example
 * // Import extended test with fixtures
 * import { test, describe, expect, WU_FIXTURES } from '../__fixtures__/index.ts';
 *
 * test('uses fixtures', ({ validWu, createWu }) => {
 *   expect(validWu.status).toBe('ready');
 *   const custom = createWu('BLOCKED_WU', { title: 'Custom' });
 *   expect(custom.status).toBe('blocked');
 * });
 *
 * @example
 * // Parameterized tests with describe.each
 * import { describe, STATE_TRANSITION_CASES } from '../__fixtures__/index.ts';
 *
 * describe.each(STATE_TRANSITION_CASES.LEGAL)(
 *   'Legal: $from → $to ($description)',
 *   ({ from, to }) => {
 *     it('allows transition', () => { ... });
 *   }
 * );
 */

import { test as baseTest, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WU_FIXTURES,
  createWuFixture,
  STATE_TRANSITION_CASES,
  TEST_WU_IDS,
  TEST_LANES,
  TEST_STATUSES,
} from './wu-fixtures.js';

/**
 * Extended test with fixture injection
 *
 * Provides pre-configured WU fixtures via test context.
 * Each fixture is a fresh structuredClone to prevent mutation between tests.
 *
 * @example
 * test('my test', ({ validWu, doneWu, blockedWu, createWu }) => {
 *   // validWu, doneWu, blockedWu are pre-configured fixtures
 *   // createWu is a factory function for custom fixtures
 * });
 */
export const test = baseTest.extend({
  /**
   * Fresh copy of VALID_WU fixture (status: ready)
   */
  validWu: async ({}, use) => {
    await use(structuredClone(WU_FIXTURES.VALID_WU));
  },

  /**
   * Fresh copy of DONE_WU fixture (status: done, locked: true)
   */
  doneWu: async ({}, use) => {
    await use(structuredClone(WU_FIXTURES.DONE_WU));
  },

  /**
   * Fresh copy of BLOCKED_WU fixture (status: blocked)
   */
  blockedWu: async ({}, use) => {
    await use(structuredClone(WU_FIXTURES.BLOCKED_WU));
  },

  /**
   * Fresh copy of IN_PROGRESS_WU fixture (status: in_progress)
   */
  inProgressWu: async ({}, use) => {
    await use(structuredClone(WU_FIXTURES.IN_PROGRESS_WU));
  },

  /**
   * Fresh copy of WAITING_WU fixture (status: waiting)
   */
  waitingWu: async ({}, use) => {
    await use(structuredClone(WU_FIXTURES.WAITING_WU));
  },

  /**
   * Factory function for creating custom WU fixtures
   *
   * @example
   * test('custom fixture', ({ createWu }) => {
   *   const wu = createWu('BLOCKED_WU', { title: 'Custom blocked' });
   * });
   */
  createWu: async ({}, use) => {
    await use(createWuFixture);
  },
});

// Re-export Vitest utilities
export { describe, expect, vi, beforeEach, afterEach };

// Re-export WU fixtures
export {
  WU_FIXTURES,
  createWuFixture,
  STATE_TRANSITION_CASES,
  TEST_WU_IDS,
  TEST_LANES,
  TEST_STATUSES,
};

export default {
  test,
  describe,
  expect,
  vi,
  beforeEach,
  afterEach,
  WU_FIXTURES,
  createWuFixture,
  STATE_TRANSITION_CASES,
  TEST_WU_IDS,
  TEST_LANES,
  TEST_STATUSES,
};
