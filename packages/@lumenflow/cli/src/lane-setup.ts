#!/usr/bin/env node

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import {
  ensureDraftLaneArtifacts,
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[lane:setup]';
const LANE_VALIDATE_COMMAND = 'pnpm lane:validate';

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

  const result = ensureDraftLaneArtifacts(projectRoot);
  const nextStep = recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.DRAFT);

  console.log(`${LOG_PREFIX} Lane lifecycle status: ${result.status}`);

  if (result.createdDefinitions || result.createdInference) {
    console.log(`${LOG_PREFIX} Draft artifacts prepared:`);
    console.log(
      `  - ${CONFIG_FILES.LUMENFLOW_CONFIG}: ${result.createdDefinitions ? 'created/updated lane definitions' : 'existing definitions preserved'}`,
    );
    console.log(
      `  - ${CONFIG_FILES.LANE_INFERENCE}: ${result.createdInference ? 'created draft taxonomy' : 'existing taxonomy preserved'}`,
    );
  } else {
    console.log(
      `${LOG_PREFIX} Existing lane artifacts preserved. You can expand/edit lanes safely.`,
    );
  }

  console.log(`${LOG_PREFIX} Validate draft: ${LANE_VALIDATE_COMMAND}`);
  console.log(`${LOG_PREFIX} Lock lifecycle: ${nextStep}`);
}

if (import.meta.main) {
  void runCLI(main);
}
