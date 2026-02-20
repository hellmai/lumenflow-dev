#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Delegate - Explicit Delegation Intent
 *
 * Generates handoff prompts and records delegation lineage intent.
 */

import { runBriefLogic } from './wu-spawn.js';
import { runCLI } from './cli-entry-point.js';

async function main(): Promise<void> {
  await runBriefLogic({
    mode: 'delegate',
    parserConfig: {
      name: 'wu-delegate',
      description: 'Generate delegation prompt and record explicit lineage intent',
    },
  });
}

if (import.meta.main) {
  void runCLI(main);
}
