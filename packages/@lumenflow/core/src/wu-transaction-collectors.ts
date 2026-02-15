/**
 * WU Transaction Collectors - Compute file content for atomic writes
 *
 * WU-1369: These functions compute the new file content WITHOUT writing.
 * This allows collection of all changes in memory before atomic commit.
 *
 * Each function returns:
 * - The new file content (string)
 * - Does NOT write to disk
 *
 * Usage:
 * ```js
 * const tx = new WUTransaction(id);
 *
 * // Collect all content
 * tx.addWrite(wuPath, computeWUYAMLContent(doc), 'WU YAML');
 * tx.addWrite(statusPath, computeStatusContent(statusPath, id, title), 'status.md');
 * tx.addWrite(backlogPath, computeBacklogContent(backlogPath, id, title), 'backlog.md');
 * tx.addWrite(stampPath, computeStampContent(id, title), 'stamp');
 *
 * // Validate and commit
 * tx.commit();
 * ```
 */

import { existsSync, readFileSync } from 'node:fs';
import { stringifyYAML } from './wu-yaml.js';
import { parseBacklogFrontmatter } from './backlog-parser.js';
import { getSectionHeadingsWithDefaults } from './section-headings.js';
import { todayISO, normalizeToDateString } from './date-utils.js';
import { createError, ErrorCodes } from './error-handler.js';
import { STRING_LITERALS, WU_STATUS } from './wu-constants.js';
// WU-1145, WU-1319: Import concurrent merge utilities
import {
  computeBacklogContentWithMainMerge,
  computeStatusContentWithMainMerge,
  computeWUEventsContentWithMainMerge,
} from './wu-done-concurrent-merge.js';

interface WUDoc extends Record<string, unknown> {
  status?: string;
  locked?: boolean;
  completed_at?: string;
  completed?: unknown;
}

interface CollectMetadataParams {
  doc: WUDoc;
  id: string;
  title: string;
  wuPath: string;
  statusPath: string;
  backlogPath: string;
  stampPath: string;
}

interface MetadataUpdate {
  path: string;
  content: string;
  description: string;
}

export interface CollectedMetadataUpdates {
  wuYAML: MetadataUpdate;
  status: MetadataUpdate;
  backlog: MetadataUpdate;
  stamp: MetadataUpdate;
}

/**
 * Compute WU YAML content for done state
 *
 * Updates the document in-place and returns the YAML string.
 * Does NOT write to disk.
 *
 * @param {object} doc - WU YAML document (will be mutated)
 * @returns {string} YAML content string
 */
export function computeWUYAMLContent(doc: WUDoc): string {
  // Apply done state updates
  doc.status = WU_STATUS.DONE;
  doc.locked = true;
  doc.completed_at = new Date().toISOString();
  // Keep legacy completion date in sync for tooling that still reads `completed`.
  doc.completed =
    normalizeToDateString(doc.completed ?? doc.completed_at) ?? doc.completed_at.slice(0, 10);

  // Serialize to YAML
  return stringifyYAML(doc);
}

/**
 * Find section in lines array
 * @param {string[]} lines - Array of lines
 * @param {string} heading - Section heading to find
 * @returns {number} Index of section, or -1 if not found
 */
function findSection(lines: string[], heading: string): number {
  return lines.findIndex((l) => l.trim() === heading);
}

/**
 * Find end of section (next ## heading or end of file)
 * @param {string[]} lines - Array of lines
 * @param {number} startIdx - Start index of section
 * @returns {number} End index of section
 */
function findSectionEnd(lines: string[], startIdx: number): number {
  const nextHeadingIdx = lines.slice(startIdx + 1).findIndex((l) => l.startsWith('## '));
  return nextHeadingIdx === -1 ? lines.length : startIdx + 1 + nextHeadingIdx;
}

/**
 * Remove WU entry from a section
 * @param {string[]} lines - Array of lines (mutated)
 * @param {number} startIdx - Start index of section
 * @param {number} endIdx - End index of section
 * @param {string} rel - Relative path to WU file
 * @param {string} id - WU ID
 * @returns {{ removed: boolean, newEndIdx: number }}
 */
