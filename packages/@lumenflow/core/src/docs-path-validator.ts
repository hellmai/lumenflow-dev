#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Docs Path Validator
 *
 * Validates that files staged for commit in a docs-only WU
 * are restricted to documentation paths only.
 *
 * Allowed paths:
 * - memory-bank/**
 * - docs/**
 * - ai/**
 * - .claude/**
 * - *.md (markdown files anywhere)
 * - .lumenflow/stamps/**
 * - .lumenflow/state/wu-events.jsonl (tooling-managed metadata)
 *
 * Forbidden paths:
 * - apps/**
 * - packages/** (except test files)
 * - supabase/**
 * - tools/** (except test files)
 */

import path from 'node:path';
import { WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { LUMENFLOW_PATHS, DIRECTORIES, FILE_EXTENSIONS, STRING_LITERALS } from './wu-constants.js';
import { getDocsOnlyPrefixes } from './file-classifiers.js';

const POSIX = path.posix;

const TOOLS_TESTS_PREFIX = `${POSIX.join(DIRECTORIES.TOOLS, '__tests__')}${STRING_LITERALS.SLASH}`;
const STAMPS_PREFIX = `${LUMENFLOW_PATHS.STAMPS_DIR}${STRING_LITERALS.SLASH}`;
const WU_EVENTS_PATH = POSIX.join(LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);

/**
 * Check if a file path is allowed for docs-only WUs
 * @param {string} filePath - The file path to validate
 * @param {readonly string[]} docsOnlyPrefixes - Config-driven docs path prefixes
 * @returns {boolean} - True if the path is allowed
 */
function isAllowedPath(filePath: string, docsOnlyPrefixes: readonly string[]) {
  if (!filePath) return false;

  if (filePath === WU_EVENTS_PATH) return true;

  if (filePath.startsWith(STAMPS_PREFIX)) return true;
  if (filePath.startsWith(TOOLS_TESTS_PREFIX)) return true;

  if (filePath.startsWith(DIRECTORIES.PACKAGES)) {
    const testsSegment = `${STRING_LITERALS.SLASH}__tests__${STRING_LITERALS.SLASH}`;
    return filePath.includes(testsSegment);
  }

  if (filePath.endsWith(FILE_EXTENSIONS.MARKDOWN)) return true;

  for (const prefix of docsOnlyPrefixes) {
    if (filePath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a list of staged files for docs-only WU
 * @param {string[]} stagedFiles - Array of file paths
 * @returns {{valid: boolean, violations: string[]}} - Validation result
 */
export function validateDocsOnly(stagedFiles: string[]) {
  const docsOnlyPrefixes = getDocsOnlyPrefixes();
  const violations = [];
  for (const file of stagedFiles) {
    if (!isAllowedPath(file, docsOnlyPrefixes)) {
      violations.push(file);
    }
  }
  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Get a human-readable description of allowed paths
 * @returns {string} - Description of allowed paths
 */
export function getAllowedPathsDescription() {
  return `Docs-only WUs can only modify:
  - memory-bank/** (task definitions, workflow docs)
  - ai/** (agent documentation, onboarding)
  - .claude/** (agent configuration and skills)
  - docs/** (technical documentation)
  - *.md (markdown files)
  - .lumenflow/stamps/** (completion stamps)
  - .lumenflow/state/${WU_EVENTS_FILE_NAME} (WU lifecycle event log)
  - tools/__tests__/** (test files only)
  - packages/**/__tests__/** (test files only)`;
}
