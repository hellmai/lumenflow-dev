#!/usr/bin/env node

/**
 * WU Brief - Pure Prompt Generator (WU-1603)
 *
 * Generates ready-to-use handoff prompts for sub-agent WU execution.
 * This is the canonical command for prompt generation.
 *
 * Usage:
 *   pnpm wu:brief --id WU-123
 *   pnpm wu:brief --id WU-123 --client codex-cli
 *
 * Output:
 *   A complete handoff prompt with:
 *   - Context loading preamble
 *   - WU details and acceptance criteria
 *   - Skills Selection section
 *   - Constraints block
 *
 * @see {@link ./wu-spawn.ts} - Shared logic (runBriefLogic)
 */

import { runBriefLogic } from './wu-spawn.js';
import { runCLI } from './cli-entry-point.js';

const BRIEF_LOG_PREFIX = '[wu:brief]';

/**
 * Main entry point for wu:brief (canonical command)
 */
async function main(): Promise<void> {
  await runBriefLogic({
    parserConfig: {
      name: 'wu-brief',
      description: 'Generate handoff prompt for sub-agent WU execution',
    },
    logPrefix: BRIEF_LOG_PREFIX,
  });
}

// Guard main() for testability (WU-1366)
if (import.meta.main) {
  void runCLI(main);
}
