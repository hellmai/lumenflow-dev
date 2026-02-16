#!/usr/bin/env node

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import {
  ensureLaneLifecycleForProject,
  recommendLaneLifecycleNextStep,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[lane:status]';

function ensureLumenflowInit(projectRoot: string): void {
  const configPath = path.join(projectRoot, CONFIG_FILES.LUMENFLOW_CONFIG);
  if (!existsSync(configPath)) {
    die(
      `${LOG_PREFIX} Missing ${CONFIG_FILES.LUMENFLOW_CONFIG}.\n\n` +
        'Run `pnpm exec lumenflow init` first, then re-run lane lifecycle commands.',
    );
  }
}

/**
 * Resolve lane lifecycle status for lane:status without mutating config.
 */
export function resolveLaneLifecycleForStatus(projectRoot: string) {
  return ensureLaneLifecycleForProject(projectRoot, { persist: false });
}

async function main() {
  const projectRoot = findProjectRoot();
  ensureLumenflowInit(projectRoot);

  const classification = resolveLaneLifecycleForStatus(projectRoot);
  const nextStep = recommendLaneLifecycleNextStep(classification.status);

  if (classification.source === 'migration') {
    console.log(`[lane:lifecycle] Migration check: ${classification.migrationReason}`);
    console.log(`[lane:lifecycle] Classified as: ${classification.status}`);
  }

  console.log(`Lane lifecycle status: ${classification.status}`);
  console.log(`Recommended next step: ${nextStep}`);
}

if (import.meta.main) {
  void runCLI(main);
}