function removeWUFromSection(
  lines: string[],
  startIdx: number,
  endIdx: number,
  rel: string,
  id: string,
): { removed: boolean; newEndIdx: number } {
  let removed = false;
  let newEndIdx = endIdx;

  for (let i = startIdx + 1; i < newEndIdx; i++) {
    if (lines[i] && (lines[i].includes(rel) || lines[i].includes(`[${id}`))) {
      lines.splice(i, 1);
      removed = true;
      newEndIdx--;
      i--;
    }
  }

  return { removed, newEndIdx };
}

/**
 * Insert completed entry into Completed section
 * @param {string[]} lines - Array of lines (mutated)
 * @param {number} completedIdx - Index of Completed section
 * @param {string} entry - Entry to insert
 * @param {string} id - WU ID
 * @param {number} sectionEndIdx - End index of Completed section
 */
function insertIntoCompleted(
  lines: string[],
  completedIdx: number,
  entry: string,
  id: string,
  sectionEndIdx: number,
): void {
  const completedSection = lines.slice(completedIdx, sectionEndIdx).join(STRING_LITERALS.NEWLINE);
  if (completedSection.includes(`[${id}`)) {
    return; // Already present (idempotent)
  }

  let insertIdx = completedIdx + 1;
  while (insertIdx < lines.length && lines[insertIdx].trim() === '') {
    insertIdx++;
  }
  lines.splice(insertIdx, 0, entry);
}

/**
 * Compute updated status.md content
 *
 * Removes WU from In Progress section and adds to Completed section.
 * Returns the new file content without writing.
 *
 * @param {string} statusPath - Path to status.md
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @returns {string} New status.md content
 * @throws {Error} If file not found or section not found
 */
