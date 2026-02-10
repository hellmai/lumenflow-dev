import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const { listTrackedWUStampIdsMock } = vi.hoisted(() => ({
  listTrackedWUStampIdsMock: vi.fn(),
}));

vi.mock('@lumenflow/core/stamp-tracking', () => ({
  listTrackedWUStampIds: listTrackedWUStampIdsMock,
}));

import { resolveStateDoctorStampIds } from '../state-doctor-stamps.js';

describe('resolveStateDoctorStampIds', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'state-doctor-stamps-'));
    mkdirSync(join(testDir, '.lumenflow/stamps'), { recursive: true });
    writeFileSync(join(testDir, '.lumenflow/stamps/WU-2001.done'), 'done');
    writeFileSync(join(testDir, '.lumenflow/stamps/WU-2002.done'), 'done');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns only tracked stamp IDs when tracking data is available', async () => {
    listTrackedWUStampIdsMock.mockResolvedValue(new Set(['WU-2002']));

    const ids = await resolveStateDoctorStampIds(testDir, '.lumenflow/stamps');

    expect(ids).toEqual(['WU-2002']);
    expect(listTrackedWUStampIdsMock).toHaveBeenCalledWith({
      projectRoot: testDir,
      stampsDir: '.lumenflow/stamps',
    });
  });

  it('treats all local stamps as visible when tracking query is unavailable', async () => {
    listTrackedWUStampIdsMock.mockResolvedValue(null);

    const ids = await resolveStateDoctorStampIds(testDir, '.lumenflow/stamps');

    expect(ids).toEqual(['WU-2001', 'WU-2002']);
  });
});
