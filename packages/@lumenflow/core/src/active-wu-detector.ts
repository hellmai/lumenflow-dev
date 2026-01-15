/**
 * Active WU Detection Utilities
 *
 * Detects which WU YAMLs are "active" (referenced in backlog.md/status.md)
 * vs "orphan" (legacy/unreferenced). Used by validate.mjs to suppress
 * lane-checker warnings for orphan WUs.
 *
 * WU-1814: Stop lane-checker warnings for orphan WU YAMLs
 */

import { WU_LINK_PATTERN } from './constants/backlog-patterns.js';

/**
 * Remediation message shown in summary for orphan WU warnings
 * @type {string}
 */
export const ORPHAN_REMEDIATION_MESSAGE =
  'Use pnpm wu:delete --id WU-XXX if truly obsolete, or add to backlog if still needed.';

/**
 * Sections in backlog.md/status.md that indicate a WU is "active"
 * (i.e., not done/completed - still requires action or attention)
 * @type {readonly string[]}
 */
const ACTIVE_SECTION_HEADERS = Object.freeze([
  '## ready',
  '## in progress',
  '## blocked',
  '## waiting',
]);

/**
 * Sections in backlog.md/status.md that indicate a WU is "done"
 * (completed work - not considered "active" for lane validation)
 * @type {readonly string[]}
 */
const DONE_SECTION_HEADERS = Object.freeze(['## done', '## completed']);

/**
 * Check if a line is a section header we care about
 * @param {string} line - Line to check
 * @param {readonly string[]} headers - Headers to match against
 * @returns {boolean} True if line matches any header
 */
function matchesSectionHeader(line, headers) {
  const normalized = line.trim().toLowerCase();
  return headers.some((header) => normalized.startsWith(header));
}

/**
 * Extract WU IDs from a markdown content string (backlog.md or status.md)
 * Only extracts from active sections (Ready, In Progress, Blocked, Waiting)
 * NOT from Done/Completed sections
 *
 * @param {string} backlogContent - Content of backlog.md
 * @param {string} statusContent - Content of status.md
 * @param {string} [currentWuId] - Optional WU_ID env var to include
 * @returns {Set<string>} Set of active WU IDs
 */
export function extractActiveWuIds(backlogContent, statusContent, currentWuId = null) {
  const activeIds = new Set();

  // Process both backlog and status content
  for (const content of [backlogContent, statusContent]) {
    if (!content) continue;

    const lines = content.split(/\r?\n/);
    let inActiveSection = false;

    for (const line of lines) {
      // Check if we're entering an active section
      if (matchesSectionHeader(line, ACTIVE_SECTION_HEADERS)) {
        inActiveSection = true;
        continue;
      }

      // Check if we're entering a done section (stop collecting)
      if (matchesSectionHeader(line, DONE_SECTION_HEADERS)) {
        inActiveSection = false;
        continue;
      }

      // Check if we're hitting another ## section (reset state)
      if (line.trim().startsWith('## ')) {
        inActiveSection = false;
        continue;
      }

      // Extract WU IDs from links in active sections only
      if (inActiveSection) {
        // Reset regex state for each line (global flag)
        WU_LINK_PATTERN.lastIndex = 0;
        const matches = [...line.matchAll(WU_LINK_PATTERN)];
        for (const match of matches) {
          const wuId = match[1];
          if (wuId) {
            activeIds.add(wuId);
          }
        }
      }
    }
  }

  // Include WU_ID env var if provided (always validate the current WU)
  if (currentWuId) {
    activeIds.add(currentWuId);
  }

  return activeIds;
}

/**
 * Check if a WU is an "orphan" (not referenced in backlog.md/status.md)
 *
 * @param {string} wuId - WU ID to check (e.g., "WU-123")
 * @param {Set<string>} activeIds - Set of active WU IDs
 * @returns {boolean} True if WU is orphan (not in active set)
 */
export function isOrphanWu(wuId, activeIds) {
  return !activeIds.has(wuId);
}
