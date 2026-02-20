/**
 * Input validation and path safety utilities (WU-1921).
 *
 * Provides validation for:
 * - Path traversal prevention (workspace root sanitization)
 * - Pack ID format validation
 * - Semver version format validation
 * - CSRF origin checking
 * - Request body size limits
 *
 * All validators return structured results with machine-readable error codes.
 */

import path from 'node:path';

/* ------------------------------------------------------------------
 * Error codes (machine-readable)
 * ------------------------------------------------------------------ */

export const ValidationErrorCode = {
  PATH_TRAVERSAL: 'ERR_PATH_TRAVERSAL',
  INVALID_PACK_ID: 'ERR_INVALID_PACK_ID',
  INVALID_SEMVER: 'ERR_INVALID_SEMVER',
  INVALID_WORKSPACE_ID: 'ERR_INVALID_WORKSPACE_ID',
  CSRF_ORIGIN_MISMATCH: 'ERR_CSRF_ORIGIN_MISMATCH',
  BODY_TOO_LARGE: 'ERR_BODY_TOO_LARGE',
  INVALID_PATH: 'ERR_INVALID_PATH',
} as const;

export type ValidationErrorCodeType =
  (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode];

/* ------------------------------------------------------------------
 * Validation result type
 * ------------------------------------------------------------------ */

export interface ValidationSuccess {
  readonly valid: true;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly code: ValidationErrorCodeType;
  readonly message: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/* ------------------------------------------------------------------
 * Pack ID validation
 * ------------------------------------------------------------------ */

/** Pack IDs must be lowercase alphanumeric with hyphens only. */
const PACK_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/** Maximum pack ID length. */
const PACK_ID_MAX_LENGTH = 128;

export function validatePackId(packId: string): ValidationResult {
  if (packId.length === 0 || packId.length > PACK_ID_MAX_LENGTH) {
    return {
      valid: false,
      code: ValidationErrorCode.INVALID_PACK_ID,
      message: `Pack ID must be between 1 and ${PACK_ID_MAX_LENGTH} characters: "${packId}"`,
    };
  }

  if (!PACK_ID_REGEX.test(packId)) {
    return {
      valid: false,
      code: ValidationErrorCode.INVALID_PACK_ID,
      message: `Pack ID must match [a-z0-9-] and not start/end with hyphen: "${packId}"`,
    };
  }

  return { valid: true };
}

/* ------------------------------------------------------------------
 * Semver validation
 * ------------------------------------------------------------------ */

/** Regex for a semver numeric segment: 0 or a non-zero-leading number. */
const NUMERIC_SEGMENT = /^(0|[1-9]\d*)$/;

/**
 * Validates a semver version string using a functional approach.
 *
 * Supports: MAJOR.MINOR.PATCH, optional pre-release (-alpha.1), optional build (+build.123).
 * Rejects leading zeros in numeric segments (e.g., 01.0.0).
 *
 * Uses string splitting instead of a single complex regex to satisfy
 * sonarjs/regex-complexity and security/detect-unsafe-regex rules.
 */
export function validateSemver(version: string): ValidationResult {
  if (version.length === 0) {
    return {
      valid: false,
      code: ValidationErrorCode.INVALID_SEMVER,
      message: `Version must be valid semver (MAJOR.MINOR.PATCH): "${version}"`,
    };
  }

  // Split off build metadata (+...) and pre-release (-...)
  const buildIdx = version.indexOf('+');
  const versionWithoutBuild = buildIdx === -1 ? version : version.slice(0, buildIdx);
  const preReleaseIdx = versionWithoutBuild.indexOf('-');
  const coreVersion =
    preReleaseIdx === -1 ? versionWithoutBuild : versionWithoutBuild.slice(0, preReleaseIdx);

  // Core must be exactly three numeric segments
  const parts = coreVersion.split('.');
  if (parts.length !== 3) {
    return {
      valid: false,
      code: ValidationErrorCode.INVALID_SEMVER,
      message: `Version must be valid semver (MAJOR.MINOR.PATCH): "${version}"`,
    };
  }

  // Each segment must be a valid non-leading-zero number
  for (const part of parts) {
    if (!NUMERIC_SEGMENT.test(part)) {
      return {
        valid: false,
        code: ValidationErrorCode.INVALID_SEMVER,
        message: `Version must be valid semver (MAJOR.MINOR.PATCH): "${version}"`,
      };
    }
  }

  return { valid: true };
}

/* ------------------------------------------------------------------
 * Workspace ID validation
 * ------------------------------------------------------------------ */

/** Workspace IDs: alphanumeric, hyphens, underscores. */
const WORKSPACE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const WORKSPACE_ID_MAX_LENGTH = 256;

export function validateWorkspaceId(workspaceId: string): ValidationResult {
  if (workspaceId.length === 0 || workspaceId.length > WORKSPACE_ID_MAX_LENGTH) {
    return {
      valid: false,
      code: ValidationErrorCode.INVALID_WORKSPACE_ID,
      message: `Workspace ID must be between 1 and ${WORKSPACE_ID_MAX_LENGTH} characters`,
    };
  }

  if (!WORKSPACE_ID_REGEX.test(workspaceId)) {
    return {
      valid: false,
      code: ValidationErrorCode.INVALID_WORKSPACE_ID,
      message: `Workspace ID contains invalid characters: "${workspaceId}"`,
    };
  }

  return { valid: true };
}

/* ------------------------------------------------------------------
 * Path traversal prevention
 * ------------------------------------------------------------------ */

/**
 * Validates that a resolved path stays within the allowed root directory.
 * Prevents path traversal attacks via `../` sequences or symlink escape.
 *
 * @param userPath - The user-supplied path
 * @param allowedRoot - The root directory the path must stay within
 * @returns Validation result; on success, the resolved absolute path is
 *          available by calling `sanitizePath()` separately.
 */
export function validatePathWithinRoot(userPath: string, allowedRoot: string): ValidationResult {
  const inputValidation = validatePathInput(userPath);
  if (!inputValidation.valid) {
    return inputValidation;
  }

  const decodedUserPath = decodePathForTraversalChecks(userPath);

  const resolvedRoot = path.resolve(allowedRoot);
  const resolvedPath = path.resolve(resolvedRoot, decodedUserPath);

  // The resolved path must start with the resolved root + separator
  // (or be exactly the root itself)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return {
      valid: false,
      code: ValidationErrorCode.PATH_TRAVERSAL,
      message: 'Path traversal detected: resolved path escapes allowed root',
    };
  }

  return { valid: true };
}

