#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import {
  ensureDraftLaneArtifacts,
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
  validateLaneArtifacts,
  setLaneLifecycleStatus,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[lane:setup]';
const LANE_VALIDATE_COMMAND = 'pnpm lane:validate';

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

  // WU-1755: Parse --lock flag from argv
  const lockFlag = process.argv.includes('--lock');

  const result = ensureDraftLaneArtifacts(projectRoot);

  console.log(`${LOG_PREFIX} Lane lifecycle status: ${result.status}`);

  if (result.createdDefinitions || result.createdInference) {
    console.log(`${LOG_PREFIX} Draft artifacts prepared:`);
    console.log(
      `  - ${WORKSPACE_CONFIG_FILE_NAME}: ${result.createdDefinitions ? 'created/updated lane definitions' : 'existing definitions preserved'}`,
    );
    console.log(
      `  - ${CONFIG_FILES.LANE_INFERENCE}: ${result.createdInference ? 'created draft taxonomy' : 'existing taxonomy preserved'}`,
    );
  } else {
    console.log(
      `${LOG_PREFIX} Existing lane artifacts preserved. You can expand/edit lanes safely.`,
    );
  }

  // WU-1755: --lock combines setup + validate + lock into a single command
  if (lockFlag) {
    const validation = validateLaneArtifacts(projectRoot);
    if (validation.warnings.length > 0) {
      for (const warning of validation.warnings) {
        console.warn(`${LOG_PREFIX} ⚠️  ${warning}`);
      }
    }
    if (validation.missingDefinitions || validation.missingInference) {
      die(`${LOG_PREFIX} Cannot lock: lane artifacts are incomplete. Fix warnings above.`);
    }
    setLaneLifecycleStatus(projectRoot, LANE_LIFECYCLE_STATUS.LOCKED);
    console.log(`${LOG_PREFIX} ✅ Lane lifecycle locked. Ready for WU creation.`);
    return;
  }

  const nextStep = recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.DRAFT);
  console.log(`${LOG_PREFIX} Validate draft: ${LANE_VALIDATE_COMMAND}`);
  console.log(`${LOG_PREFIX} Lock lifecycle: ${nextStep}`);
}

if (import.meta.main) {
  void runCLI(main);
}
