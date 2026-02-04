/**
 * Hardcoded String Detection Module
 *
 * Provides classification of hardcoded path strings to distinguish between:
 * - Route paths (API endpoints, webhooks, etc.) - should use endpoint constants
 * - Filesystem paths (absolute paths, config files) - should use path.join()
 *
 * This enables Gate 13 to provide accurate, actionable remediation messages.
 *
 * @see WU-1788 - Improve hardcoded-string gate messaging for route paths
 */

/**
 * Path type constants
 * @type {Object}
 */
export const PATH_TYPES = Object.freeze({
  ROUTE: 'route',
  FILESYSTEM: 'filesystem',
  UNKNOWN: 'unknown',
});

/**
 * Route path prefixes that indicate API/web endpoints
 * These should use endpoint constants, not path.join()
 */
const ROUTE_PREFIXES = [
  '/api/',
  '/api?', // API with query params
  '/auth/',
  '/v1/',
  '/v2/',
  '/v3/',
  '/graphql',
  '/webhook/',
  '/webhooks/',
  '/trpc/',
  '/rest/',
  '/rpc/',
];

/**
 * Filesystem path prefixes that indicate absolute paths
 * These should use path.join() with constants
 */
const FILESYSTEM_PREFIXES = [
  '/home/',
  '/usr/',
  '/etc/',
  '/var/',
  '/tmp/',
  '/opt/',
  '/bin/',
  '/sbin/',
  '/lib/',
  '/proc/',
  '/sys/',
  '/dev/',
  '/mnt/',
  '/media/',
  '/srv/',
  '/root/',
];

/**
 * Common file extensions that indicate filesystem paths
 */
const FILE_EXTENSIONS = [
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.conf',
  '.config',
  '.cfg',
  '.ini',
  '.env',
  '.log',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.rb',
  '.pl',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.js',
  '.cjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.pem',
  '.key',
  '.crt',
  '.cer',
];

/**
 * Patterns that indicate filesystem paths
 */
const FILESYSTEM_PATTERNS = [
  /^[A-Z]:[/\\]/, // Windows drive letter (C:\, D:/)
  /node_modules/, // Node.js modules directory
  /\.\.\//, // Relative path traversal
  /~\//, // Home directory shorthand
];

/**
 * Classify a path string as route, filesystem, or unknown
 *
 * @param {string} pathStr - The path string to classify
 * @returns {string} One of PATH_TYPES values
 */
export function classifyPath(pathStr) {
  if (!pathStr || pathStr === '/') {
    return PATH_TYPES.UNKNOWN;
  }

  const normalizedPath = pathStr.toLowerCase();

  // Check for route path indicators first (more specific)
  for (const prefix of ROUTE_PREFIXES) {
    if (normalizedPath.startsWith(prefix) || normalizedPath.includes(prefix)) {
      return PATH_TYPES.ROUTE;
    }
  }

  // Check for query parameters (indicates a route/URL)
  if (pathStr.includes('?') && pathStr.startsWith('/')) {
    return PATH_TYPES.ROUTE;
  }

  // Check for filesystem path prefixes
  for (const prefix of FILESYSTEM_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      return PATH_TYPES.FILESYSTEM;
    }
  }

  // Check for file extensions
  for (const ext of FILE_EXTENSIONS) {
    if (normalizedPath.endsWith(ext)) {
      return PATH_TYPES.FILESYSTEM;
    }
  }

  // Check for filesystem patterns
  for (const pattern of FILESYSTEM_PATTERNS) {
    if (pattern.test(pathStr)) {
      return PATH_TYPES.FILESYSTEM;
    }
  }

  // Default to unknown for ambiguous paths
  return PATH_TYPES.UNKNOWN;
}

/**
 * Remediation messages for each path type
 */
const REMEDIATION_MESSAGES = Object.freeze({
  [PATH_TYPES.ROUTE]:
    'Route path - use an endpoint constant or config (e.g., API_ENDPOINT, API_ROUTES.ASSISTANT)',
  [PATH_TYPES.FILESYSTEM]: 'File path - use path.join() with constants',
  [PATH_TYPES.UNKNOWN]: 'Path string - use a constant or configuration value',
});

