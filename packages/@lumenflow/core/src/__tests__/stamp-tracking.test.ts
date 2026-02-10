import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { listTrackedWUStampIds } from '../stamp-tracking.js';

describe('listTrackedWUStampIds', () => {
  it('returns tracked stamp IDs from git ls-files output', async () => {
    const gitRaw = vi
      .fn()
      .mockResolvedValue('.lumenflow/stamps/WU-100.done\n.lumenflow/stamps/WU-101.done\n');

    const ids = await listTrackedWUStampIds({
      projectRoot: '/repo',
      stampsDir: '.lumenflow/stamps',
      gitRaw,
    });

    expect(ids).toEqual(new Set(['WU-100', 'WU-101']));
    expect(gitRaw).toHaveBeenCalledWith(['ls-files', '--', '.lumenflow/stamps/WU-*.done']);
  });

  it('normalizes absolute stamp paths to a repo-relative pathspec', async () => {
    const gitRaw = vi.fn().mockResolvedValue('docs/other.txt\n');

    await listTrackedWUStampIds({
      projectRoot: '/repo',
      stampsDir: path.join('/repo', '.lumenflow', 'stamps'),
      gitRaw,
    });

    expect(gitRaw).toHaveBeenCalledWith(['ls-files', '--', '.lumenflow/stamps/WU-*.done']);
  });

  it('returns null when git query is unavailable', async () => {
    const gitRaw = vi.fn().mockRejectedValue(new Error('git unavailable'));

    const ids = await listTrackedWUStampIds({
      projectRoot: '/repo',
      stampsDir: '.lumenflow/stamps',
      gitRaw,
    });

    expect(ids).toBeNull();
  });
});
