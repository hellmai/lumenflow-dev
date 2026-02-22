// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-lifecycle-process.test.ts
 * WU-1748: Process-owned deferred lane lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
import {
  classifyLaneLifecycleForProject,
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
  buildWuCreateLaneLifecycleMessage,
  buildInitiativeCreateLaneLifecycleMessage,
} from '../lane-lifecycle-process.js';

const CONFIG_FILE_NAME = WORKSPACE_CONFIG_FILE_NAME;
const LANE_INFERENCE_FILE_NAME = '.lumenflow.lane-inference.yaml';

describe('lane lifecycle process (WU-1748)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-lane-lifecycle-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeConfig(doc: Record<string, unknown>): void {
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);
    fs.writeFileSync(
      configPath,
      YAML.stringify({
        [WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY]: doc,
      }),
      'utf-8',
    );
  }

  function writeLaneInference(content: string): void {
    const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);
    fs.writeFileSync(laneInferencePath, content, 'utf-8');
  }

  it('classifies as unconfigured when no lane artifacts exist', () => {
    writeConfig({});

    const classification = classifyLaneLifecycleForProject(tempDir);
    expect(classification.status).toBe(LANE_LIFECYCLE_STATUS.UNCONFIGURED);
  });

  it('classifies as locked when lane artifacts exist and validate', () => {
    writeConfig({
      lanes: {
        definitions: [{ name: 'Framework: Core', wip_limit: 1, code_paths: ['src/core/**'] }],
      },
    });
    writeLaneInference(`Framework:\n  Core:\n    code_paths:\n      - src/core/**\n`);

    const classification = classifyLaneLifecycleForProject(tempDir);
    expect(classification.status).toBe(LANE_LIFECYCLE_STATUS.LOCKED);
  });

  it('classifies as draft when lane artifacts exist but validation fails', () => {
    writeConfig({
      lanes: {
        definitions: [{ name: 'Foundation: Core', wip_limit: 1, code_paths: ['src/core/**'] }],
      },
    });
    writeLaneInference(`Framework:\n  Core:\n    code_paths:\n      - src/core/**\n`);

    const classification = classifyLaneLifecycleForProject(tempDir);
    expect(classification.status).toBe(LANE_LIFECYCLE_STATUS.DRAFT);
  });

  it('recommends deterministic next step for each lifecycle status', () => {
    expect(recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.UNCONFIGURED)).toBe(
      'pnpm lane:setup',
    );
    expect(recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.DRAFT)).toBe('pnpm lane:lock');
    expect(recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.LOCKED)).toBe('lanes ready');
  });

  it('builds wu:create precondition message for unconfigured status', () => {
    const message = buildWuCreateLaneLifecycleMessage(LANE_LIFECYCLE_STATUS.UNCONFIGURED);
    expect(message).toContain('Lane lifecycle status: unconfigured');
    expect(message).toContain('Cannot create delivery WU until lanes are locked');
    expect(message).toContain('Next step: pnpm lane:setup');
  });

  it('builds wu:create precondition message for draft status', () => {
    const message = buildWuCreateLaneLifecycleMessage(LANE_LIFECYCLE_STATUS.DRAFT);
    expect(message).toContain('Lane lifecycle status: draft');
    expect(message).toContain('Cannot create delivery WU until lanes are locked');
    expect(message).toContain('Next step: pnpm lane:lock');
  });

  it('builds initiative:create informational message without lane synthesis', () => {
    const message = buildInitiativeCreateLaneLifecycleMessage(LANE_LIFECYCLE_STATUS.UNCONFIGURED);
    expect(message).toContain('Lane lifecycle: unconfigured');
    expect(message).toContain('Initiative creation is allowed before lane setup');
    expect(message).toContain('When ready for delivery WUs, run: pnpm lane:setup');
  });
});
