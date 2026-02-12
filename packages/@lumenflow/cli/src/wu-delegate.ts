#!/usr/bin/env node

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
