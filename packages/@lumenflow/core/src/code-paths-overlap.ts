// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Code Paths Overlap Detection
 *
 * Two-step algorithm for detecting code path conflicts between Work Units:
 * 1. Static glob containment check (fast pre-filter using pattern matching)
 * 2. Concrete file intersection (authoritative using filesystem)
 *
 * @module code-paths-overlap
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { parseYAML } from './wu-yaml.js';
import fg from 'fast-glob';
import micromatch from 'micromatch';
import { STATUS_SECTIONS, BACKLOG_SECTIONS, STRING_LITERALS } from './wu-constants.js';
import { GIT_DIRECTORY_NAME } from './config-contract.js';
import { createWuPaths } from './wu-paths.js';
import { findProjectRoot } from './lumenflow-config.js';

const RECURSIVE_GIT_DIR_GLOB = `${GIT_DIRECTORY_NAME}/**`;

function resolveProjectRootFromStatusPath(statusPath: string): string {
  const absoluteStatusPath = path.resolve(statusPath);
  return findProjectRoot(path.dirname(absoluteStatusPath));
}

/**
 * Check for code path overlap between two sets of glob patterns
 *
 * Uses two-step algorithm:
 * - Static check: Fast pattern analysis to detect obvious containment
 * - Concrete check: Filesystem-based expansion to find actual file intersection
 *
 * @param {string[]} claimingPaths - Glob patterns from WU being claimed
 * @param {string[]} existingPaths - Glob patterns from in-progress WU
 * @returns {{
 *   overlaps: boolean,
 *   type: 'none'|'concrete'|'ambiguous',
 *   files: string[]
 * }} Overlap detection result
 *
 * @example
 * checkOverlap(['apps/web/**'], ['apps/web/prompts/**'])
 * // => { overlaps: true, type: 'concrete', files: [...] }
 */
export function checkOverlap(
  claimingPaths: readonly string[] | null | undefined,
  existingPaths: readonly string[] | null | undefined,
) {
  // Handle empty inputs
  if (!claimingPaths || claimingPaths.length === 0) {
    return { overlaps: false, type: 'none', files: [] };
  }
  if (!existingPaths || existingPaths.length === 0) {
    return { overlaps: false, type: 'none', files: [] };
  }

  // Step 1: Static check (fast pre-filter)
  // Check if any pattern pair has static containment
  let hasStaticOverlap = false;
  for (const claiming of claimingPaths) {
    for (const existing of existingPaths) {
      // Bidirectional check: A contains B OR B contains A
      if (staticGlobContainment(claiming, existing) || staticGlobContainment(existing, claiming)) {
        hasStaticOverlap = true;
        break;
      }
    }
    if (hasStaticOverlap) break;
  }

  // Step 2: Concrete check (authoritative)
  // Expand globs and find actual file intersection
  const allFiles = new Set();
  for (const claiming of claimingPaths) {
    for (const existing of existingPaths) {
      const result = concreteFileIntersection(claiming, existing);
      if (result.overlaps) {
        result.files.forEach((f) => allFiles.add(f));
      }
    }
  }

  const hasConcreteOverlap = allFiles.size > 0;

  // Decision logic:
  // - Both static and concrete → BLOCK (concrete overlap)
  // - Static only, no concrete → WARN (ambiguous)
  // - Neither → ALLOW (none)
  if (hasConcreteOverlap) {
    return {
      overlaps: true,
      type: 'concrete',
      files: [...allFiles].sort(),
    };
  } else if (hasStaticOverlap && !hasConcreteOverlap) {
    return {
      overlaps: false,
      type: 'ambiguous',
      files: [],
    };
  } else {
    return {
      overlaps: false,
      type: 'none',
      files: [],
    };
  }
}

/**
 * Find all in-progress WUs with overlapping code paths
 *
 * Reads status.md to find in-progress WUs, loads their code_paths,
 * and checks for overlaps with the claiming WU's paths.
 *
 * @param {string} statusPath - Path to status.md file
 * @param {string[]} claimingPaths - Glob patterns from WU being claimed
 * @param {string} claimingWU - WU ID being claimed (excluded from check)
 * @returns {{
 *   conflicts: Array<{wuid: string, overlaps: string[]}>,
 *   hasBlocker: boolean
 * }} List of conflicting WUs and whether to block claim
 *
 * @example
 * const statusPath = createWuPaths().STATUS();
 * detectConflicts(statusPath, ['apps/**'], 'WU-901')
 * // => { conflicts: [{wuid: 'WU-900', overlaps: ['apps/web/foo.ts']}], hasBlocker: true }
 */
