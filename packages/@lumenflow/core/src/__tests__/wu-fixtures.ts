/* global structuredClone */
/**
 * Work Unit Test Fixtures
 *
 * Shared WU test data for Vitest tests.
 * Uses WU-TEST-XXX prefix to avoid collision with real WUs.
 *
 * Part of WU-1244: Implement test fixtures best practice with Vitest test.extend
 *
 * @see {@link tools/__tests__/helpers/test-repo-factory.mjs} - Test repo factory (pattern reference)
 * @see {@link tools/lib/wu-constants.mjs} - Production constants
 */

/**
 * Test WU ID constants
 * Uses WU-TEST- prefix to distinguish from real WUs
 */
export const TEST_WU_IDS = {
  VALID: 'WU-TEST-100',
  DONE: 'WU-TEST-101',
  BLOCKED: 'WU-TEST-102',
  IN_PROGRESS: 'WU-TEST-103',
  WAITING: 'WU-TEST-104',
} as const;

/**
 * Test lane names
 * Mirrors production lanes for realistic testing
 */
export const TEST_LANES = {
  OPERATIONS: 'Operations',
  OPERATIONS_TOOLING: 'Operations: Tooling',
  INTELLIGENCE: 'Intelligence',
  INTELLIGENCE_PROMPTS: 'Intelligence: Prompts',
  CORE_SYSTEMS: 'Core Systems',
  EXPERIENCE: 'Experience',
} as const;

/**
 * Valid WU statuses
 */
export const TEST_STATUSES = ['ready', 'in_progress', 'blocked', 'waiting', 'done'] as const;

/**
 * Base WU structure with all required fields
 * Aligns with test-repo-factory.mjs createTestWU() structure
 */
const BASE_WU = {
  id: TEST_WU_IDS.VALID,
  title: 'Test WU fixture',
  lane: TEST_LANES.OPERATIONS,
  type: 'feature',
  status: 'ready',
  priority: 'P2',
  locked: false,
  created: '2025-01-01',
  description: 'Test WU description for integration testing',
  acceptance: ['Test criterion passes'],
  code_paths: [],
  notes: '',
};

/**
 * Pre-configured WU fixtures for common test scenarios
 */
export const WU_FIXTURES = {
  /** Ready state WU - valid for claiming */
  VALID_WU: {
    ...BASE_WU,
  },

  /** Terminal state WU - locked, cannot transition */
  DONE_WU: {
    ...BASE_WU,
    id: TEST_WU_IDS.DONE,
    title: 'Completed WU fixture',
    status: 'done',
    locked: true,
  },

  /** Blocked state WU - waiting for external dependency */
  BLOCKED_WU: {
    ...BASE_WU,
    id: TEST_WU_IDS.BLOCKED,
    title: 'Blocked WU fixture',
    status: 'blocked',
  },

  /** In-progress state WU - actively being worked */
  IN_PROGRESS_WU: {
    ...BASE_WU,
    id: TEST_WU_IDS.IN_PROGRESS,
    title: 'In-progress WU fixture',
    status: 'in_progress',
  },

  /** Waiting state WU - awaiting review */
  WAITING_WU: {
    ...BASE_WU,
    id: TEST_WU_IDS.WAITING,
    title: 'Waiting WU fixture',
    status: 'waiting',
  },
};

/**
 * Create a fresh WU fixture with optional overrides
 *
 * Uses structuredClone for isolation - prevents mutation between tests
 *
 * @param {keyof typeof WU_FIXTURES} [type='VALID_WU'] - Fixture type to clone
 * @param {object} [overrides={}] - Field overrides
 * @returns {object} Fresh WU data object
 *
 * @example
 * // Get fresh copy of VALID_WU
 * const wu = createWuFixture();
 *
 * @example
 * // Get BLOCKED_WU with custom title
 * const wu = createWuFixture('BLOCKED_WU', { title: 'Custom blocked WU' });
 */
export function createWuFixture(
  type: keyof typeof WU_FIXTURES = 'VALID_WU',
  overrides: Record<string, any> = {},
) {
  const base = WU_FIXTURES[type];
  if (!base) {
    throw new Error(
      `Unknown fixture type: ${type}. Valid types: ${Object.keys(WU_FIXTURES).join(', ')}`,
    );
  }
  return { ...structuredClone(base), ...overrides };
}

/**
 * State transition test cases for describe.each()
 *
 * Based on LumenFlow state machine rules (tools/lib/state-machine.mjs)
 */
export const STATE_TRANSITION_CASES = {
  /**
   * Legal state transitions - should NOT throw
   */
  LEGAL: [
    { from: 'ready', to: 'in_progress', description: 'claim' },
    { from: 'in_progress', to: 'blocked', description: 'block' },
    { from: 'in_progress', to: 'waiting', description: 'submit for review' },
    { from: 'in_progress', to: 'done', description: 'direct completion' },
    { from: 'blocked', to: 'in_progress', description: 'unblock' },
    { from: 'blocked', to: 'done', description: 'direct resolution' },
    { from: 'waiting', to: 'in_progress', description: 'changes requested' },
    { from: 'waiting', to: 'done', description: 'approved' },
  ],

  /**
   * Illegal state transitions - should throw
   */
  ILLEGAL: [
    { from: 'done', to: 'in_progress', reason: 'done is terminal' },
    { from: 'done', to: 'ready', reason: 'done is terminal' },
    { from: 'done', to: 'blocked', reason: 'done is terminal' },
    { from: 'done', to: 'waiting', reason: 'done is terminal' },
    { from: 'done', to: 'done', reason: 'no-op transition' },
    { from: 'ready', to: 'blocked', reason: 'must claim first' },
    { from: 'ready', to: 'done', reason: 'must implement first' },
    { from: 'ready', to: 'waiting', reason: 'must claim first' },
    { from: 'ready', to: 'ready', reason: 'no-op transition' },
    { from: 'blocked', to: 'waiting', reason: 'invalid path' },
    { from: 'blocked', to: 'ready', reason: 'invalid path' },
    { from: 'blocked', to: 'blocked', reason: 'no-op transition' },
    { from: 'waiting', to: 'blocked', reason: 'invalid path' },
    { from: 'waiting', to: 'ready', reason: 'invalid path' },
    { from: 'waiting', to: 'waiting', reason: 'no-op transition' },
    { from: 'in_progress', to: 'ready', reason: 'backward transition' },
    { from: 'in_progress', to: 'in_progress', reason: 'no-op transition' },
  ],

  /**
   * Edge cases - invalid/null states
   */
  EDGE_CASES: [
    { from: null, to: 'in_progress', expected: 'Invalid state: null' },
    { from: undefined, to: 'in_progress', expected: 'Invalid state: undefined' },
    { from: 'ready', to: null, expected: 'Invalid state: null' },
    { from: 'ready', to: undefined, expected: 'Invalid state: undefined' },
    { from: '', to: 'in_progress', expected: 'Invalid state' },
    { from: 'ready', to: '', expected: 'Invalid state' },
    { from: 'unknown_state', to: 'in_progress', expected: 'Invalid state: unknown_state' },
    { from: 'ready', to: 'unknown_state', expected: 'Invalid state: unknown_state' },
  ],
};

export default {
  TEST_WU_IDS,
  TEST_LANES,
  TEST_STATUSES,
  WU_FIXTURES,
  createWuFixture,
  STATE_TRANSITION_CASES,
};