export function computeStatusContent(statusPath: string, id: string, title: string): string {
  if (!existsSync(statusPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Status file not found: ${statusPath}`, {
      path: statusPath,
      function: 'computeStatusContent',
    });
  }

  const { frontmatter, markdown } = parseBacklogFrontmatter(statusPath);
  const headings = getSectionHeadingsWithDefaults(frontmatter, 'status');

  const rel = `wu/${id}.yaml`;
  const completedEntry = `- [${id} — ${title}](${rel}) — ${todayISO()}`;
  const lines = markdown.split(/\r?\n/);

  // Find and process In Progress section
  const inProgressIdx = findSection(lines, headings.in_progress);
  if (inProgressIdx === -1) {
    throw createError(
      ErrorCodes.SECTION_NOT_FOUND,
      `Could not find "${headings.in_progress}" section in ${statusPath}`,
      { path: statusPath, section: headings.in_progress, function: 'computeStatusContent' },
    );
  }

  let inProgressEndIdx = findSectionEnd(lines, inProgressIdx);
  const { removed, newEndIdx } = removeWUFromSection(
    lines,
    inProgressIdx,
    inProgressEndIdx,
    rel,
    id,
  );
  inProgressEndIdx = newEndIdx;

  // Add placeholder if section is now empty after removal
  if (removed) {
    const sectionContent = lines
      .slice(inProgressIdx + 1, inProgressEndIdx)
      .filter((l) => l.trim() !== '');
    if (sectionContent.length === 0) {
      lines.splice(inProgressEndIdx, 0, '', '(No items currently in progress)', '');
    }
  }

  // Find and process Completed section
  const completedIdx = findSection(lines, headings.completed);
  if (completedIdx === -1) {
    throw createError(
      ErrorCodes.SECTION_NOT_FOUND,
      `Could not find "${headings.completed}" section in ${statusPath}`,
      { path: statusPath, section: headings.completed, function: 'computeStatusContent' },
    );
  }

  const completedEndIdx = findSectionEnd(lines, completedIdx);
  insertIntoCompleted(lines, completedIdx, completedEntry, id, completedEndIdx);

  // Reconstruct with frontmatter
  const raw = readFileSync(statusPath, { encoding: 'utf-8' });
  const frontmatterMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
  const frontmatterText = frontmatterMatch ? frontmatterMatch[0] : '';

  return frontmatterText + lines.join(STRING_LITERALS.NEWLINE);
}

/**
 * Compute wu-events.jsonl content after completing a WU.
 *
 * WU-1145: Now merges with origin/main to preserve concurrent changes.
 * This prevents loss of WU entries when multiple WUs are completed concurrently.
 *
 * @param {string} backlogPath - Path to backlog.md
 * @param {string} wuId - WU ID being completed
 * @returns {Promise<{eventsPath: string, content: string} | null>}
 */
export async function computeWUEventsContentAfterComplete(
  backlogPath: string,
  wuId: string,
): Promise<{ eventsPath: string; content: string } | null> {
  // WU-1145: Use merged state to preserve concurrent changes
  return computeWUEventsContentWithMainMerge(backlogPath, wuId);
}

/**
 * Compute updated backlog.md content
 *
 * WU-1574: Simplified to generate from state store
 * WU-1145: Now merges with origin/main to preserve concurrent changes
 *
 * @param {string} backlogPath - Path to backlog.md
 * @param {string} id - WU ID to mark complete
 * @param {string} _title - WU title (unused - state store has it)
 * @returns {Promise<string>} New backlog.md content
 */
export async function computeBacklogContent(
  backlogPath: string,
  id: string,
  _title: string,
): Promise<string> {
  // WU-1145: Use merged state to preserve concurrent changes
  return computeBacklogContentWithMainMerge(backlogPath, id);
}

/**
 * Compute updated status.md content from merged state store
 *
 * WU-1319: Generates status.md from merged state (origin/main + worktree events)
 * instead of editing the local file snapshot. This prevents reintroducing
 * stale "In Progress" entries when concurrent WUs complete on main.
 *
 * @param {string} backlogPath - Path to backlog.md (used to find state dir)
 * @param {string} id - WU ID to mark complete
 * @returns {Promise<string>} New status.md content
 */
export async function computeStatusContentFromMergedState(
  backlogPath: string,
  id: string,
): Promise<string> {
  // WU-1319: Use merged state to preserve concurrent changes
  return computeStatusContentWithMainMerge(backlogPath, id);
}

/**
 * Compute stamp file content
 *
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @returns {string} Stamp content
 */
export function computeStampContent(id: string, title: string): string {
  const timestamp = todayISO();
  return `WU ${id} — ${title}\nCompleted: ${timestamp}\n`;
}

/**
 * Collect all metadata updates for a transaction
 * WU-1574: Made async for computeBacklogContent
 * WU-1319: Made status.md generation use merged state
 *
 * Convenience function that computes all file contents at once.
 * Returns an object with all computed content.
 *
 * @param {object} params - Parameters
 * @param {object} params.doc - WU YAML document (will be mutated)
 * @param {string} params.id - WU ID
 * @param {string} params.title - WU title
 * @param {string} params.wuPath - Path to WU YAML
 * @param {string} params.statusPath - Path to status.md
 * @param {string} params.backlogPath - Path to backlog.md
 * @param {string} params.stampPath - Path to stamp file
 * @returns {Promise<object>} Object with content for each file
 */
export async function collectMetadataUpdates({
  doc,
  id,
  title,
  wuPath,
  statusPath,
  backlogPath,
  stampPath,
}: CollectMetadataParams): Promise<CollectedMetadataUpdates> {
  return {
    wuYAML: {
      path: wuPath,
      content: computeWUYAMLContent(doc),
      description: 'WU YAML',
    },
    status: {
      path: statusPath,
      // WU-1319: Use merged state to preserve concurrent changes
      content: await computeStatusContentFromMergedState(backlogPath, id),
      description: 'status.md',
    },
    backlog: {
      path: backlogPath,
      content: await computeBacklogContent(backlogPath, id, title),
      description: 'backlog.md',
    },
    stamp: {
      path: stampPath,
      content: computeStampContent(id, title),
      description: 'completion stamp',
    },
  };
}
