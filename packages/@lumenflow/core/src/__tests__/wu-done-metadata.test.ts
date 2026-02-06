import { describe, it, expect } from 'vitest';

import { DEFAULTS } from '../wu-constants.js';
import { generateCommitMessage } from '../wu-done-metadata.js';

describe('generateCommitMessage provenance trailers', () => {
  it('appends Worktree-Branch trailer when branch provenance is provided', () => {
    const msg = (generateCommitMessage as any)('WU-1479', 'Fix push race', DEFAULTS.MAX_COMMIT_SUBJECT, {
      branch: 'lane/framework-core/wu-1479',
    });

    expect(msg).toContain('\n\n');
    expect(msg).toContain('Worktree-Branch: lane/framework-core/wu-1479');
  });

  it('appends both branch and path trailers when both are provided', () => {
    const msg = (generateCommitMessage as any)('WU-1479', 'Fix push race', DEFAULTS.MAX_COMMIT_SUBJECT, {
      branch: 'lane/framework-core/wu-1479',
      worktreePath: '/tmp/worktrees/framework-core-wu-1479',
    });

    expect(msg).toContain('Worktree-Branch: lane/framework-core/wu-1479');
    expect(msg).toContain('Worktree-Path: /tmp/worktrees/framework-core-wu-1479');
  });

  it('keeps the first line within subject-length limits', () => {
    const msg = (generateCommitMessage as any)('WU-1479', 'a very long title '.repeat(20), 72, {
      branch: 'lane/framework-core/wu-1479',
      worktreePath: '/tmp/worktrees/framework-core-wu-1479',
    });

    const [subject] = msg.split('\n');
    expect(subject.length).toBeLessThanOrEqual(72);
  });
});
