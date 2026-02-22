// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fg from 'fast-glob';
import { pathReferenceExists, pathReferenceExistsSync } from '../wu-rules-resolvers.js';

vi.mock('fast-glob', () => {
  const asyncGlob = vi.fn();
  const syncGlob = vi.fn();
  Object.assign(asyncGlob, { sync: syncGlob });
  return { default: asyncGlob };
});

const mockFastGlobAsync = vi.mocked(fg);
const mockFastGlobSync = vi.mocked(fg.sync);

const ELOOP_ERROR = 'ELOOP: too many symbolic links encountered';

describe('wu-rules-resolvers glob robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false instead of throwing when sync glob expansion hits ELOOP', () => {
    mockFastGlobSync.mockImplementation(() => {
      throw new Error(ELOOP_ERROR);
    });

    expect(() => pathReferenceExistsSync('packages/@lumenflow/cli/**', '/tmp/repo')).not.toThrow();
    expect(pathReferenceExistsSync('packages/@lumenflow/cli/**', '/tmp/repo')).toBe(false);
  });

  it('returns false instead of throwing when async glob expansion hits ELOOP', async () => {
    mockFastGlobAsync.mockRejectedValue(new Error(ELOOP_ERROR));

    await expect(pathReferenceExists('packages/@lumenflow/cli/**', '/tmp/repo')).resolves.toBe(
      false,
    );
  });
});
