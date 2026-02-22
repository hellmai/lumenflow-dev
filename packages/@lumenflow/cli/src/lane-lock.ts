#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import {
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
  setLaneLifecycleStatus,
  validateLaneArtifacts,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[lane:lock]';

function ensureLumenflowInit(projectRoot: string): void {
  const configPath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    die(
      `${LOG_PREFIX} Missing ${WORKSPACE_CONFIG_FILE_NAME}.\n\n` +
        'Run `pnpm workspace-init --yes` first, then configure lane lifecycle.',
    );
  }
}

async function main() {
  const projectRoot = findProjectRoot();
  ensureLumenflowInit(projectRoot);

  const validation = validateLaneArtifacts(projectRoot);
  const passed = validation.warnings.length === 0 && validation.invalidLanes.length === 0;

  if (!passed) {
    console.log(`${LOG_PREFIX} Cannot lock lane lifecycle because validation failed:`);
    for (const warning of validation.warnings) {
      console.log(`  - ${warning}`);
    }
    for (const invalidLane of validation.invalidLanes) {
      console.log(`  - Invalid lane mapping: ${invalidLane}`);
    }
    console.log(`${LOG_PREFIX} Next step: pnpm lane:validate`);
    process.exitCode = 1;
    return;
  }

  setLaneLifecycleStatus(projectRoot, LANE_LIFECYCLE_STATUS.LOCKED);
  console.log(`${LOG_PREFIX} Lane lifecycle status: ${LANE_LIFECYCLE_STATUS.LOCKED}`);
  console.log(
    `${LOG_PREFIX} Next step: ${recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.LOCKED)}`,
  );
}

if (import.meta.main) {
  void runCLI(main);
}
