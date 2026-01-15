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
 * @see {@link tools/__tests__/backlog-generator.test.mjs} - Tests
 * @see {@link tools/__tests__/backlog-checksum.test.mjs} - Checksum tests
 * @see {@link tools/__tests__/status-date-from-event.test.mjs} - Date tests
 * @see {@link tools/lib/wu-state-store.mjs} - State store
 */

import { createHash } from 'node:crypto';

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
 * @returns {Promise<string>} Markdown content for backlog.md
 *
 * @example
 * const store = new WUStateStore('/path/to/state');
 * await store.load();
 * const markdown = await generateBacklog(store);
 * await fs.writeFile('backlog.md', markdown, 'utf-8');
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
export async function generateBacklog(store) {
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

> Agent: Read **ai/onboarding/starting-prompt.md** first, then follow **docs/04-operations/\\_frameworks/lumenflow/lumenflow-complete.md** for execution.

# Backlog (single source of truth)

`;

  // Generate sections
  const sections = [];

  // Ready section (WUs with status: ready)
  sections.push('## 🚀 Ready (pull from here)');
  sections.push('');
  const ready = store.getByStatus('ready');
  if (ready.size === 0) {
    sections.push('(No items ready)');
  } else {
    for (const wuId of ready) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml) — ${state.lane}`);
      }
    }
  }

  // In Progress section
  sections.push('');
  sections.push('## 🔧 In progress');
  sections.push('');
  const inProgress = store.getByStatus('in_progress');
  if (inProgress.size === 0) {
    sections.push('(No items currently in progress)');
  } else {
    for (const wuId of inProgress) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml) — ${state.lane}`);
      }
    }
  }

  // Blocked section
  sections.push('');
  sections.push('## ⛔ Blocked');
  sections.push('');
  const blocked = store.getByStatus('blocked');
  if (blocked.size === 0) {
    sections.push('(No items currently blocked)');
  } else {
    for (const wuId of blocked) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml) — ${state.lane}`);
      }
    }
  }

  // Done section
  sections.push('');
  sections.push('## ✅ Done');
  sections.push('');
  const done = store.getByStatus('done');
  if (done.size === 0) {
    sections.push('(No completed items)');
  } else {
    for (const wuId of done) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml)`);
      }
    }
  }

  return frontmatter + sections.join('\n');
}

/**
 * Generates status.md markdown from WUStateStore
 *
 * Format matches current status.md exactly:
 * - Header with last updated timestamp
 * - In Progress section
 * - Completed section with dates
 * - Placeholder for empty sections
 *
 * @param {import('./wu-state-store.js').WUStateStore} store - State store to read from
 * @returns {Promise<string>} Markdown content for status.md
 *
 * @example
 * const store = new WUStateStore('/path/to/state');
 * await store.load();
 * const markdown = await generateStatus(store);
 * await fs.writeFile('status.md', markdown, 'utf-8');
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Pre-existing complexity, refactor tracked separately
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
  const inProgress = store.getByStatus('in_progress');
  if (inProgress.size === 0) {
    sections.push('(No items currently in progress)');
  } else {
    for (const wuId of inProgress) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml)`);
      }
    }
  }

  // Blocked section (only show if has WUs)
  const blocked = store.getByStatus('blocked');
  if (blocked.size > 0) {
    sections.push('');
    sections.push('## Blocked');
    sections.push('');
    for (const wuId of blocked) {
      const state = store.wuState.get(wuId);
      if (state) {
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml)`);
      }
    }
  }

  // Completed section
  sections.push('');
  sections.push('## Completed');
  sections.push('');
  const done = store.getByStatus('done');
  if (done.size === 0) {
    sections.push('(No completed items)');
  } else {
    for (const wuId of done) {
      const state = store.wuState.get(wuId);
      if (state) {
        // WU-2244: Use completedAt from event, fall back to today if not available
        const completionDate = getCompletionDate(store, wuId);
        sections.push(`- [${wuId} — ${state.title}](wu/${wuId}.yaml) — ${completionDate}`);
      }
    }
  }

  return header + sections.join('\n');
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
  '## 🚀 Ready (pull from here)': 'ready',
  '## 🔧 In progress': 'in_progress',
  '## ⛔ Blocked': 'blocked',
  '## ✅ Done': 'done',
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
          `${wuId} in wrong section: expected ${expectedSection}, found ${foundInSection}`
        );
      } else {
        errors.push(`${wuId} missing from backlog (status: ${expectedSection})`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
