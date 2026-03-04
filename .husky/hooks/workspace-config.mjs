#!/usr/bin/env node
/**
 * Shared workspace config reader for git hooks and tool scripts.
 * WU-2310: Single source of truth for wuDir resolution in non-TypeScript code.
 *
 * Resolution order:
 * 1. Built CLI helper (@lumenflow/core/dist/cli/get-wu-dir.js) via getConfig()
 * 2. Direct workspace.yaml read (bootstrap/pre-build scenarios)
 * Returns null if neither is available. No hardcoded fallback paths.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProjectRoot } from './project-root.mjs';

const CLI_HELPER_CANDIDATES = [
  'node_modules/@lumenflow/core/dist/cli/get-wu-dir.js',
  'packages/@lumenflow/core/dist/cli/get-wu-dir.js',
];

/**
 * Resolve the configured wuDir for the project.
 * @param {string} [projectRoot] - Project root path. Auto-detected if omitted.
 * @returns {string | null} The configured wuDir (relative path), or null if unavailable.
 */
export function getWuDir(projectRoot) {
  const root = projectRoot || resolveProjectRoot();

  for (const candidate of CLI_HELPER_CANDIDATES) {
    const helperPath = join(root, candidate);
    if (existsSync(helperPath)) {
      try {
        const result = execFileSync('node', [helperPath, root], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        }).trim();
        if (result) return result;
      } catch {
        // CLI helper failed — return null, don't guess
      }
    }
  }

  // Fallback: read workspace.yaml directly (bootstrap/pre-build scenarios)
  try {
    const wsPath = join(root, 'workspace.yaml');
    if (existsSync(wsPath)) {
      const content = readFileSync(wsPath, 'utf8');
      const match = content.match(/^\s+wuDir:\s*['"]?([^\s'"]+)['"]?\s*$/m);
      if (match) return match[1];
    }
  } catch {
    // workspace.yaml unreadable — return null
  }

  return null;
}
