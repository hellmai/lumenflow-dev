/**
 * Backlog Generator (WU-1573, WU-2244)
 *
 * Generates backlog.md and status.md from WUStateStore (read-only).
 * Never parses markdown back to state - single source of truth is wu-events.jsonl.
 *
 * Performance target: <100ms for full backlog generation.
 *
 * WU-2244 additions:
 * - validateBacklogConsistency(): Validates generated backlog against store state
 * - computeStoreChecksum(): Computes deterministic checksum of store state
 * - getCompletionDate(): Retrieves completion date from event timestamp
 *
 * @see {@link packages/@lumenflow/cli/src/__tests__/backlog-generator.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/__tests__/backlog-checksum.test.ts} - Checksum tests
 * @see {@link packages/@lumenflow/cli/src/__tests__/status-date-from-event.test.ts} - Date tests
 * @see {@link packages/@lumenflow/cli/src/lib/wu-state-store.ts} - State store
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readWURaw } from './wu-yaml.js';
import { WU_STATUS, WU_STATUS_GROUPS } from './wu-constants.js';
import { createWuPaths, resolveFromProjectRoot } from './wu-paths.js';

const WU_FILENAME_PATTERN = /^WU-\d+\.yaml$/;

interface BacklogYamlOptions {
  wuDir?: string;
  projectRoot?: string;
}

function normalizeYamlScalar(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeYamlStatus(value) {
  const normalized = normalizeYamlScalar(value).trim().toLowerCase();
  return normalized === '' ? WU_STATUS.READY : normalized;
}

function mapYamlStatusToSection(status) {
  if (WU_STATUS_GROUPS.UNCLAIMED.includes(status)) {
    return WU_STATUS.READY;
  }
  if (status === WU_STATUS.IN_PROGRESS) {
    return WU_STATUS.IN_PROGRESS;
  }
  if (status === WU_STATUS.BLOCKED) {
    return WU_STATUS.BLOCKED;
  }
  if (WU_STATUS_GROUPS.TERMINAL.includes(status)) {
    return WU_STATUS.DONE;
  }
  return WU_STATUS.READY;
}

function compareWuIds(a, b) {
  const numA = Number.parseInt(a.replace(/^WU-/, ''), 10);
  const numB = Number.parseInt(b.replace(/^WU-/, ''), 10);
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
    return numA - numB;
  }
  return a.localeCompare(b);
}

function escapeMarkdownText(value) {
  return normalizeYamlScalar(value)
    .replaceAll('\\', '\\\\')
    .replace(/([_*[\]`])/g, '\\$1');
}

function resolveWuDir(options: BacklogYamlOptions = {}) {
  const paths = createWuPaths({ projectRoot: options.projectRoot });
  const configured = options.wuDir || paths.WU_DIR();
  return path.isAbsolute(configured) ? configured : resolveFromProjectRoot(configured);
}

function loadYamlWuEntries(wuDir) {
  if (!existsSync(wuDir)) {
    return new Map();
  }

  const files = readdirSync(wuDir).filter((file) => WU_FILENAME_PATTERN.test(file));
  files.sort((a, b) => compareWuIds(a.replace(/\.yaml$/, ''), b.replace(/\.yaml$/, '')));

  const entries = new Map();

  for (const file of files) {
    const wuId = file.replace(/\.yaml$/, '');
    const doc = readWURaw(path.join(wuDir, file));

    if (!doc || typeof doc !== 'object') {
      continue;
    }

    entries.set(wuId, {
      status: normalizeYamlStatus(doc.status),
      title: normalizeYamlScalar(doc.title),
      lane: normalizeYamlScalar(doc.lane),
    });
  }

  return entries;
}

function getMergedBacklogEntry(store, yamlEntries, wuId) {
  const state =
    typeof store.getWUState === 'function' ? store.getWUState(wuId) : store.wuState.get(wuId);
  if (state) {
    return { title: state.title, lane: state.lane };
  }

  const yamlEntry = yamlEntries.get(wuId);
  if (!yamlEntry) {
    return null;
  }

  return { title: yamlEntry.title, lane: yamlEntry.lane };
}

/**
 * Generates backlog.md markdown from WUStateStore
 *
 * Format matches current backlog.md exactly:
 * - YAML frontmatter with section headings
 * - Section headings with emojis
 * - Bullet format: - [WU-ID — Title](wu/WU-ID.yaml) — Lane
 * - Placeholder text for empty sections
 *
 * @param {import('./wu-state-store.js').WUStateStore} store - State store to read from
 * @param {object} [options] - Optional settings
 * @param {string} [options.wuDir] - Absolute or repo-relative path to WU YAML directory
 * @param {string} [options.projectRoot] - Project root override for path resolution
 * @returns {Promise<string>} Markdown content for backlog.md
 *
 * @example
 * const store = new WUStateStore('/path/to/state');
 * await store.load();
 * const markdown = await generateBacklog(store);
 * await fs.writeFile('backlog.md', markdown, 'utf-8');
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
export async function generateBacklog(store, options: BacklogYamlOptions = {}) {
  // Start with frontmatter
  const frontmatter = `---
sections:
  ready:
    heading: '## 🚀 Ready (pull from here)'
    insertion: after_heading_blank_line
  in_progress:
    heading: '## 🔧 In progress'
    insertion: after_heading_blank_line
  blocked:
    heading: '## ⛔ Blocked'
    insertion: after_heading_blank_line
  done:
    heading: '## ✅ Done'
    insertion: after_heading_blank_line
---

> Agent: Read **docs/04-operations/\\_frameworks/lumenflow/agent/onboarding/starting-prompt.md** first, then follow **docs/04-operations/\\_frameworks/lumenflow/lumenflow-complete.md** for execution.

# Backlog (single source of truth)

`;

  const yamlEntries = loadYamlWuEntries(resolveWuDir(options));

  const storeReady = Array.from(store.getByStatus(WU_STATUS.READY));
  const storeInProgress = Array.from(store.getByStatus(WU_STATUS.IN_PROGRESS));
  const storeBlocked = Array.from(store.getByStatus(WU_STATUS.BLOCKED));
  const storeDone = Array.from(store.getByStatus(WU_STATUS.DONE));

  const storeIds = new Set([...storeReady, ...storeInProgress, ...storeBlocked, ...storeDone]);

  const yamlReady = [];
  const yamlInProgress = [];
  const yamlBlocked = [];
  const yamlDone = [];

  for (const [wuId, entry] of yamlEntries.entries()) {
    if (storeIds.has(wuId)) {
      continue;
    }

    const status = mapYamlStatusToSection(entry.status);

    if (status === WU_STATUS.IN_PROGRESS) {
      yamlInProgress.push(wuId);
    } else if (status === WU_STATUS.BLOCKED) {
      yamlBlocked.push(wuId);
    } else if (status === WU_STATUS.DONE) {
      yamlDone.push(wuId);
    } else {
      yamlReady.push(wuId);
    }
  }

  yamlReady.sort(compareWuIds);
  yamlInProgress.sort(compareWuIds);
  yamlBlocked.sort(compareWuIds);
  yamlDone.sort(compareWuIds);

  const ready = [...storeReady, ...yamlReady];
  const inProgress = [...storeInProgress, ...yamlInProgress];
  const blocked = [...storeBlocked, ...yamlBlocked];
  const done = [...storeDone, ...yamlDone];

  // Generate sections
  const sections = [];

  // Ready section (WUs with status: ready)
  sections.push('## 🚀 Ready (pull from here)');
  sections.push('');
  if (ready.length === 0) {
    sections.push('(No items ready)');
  } else {
    for (const wuId of ready) {
      const entry = getMergedBacklogEntry(store, yamlEntries, wuId);
      if (entry) {
        sections.push(
          `- [${wuId} — ${escapeMarkdownText(entry.title)}](wu/${wuId}.yaml) — ${escapeMarkdownText(entry.lane)}`,
        );
      }
    }
  }

  // In Progress section
  sections.push('');
  sections.push('## 🔧 In progress');
  sections.push('');
  if (inProgress.length === 0) {
    sections.push('(No items currently in progress)');
  } else {
    for (const wuId of inProgress) {
      const entry = getMergedBacklogEntry(store, yamlEntries, wuId);
      if (entry) {
        sections.push(
          `- [${wuId} — ${escapeMarkdownText(entry.title)}](wu/${wuId}.yaml) — ${escapeMarkdownText(entry.lane)}`,
        );
      }
    }
  }

  // Blocked section
  sections.push('');
  sections.push('## ⛔ Blocked');
  sections.push('');
  if (blocked.length === 0) {
    sections.push('(No items currently blocked)');
  } else {
    for (const wuId of blocked) {
      const entry = getMergedBacklogEntry(store, yamlEntries, wuId);
      if (entry) {
        sections.push(
          `- [${wuId} — ${escapeMarkdownText(entry.title)}](wu/${wuId}.yaml) — ${escapeMarkdownText(entry.lane)}`,
        );
      }
    }
  }

  // Done section
  sections.push('');
  sections.push('## ✅ Done');
  sections.push('');
  if (done.length === 0) {
    sections.push('(No completed items)');
  } else {
    for (const wuId of done) {
      const entry = getMergedBacklogEntry(store, yamlEntries, wuId);
      if (entry) {
        sections.push(`- [${wuId} — ${escapeMarkdownText(entry.title)}](wu/${wuId}.yaml)`);
      }
    }
  }

  return `${frontmatter}${sections.join('\n')}\n`;
}
export async function generateStatus(store) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Header
  const header = `# Work Unit Status

_Last updated: ${today}_
`;

  const sections = [];

  // In Progress section
  sections.push('');
  sections.push('## In Progress');
  sections.push('');
  const inProgress = store.getByStatus(WU_STATUS.IN_PROGRESS);
  if (inProgress.size === 0) {
    sections.push('(No items currently in progress)');
  } else {
    for (const wuId of inProgress) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${escapeMarkdownText(state.title)}](wu/${wuId}.yaml)`);
      }
    }
  }

  // Blocked section (only show if has WUs)
  const blocked = store.getByStatus(WU_STATUS.BLOCKED);
  if (blocked.size > 0) {
    sections.push('');
    sections.push('## Blocked');
    sections.push('');
    for (const wuId of blocked) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${escapeMarkdownText(state.title)}](wu/${wuId}.yaml)`);
      }
    }
  }

  // Completed section
  sections.push('');
  sections.push('## Completed');
  sections.push('');
  const done = store.getByStatus(WU_STATUS.DONE);
  if (done.size === 0) {
    sections.push('(No completed items)');
  } else {
    for (const wuId of done) {
      const state = store.wuState.get(wuId);
      if (state) {
        // WU-2244: Use completedAt from event, fall back to today if not available
        const completionDate = getCompletionDate(store, wuId);
        sections.push(
          `- [${wuId} — ${escapeMarkdownText(state.title)}](wu/${wuId}.yaml) — ${completionDate}`,
        );
      }
    }
  }

  return `${header}${sections.join('\n')}\n`;
}

/**
 * WU-2244: Get completion date for a WU from state store
 *
 * Returns the completion date from the complete event timestamp.
 * Falls back to current date if completedAt is not available (legacy data).
 *
 * @param {import('./wu-state-store.js').WUStateStore} store - State store
 * @param {string} wuId - WU ID to get completion date for
 * @returns {string} Completion date in YYYY-MM-DD format
 *
 * @example
 * const date = getCompletionDate(store, 'WU-100');
 * // Returns '2025-01-15' if completedAt is set, or today's date otherwise
 */
