/**
 * Feedback Promote Core Logic (WU-1599)
 *
 * Generates draft WU specs from feedback patterns and promotes them to actual WUs.
 * Tracks incident-to-WU mappings in feedback-index.ndjson.
 *
 * @see {@link tools/__tests__/feedback-promote.test.mjs} - Tests
 * @see {@link tools/feedback-promote.mjs} - CLI entry point
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { stringifyYAML } from '@lumenflow/core/lib/wu-yaml.js';

/**
 * Directory for draft WU specs
 */
export const DRAFT_DIRECTORY = '.beacon/feedback-drafts';

/**
 * Path to feedback index (incident-to-WU mappings)
 */
export const FEEDBACK_INDEX_PATH = '.beacon/feedback-index.ndjson';

/**
 * Feedback index entry status
 */
export const FEEDBACK_STATUS = {
  PENDING_RESOLUTION: 'pending_resolution',
  RESOLVED: 'resolved',
  WONT_FIX: 'wont_fix',
};

/**
 * Lane constants for DRY compliance
 */
const LANES = {
  OPERATIONS_TOOLING: 'Operations: Tooling',
  OPERATIONS_DOCUMENTATION: 'Operations: Documentation',
  OPERATIONS_SECURITY: 'Operations: Security',
  OPERATIONS_COMPLIANCE: 'Operations: Compliance',
  OPERATIONS: 'Operations',
  CORE_SYSTEMS: 'Core Systems',
  EXPERIENCE: 'Experience',
  INTELLIGENCE: 'Intelligence',
};

/**
 * Lane inference mapping from category to suggested lane
 */
const CATEGORY_TO_LANE = {
  test: LANES.OPERATIONS_TOOLING,
  tooling: LANES.OPERATIONS_TOOLING,
  docs: LANES.OPERATIONS_DOCUMENTATION,
  documentation: LANES.OPERATIONS_DOCUMENTATION,
  infrastructure: LANES.CORE_SYSTEMS,
  database: LANES.CORE_SYSTEMS,
  api: LANES.CORE_SYSTEMS,
  ui: LANES.EXPERIENCE,
  frontend: LANES.EXPERIENCE,
  ux: LANES.EXPERIENCE,
  llm: LANES.INTELLIGENCE,
  prompt: LANES.INTELLIGENCE,
  ai: LANES.INTELLIGENCE,
  security: LANES.OPERATIONS_SECURITY,
  compliance: LANES.OPERATIONS_COMPLIANCE,
  uncategorized: LANES.OPERATIONS,
};

/**
 * Infer lane from pattern category
 *
 * @param {string} category - Pattern category
 * @returns {string} Suggested lane
 */
function inferLane(category) {
  const normalizedCategory = (category || 'uncategorized').toLowerCase();
  // Safe lookup using Object.hasOwn to prevent prototype pollution
  if (Object.hasOwn(CATEGORY_TO_LANE, normalizedCategory)) {
    // eslint-disable-next-line security/detect-object-injection -- Safe: hasOwn validates key exists
    return CATEGORY_TO_LANE[normalizedCategory];
  }
  return CATEGORY_TO_LANE.uncategorized;
}

/**
 * Generate description from pattern
 *
 * @param {object} pattern - Pattern object
 * @returns {string} Description with Context/Problem/Solution structure
 */
function generateDescription(pattern) {
  const frequency = pattern.frequency || 1;
  const category = pattern.category || 'uncategorized';
  const firstSeen = pattern.firstSeen ? new Date(pattern.firstSeen).toISOString().slice(0, 10) : 'unknown';
  const lastSeen = pattern.lastSeen ? new Date(pattern.lastSeen).toISOString().slice(0, 10) : 'unknown';

  return [
    `Context: Pattern detected from ${frequency} incident(s) in category "${category}". First seen: ${firstSeen}, last seen: ${lastSeen}.`,
    '',
    `Problem: ${pattern.title}`,
    '',
    'Solution: [To be defined by implementer]',
  ].join('\n');
}

/**
 * Generate acceptance criteria from pattern
 *
 * @param {object} pattern - Pattern object
 * @returns {string[]} Acceptance criteria
 */
function generateAcceptance(pattern) {
  return [
    'Root cause identified and documented',
    'Fix implemented',
    'Tests pass (pnpm gates)',
    `No recurrence of "${pattern.title}" pattern`,
  ];
}

/**
 * Generate draft WU spec from a pattern
 *
 * @param {string} baseDir - Base directory
 * @param {object} pattern - Pattern from feedback:review
 * @param {object} [options] - Options
 * @param {boolean} [options.writeFile=false] - Write draft to file
 * @returns {Promise<object>} Draft WU spec
 */
export async function generateDraft(baseDir, pattern, options = {}) {
  const { writeFile: shouldWrite = false } = options;

  const draft = {
    title: pattern.title,
    lane: inferLane(pattern.category),
    description: generateDescription(pattern),
    acceptance: generateAcceptance(pattern),
    source_incidents: (pattern.examples || []).map((e) => e.id),
    pattern_metadata: {
      frequency: pattern.frequency,
      category: pattern.category,
      score: pattern.score,
      firstSeen: pattern.firstSeen,
      lastSeen: pattern.lastSeen,
    },
  };

  if (shouldWrite) {
    const draftsDir = path.join(baseDir, DRAFT_DIRECTORY);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
    await fs.mkdir(draftsDir, { recursive: true });

    const timestamp = Date.now();
    const filename = `draft-${timestamp}.yaml`;
    const filePath = path.join(draftsDir, filename);

    const yamlContent = stringifyYAML(draft, { lineWidth: 100 });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes draft file
    await fs.writeFile(filePath, yamlContent, 'utf8');

    draft.filePath = path.join(DRAFT_DIRECTORY, filename);
  }

  return draft;
}