/**
 * Get the appropriate remediation message for a path type
 *
 * @param {string} pathType - One of PATH_TYPES values
 * @returns {string} Remediation message
 */
export function getRemediation(pathType) {
  // Validate pathType to prevent object injection
  const validTypes = Object.values(PATH_TYPES);
  if (validTypes.includes(pathType)) {
    // eslint-disable-next-line security/detect-object-injection -- Safe: pathType validated against known values above
    return REMEDIATION_MESSAGES[pathType];
  }
  return REMEDIATION_MESSAGES[PATH_TYPES.UNKNOWN];
}

/**
 * Pattern to match path-like strings in code
 * Matches quoted strings that:
 * - Start with /
 * - Have at least one path segment after the initial /
 * - May include alphanumeric characters, underscores, hyphens, dots
 * - May include query parameters
 *
 * Note: Uses non-greedy quantifiers and avoids nested quantifiers to prevent ReDoS
 */
// eslint-disable-next-line security/detect-unsafe-regex -- Intentionally simplified pattern, not user-controlled
const PATH_PATTERN = /['"](\/[\w./-]+(?:\?[^'"]*)?)['"]/gi;

/**
 * Check if a line contains a constant definition (SCREAMING_SNAKE_CASE)
 *
 * @param {string} line - The line to check
 * @returns {boolean} True if line defines a constant
 */
function isConstantDefinition(line) {
  if (!line.includes('const ')) return false;
  const afterConst = line.split('const ')[1];
  if (!afterConst) return false;
  const identifier = afterConst.trim().split(/[\s=]/)[0];
  return identifier && identifier === identifier.toUpperCase() && identifier.length > 1;
}

/**
 * Options for hardcoded path violation detection
 */
export interface FindHardcodedPathViolationsOptions {
  /** Whether this is a test file (skip detection) */
  isTestFile?: boolean;
  /** Whether this is a config file (skip detection) */
  isConfigFile?: boolean;
}

/**
 * Find hardcoded path violations in a line of code
 *
 * @param {string} line - The line of code to check
 * @param {FindHardcodedPathViolationsOptions} options - Options for detection
 * @returns {Array<{line: string, fix: string, pathType: string, path: string}>} Array of violations
 */
export function findHardcodedPathViolations(
  line,
  options: FindHardcodedPathViolationsOptions = {},
) {
  const { isTestFile = false, isConfigFile = false } = options;

  // Skip test files and config files
  if (isTestFile || isConfigFile) {
    return [];
  }

  // Skip constant definitions (they ARE the constants we want people to create)
  if (isConstantDefinition(line)) {
    return [];
  }

  // Skip lines that look like test context
  if (line.includes('.test.') || line.includes('.spec.')) {
    return [];
  }

  const violations = [];
  let match;

  // Reset regex lastIndex for global matching
  PATH_PATTERN.lastIndex = 0;

  while ((match = PATH_PATTERN.exec(line)) !== null) {
    const pathStr = match[1];

    // Only flag paths that start with /
    if (!pathStr.startsWith('/')) {
      continue;
    }

    const pathType = classifyPath(pathStr);
    const remediation = getRemediation(pathType);

    violations.push({
      line: line.substring(0, 80),
      fix: remediation,
      pathType,
      path: pathStr,
    });
  }

  return violations;
}

/**
 * Legacy function for backwards compatibility with gates-pre-commit.ts
 * Detects all hardcoded string patterns (not just paths)
 *
 * @deprecated Use findHardcodedPathViolations for path-specific detection
 */
export const HARDCODED_PATTERNS = [
  {
    pattern: /['"]https?:\/\/[^'"]+\/api\//i,
    message: 'API endpoint - use environment variable or config',
  },
  {
    pattern: /throw new Error\s*\(\s*['"][^'"]{50,}['"]\s*\)/i,
    message: 'Long error message - use error constants',
  },
  // WU-1788: Path pattern now uses classifier for accurate messages
  // The old pattern is replaced by findHardcodedPathViolations
  { pattern: /['"]#[0-9a-fA-F]{6}['"]/i, message: 'Color value - use theme/design tokens' },
  { pattern: /if\s*\(\s*['"]feature_/i, message: 'Feature flag - use feature flag service' },
];
