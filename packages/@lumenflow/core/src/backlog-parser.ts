// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backlog Parser (WU-1065, WU-1211)
 * Shared module for parsing YAML frontmatter in backlog.md
 * Uses gray-matter library for robust frontmatter parsing
 */
import { readFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import yaml from 'yaml';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Parse YAML frontmatter from backlog.md
 * @param {string} backlogPath - Path to backlog.md file
 * @returns {{frontmatter: object|null, markdown: string}} Parsed frontmatter and markdown body
 * @throws {Error} If file not found or YAML parsing fails
 */
export function parseBacklogFrontmatter(backlogPath: string) {
  if (!existsSync(backlogPath)) {
    throw createError(ErrorCodes.FILE_NOT_FOUND, `Backlog not found: ${backlogPath}`, {
      path: backlogPath,
    });
  }

  const content = readFileSync(backlogPath, { encoding: 'utf-8' });

  try {
    // Configure gray-matter to use modern yaml library instead of deprecated js-yaml
    const { data, content: markdown } = matter(content, {
      engines: {
        yaml: {
          parse: yaml.parse.bind(yaml),
          stringify: yaml.stringify.bind(yaml),
        },
      },
    });
    // gray-matter returns {} for no frontmatter; normalize to null for consistency
    const frontmatter = Object.keys(data).length > 0 ? data : null;
    return { frontmatter, markdown };
  } catch (err) {
    throw createError(
      ErrorCodes.YAML_PARSE_ERROR,
      `Failed to parse frontmatter in ${backlogPath}:\n\n${err.message}\n\n` +
        `Ensure frontmatter is valid YAML between --- delimiters.`,
      { path: backlogPath, originalError: err.message },
    );
  }
}

/**
 * Section configuration from frontmatter
 */
interface SectionConfig {
  heading?: string;
}

/**
 * Backlog frontmatter structure
 */
interface BacklogFrontmatter {
  sections?: Record<string, SectionConfig>;
}

/**
 * Section boundary definition
 */
interface SectionBoundary {
  start: number;
  end: number | null;
}

/**
 * Extract section headings from frontmatter
 * @param {object|null} frontmatter - Parsed frontmatter object
 * @returns {object} Map of section names to heading strings (e.g., {ready: "## 🚀 Ready"})
 */
export function getSectionHeadings(frontmatter: BacklogFrontmatter | null): Record<string, string> {
  if (!frontmatter || !frontmatter.sections) {
    return {};
  }

  const headings: Record<string, string> = {};
  for (const [sectionName, sectionConfig] of Object.entries(frontmatter.sections)) {
    if (sectionConfig.heading) {
      headings[sectionName] = sectionConfig.heading;
    }
  }

  return headings;
}

/**
 * Find section boundaries in backlog content
 * @param {string[]} lines - Lines of backlog content
 * @param {object|null} frontmatter - Parsed frontmatter object
 * @returns {object} Map of section names to {start, end} boundary indices
 */
export function findSectionBoundaries(
  lines: string[],
  frontmatter: BacklogFrontmatter | null,
): Record<string, SectionBoundary | null> {
  if (!frontmatter || !frontmatter.sections) {
    return {};
  }

  const headings = getSectionHeadings(frontmatter);
  const boundaries: Record<string, SectionBoundary | null> = {};

  // Initialize all sections as null (not found)
  for (const sectionName of Object.keys(headings)) {
    boundaries[sectionName] = null;
  }

  // Find start indices for each section (exact match)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const [sectionName, heading] of Object.entries(headings)) {
      if (line === heading) {
        boundaries[sectionName] = { start: i, end: null };
      }
    }
  }

  // Calculate end indices (last line before next section or EOF)
  const sectionStarts = Object.values(boundaries)
    .filter((b): b is SectionBoundary => b !== null)
    .map((b) => b.start)
    .sort((a, b) => a - b);

  for (const boundary of Object.values(boundaries)) {
    if (boundary === null) continue;

    const currentStart = boundary.start;
    const nextStart = sectionStarts.find((s) => s > currentStart);

    if (nextStart !== undefined) {
      boundary.end = nextStart - 1;
    } else {
      boundary.end = lines.length - 1;
    }
  }

  return boundaries;
}
