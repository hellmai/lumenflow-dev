#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
const BRIEF_DESCRIPTION =
  'Generate config-aware handoff prompt and record wu:brief evidence for sub-agent execution';

/**
 * Main entry point for wu:brief (canonical command)
 */
export async function main(): Promise<void> {
  await runBriefLogic({
    mode: 'brief',
    parserConfig: {
      name: 'wu-brief',
      description: BRIEF_DESCRIPTION,
    },
    logPrefix: BRIEF_LOG_PREFIX,
  });
}

// Guard main() for testability (WU-1366)
if (import.meta.main) {
  void runCLI(main);
}
