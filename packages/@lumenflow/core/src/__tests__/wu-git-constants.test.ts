import { describe, expect, it } from 'vitest';

import { GIT_COMMANDS, GIT_FLAGS } from '../wu-constants.js';

describe('wu git sync constants', () => {
  it('exports the --rebase flag constant', () => {
    expect(GIT_FLAGS.REBASE).toBe('--rebase');
  });

  it('exports the pull command constant', () => {
    expect(GIT_COMMANDS.PULL).toBe('pull');
  });
});
