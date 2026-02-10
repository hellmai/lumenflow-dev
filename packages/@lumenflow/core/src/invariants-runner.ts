/**
 * Invariants Runner (WU-2252)
 *
 * Validates durable repo invariants from invariants.yml.
 * Runs as the first gate check and also inside wu:done even when --skip-gates is used.
 *
 * Supported invariant types:
 * - required-file: File must exist
 * - forbidden-file: File must NOT exist
 * - mutual-exclusivity: Only one of the listed files may exist
 * - forbidden-pattern: Pattern must not appear in scoped files
 * - required-pattern: Pattern MUST appear at least once in scoped files (WU-2254)
 * - forbidden-import: Files must not import forbidden modules (WU-2254)
 * - wu-automated-tests: WUs with code files must have automated tests (WU-2333)
 *
 * Performance constraints:
 * - Excludes node_modules/, worktrees/, .next/, dist/, .git/ from scanning
 * - For forbidden-pattern rules, scans only the specified scope paths
 *
 * @module tools/lib/invariants-runner
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { parseYAML } from './wu-yaml.js';
// WU-2333: Import automated tests invariant check
import { checkAutomatedTestsInvariant } from './invariants/check-automated-tests.js';

/**
 * Invariant type constants
 */
export const INVARIANT_TYPES = {
  REQUIRED_FILE: 'required-file',
  FORBIDDEN_FILE: 'forbidden-file',
  MUTUAL_EXCLUSIVITY: 'mutual-exclusivity',
  FORBIDDEN_PATTERN: 'forbidden-pattern',
  // WU-2254: New invariant types
  REQUIRED_PATTERN: 'required-pattern',
  FORBIDDEN_IMPORT: 'forbidden-import',
  // WU-2333: WU automated tests invariant
  WU_AUTOMATED_TESTS: 'wu-automated-tests',
};

/**
 * Directories to exclude from pattern scanning
 */
const EXCLUDED_DIRS = ['node_modules', 'worktrees', '.next', 'dist', '.git'];

/**
 * Custom error class for invariant violations
 */
export class InvariantError extends Error {
  /** The invariant ID */
  invariantId: string;

  /**
   * @param {string} invariantId - The invariant ID (e.g., 'INV-001')
   * @param {string} message - Error message
   */
  constructor(invariantId: string, message: string) {
    super(message);
    this.name = 'InvariantError';
    this.invariantId = invariantId;
  }
}

/**
 * Load invariants from a YAML file
 *
 * @param {string} filePath - Path to invariants.yml
 * @returns {Array<object>} Array of invariant definitions
 * @throws {Error} If file doesn't exist or has invalid YAML
 */
export function loadInvariants(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Invariants file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');

  let doc;
  try {
    doc = parseYAML(content);
  } catch (e) {
    throw new Error(`Invalid YAML in ${filePath}: ${e.message}`);
  }

  if (!doc || !Array.isArray(doc.invariants)) {
    throw new Error(`Invalid invariants.yml: expected 'invariants' array at root`);
  }

  return doc.invariants;
}

/**
 * Validate a required-file invariant
 *
 * @param {object} invariant - Invariant definition
 * @param {string} baseDir - Base directory for path resolution
 * @returns {object|null} Violation object if invalid, null if valid
 */
function validateRequiredFile(invariant, baseDir) {
  const fullPath = path.join(baseDir, invariant.path);

  if (!existsSync(fullPath)) {
    return {
      ...invariant,
      valid: false,
      path: invariant.path,
    };
  }

  return null;
}

/**
 * Validate a forbidden-file invariant
 *
 * @param {object} invariant - Invariant definition
 * @param {string} baseDir - Base directory for path resolution
 * @returns {object|null} Violation object if invalid, null if valid
 */
function validateForbiddenFile(invariant, baseDir) {
  const fullPath = path.join(baseDir, invariant.path);

  if (existsSync(fullPath)) {
    return {
      ...invariant,
      valid: false,
      path: invariant.path,
    };
  }

  return null;
}