/**
 * Resolves a user-supplied path within an allowed root, returning the
 * sanitized absolute path. Throws if path escapes the root.
 */
export function sanitizePath(userPath: string, allowedRoot: string): string {
  const validation = validatePathWithinRoot(userPath, allowedRoot);
  if (!validation.valid) {
    throw new Error(`${validation.code}: ${validation.message}`);
  }

  const resolvedRoot = path.resolve(allowedRoot);
  return path.resolve(resolvedRoot, decodePathForTraversalChecks(userPath));
}

/**
 * Resolves a relative path within an allowed root and rejects:
 * - absolute paths
 * - traversal attempts
 * - empty paths that resolve to the root itself
 */
export function sanitizeRelativePath(userPath: string, allowedRoot: string): string {
  if (path.isAbsolute(userPath)) {
    throw new Error(`${ValidationErrorCode.PATH_TRAVERSAL}: Path must be relative`);
  }

  const resolvedRoot = path.resolve(allowedRoot);
  const sanitized = sanitizePath(userPath, resolvedRoot);

  if (sanitized === resolvedRoot) {
    throw new Error(
      `${ValidationErrorCode.PATH_TRAVERSAL}: Path must resolve to a file under the root`,
    );
  }

  return sanitized;
}

/**
 * Maximum number of decode passes for path traversal checks.
 * Handles single and double-encoded payloads without risking unbounded loops.
 */
const MAX_PATH_DECODE_PASSES = 3;

/**
 * Decode path input repeatedly until stable or decode fails.
 * This catches traversal payloads like `%2e%2e` and `%252e%252e`.
 */
function decodePathForTraversalChecks(userPath: string): string {
  let decoded = userPath;

  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }

  return decoded;
}

/**
 * Validate user-supplied path text for traversal markers before it is resolved.
 * Use this for request payload fields that are consumed as paths.
 */
export function validatePathInput(userPath: string): ValidationResult {
  const decodedPath = decodePathForTraversalChecks(userPath);

  if (decodedPath.includes('\0')) {
    return {
      valid: false,
      code: ValidationErrorCode.PATH_TRAVERSAL,
      message: 'Path contains null bytes',
    };
  }

  const normalizedPath = decodedPath.replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0);

  if (pathSegments.includes('..')) {
    return {
      valid: false,
      code: ValidationErrorCode.PATH_TRAVERSAL,
      message: 'Path traversal detected: input contains parent directory segments',
    };
  }

  return { valid: true };
}

/* ------------------------------------------------------------------
 * CSRF origin checking
 * ------------------------------------------------------------------ */

/**
 * Validates that the request Origin or Referer header matches an allowed origin.
 *
 * @param request - The incoming HTTP request
 * @param allowedOrigins - Set of allowed origin URLs (e.g., ['https://lumenflow.dev'])
 * @returns Validation result
 */
export function validateCsrfOrigin(
  request: { headers: { get(name: string): string | null } },
  allowedOrigins: readonly string[],
): ValidationResult {
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');

  // If no origin/referer is provided, block the request
  // (same-origin requests from browsers always include Origin on POST)
  const checkValue = origin ?? (referer ? new URL(referer).origin : null);

  if (!checkValue) {
    return {
      valid: false,
      code: ValidationErrorCode.CSRF_ORIGIN_MISMATCH,
      message: 'Missing Origin or Referer header',
    };
  }

  if (!allowedOrigins.includes(checkValue)) {
    return {
      valid: false,
      code: ValidationErrorCode.CSRF_ORIGIN_MISMATCH,
      message: `Origin "${checkValue}" is not in allowed origins`,
    };
  }

  return { valid: true };
}

/* ------------------------------------------------------------------
 * Request body size limit
 * ------------------------------------------------------------------ */

/** Default maximum body size: 1 MB */
export const DEFAULT_MAX_BODY_SIZE = 1 * 1024 * 1024;

/**
 * Validates that the request Content-Length does not exceed the maximum.
 *
 * @param request - The incoming HTTP request
 * @param maxSize - Maximum allowed body size in bytes
 * @returns Validation result
 */
export function validateBodySize(
  request: { headers: { get(name: string): string | null } },
  maxSize: number = DEFAULT_MAX_BODY_SIZE,
): ValidationResult {
  const contentLength = request.headers.get('Content-Length');

  if (contentLength !== null) {
    const size = parseInt(contentLength, 10);
    if (!Number.isNaN(size) && size > maxSize) {
      return {
        valid: false,
        code: ValidationErrorCode.BODY_TOO_LARGE,
        message: `Request body size ${size} exceeds limit of ${maxSize} bytes`,
      };
    }
  }

  return { valid: true };
}
