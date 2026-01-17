/**
 * WU YAML Auto-Fixer
 *
 * Detects and auto-repairs common YAML validation issues that would fail at wu:done.
 * Part of WU-1359: Early YAML validation at wu:claim.
 *
 * Common issues fixed:
 * - ISO timestamp dates → YYYY-MM-DD format
 * - Username → email format (with configurable domain)
 * - docs → documentation (type field)
 * - String numbers → number (phase field)
 *
 * @see {@link tools/lib/wu-schema.mjs} - WU schema definition
 * @see {@link tools/wu-claim.mjs} - Consumer
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { parseYAML, stringifyYAML } from './wu-yaml.js';
import { FILE_SYSTEM, STRING_LITERALS } from './wu-constants.js';

// Valid type values from wu-schema.mjs
const VALID_TYPES = ['feature', 'bug', 'documentation', 'process', 'tooling', 'chore', 'refactor'];

// Common type aliases that should be auto-fixed
const TYPE_ALIASES = {
  docs: 'documentation',
  doc: 'documentation',
  feat: 'feature',
  fix: 'bug',
  bugfix: 'bug',
  tool: 'tooling',
  tools: 'tooling',
  ref: 'refactor',
  proc: 'process',
};

// Default email domain for username → email conversion
const DEFAULT_EMAIL_DOMAIN = 'exampleapp.co.uk';

/**
 * Issue types that can be detected and auto-fixed
 */
export const FIXABLE_ISSUES = {
  DATE_ISO_TIMESTAMP: 'DATE_ISO_TIMESTAMP',
  USERNAME_NOT_EMAIL: 'USERNAME_NOT_EMAIL',
  TYPE_ALIAS: 'TYPE_ALIAS',
  PHASE_STRING: 'PHASE_STRING',
  PRIORITY_LOWERCASE: 'PRIORITY_LOWERCASE',
};

/**
 * Check created field for ISO timestamp issues
 * @param {object} doc - Parsed WU YAML data
 * @returns {object|null} Issue object or null
 */
function checkCreatedField(doc) {
  if (!doc.created) return null;

  const createdStr = String(doc.created);
  // Match ISO 8601 timestamp (2025-12-02T00:00:00.000Z or similar)
  if (/^\d{4}-\d{2}-\d{2}T/.test(createdStr)) {
    const dateOnly = createdStr.slice(0, 10);
    return {
      type: FIXABLE_ISSUES.DATE_ISO_TIMESTAMP,
      field: 'created',
      current: createdStr,
      suggested: dateOnly,
      description: `ISO timestamp should be YYYY-MM-DD: ${createdStr} → ${dateOnly}`,
    };
  }
  // Handle Date objects that YAML parser may create
  if (doc.created instanceof Date) {
    const dateOnly = doc.created.toISOString().slice(0, 10);
    return {
      type: FIXABLE_ISSUES.DATE_ISO_TIMESTAMP,
      field: 'created',
      current: doc.created.toISOString(),
      suggested: dateOnly,
      description: `Date object should be YYYY-MM-DD string: ${doc.created.toISOString()} → ${dateOnly}`,
    };
  }
  return null;
}

/**
 * Check assigned_to field for username without email domain
 * @param {object} doc - Parsed WU YAML data
 * @returns {object|null} Issue object or null
 */
function checkAssignedToField(doc) {
  if (!doc.assigned_to || typeof doc.assigned_to !== 'string') return null;

  const assignee = doc.assigned_to.trim();
  if (assignee && !assignee.includes('@')) {
    const suggested = `${assignee}@${DEFAULT_EMAIL_DOMAIN}`;
    return {
      type: FIXABLE_ISSUES.USERNAME_NOT_EMAIL,
      field: 'assigned_to',
      current: assignee,
      suggested,
      description: `Username should be email format: ${assignee} → ${suggested}`,
    };
  }
  return null;
}

/**
 * Check type field for common aliases or typos
 * @param {object} doc - Parsed WU YAML data
 * @returns {object|null} Issue object or null
 */
function checkTypeField(doc) {
  if (!doc.type || typeof doc.type !== 'string') return null;

  const typeLower = doc.type.toLowerCase();
  if (TYPE_ALIASES[typeLower]) {
    return {
      type: FIXABLE_ISSUES.TYPE_ALIAS,
      field: 'type',
      current: doc.type,
      suggested: TYPE_ALIASES[typeLower],
      description: `Type alias should use canonical form: ${doc.type} → ${TYPE_ALIASES[typeLower]}`,
    };
  }
  // Check for invalid type not in aliases - try fuzzy match
  if (!VALID_TYPES.includes(typeLower)) {
    const closest = VALID_TYPES.find(
      (t) => t.startsWith(typeLower.slice(0, 3)) || typeLower.startsWith(t.slice(0, 3))
    );
    if (closest) {
      return {
        type: FIXABLE_ISSUES.TYPE_ALIAS,
        field: 'type',
        current: doc.type,
        suggested: closest,
        description: `Invalid type "${doc.type}" - did you mean "${closest}"?`,
      };
    }
  }
  return null;
}