/**
 * Validate a mutual-exclusivity invariant
 *
 * @param {object} invariant - Invariant definition with paths array
 * @param {string} baseDir - Base directory for path resolution
 * @returns {object|null} Violation object if invalid, null if valid
 */
function validateMutualExclusivity(invariant, baseDir) {
  const existingPaths = invariant.paths.filter((p) => {
    const fullPath = path.join(baseDir, p);
    return existsSync(fullPath);
  });

  if (existingPaths.length > 1) {
    return {
      ...invariant,
      valid: false,
      existingPaths,
    };
  }

  return null;
}

/**
 * Validate a forbidden-pattern invariant
 *
 * @param {object} invariant - Invariant definition with pattern and scope
 * @param {string} baseDir - Base directory for path resolution
 * @returns {object|null} Violation object if invalid, null if valid
 */
function validateForbiddenPattern(invariant, baseDir) {
  const { pattern, scope } = invariant;

  if (!pattern || !scope || !Array.isArray(scope)) {
    return null; // Skip if misconfigured
  }

  // Build ignore patterns for excluded directories
  const ignorePatterns = EXCLUDED_DIRS.map((dir) => `**/${dir}/**`);

  // Find all files matching the scope
  const matchingFiles = [];

  for (const scopePattern of scope) {
    const files = globSync(scopePattern, {
      cwd: baseDir,
      ignore: ignorePatterns,
      nodir: true,
    });

    // Check each file for the forbidden pattern
    // eslint-disable-next-line security/detect-non-literal-regexp -- pattern from invariant config, not user input
    const regex = new RegExp(pattern);

    for (const file of files) {
      const fullPath = path.join(baseDir, file);

      try {
        const content = readFileSync(fullPath, 'utf-8');
        if (regex.test(content)) {
          matchingFiles.push(file);
        }
      } catch {
        // Skip files that can't be read (e.g., binary files)
      }
    }
  }

  if (matchingFiles.length > 0) {
    return {
      ...invariant,
      valid: false,
      matchingFiles,
    };
  }

  return null;
}

/**
 * WU-2254: Validate a required-pattern invariant
 *
 * Semantics: PASS if the regex matches at least once across the scoped files.
 * This is the inverse of forbidden-pattern - we WANT to find the pattern.
 *
 * @param {object} invariant - Invariant definition with pattern and scope
 * @param {string} baseDir - Base directory for path resolution
 * @returns {object|null} Violation object if pattern NOT found, null if found
 */
function validateRequiredPattern(invariant, baseDir) {
  const { pattern, scope } = invariant;

  if (!pattern || !scope || !Array.isArray(scope)) {
    return null; // Skip if misconfigured
  }

  // Build ignore patterns for excluded directories
  const ignorePatterns = EXCLUDED_DIRS.map((dir) => `**/${dir}/**`);

  // Check if pattern exists in any file matching the scope
  // eslint-disable-next-line security/detect-non-literal-regexp -- pattern from invariant config, not user input
  const regex = new RegExp(pattern);

  for (const scopePattern of scope) {
    const files = globSync(scopePattern, {
      cwd: baseDir,
      ignore: ignorePatterns,
      nodir: true,
    });

    for (const file of files) {
      const fullPath = path.join(baseDir, file);

      try {
        const content = readFileSync(fullPath, 'utf-8');
        if (regex.test(content)) {
          // Pattern found - invariant passes
          return null;
        }
      } catch {
        // Skip files that can't be read (e.g., binary files)
      }
    }
  }

  // Pattern not found in any file - invariant fails
  return {
    ...invariant,
    valid: false,
    patternNotFound: true,
  };
}

