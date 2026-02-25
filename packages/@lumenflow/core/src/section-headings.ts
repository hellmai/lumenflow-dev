// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Section Headings Constants
 *
 * Centralized section heading defaults for backlog.md and status.md
 * Eliminates magic strings scattered throughout wu-* tools
 *
 * Usage: Use getSectionHeadingsWithDefaults() to get frontmatter-configured
 * headings with sensible fallbacks if frontmatter is missing/malformed
 */

import { getSectionHeadings } from './backlog-parser.js';
import { BACKLOG_SECTIONS, STATUS_SECTIONS } from './wu-constants.js';

/**
 * Default section headings (fallbacks when frontmatter is missing)
 * Re-exports from wu-constants.ts for backwards compatibility
 */
export const DEFAULT_SECTION_HEADINGS = {
  backlog: {
    ready: BACKLOG_SECTIONS.READY,
    in_progress: BACKLOG_SECTIONS.IN_PROGRESS,
    blocked: BACKLOG_SECTIONS.BLOCKED,
    done: BACKLOG_SECTIONS.DONE,
  },
  status: {
    in_progress: STATUS_SECTIONS.IN_PROGRESS,
    completed: STATUS_SECTIONS.COMPLETED,
    blocked: STATUS_SECTIONS.BLOCKED,
  },
};

/**
 * Get section headings with frontmatter override + defaults
 *
 * Replaces scattered pattern: headings.done || '## ✅ Done'
 * Centralizes fallback logic for consistent heading resolution
 *
 * @param {object|null} frontmatter - Parsed frontmatter from backlog.md/status.md
 * @param {'backlog'|'status'} docType - Document type
 * @returns {object} Section headings (configured or default)
 */
export function getSectionHeadingsWithDefaults(
  frontmatter: Record<string, unknown> | null,
  docType: keyof typeof DEFAULT_SECTION_HEADINGS = 'backlog',
) {
  const defaults = DEFAULT_SECTION_HEADINGS[docType] as {
    ready?: string;
    in_progress?: string;
    blocked?: string;
    done?: string;
    completed?: string;
  };
  const configured = frontmatter ? getSectionHeadings(frontmatter) : {};

  return {
    ready: configured.ready || defaults.ready || DEFAULT_SECTION_HEADINGS.backlog.ready,
    in_progress:
      configured.in_progress ||
      defaults.in_progress ||
      DEFAULT_SECTION_HEADINGS.backlog.in_progress,
    blocked: configured.blocked || defaults.blocked || DEFAULT_SECTION_HEADINGS.backlog.blocked,
    done: configured.done || defaults.done || DEFAULT_SECTION_HEADINGS.backlog.done,
    completed:
      configured.completed || defaults.completed || DEFAULT_SECTION_HEADINGS.status.completed,
  };
}