/**
 * Load all draft files from .beacon/feedback-drafts/
 *
 * @param {string} baseDir - Base directory
 * @returns {Promise<object[]>} Array of draft objects with filePath
 */
export async function loadDrafts(baseDir) {
  const draftsDir = path.join(baseDir, DRAFT_DIRECTORY);

  let files;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads known directory
    files = await fs.readdir(draftsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const drafts = [];

  for (const file of yamlFiles) {
    const filePath = path.join(draftsDir, file);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads draft files
      const content = await fs.readFile(filePath, 'utf8');
      // Parse YAML or JSON content
      let draft;
      try {
        // Try JSON first (for test files that might use JSON.stringify)
        draft = JSON.parse(content);
      } catch {
        // Fall back to YAML parsing using dynamic import
        const { parseYAML } = await import('./wu-yaml.mjs');
        draft = parseYAML(content);
      }
      draft.filePath = path.join(DRAFT_DIRECTORY, file);
      drafts.push(draft);
    } catch (err) {
      // Skip malformed files
      console.warn(`Warning: Could not load draft ${file}: ${err.message}`);
    }
  }

  return drafts;
}

/**
 * Promote a draft to a WU via wu:create
 *
 * @param {string} baseDir - Base directory
 * @param {object} draft - Draft object
 * @param {object} [options] - Options
 * @param {boolean} [options.dryRun=false] - Dry run (don't execute command)
 * @param {string} [options.wuIdOverride] - Override WU ID (for testing)
 * @param {boolean} [options.removeDraft=false] - Remove draft file after promotion
 * @returns {Promise<object>} Result with success, wuId, command
 */
export async function promoteDraft(baseDir, draft, options = {}) {
  const { dryRun = false, wuIdOverride, removeDraft = false } = options;

  // Generate WU ID if not provided
  const wuId = wuIdOverride || `WU-${Date.now()}`;

  // Build wu:create command
  const command = buildWuCreateCommand(wuId, draft);

  const result = {
    success: true,
    wuId,
    command,
    draft,
  };

  if (!dryRun) {
    // Execute wu:create command
    const { execSync } = await import('node:child_process');
    try {
      execSync(command, { cwd: baseDir, stdio: 'pipe' });
    } catch (err) {
      return {
        success: false,
        wuId,
        command,
        error: err.message,
      };
    }

    // Update feedback index with incident mappings
    if (draft.source_incidents && draft.source_incidents.length > 0) {
      await updateFeedbackIndex(baseDir, wuId, draft.source_incidents);
    }
  }

  // Remove draft file if requested
  if (removeDraft && draft.filePath) {
    const absolutePath = draft.filePath.startsWith('/')
      ? draft.filePath
      : path.join(baseDir, draft.filePath);

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool removes draft file
      await fs.unlink(absolutePath);
      result.draftRemoved = true;
    } catch (err) {
      // Ignore errors if file doesn't exist
      if (err.code !== 'ENOENT') {
        console.warn(`Warning: Could not remove draft ${draft.filePath}: ${err.message}`);
      }
      result.draftRemoved = true; // Mark as removed even if it didn't exist
    }
  }

  return result;
}

/**
 * Build wu:create command from draft
 *
 * @param {string} wuId - WU ID
 * @param {object} draft - Draft object
 * @returns {string} Command string
 */
function buildWuCreateCommand(wuId, draft) {
  const parts = ['pnpm wu:create'];
  parts.push(`--id ${wuId}`);
  parts.push(`--lane "${draft.lane}"`);
  parts.push(`--title "${draft.title.replace(/"/g, '\\"')}"`);

  if (draft.description) {
    parts.push(`--description "${draft.description.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  }

  if (draft.acceptance && draft.acceptance.length > 0) {
    for (const criterion of draft.acceptance) {
      parts.push(`--acceptance "${criterion.replace(/"/g, '\\"')}"`);
    }
  }

  return parts.join(' ');
}

/**
 * Update feedback index with incident-to-WU mappings
 *
 * @param {string} baseDir - Base directory
 * @param {string} wuId - WU ID
 * @param {string[]} incidentIds - Array of incident IDs
 */
export async function updateFeedbackIndex(baseDir, wuId, incidentIds) {
  const indexPath = path.join(baseDir, FEEDBACK_INDEX_PATH);
  const timestamp = new Date().toISOString();

  // Ensure directory exists
  const indexDir = path.dirname(indexPath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool creates known directory
  await fs.mkdir(indexDir, { recursive: true });

  // Build NDJSON entries
  const entries = incidentIds.map((incidentId) => ({
    incident_id: incidentId,
    wu_id: wuId,
    status: FEEDBACK_STATUS.PENDING_RESOLUTION,
    timestamp,
  }));

  const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;

  // Append to index file
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool writes index file
  await fs.appendFile(indexPath, content, 'utf8');
}

/**
 * Load feedback index entries
 *
 * @param {string} baseDir - Base directory
 * @returns {Promise<object[]>} Array of index entries
 */
export async function loadFeedbackIndex(baseDir) {
  const indexPath = path.join(baseDir, FEEDBACK_INDEX_PATH);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool reads index file
    const content = await fs.readFile(indexPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}
