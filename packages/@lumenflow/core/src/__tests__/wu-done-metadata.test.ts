import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';

import { DEFAULTS } from '../wu-constants.js';
import { generateCommitMessage, validateMetadataFilesExist } from '../wu-done-metadata.js';

describe('generateCommitMessage provenance trailers', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('returns subject only when no provenance is provided', () => {
    const msg = generateCommitMessage('WU-1479', 'Fix push race', DEFAULTS.MAX_COMMIT_SUBJECT);
    expect(msg).not.toContain('Worktree-Branch:');
    expect(msg).not.toContain('Worktree-Path:');
  });

  it('appends Worktree-Branch trailer when branch provenance is provided', () => {
    const msg = generateCommitMessage('WU-1479', 'Fix push race', DEFAULTS.MAX_COMMIT_SUBJECT, {
      branch: 'lane/framework-core/wu-1479',
    });

    expect(msg).toContain('\n\n');
    expect(msg).toContain('Worktree-Branch: lane/framework-core/wu-1479');
  });

  it('appends both branch and path trailers when both are provided', () => {
    const msg = generateCommitMessage('WU-1479', 'Fix push race', DEFAULTS.MAX_COMMIT_SUBJECT, {
      branch: 'lane/framework-core/wu-1479',
      worktreePath: '/tmp/worktrees/framework-core-wu-1479',
    });

    expect(msg).toContain('Worktree-Branch: lane/framework-core/wu-1479');
    expect(msg).toContain('Worktree-Path: /tmp/worktrees/framework-core-wu-1479');
  });

  it('keeps the first line within subject-length limits', () => {
    const msg = generateCommitMessage('WU-1479', 'a very long title '.repeat(20), 72, {
      branch: 'lane/framework-core/wu-1479',
      worktreePath: '/tmp/worktrees/framework-core-wu-1479',
    });

    const [subject] = msg.split('\n');
    expect(subject.length).toBeLessThanOrEqual(72);
  });

  it('throws when required metadata files are missing', () => {
    expect(() =>
      validateMetadataFilesExist({
        statusPath: '/tmp/missing-status.md',
        backlogPath: '/tmp/missing-backlog.md',
      }),
    ).toThrow('Required metadata files missing');
  });

  it('passes when status and backlog files exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wu-done-metadata-'));
    tempDirs.push(dir);
    const statusPath = path.join(dir, 'status.md');
    const backlogPath = path.join(dir, 'backlog.md');
    writeFileSync(statusPath, '# status');
    writeFileSync(backlogPath, '# backlog');

    expect(() => validateMetadataFilesExist({ statusPath, backlogPath })).not.toThrow();
  });
});