export function detectConflicts(
  statusPath: string,
  claimingPaths: readonly string[] | null | undefined,
  claimingWU: string,
) {
  // Handle empty claiming paths
  if (!claimingPaths || claimingPaths.length === 0) {
    return { conflicts: [], hasBlocker: false };
  }

  // Read status.md
  const content = readFileSync(statusPath, { encoding: 'utf-8' });
  const lines = content.split(STRING_LITERALS.NEWLINE);

  // Find "## In Progress" section (handles both status.md and backlog.md formats)
  const inProgressIdx = lines.findIndex((l) => {
    const normalized = l.trim().toLowerCase();
    return (
      normalized === STATUS_SECTIONS.IN_PROGRESS.toLowerCase() ||
      normalized === BACKLOG_SECTIONS.IN_PROGRESS.toLowerCase() ||
      normalized.startsWith('## in progress')
    );
  });

  if (inProgressIdx === -1) {
    return { conflicts: [], hasBlocker: false };
  }

  // Find end of In Progress section (next ## heading or end of file)
  let endIdx = lines.slice(inProgressIdx + 1).findIndex((l) => l.startsWith('## '));
  if (endIdx === -1) endIdx = lines.length - inProgressIdx - 1;
  else endIdx = inProgressIdx + 1 + endIdx;

  // Extract section content
  const section = lines.slice(inProgressIdx + 1, endIdx).join(STRING_LITERALS.NEWLINE);

  // Check for "No items" marker
  if (section.includes('No items currently in progress')) {
    return { conflicts: [], hasBlocker: false };
  }

  // Extract WU IDs from links like [WU-334 — Title](wu/WU-334.yaml)
  const wuLinkPattern = /\[([A-Z]+-\d+)\s*—\s*[^\]]+\]\([^)]+\)/gi;
  const matches = [...section.matchAll(wuLinkPattern)];

  if (matches.length === 0) {
    return { conflicts: [], hasBlocker: false };
  }

  // Compute project root from status path and resolve file paths from config.
  const projectRoot = resolveProjectRootFromStatusPath(statusPath);
  const wuPaths = createWuPaths({ projectRoot });

  // Check each in-progress WU for overlaps
  const conflicts = [];
  for (const match of matches) {
    const activeWuid = match[1]; // e.g., "WU-334"
    if (!activeWuid) {
      continue;
    }

    // Skip claiming WU (shouldn't conflict with itself)
    if (activeWuid === claimingWU) {
      continue;
    }

    // Read WU YAML
    const wuPath = path.join(projectRoot, wuPaths.WU(activeWuid));
    if (!existsSync(wuPath)) {
      continue; // Skip if YAML doesn't exist
    }

    const wuContent = readFileSync(wuPath, { encoding: 'utf-8' });
    const wuDoc = parseYAML(wuContent) as { code_paths?: string[] } | null;

    // Extract code_paths (skip if not defined)
    const existingPaths = wuDoc?.code_paths;
    if (!existingPaths || existingPaths.length === 0) {
      continue;
    }

    // Check for overlap
    const overlapResult = checkOverlap(claimingPaths, existingPaths);

    // Only record concrete overlaps (block on real conflicts)
    if (overlapResult.overlaps && overlapResult.type === 'concrete') {
      conflicts.push({
        wuid: activeWuid,
        overlaps: overlapResult.files,
      });
    }
  }

  return {
    conflicts,
    hasBlocker: conflicts.length > 0,
  };
}

/**
 * Static glob containment check (internal helper)
 *
 * Tests if patternA contains patternB using glob semantics.
 * Uses micromatch to convert globs to regex and test containment.
 *
 * @private
 * @param {string} patternA - First glob pattern
 * @param {string} patternB - Second glob pattern
 * @returns {boolean} True if patternA contains patternB
 *
 * @example
 * staticGlobContainment('apps/**', 'apps/web/**') // => true
 * staticGlobContainment('apps/web/**', 'packages/**') // => false
 */
function staticGlobContainment(patternA: string, patternB: string): boolean {
  // Convert patternB to a test path by replacing wildcards
  // Example: 'apps/web/**' → 'apps/web/test/file.ts'
  const testPath = patternB.replace(/\*\*/g, 'test/nested').replace(/\*/g, 'testfile');

  // Use micromatch to test if patternA would match this test path
  // If patternA matches the test path, it contains patternB
  return micromatch.isMatch(testPath, patternA);
}

/**
 * Concrete file intersection using filesystem (internal helper)
 *
 * Expands glob patterns to real files using fast-glob,
 * then computes Set intersection to find overlapping files.
 *
 * @private
 * @param {string} patternA - First glob pattern
 * @param {string} patternB - Second glob pattern
 * @returns {{overlaps: boolean, files: string[]}} Intersection result
 *
 * @example
 * concreteFileIntersection('apps/web/**', 'apps/web/prompts/**')
 * // => { overlaps: true, files: ['apps/web/prompts/base.yaml'] }
 */
function concreteFileIntersection(patternA: string, patternB: string) {
  // Expand globs to real files using fast-glob
  // Use sync for simplicity (wu:claim is not performance-critical)
  const filesA = new Set(
    fg.sync(patternA, {
      dot: true, // Include dotfiles
      ignore: ['node_modules/**', RECURSIVE_GIT_DIR_GLOB], // Exclude common bloat
    }),
  );

  const filesB = new Set(
    fg.sync(patternB, {
      dot: true,
      ignore: ['node_modules/**', RECURSIVE_GIT_DIR_GLOB],
    }),
  );

  // Compute intersection: files in both sets
  const intersection = [...filesA].filter((file) => filesB.has(file));

  return {
    overlaps: intersection.length > 0,
    files: intersection,
  };
}
