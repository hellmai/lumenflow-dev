import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import { createError, ErrorCodes } from './error-handler.js';
import { STRING_LITERALS } from './wu-constants.js';

/**
 * Backlog/Status file editor module.
 *
 * Abstracts section movements and bullet manipulation to eliminate ~350 duplicate lines
 * across wu-claim, wu-done, wu-block, wu-unblock, wu-cleanup, and wu-create.
 *
 * Core primitives:
 * - readBacklogFile: Read file with frontmatter parsing
 * - writeBacklogFile: Write file preserving frontmatter
 * - findSectionBounds: Locate section start/end indices
 * - removeBulletFromSection: Remove bullet from section
 * - addBulletToSection: Add bullet to section
 * - moveBullet: Atomic move operation (remove + add)
 *
 * @example
 * import { moveBullet } from './lib/backlog-editor.js';
 *
 * moveBullet('docs/04-operations/tasks/backlog.md', {
 *   fromSection: '## Ready',
 *   toSection: '## In Progress',
 *   bulletPattern: 'WU-123',
 *   newBullet: '- [WU-123 — Title](link)',
 * });
 */

/**
 * Read backlog/status file and separate frontmatter from content.
 *
 * @param {string} filePath - Path to file
 * @returns {{ frontmatter: string, lines: string[] }} Frontmatter and content lines
 */
export function readBacklogFile(filePath) {
  if (!existsSync(filePath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `File not found: ${filePath}`, { path: filePath });
  }

  const raw = readFileSync(filePath, { encoding: 'utf-8' });

  // WU-1242: Use gray-matter for robust frontmatter extraction instead of regex
  const parsed = matter(raw);
  // Reconstruct frontmatter string for writeBacklogFile compatibility
  const frontmatter = parsed.matter ? `---\n${parsed.matter}\n---\n` : '';
  const content = parsed.content;

  const lines = content.split(STRING_LITERALS.NEWLINE);

  return { frontmatter, lines };
}

/**
 * Write backlog/status file with frontmatter and content.
 *
 * @param {string} filePath - Path to file
 * @param {string} frontmatter - Frontmatter text (including --- markers)
 * @param {string[]} lines - Content lines
 */
export function writeBacklogFile(filePath, frontmatter, lines) {
  const content = frontmatter + lines.join(STRING_LITERALS.NEWLINE);
  writeFileSync(filePath, content, { encoding: 'utf-8' });
}

/**
 * Find section boundaries in lines array.
 *
 * Finds the section starting with the given heading and returns its start/end indices.
 * Section ends at the next ## heading or end of file.
 *
 * @param {string[]} lines - Content lines
 * @param {string} heading - Section heading (e.g., '## Ready')
 * @returns {{ start: number, end: number } | null} Section bounds or null if not found
 */
export function findSectionBounds(lines, heading) {
  // Find section header (case-insensitive match)
  const normalizedHeading = heading.trim().toLowerCase();
  const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === normalizedHeading);

  if (startIdx === -1) {
    return null; // Section not found
  }

  // Find next section header (## but not ###)
  let endIdx = lines
    .slice(startIdx + 1)
    .findIndex((l) => l.startsWith('## ') && !l.startsWith('### '));

  if (endIdx === -1) {
    // No next section, use end of file
    endIdx = lines.length;
  } else {
    // Convert relative index to absolute
    endIdx = startIdx + 1 + endIdx;
  }

  return { start: startIdx, end: endIdx };
}

/**
 * Remove bullet matching pattern from section.
 *
 * Modifies lines array in-place, removing all bullets that contain the given pattern.
 *
 * @param {string[]} lines - Content lines (modified in-place)
 * @param {number} sectionStart - Section start index
 * @param {number} sectionEnd - Section end index
 * @param {string} bulletPattern - Pattern to match (e.g., 'WU-123' or link path)
 */
export function removeBulletFromSection(lines, sectionStart, sectionEnd, bulletPattern) {
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (lines[i] && lines[i].includes(bulletPattern)) {
      lines.splice(i, 1);
      sectionEnd--; // Adjust end index after removal
      i--; // Re-check current index (next element shifted down)
    }
  }
}

/**
 * Add bullet to section.
 *
 * Inserts bullet after section header, replacing "(No items...)" marker if present.
 * Modifies lines array in-place.
 *
 * @param {string[]} lines - Content lines (modified in-place)
 * @param {number} sectionStart - Section start index
 * @param {string} bullet - Bullet text to add (e.g., '- [WU-123 — Title](link)')
 */
export function addBulletToSection(lines, sectionStart, bullet) {
  // Insert position: after header + empty line (typically sectionStart + 2)
  // But handle case where there's a "(No items...)" marker
  const nextLineIdx = sectionStart + 1;
  const bulletInsertIdx = nextLineIdx + 1;

  // WU-1242: Use string includes instead of regex for "(No items...)" marker check
  const isNoItemsMarker =
    lines[bulletInsertIdx] &&
    lines[bulletInsertIdx].toLowerCase().includes('no items currently in progress');
  if (isNoItemsMarker) {
    // Replace "(No items...)" with bullet
    lines.splice(bulletInsertIdx, 1, bullet);
  } else {
    // Insert bullet at bulletInsertIdx
    lines.splice(bulletInsertIdx, 0, bullet);
  }
}

/**
 * Move bullet from one section to another (atomic operation).
 *
 * Reads file, removes bullet from source section, adds bullet to target section,
 * writes file back. Preserves frontmatter.
 *
 * @param {string} filePath - Path to backlog/status file
 * @param {object} options - Move options
 * @param {string} options.fromSection - Source section heading (e.g., '## Ready')
 * @param {string} options.toSection - Target section heading (e.g., '## In Progress')
 * @param {string} options.bulletPattern - Pattern to match for removal (e.g., 'WU-123')
 * @param {string} options.newBullet - Bullet text to add (e.g., '- [WU-123 — Title](link)')
 * @throws {Error} If file not found or sections not found
 */
export function moveBullet(filePath, { fromSection, toSection, bulletPattern, newBullet }) {
  const { frontmatter, lines } = readBacklogFile(filePath);

  // Find source and target sections
  const fromBounds = findSectionBounds(lines, fromSection);
  const toBounds = findSectionBounds(lines, toSection);

  if (!fromBounds) {
    throw createError(ErrorCodes.SECTION_NOT_FOUND, `Source section not found: ${fromSection}`, {
      section: fromSection,
      file: filePath,
    });
  }

  if (!toBounds) {
    throw createError(ErrorCodes.SECTION_NOT_FOUND, `Target section not found: ${toSection}`, {
      section: toSection,
      file: filePath,
    });
  }

  // Remove bullet from source section
  removeBulletFromSection(lines, fromBounds.start, fromBounds.end, bulletPattern);

  // Recalculate target bounds after removal (indices may have shifted)
  const updatedToBounds = findSectionBounds(lines, toSection);
  if (!updatedToBounds) {
    throw createError(
      ErrorCodes.SECTION_NOT_FOUND,
      `Target section not found after removal: ${toSection}`,
      { section: toSection, file: filePath, context: 'after removal' },
    );
  }

  // Add bullet to target section
  addBulletToSection(lines, updatedToBounds.start, newBullet);

  // Write file back
  writeBacklogFile(filePath, frontmatter, lines);
}