export function getCompletionDate(store, wuId) {
  const state = store.wuState.get(wuId);
  if (state && state.completedAt) {
    // Extract date portion from ISO timestamp
    return state.completedAt.split('T')[0];
  }
  // Fallback to current date for legacy data
  return new Date().toISOString().split('T')[0];
}

/**
 * WU-2244: Compute deterministic checksum of store state
 *
 * Creates a hash of the current store state that can be used to detect
 * inconsistencies between the store and generated backlog.
 *
 * The checksum is based on:
 * - All WU IDs
 * - Their statuses
 * - Their titles
 * - Their lanes
 *
 * @param {import('./wu-state-store.js').WUStateStore} store - State store
 * @returns {string} SHA-256 checksum of store state
 *
 * @example
 * const checksum = computeStoreChecksum(store);
 * // Returns '3f4d5a6b...' (64 char hex string)
 */
export function computeStoreChecksum(store) {
  // Build deterministic state representation
  const stateEntries = [];

  for (const [wuId, state] of store.wuState.entries()) {
    stateEntries.push({
      wuId,
      status: state.status,
      title: state.title,
      lane: state.lane,
    });
  }

  // Sort by wuId for deterministic ordering
  stateEntries.sort((a, b) => a.wuId.localeCompare(b.wuId));

  // Create hash
  const hash = createHash('sha256');
  hash.update(JSON.stringify(stateEntries));
  return hash.digest('hex');
}

