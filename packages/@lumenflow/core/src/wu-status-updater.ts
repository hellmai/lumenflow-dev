// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Status.md Update Utilities
 *
 * Centralized status.md update functions (extracted from wu-done.ts)
 * Refactored to use frontmatter-based section headings (no magic strings)
 *
 * Used by both main wu:done flow AND recovery mode (DRY principle)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseBacklogFrontmatter } from './backlog-parser.js';
import { getSectionHeadingsWithDefaults } from './section-headings.js';
import { todayISO } from './date-utils.js';
import { die, createError, ErrorCodes } from './error-handler.js';
import { STRING_LITERALS } from './wu-constants.js';

/**
 * Remove WU from In Progress section (idempotent)
 * Refactored from wu-done.ts line 471 to use frontmatter headings
 *
 * @param {string} statusPath - Path to status.md
 * @param {string} id - WU ID
 */
export function updateStatusRemoveInProgress(statusPath: string, id: string) {
  if (!existsSync(statusPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Status file not found: ${statusPath}`, {
      path: statusPath,
      function: 'updateStatusRemoveInProgress',
    });
  }

  // Use frontmatter parser to get configured section headings
  const { frontmatter, markdown } = parseBacklogFrontmatter(statusPath);
  const headings = getSectionHeadingsWithDefaults(frontmatter, 'status');

  const rel = `wu/${id}.yaml`;
  const lines = markdown.split(STRING_LITERALS.NEWLINE);

  // Find In Progress section using configured heading
  const startIdx = lines.findIndex((l) => l.trim() === headings.in_progress);
  if (startIdx === -1) {
    throw createError(
      ErrorCodes.SECTION_NOT_FOUND,
      `Could not find "${headings.in_progress}" section in ${statusPath}`,
      { path: statusPath, section: headings.in_progress, function: 'updateStatusRemoveInProgress' },
    );
  }

  // Find section boundaries
  let endIdx = lines.slice(startIdx + 1).findIndex((l) => l.startsWith('## '));
  endIdx = endIdx === -1 ? lines.length - startIdx - 1 : startIdx + 1 + endIdx;

  // Remove WU entry (idempotent - safe to call if already removed)
  let removed = false;
  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    if (line && (line.includes(rel) || line.includes(`[${id}`))) {
      lines.splice(i, 1);
      removed = true;
      endIdx--;
      i--; // Adjust index after splice
    }
  }

  // Add placeholder if section is now empty
  if (removed) {
    const section = lines.slice(startIdx + 1, endIdx).filter((l) => l.trim() !== '');
    if (section.length === 0) {
      lines.splice(endIdx, 0, '', '(No items currently in progress)', '');
    }
  }

  // Reconstruct file with frontmatter preservation
  const raw = readFileSync(statusPath, { encoding: 'utf-8' });
  const frontmatterMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
  const frontmatterText = frontmatterMatch ? frontmatterMatch[0] : '';
  writeFileSync(statusPath, frontmatterText + lines.join(STRING_LITERALS.NEWLINE), {
    encoding: 'utf-8',
  });
}

/**
 * Add WU to Completed section (idempotent - checks for duplicates)
 * Refactored from wu-done.ts line 499 to use frontmatter headings
 *
 * @param {string} statusPath - Path to status.md
 * @param {string} id - WU ID
 * @param {string} title - WU title
 */
export function addToStatusCompleted(statusPath: string, id: string, title: string) {
  if (!existsSync(statusPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Status file not found: ${statusPath}`, {
      path: statusPath,
      function: 'addToStatusCompleted',
    });
  }

  // Use frontmatter parser to get configured section headings
  const { frontmatter, markdown } = parseBacklogFrontmatter(statusPath);
  const headings = getSectionHeadingsWithDefaults(frontmatter, 'status');

  const rel = `wu/${id}.yaml`;
  const date = todayISO();
  const completedEntry = `- [${id} — ${title}](${rel}) — ${date}`;

  const lines = markdown.split(STRING_LITERALS.NEWLINE);

  // Find Completed section using configured heading
  const completedIdx = lines.findIndex((l) => l.trim() === headings.completed);
  if (completedIdx === -1) {
    die(`Could not find "${headings.completed}" section in ${statusPath}`);
  }

  // Idempotent check: skip if already in Completed section
  const nextSectionIdx = lines.slice(completedIdx + 1).findIndex((l) => l.startsWith('## '));
  const completedEndIdx = nextSectionIdx === -1 ? lines.length : completedIdx + 1 + nextSectionIdx;
  const completedSection = lines.slice(completedIdx, completedEndIdx).join(STRING_LITERALS.NEWLINE);
  if (completedSection.includes(`[${id}`)) {
    console.log(`[wu-status-updater] ${id} already in Completed section (idempotent skip)`);
    return;
  }

  // Insert at top of Completed section (after header, skipping empty lines)
  let insertIdx = completedIdx + 1;
  while (insertIdx < lines.length) {
    const line = lines[insertIdx];
    if (typeof line !== 'string' || line.trim() !== '') {
      break;
    }
    insertIdx++;
  }

  lines.splice(insertIdx, 0, completedEntry);

  // Reconstruct file with frontmatter preservation
  const raw = readFileSync(statusPath, { encoding: 'utf-8' });
  const frontmatterMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
  const frontmatterText = frontmatterMatch ? frontmatterMatch[0] : '';
  writeFileSync(statusPath, frontmatterText + lines.join(STRING_LITERALS.NEWLINE), {
    encoding: 'utf-8',
  });
}
