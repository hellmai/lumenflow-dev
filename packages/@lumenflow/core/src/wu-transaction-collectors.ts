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

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stringifyYAML } from './wu-yaml.js';
import { parseBacklogFrontmatter } from './backlog-parser.js';
import { getSectionHeadingsWithDefaults } from './section-headings.js';
import { todayISO } from './date-utils.js';
import { createError, ErrorCodes } from './error-handler.js';
import { FILE_SYSTEM, STRING_LITERALS } from './wu-constants.js';
// WU-1574: BacklogManager removed - using state store + generator
import { WUStateStore, WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { generateBacklog } from './backlog-generator.js';
// WU-1734: Import proper path resolution utility
import { getStateStoreDirFromBacklog } from './wu-paths.js';

/**
 * Compute WU YAML content for done state
 *
 * Updates the document in-place and returns the YAML string.
 * Does NOT write to disk.
 *
 * @param {object} doc - WU YAML document (will be mutated)
 * @returns {string} YAML content string
 */
export function computeWUYAMLContent(doc) {
  // Apply done state updates
  doc.status = 'done';
  doc.locked = true;
  doc.completed_at = new Date().toISOString();

  // Serialize to YAML
  return stringifyYAML(doc);
}

/**
 * Find section in lines array
 * @param {string[]} lines - Array of lines
 * @param {string} heading - Section heading to find
 * @returns {number} Index of section, or -1 if not found
 */
function findSection(lines, heading) {
  return lines.findIndex((l) => l.trim() === heading);
}

/**
 * Find end of section (next ## heading or end of file)
 * @param {string[]} lines - Array of lines
 * @param {number} startIdx - Start index of section
 * @returns {number} End index of section
 */
function findSectionEnd(lines, startIdx) {
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
function removeWUFromSection(lines, startIdx, endIdx, rel, id) {
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
function insertIntoCompleted(lines, completedIdx, entry, id, sectionEndIdx) {
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
export function computeStatusContent(statusPath, id, title) {
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

function ensureTrailingNewline(content) {
  if (content === '') return content;
  if (content.endsWith(STRING_LITERALS.NEWLINE)) return content;
  return content + STRING_LITERALS.NEWLINE;
}

async function computeCompletionUpdatesFromStateStore(backlogPath, wuId) {
  const stateDir = getStateStoreDirFromBacklog(backlogPath);
  const store = new WUStateStore(stateDir);
  await store.load();

  const current = store.getWUState(wuId);
  if (!current) {
    throw new Error(`WU ${wuId} is not in_progress`);
  }

  if (current.status === 'done') {
    return { store, stateDir, shouldAppendCompleteEvent: false, completeEvent: null };
  }

  if (current.status !== 'in_progress') {
    throw new Error(`WU ${wuId} is not in_progress`);
  }

  const completeEvent = store.createCompleteEvent(wuId);
  store.applyEvent(completeEvent);

  return { store, stateDir, shouldAppendCompleteEvent: true, completeEvent };
}

export async function computeWUEventsContentAfterComplete(backlogPath, wuId) {
  const { stateDir, shouldAppendCompleteEvent, completeEvent } =
    await computeCompletionUpdatesFromStateStore(backlogPath, wuId);

  if (!shouldAppendCompleteEvent) {
    return null;
  }

  const eventsPath = path.join(stateDir, WU_EVENTS_FILE_NAME);
  const existing = existsSync(eventsPath) ? readFileSync(eventsPath, { encoding: 'utf-8' }) : '';
  const withNewline = ensureTrailingNewline(existing);

  return {
    eventsPath,
    content: withNewline + JSON.stringify(completeEvent) + STRING_LITERALS.NEWLINE,
  };
}

/**
 * Compute updated backlog.md content
 * WU-1574: Simplified to generate from state store
 *
 * @param {string} backlogPath - Path to backlog.md
 * @param {string} id - WU ID to mark complete
 * @param {string} _title - WU title (unused - state store has it)
 * @returns {Promise<string>} New backlog.md content
 */
export async function computeBacklogContent(backlogPath, id, _title) {
  const { store } = await computeCompletionUpdatesFromStateStore(backlogPath, id);
  return generateBacklog(store);
}

/**
 * Compute stamp file content
 *
 * @param {string} id - WU ID
 * @param {string} title - WU title
 * @returns {string} Stamp content
 */
export function computeStampContent(id, title) {
  const timestamp = todayISO();
  return `WU ${id} — ${title}\nCompleted: ${timestamp}\n`;
}

/**
 * Collect all metadata updates for a transaction
 * WU-1574: Made async for computeBacklogContent
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
}) {
  return {
    wuYAML: {
      path: wuPath,
      content: computeWUYAMLContent(doc),
      description: 'WU YAML',
    },
    status: {
      path: statusPath,
      content: computeStatusContent(statusPath, id, title),
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