/** @type {Record<string, string>} Section heading to status mapping */
const SECTION_STATUS_MAP = {
  '## 🚀 Ready (pull from here)': WU_STATUS.READY,
  '## 🔧 In progress': WU_STATUS.IN_PROGRESS,
  '## ⛔ Blocked': WU_STATUS.BLOCKED,
  '## ✅ Done': WU_STATUS.DONE,
};

/**
 * Strip YAML frontmatter from markdown content
 * @param {string} markdown - Markdown with potential frontmatter
 * @returns {string} Content without frontmatter
 */
function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---')) {
    return markdown;
  }
  const secondMarker = markdown.indexOf('---', 3);
  return secondMarker !== -1 ? markdown.slice(secondMarker + 3) : markdown;
}

/**
 * Count WU ID occurrences in content
 * @param {string} content - Markdown content
 * @returns {Map<string, number>} WU ID to count mapping
 */
function countWUReferences(content) {
  const foundWUs = new Map();
  const matches = content.matchAll(/WU-\d+/g);
  for (const match of matches) {
    const wuId = match[0];
    foundWUs.set(wuId, (foundWUs.get(wuId) || 0) + 1);
  }
  return foundWUs;
}

/**
 * Parse markdown into sections with their WU IDs
 * @param {string} content - Markdown content
 * @returns {Map<string, string[]>} Status to WU IDs mapping
 */