/**
 * Check phase field for string instead of number
 * @param {object} doc - Parsed WU YAML data
 * @returns {object|null} Issue object or null
 */
function checkPhaseField(doc) {
  if (doc.phase == null || typeof doc.phase !== 'string') return null;

  const num = parseInt(doc.phase, 10);
  if (!isNaN(num) && num > 0) {
    return {
      type: FIXABLE_ISSUES.PHASE_STRING,
      field: 'phase',
      current: doc.phase,
      suggested: num,
      description: `Phase should be number: "${doc.phase}" → ${num}`,
    };
  }
  return null;
}

/**
 * Check priority field for lowercase
 * @param {object} doc - Parsed WU YAML data
 * @returns {object|null} Issue object or null
 */
function checkPriorityField(doc) {
  if (!doc.priority || typeof doc.priority !== 'string') return null;

  const upper = doc.priority.toUpperCase();
  if (doc.priority !== upper && /^P[0-3]$/i.test(doc.priority)) {
    return {
      type: FIXABLE_ISSUES.PRIORITY_LOWERCASE,
      field: 'priority',
      current: doc.priority,
      suggested: upper,
      description: `Priority should be uppercase: ${doc.priority} → ${upper}`,
    };
  }
  return null;
}

/**
 * Detects fixable issues in WU YAML data
 *
 * @param {object} doc - Parsed WU YAML data
 * @returns {Array<{type: string, field: string, current: unknown, suggested: unknown, description: string}>}
 */
export function detectFixableIssues(doc) {
  const checks = [
    checkCreatedField,
    checkAssignedToField,
    checkTypeField,
    checkPhaseField,
    checkPriorityField,
  ];

  return checks.map((check) => check(doc)).filter((issue) => issue !== null);
}

/**
 * Applies fixes to WU YAML data in-place
 *
 * @param {object} doc - Parsed WU YAML data (will be modified)
 * @param {Array<{type: string, field: string, suggested: unknown}>} issues - Issues to fix
 * @returns {number} Number of fixes applied
 */
export function applyFixes(doc, issues) {
  let fixed = 0;

  for (const issue of issues) {
    switch (issue.type) {
      case FIXABLE_ISSUES.DATE_ISO_TIMESTAMP:
        doc[issue.field] = issue.suggested;
        fixed++;
        break;

      case FIXABLE_ISSUES.USERNAME_NOT_EMAIL:
        doc[issue.field] = issue.suggested;
        fixed++;
        break;

      case FIXABLE_ISSUES.TYPE_ALIAS:
        doc[issue.field] = issue.suggested;
        fixed++;
        break;

      case FIXABLE_ISSUES.PHASE_STRING:
        doc[issue.field] = issue.suggested;
        fixed++;
        break;

      case FIXABLE_ISSUES.PRIORITY_LOWERCASE:
        doc[issue.field] = issue.suggested;
        fixed++;
        break;
    }
  }

  return fixed;
}

/**
 * Options for auto-fixing WU YAML
 */
export interface AutoFixWUYamlOptions {
  /** If true, report issues without fixing */
  dryRun?: boolean;
  /** If true, create .bak file before fixing */
  backup?: boolean;
}

/**
 * Auto-fix WU YAML file
 *
 * @param {string} wuPath - Path to WU YAML file
 * @param {AutoFixWUYamlOptions} options - Options
 * @returns {{fixed: number, issues: Array, backupPath?: string}}
 */
export function autoFixWUYaml(wuPath, options: AutoFixWUYamlOptions = {}) {
  const { dryRun = false, backup = true } = options;

  // Read and parse
  const text = readFileSync(wuPath, { encoding: 'utf-8' });
  const doc = parseYAML(text);

  // Detect issues
  const issues = detectFixableIssues(doc);

  if (issues.length === 0) {
    return { fixed: 0, issues: [] };
  }

  if (dryRun) {
    return { fixed: 0, issues, wouldFix: issues.length };
  }

  // Create backup if requested
  let backupPath;
  if (backup) {
    backupPath = `${wuPath}.bak`;
    copyFileSync(wuPath, backupPath);
  }

  // Apply fixes
  const fixed = applyFixes(doc, issues);

  // Write back
  const newText = stringifyYAML(doc);
  writeFileSync(wuPath, newText, { encoding: 'utf-8' });

  return { fixed, issues, backupPath };
}

/**
 * Format issues for CLI output
 *
 * @param {Array<{field: string, description: string}>} issues
 * @returns {string}
 */
export function formatIssues(issues) {
  return issues.map((i) => `  - ${i.field}: ${i.description}`).join(STRING_LITERALS.NEWLINE);
}
