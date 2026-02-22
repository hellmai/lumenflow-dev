// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const getConfigValueMock = vi.fn(async () => undefined);

vi.mock('../git-adapter.js', () => ({
  getGitForCwd: () => ({
    getConfigValue: getConfigValueMock,
  }),
}));

describe('user-normalizer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'user-normalizer-'));
    getConfigValueMock.mockReset();
    getConfigValueMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('infers default domain from workspace.yaml software_delivery.owner_email', async () => {
    await writeFile(
      path.join(tempDir, 'workspace.yaml'),
      ['software_delivery:', '  owner_email: "workspace-owner@kernel-first.dev"', ''].join('\n'),
      'utf-8',
    );

    const { inferDefaultDomain } = await import('../user-normalizer.js');
    const result = await inferDefaultDomain(tempDir);

    expect(result).toBe('kernel-first.dev');
  });
});
