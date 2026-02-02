import { describe, it, expect } from 'vitest';
import { generateLaneOccupationWarning } from '../dist/wu-spawn.js';

/**
 * WU-1346: Tests for lane occupation warning generation
 *
 * These tests verify generateLaneOccupationWarning uses injected config values
 * instead of reading from repo-specific .lumenflow.config.yaml.
 * This makes tests portable and independent of actual config file content.
 */

/** Test fixture: mock lane name for portable tests */
const TEST_LANE = 'Test: Lane';

describe('wu-spawn lane occupation warning (WU-1340, WU-1346)', () => {
  it('uses injected wipLimit and lockPolicy values', () => {
    const lane = TEST_LANE;
    const warning = generateLaneOccupationWarning({ lane, wuId: 'WU-LOCKED' }, 'WU-TARGET', {
      wipLimit: 2,
      lockPolicy: 'active',
    });

    expect(warning).toContain('WIP=2');
    expect(warning).toContain('lock_policy=active');
  });

  it('uses default values when not injected (backward compatibility)', () => {
    const lane = 'Nonexistent: Lane';
    const warning = generateLaneOccupationWarning(
      { lane, wuId: 'WU-LOCKED' },
      'WU-TARGET',
      // No wipLimit/lockPolicy - should use defaults from lane-checker
    );

    // Should contain lane info regardless of config lookup result
    expect(warning).toContain('Lane "Nonexistent: Lane" is occupied by WU-LOCKED');
    expect(warning).toContain('WIP=');
    expect(warning).toContain('lock_policy=');
  });

  it('includes stale lock warning when isStale is true', () => {
    const warning = generateLaneOccupationWarning(
      { lane: TEST_LANE, wuId: 'WU-STALE' },
      'WU-TARGET',
      { isStale: true, wipLimit: 1, lockPolicy: 'all' },
    );

    expect(warning).toContain('STALE');
    expect(warning).toContain('>24 hours old');
    expect(warning).toContain('pnpm wu:block --id WU-STALE');
  });

  it('includes actionable options for user', () => {
    const warning = generateLaneOccupationWarning(
      { lane: TEST_LANE, wuId: 'WU-BLOCKER' },
      'WU-NEW',
      { wipLimit: 1, lockPolicy: 'all' },
    );

    expect(warning).toContain('Wait for WU-BLOCKER to complete or block');
    expect(warning).toContain('Choose a different lane for WU-NEW');
    expect(warning).toContain('Block WU-BLOCKER if work is stalled');
  });

  it('handles different lock policies correctly', () => {
    const testCases = [
      { policy: 'all', wip: 1 },
      { policy: 'active', wip: 3 },
      { policy: 'none', wip: 10 },
    ] as const;

    for (const { policy, wip } of testCases) {
      const warning = generateLaneOccupationWarning({ lane: 'Any: Lane', wuId: 'WU-X' }, 'WU-Y', {
        wipLimit: wip,
        lockPolicy: policy,
      });

      expect(warning).toContain(`WIP=${wip}`);
      expect(warning).toContain(`lock_policy=${policy}`);
    }
  });
});
