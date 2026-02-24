// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateBacklogSync } from '../backlog-sync-validator.js';

function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'lumenflow-backlog-sync-validator-'));
}

describe('backlog-sync-validator', () => {
  let tmpDir: string;
  let previousCwd: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    previousCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves WU YAML directory from workspace config instead of backlog-relative sibling paths', () => {
    const customWuDir = path.join('artifacts', 'wu-records');
    const customBacklogPath = path.join('planning', 'backlog.md');
    const backlogPath = path.join(tmpDir, customBacklogPath);

    writeFileSync(
      path.join(tmpDir, 'workspace.yaml'),
      `software_delivery:
  directories:
    wuDir: ${customWuDir}
    backlogPath: ${customBacklogPath}
`,
      { encoding: 'utf-8' },
    );

    writeFileSync(
      path.join(tmpDir, '.lumenflow.lane-inference.yaml'),
      `Operations:
  sub_lanes:
    - Tooling
`,
      { encoding: 'utf-8' },
    );

    mkdirSync(path.join(tmpDir, customWuDir), { recursive: true });
    writeFileSync(
      path.join(tmpDir, customWuDir, 'WU-100.yaml'),
      `id: WU-100
title: Verify config-driven wuDir resolution
lane: Operations
status: ready
`,
      { encoding: 'utf-8' },
    );

    mkdirSync(path.dirname(backlogPath), { recursive: true });
    writeFileSync(
      backlogPath,
      `---
sections:
  ready:
    heading: "## Ready"
  in_progress:
    heading: "## In Progress"
  blocked:
    heading: "## Blocked"
  done:
    heading: "## Done"
---
## Ready
- [WU-100 — Verify config-driven wuDir resolution](wu/WU-100.yaml)
`,
      { encoding: 'utf-8' },
    );

    const result = validateBacklogSync(backlogPath);

    expect(result.valid).toBe(false);
    expect(result.stats?.parentOnlyInReady).toBe(1);
    expect(result.errors.some((error) => error.includes('parent-only lane format'))).toBe(true);
  });
});

