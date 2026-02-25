// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backlog Parsing Patterns
 *
 * Centralizes patterns for parsing status.md and backlog.md files.
 * Used by lane-checker.ts and related backlog utilities.
 */

/** Markdown section header patterns for In Progress section */
export const IN_PROGRESS_HEADERS = ['## in progress', '## 🔧 in progress'];

/**
 * Pattern for extracting WU ID from backlog links.
 * Matches: [WU-123 — Title text](path/to/file.yaml)
 * Captures: WU ID (e.g., "WU-123")
 */
export const WU_LINK_PATTERN = /\[([A-Z]+-\d+)\s*—\s*[^\]]+\]\([^)]+\)/gi;

/**
 * Check if a line matches an In Progress section header.
 * @param {string} line - Line to check (will be trimmed and lowercased)
 * @returns {boolean} True if line is an In Progress header
 */
export function isInProgressHeader(line: string) {
  const normalized = line.trim().toLowerCase();
  return IN_PROGRESS_HEADERS.some(
    (header) => normalized === header || normalized.startsWith(header),
  );
}
