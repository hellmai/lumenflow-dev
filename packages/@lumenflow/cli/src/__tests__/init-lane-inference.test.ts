// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-lane-inference.test.ts
 * WU-1748: Deferred lane lifecycle
 *
 * `.lumenflow.lane-inference.yaml` is no longer scaffolded by `init`.
 * It is created during lane lifecycle setup (`pnpm lane:setup`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scaffoldProject } from '../init.js';

const LANE_INFERENCE_FILE_NAME = '.lumenflow.lane-inference.yaml';

describe('init lane inference deferral (WU-1748)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-lane-inference-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not generate lane inference file during init', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);
    expect(fs.existsSync(laneInferencePath)).toBe(false);
  });

  it('does not generate lane inference file even when framework is provided', async () => {
    await scaffoldProject(tempDir, {
      force: true,
      full: true,
      framework: 'nextjs',
    });

    const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);
    expect(fs.existsSync(laneInferencePath)).toBe(false);
  });
});
