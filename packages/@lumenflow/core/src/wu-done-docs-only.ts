// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Docs-only detection utilities for wu:done
 *
 * WU-1234 + WU-1255 + WU-1539: Detect docs-only WUs from code_paths.
 */
import { getDocsOnlyPrefixes, DOCS_ONLY_ROOT_FILES } from './file-classifiers.js';

/**
 * Prefixes for paths that qualify as "docs-only" (no code changes).
 * Unlike SKIP_TESTS_PREFIXES, this excludes tools/ and scripts/ because
 * those contain code files that require full gate validation.
 *
 * WU-1539: Split from shouldSkipWebTests to fix docs-only misclassification.
 * @constant {string[]}
 */
/**
 * Detect docs-only WU from code_paths.
 * Returns true if all code_paths are documentation paths only.
 *
 * Docs-only paths: docs/, ai/, .claude/, memory-bank/, README*, CLAUDE*.md
 * NOT docs-only: tools/, scripts/ (these are code, not documentation)
 *
 * WU-1539: Fixed misclassification where tools/ was treated as docs-only
 * but then rejected by validateDocsOnly(). tools/ should skip web tests
 * but NOT be classified as docs-only.
 *
 * @param {string[]|null|undefined} codePaths - Array of file paths from WU YAML
 * @returns {boolean} True if WU is docs-only (all paths are documentation)
 */
export function detectDocsOnlyByPaths(codePaths: string[] | null | undefined) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return false;
  }

  const docsOnlyPrefixes = getDocsOnlyPrefixes();

  return codePaths.every((filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }

    const path = filePath.trim();
    if (path.length === 0) {
      return false;
    }

    // Check docs-only prefixes (docs/, ai/, .claude/, memory-bank/)
    for (const prefix of docsOnlyPrefixes) {
      if (path.startsWith(prefix)) {
        return true;
      }
    }

    // Check if it's a markdown file (*.md)
    if (path.endsWith('.md')) {
      return true;
    }

    // Check root file patterns (README*, CLAUDE*.md)
    const lowerPath = path.toLowerCase();
    for (const pattern of DOCS_ONLY_ROOT_FILES) {
      if (lowerPath.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  });
}
