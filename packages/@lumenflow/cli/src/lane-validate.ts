#!/usr/bin/env node

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import {
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
  setLaneLifecycleStatus,
  validateLaneArtifacts,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[lane:validate]';
const PASS_SENTINEL = 'Lane lifecycle validation passed.';

function ensureLumenflowInit(projectRoot: string): void {
  const configPath = path.join(projectRoot, CONFIG_FILES.LUMENFLOW_CONFIG);
  if (!existsSync(configPath)) {
    die(
      `${LOG_PREFIX} Missing ${CONFIG_FILES.LUMENFLOW_CONFIG}.\n\n` +
        'Run `pnpm exec lumenflow init` first, then configure lane lifecycle.',
    );
  }
}

async function main() {
  const projectRoot = findProjectRoot();
  ensureLumenflowInit(projectRoot);

  const validation = validateLaneArtifacts(projectRoot);
  const passed = validation.warnings.length === 0 && validation.invalidLanes.length === 0;

  if (!passed) {
    console.log(`${LOG_PREFIX} Validation failed:`);
    for (const warning of validation.warnings) {
      console.log(`  - ${warning}`);
    }
    for (const invalidLane of validation.invalidLanes) {
      console.log(`  - Invalid lane mapping: ${invalidLane}`);
    }
    console.log(
      `${LOG_PREFIX} Next step: ${recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.UNCONFIGURED)}`,
    );
    process.exitCode = 1;
    return;
  }

  setLaneLifecycleStatus(projectRoot, LANE_LIFECYCLE_STATUS.DRAFT);
  console.log(`${LOG_PREFIX} ${PASS_SENTINEL}`);
  console.log(`${LOG_PREFIX} Lane lifecycle status: ${LANE_LIFECYCLE_STATUS.DRAFT}`);
  console.log(
    `${LOG_PREFIX} Next step: ${recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.DRAFT)}`,
  );
}

if (import.meta.main) {
  void runCLI(main);
}
