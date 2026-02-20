// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-deferred-lanes.test.ts
 * WU-1748: Deferred lane lifecycle process
 *
 * Verifies init no longer finalizes delivery lanes. Lane lifecycle begins in
 * `unconfigured` state and is completed through dedicated lane commands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { scaffoldProject } from '../init.js';

const CONFIG_FILE_NAME = '.lumenflow.config.yaml';
const LANE_INFERENCE_FILE_NAME = '.lumenflow.lane-inference.yaml';
const LANE_LIFECYCLE_STATUS_UNCONFIGURED = 'unconfigured';

interface ConfigLanesSection {
  definitions?: unknown[];
  lifecycle?: {
    status?: string;
  };
}

interface LumenflowConfigDoc {
  lanes?: ConfigLanesSection;
}

describe('init deferred lane lifecycle (WU-1748)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-deferred-lanes-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function readConfig(): LumenflowConfigDoc {
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);
    const configContent = fs.readFileSync(configPath, 'utf-8');
    return YAML.parse(configContent) as LumenflowConfigDoc;
  }

  it('does not scaffold lane inference taxonomy during init', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);
    expect(fs.existsSync(laneInferencePath)).toBe(false);
  });

  it('does not scaffold finalized lanes.definitions during init', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const config = readConfig();
    expect(config.lanes?.definitions).toBeUndefined();
  });

  it('marks lane lifecycle as unconfigured in generated config', async () => {
    await scaffoldProject(tempDir, { force: true, full: true });

    const config = readConfig();
    expect(config.lanes?.lifecycle?.status).toBe(LANE_LIFECYCLE_STATUS_UNCONFIGURED);
  });
});
