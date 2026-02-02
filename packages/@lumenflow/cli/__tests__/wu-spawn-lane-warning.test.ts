import { describe, it, expect } from 'vitest';
import { generateLaneOccupationWarning } from '../dist/wu-spawn.js';

describe('wu-spawn lane occupation warning (WU-1340)', () => {
  it('includes lock_policy and wip_limit in warning message', () => {
    const lane = 'Content: Documentation';
    const warning = generateLaneOccupationWarning({ lane, wuId: 'WU-LOCKED' }, 'WU-TARGET');

    expect(warning).toContain('lock_policy=all');
    expect(warning).toContain('WIP=4');
  });
});