/**
 * WU-2254: Validate a forbidden-import invariant
 *
 * Detects import/require/re-export statements referencing forbidden modules.
 * Supports:
 * - ESM static import: import { x } from 'module'
 * - ESM dynamic import: await import('module')
 * - ESM re-export: export { x } from 'module'
 * - CommonJS require: require('module')
 *
 * @param {object} invariant - Invariant definition with from glob and cannot_import array
 * @param {string} baseDir - Base directory for path resolution
 * @returns {object|null} Violation object if forbidden imports found, null otherwise
 */
function validateForbiddenImport(invariant, baseDir) {
  const { from, cannot_import } = invariant;

  if (!from || !cannot_import || !Array.isArray(cannot_import)) {
    return null; // Skip if misconfigured
  }

  // Build ignore patterns for excluded directories
  const ignorePatterns = EXCLUDED_DIRS.map((dir) => `**/${dir}/**`);

  // Find all files matching the 'from' glob
  const files = globSync(from, {
    cwd: baseDir,
    ignore: ignorePatterns,
    nodir: true,
  });

  const violatingFiles = [];
  const violatingImports = {};

  // Build regex patterns for detecting imports of forbidden modules
  // We escape special regex characters in module names
  const forbiddenModulePatterns = cannot_import.map((mod) => {
    const escapedMod = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match:
    // - import ... from 'module' or "module"
    // - export ... from 'module' or "module"
    // - require('module') or require("module")
    // - import('module') or import("module") for dynamic imports
    // eslint-disable-next-line security/detect-non-literal-regexp -- module name from invariant config, not user input
    return new RegExp(
      `(?:` +
        `import\\s+[^;]*from\\s*['"]${escapedMod}['"]|` + // static import
        `export\\s+[^;]*from\\s*['"]${escapedMod}['"]|` + // re-export
        `require\\s*\\(\\s*['"]${escapedMod}['"]\\s*\\)|` + // require()
        `import\\s*\\(\\s*['"]${escapedMod}['"]\\s*\\)` + // dynamic import()
        `)`,
    );
  });

  for (const file of files) {
    const fullPath = path.join(baseDir, file);

    try {
      const content = readFileSync(fullPath, 'utf-8');

      // Check each forbidden module pattern
      for (let i = 0; i < forbiddenModulePatterns.length; i++) {
        const pattern = forbiddenModulePatterns[i];
        const moduleName = cannot_import[i];

        if (pattern.test(content)) {
          if (!violatingFiles.includes(file)) {
            violatingFiles.push(file);
          }
          violatingImports[moduleName] = (violatingImports[moduleName] || 0) + 1;
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (violatingFiles.length > 0) {
    return {
      ...invariant,
      valid: false,
      violatingFiles,
      violatingImports,
    };
  }

  return null;
}

/**
 * WU-2333: Validate wu-automated-tests invariant
 *
 * Checks that WUs with code files have automated tests.
 * Delegates to the check-automated-tests module for the actual validation.
 *
 * WU-2425: When wuId is provided, only validates that specific WU instead of
 * all active WUs. This prevents unrelated WUs from blocking wu:done completion.
 *
 * @param {object} invariant - Invariant definition
 * @param {string} baseDir - Base directory for path resolution
 * @param {ValidateWUAutomatedTestsContext} [context={}] - Additional context
 * @returns {object|null} Violation object if violations found, null otherwise
 */
interface ValidateWUAutomatedTestsContext {
  /** Specific WU ID to validate (scoped validation) */
  wuId?: string;
}

function validateWUAutomatedTests(
  invariant,
  baseDir,
  context: ValidateWUAutomatedTestsContext = {},
) {
  const { wuId } = context;
  const result = checkAutomatedTestsInvariant({ baseDir, wuId });

  if (!result.valid && result.violations.length > 0) {
    // Return first violation with invariant metadata merged in
    // (checkAutomatedTestsInvariant returns array, we merge with registry invariant)
    return {
      ...invariant,
      valid: false,
      wuViolations: result.violations,
    };
  }

  return null;
}

/**
 * Validate all invariants against the current repo state
 *
 * WU-2425: When wuId is provided, WU-scoped invariants only validate that specific WU.
 *
 * @param {Array<object>} invariants - Array of invariant definitions
 * @param {ValidateInvariantsOptions} [options={}] - Options
 * @returns {{valid: boolean, violations: Array<object>}} Validation result
 */
export interface ValidateInvariantsOptions {
  /** Base directory for path resolution */
  baseDir?: string;
  /** Specific WU ID for scoped validation (WU-2425) */
  wuId?: string;
}

export function validateInvariants(invariants, options: ValidateInvariantsOptions = {}) {
  const { baseDir = process.cwd(), wuId } = options;
  const violations = [];

  for (const invariant of invariants) {
    let violation = null;

    switch (invariant.type) {
      case INVARIANT_TYPES.REQUIRED_FILE:
        violation = validateRequiredFile(invariant, baseDir);
        break;

      case INVARIANT_TYPES.FORBIDDEN_FILE:
        violation = validateForbiddenFile(invariant, baseDir);
        break;

      case INVARIANT_TYPES.MUTUAL_EXCLUSIVITY:
        violation = validateMutualExclusivity(invariant, baseDir);
        break;

      case INVARIANT_TYPES.FORBIDDEN_PATTERN:
        violation = validateForbiddenPattern(invariant, baseDir);
        break;

      // WU-2254: New invariant types
      case INVARIANT_TYPES.REQUIRED_PATTERN:
        violation = validateRequiredPattern(invariant, baseDir);
        break;

      case INVARIANT_TYPES.FORBIDDEN_IMPORT:
        violation = validateForbiddenImport(invariant, baseDir);
        break;

      // WU-2333: WU automated tests invariant
      // WU-2425: Pass wuId for scoped validation
      case INVARIANT_TYPES.WU_AUTOMATED_TESTS:
        violation = validateWUAutomatedTests(invariant, baseDir, { wuId });
        break;

      default:
        // Unknown invariant type - skip with warning
        console.warn(`[invariants] Unknown invariant type: ${invariant.type} (${invariant.id})`);
    }

    if (violation) {
      violations.push(violation);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Format file-related violation details.
 * @param {object} violation - Violation object
 * @returns {string[]} Formatted lines
 */
function formatFileViolationDetails(violation) {
  const lines = [];
  if (violation.path) {
    lines.push(`Path: ${violation.path}`);
  }
  if (violation.existingPaths) {
    lines.push(`Conflicting files: ${violation.existingPaths.join(', ')}`);
  }
  if (violation.matchingFiles) {
    lines.push(`Files with forbidden pattern: ${violation.matchingFiles.join(', ')}`);
  }
  return lines;
}

/**
 * Format forbidden-import violation details.
 * @param {object} violation - Violation object
 * @returns {string[]} Formatted lines
 */
function formatImportViolationDetails(violation) {
  const lines = [];
  if (violation.from) {
    lines.push(`From: ${violation.from}`);
  }
  if (violation.cannot_import) {
    lines.push(`Cannot import: ${violation.cannot_import.join(', ')}`);
  }
  if (violation.violatingFiles) {
    lines.push(`Files with forbidden imports: ${violation.violatingFiles.join(', ')}`);
  }
  if (violation.violatingImports) {
    const imports = Object.entries(violation.violatingImports)
      .map(([mod, count]) => `${mod} (${count} occurrence${(count as number) > 1 ? 's' : ''})`)
      .join(', ');
    lines.push(`Forbidden imports found: ${imports}`);
  }
  return lines;
}

/**
 * Format pattern-related violation details.
 * @param {object} violation - Violation object
 * @returns {string[]} Formatted lines
 */
function formatPatternViolationDetails(violation) {
  const lines = [];
  if (violation.patternNotFound) {
    lines.push(`Required pattern not found: ${violation.pattern}`);
    if (violation.scope) {
      lines.push(`Searched in: ${violation.scope.join(', ')}`);
    }
  }
  return lines;
}

/**
 * WU-2333: Format wu-automated-tests violation details.
 * @param {object} violation - Violation object
 * @returns {string[]} Formatted lines
 */
function formatWUAutomatedTestsViolationDetails(violation) {
  const lines = [];
  if (violation.wuViolations) {
    lines.push(`WUs missing automated tests:`);
    for (const wuViolation of violation.wuViolations) {
      lines.push(`  - ${wuViolation.wuId}`);
      if (wuViolation.codeFiles && wuViolation.codeFiles.length > 0) {
        lines.push(`    Code files: ${wuViolation.codeFiles.join(', ')}`);
      }
    }
  }
  return lines;
}

/**
 * Format type-specific details for a violation.
 * Extracted to reduce cognitive complexity of formatInvariantError.
 *
 * @param {object} violation - Violation object
 * @returns {string[]} Array of formatted detail lines
 */
function formatViolationDetails(violation) {
  return [
    ...formatFileViolationDetails(violation),
    ...formatImportViolationDetails(violation),
    ...formatPatternViolationDetails(violation),
    ...formatWUAutomatedTestsViolationDetails(violation),
  ];
}

/**
 * Format an invariant violation for display
 *
 * @param {object} violation - Violation object from validateInvariants
 * @returns {string} Formatted error message
 */
export function formatInvariantError(violation) {
  const lines = [
    `INVARIANT VIOLATION: ${violation.id}`,
    `Type: ${violation.type}`,
    `Description: ${violation.description}`,
    ...formatViolationDetails(violation),
  ];

  // Add the actionable message
  if (violation.message) {
    lines.push('');
    lines.push(`Action: ${violation.message}`);
  }

  return lines.join('\n');
}

/**
 * Run invariants validation and format results for gates output
 *
 * WU-2425: When wuId is provided, WU-scoped invariants (like automated tests)
 * only validate that specific WU, preventing unrelated WUs from blocking wu:done.
 *
 * @param {RunInvariantsOptions} [options={}] - Options
 * @returns {{success: boolean, violations: Array<object>, formatted: string}} Result
 */
export interface RunInvariantsOptions {
  /** Path to invariants config */
  configPath?: string;
  /** Base directory */
  baseDir?: string;
  /** Suppress console output */
  silent?: boolean;
  /** Specific WU ID for scoped validation (WU-2425) */
  wuId?: string;
}

export function runInvariants(options: RunInvariantsOptions = {}) {
  const {
    configPath = 'tools/invariants.yml',
    baseDir = process.cwd(),
    silent = false,
    wuId,
  } = options;

  const fullConfigPath = path.isAbsolute(configPath) ? configPath : path.join(baseDir, configPath);

  // Check if config exists - if not, pass (no invariants defined)
  if (!existsSync(fullConfigPath)) {
    if (!silent) {
      console.log('[invariants] No tools/invariants.yml found - skipping');
    }
    return { success: true, violations: [], formatted: '' };
  }

  try {
    const invariants = loadInvariants(fullConfigPath);

    if (invariants.length === 0) {
      if (!silent) {
        console.log('[invariants] No invariants defined - skipping');
      }
      return { success: true, violations: [], formatted: '' };
    }

    // WU-2425: Pass wuId for scoped validation
    const result = validateInvariants(invariants, { baseDir, wuId });

    if (result.valid) {
      if (!silent) {
        console.log(`[invariants] All ${invariants.length} invariants passed`);
      }
      return { success: true, violations: [], formatted: '' };
    }

    // Format violations
    const formatted = result.violations.map(formatInvariantError).join('\n\n');

    if (!silent) {
      console.error('[invariants] FAILED - violations detected:');
      console.error('');
      console.error(formatted);
    }

    return {
      success: false,
      violations: result.violations,
      formatted,
    };
  } catch (e) {
    const error = `[invariants] Error: ${e.message}`;
    if (!silent) {
      console.error(error);
    }
    return {
      success: false,
      violations: [],
      formatted: error,
    };
  }
}