function parseMarkdownSections(content) {
  const sections = new Map();
  let currentSection = null;

  for (const line of content.split('\n')) {
    // Check for section headings
    for (const [heading, status] of Object.entries(SECTION_STATUS_MAP)) {
      if (line.includes(heading)) {
        currentSection = status;
        sections.set(status, []);
        break;
      }
    }

    // Extract WU IDs from lines in current section
    if (currentSection && line.includes('[WU-')) {
      const wuMatch = line.match(/WU-\d+/);
      if (wuMatch) {
        sections.get(currentSection).push(wuMatch[0]);
      }
    }
  }

  return sections;
}

/**
 * Find which section contains a WU ID
 * @param {Map<string, string[]>} sections - Parsed sections
 * @param {string} wuId - WU ID to find
 * @returns {string|null} Section status or null if not found
 */
function findWUSection(sections, wuId) {
  for (const [section, wus] of sections.entries()) {
    if (wus.includes(wuId)) {
      return section;
    }
  }
  return null;
}

/**
 * WU-2244: Validate backlog consistency against store state
 *
 * Checks that a generated backlog markdown contains all WUs from the store
 * in the correct sections, with no duplicates or missing entries.
 *
 * @param {import('./wu-state-store.js').WUStateStore} store - State store
 * @param {string} markdown - Generated backlog markdown
 * @returns {Promise<{valid: boolean, errors: string[]}>} Validation result
 *
 * @example
 * const result = await validateBacklogConsistency(store, backlogMarkdown);
 * if (!result.valid) {
 *   console.error('Backlog inconsistencies:', result.errors);
 * }
 */
export async function validateBacklogConsistency(store, markdown) {
  const errors = [];
  const content = stripFrontmatter(markdown);
  const foundWUs = countWUReferences(content);

  // Check for duplicates (each WU appears twice: link text + URL)
  for (const [wuId, count] of foundWUs) {
    if (count > 2) {
      errors.push(`${wuId} appears ${count / 2} times (duplicate entry)`);
    }
  }

  const sections = parseMarkdownSections(content);

  // Check each WU in store is in correct section
  for (const [wuId, state] of store.wuState.entries()) {
    const expectedSection = state.status;
    const sectionWUs = sections.get(expectedSection) || [];

    if (!sectionWUs.includes(wuId)) {
      const foundInSection = findWUSection(sections, wuId);

      if (foundInSection) {
        errors.push(
          `${wuId} in wrong section: expected ${expectedSection}, found ${foundInSection}`,
        );
      } else {
        errors.push(`${wuId} missing from backlog (status: ${expectedSection})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
