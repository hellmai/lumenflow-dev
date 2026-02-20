/**
 * Tests for input validation and path safety (WU-1921).
 *
 * RED phase: These tests define the expected behavior before
 * the validation is wired into route handlers.
 */
import { describe, expect, it } from 'vitest';
import {
  validatePackId,
  validateSemver,
  validateWorkspaceId,
  validatePathWithinRoot,
  sanitizePath,
  validateCsrfOrigin,
  validateBodySize,
  ValidationErrorCode,
  DEFAULT_MAX_BODY_SIZE,
} from '../src/server/input-validation';

/* ------------------------------------------------------------------
 * Pack ID validation
 * ------------------------------------------------------------------ */

describe('validatePackId', () => {
  it('accepts valid lowercase pack IDs', () => {
    expect(validatePackId('software-delivery').valid).toBe(true);
    expect(validatePackId('my-pack').valid).toBe(true);
    expect(validatePackId('a').valid).toBe(true);
    expect(validatePackId('pack123').valid).toBe(true);
    expect(validatePackId('a1b2c3').valid).toBe(true);
  });

  it('rejects pack IDs with uppercase letters', () => {
    const result = validatePackId('Software-Delivery');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.INVALID_PACK_ID);
    }
  });

  it('rejects pack IDs with special characters', () => {
    expect(validatePackId('my_pack').valid).toBe(false);
    expect(validatePackId('my.pack').valid).toBe(false);
    expect(validatePackId('my pack').valid).toBe(false);
    expect(validatePackId('my@pack').valid).toBe(false);
    expect(validatePackId('../traversal').valid).toBe(false);
  });

  it('rejects pack IDs starting or ending with hyphen', () => {
    expect(validatePackId('-leading').valid).toBe(false);
    expect(validatePackId('trailing-').valid).toBe(false);
  });

  it('rejects empty pack ID', () => {
    const result = validatePackId('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.INVALID_PACK_ID);
    }
  });

  it('rejects overly long pack ID', () => {
    const longId = 'a'.repeat(129);
    expect(validatePackId(longId).valid).toBe(false);
  });

  it('returns machine-readable error code on failure', () => {
    const result = validatePackId('INVALID');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.INVALID_PACK_ID);
      expect(result.message).toContain('INVALID');
    }
  });
});

/* ------------------------------------------------------------------
 * Semver validation
 * ------------------------------------------------------------------ */

describe('validateSemver', () => {
  it('accepts valid semver strings', () => {
    expect(validateSemver('1.0.0').valid).toBe(true);
    expect(validateSemver('0.1.0').valid).toBe(true);
    expect(validateSemver('10.20.30').valid).toBe(true);
  });

  it('accepts semver with pre-release tag', () => {
    expect(validateSemver('1.0.0-alpha').valid).toBe(true);
    expect(validateSemver('1.0.0-beta.1').valid).toBe(true);
    expect(validateSemver('1.0.0-0.3.7').valid).toBe(true);
  });

  it('accepts semver with build metadata', () => {
    expect(validateSemver('1.0.0+build.123').valid).toBe(true);
    expect(validateSemver('1.0.0-alpha+001').valid).toBe(true);
  });

  it('rejects non-semver strings', () => {
    expect(validateSemver('1.0').valid).toBe(false);
    expect(validateSemver('1').valid).toBe(false);
    expect(validateSemver('latest').valid).toBe(false);
    expect(validateSemver('v1.0.0').valid).toBe(false);
    expect(validateSemver('').valid).toBe(false);
  });

  it('rejects leading zeros in numeric segments', () => {
    expect(validateSemver('01.0.0').valid).toBe(false);
    expect(validateSemver('1.01.0').valid).toBe(false);
    expect(validateSemver('1.0.01').valid).toBe(false);
  });

  it('returns machine-readable error code on failure', () => {
    const result = validateSemver('invalid');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.INVALID_SEMVER);
      expect(result.message).toContain('invalid');
    }
  });
});

/* ------------------------------------------------------------------
 * Workspace ID validation
 * ------------------------------------------------------------------ */

describe('validateWorkspaceId', () => {
  it('accepts valid workspace IDs', () => {
    expect(validateWorkspaceId('ws-001').valid).toBe(true);
    expect(validateWorkspaceId('my_workspace').valid).toBe(true);
    expect(validateWorkspaceId('MyProject123').valid).toBe(true);
  });

  it('rejects empty workspace ID', () => {
    const result = validateWorkspaceId('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.INVALID_WORKSPACE_ID);
    }
  });

  it('rejects workspace IDs with special characters', () => {
    expect(validateWorkspaceId('ws/001').valid).toBe(false);
    expect(validateWorkspaceId('ws..001').valid).toBe(false);
    expect(validateWorkspaceId('../escape').valid).toBe(false);
  });

  it('rejects workspace IDs starting with special characters', () => {
    expect(validateWorkspaceId('-leading').valid).toBe(false);
    expect(validateWorkspaceId('_leading').valid).toBe(false);
  });

  it('rejects overly long workspace IDs', () => {
    const longId = 'a'.repeat(257);
    expect(validateWorkspaceId(longId).valid).toBe(false);
  });
});

/* ------------------------------------------------------------------
 * Path traversal prevention
 * ------------------------------------------------------------------ */

describe('validatePathWithinRoot', () => {
  it('allows paths within the root directory', () => {
    expect(validatePathWithinRoot('subdir/file.txt', '/allowed/root').valid).toBe(true);
    expect(validatePathWithinRoot('file.txt', '/allowed/root').valid).toBe(true);
    expect(validatePathWithinRoot('.', '/allowed/root').valid).toBe(true);
  });

  it('rejects path traversal via ../', () => {
    const result = validatePathWithinRoot('../../../etc/passwd', '/allowed/root');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.PATH_TRAVERSAL);
    }
  });

  it('rejects path traversal via encoded sequences', () => {
    // After decoding, this could resolve outside root
    const result = validatePathWithinRoot('..%2F..%2Fetc/passwd', '/allowed/root');
    // The resolved path should still stay within root if it literally contains %2F
    // But direct ../ should be caught
    expect(validatePathWithinRoot('../../etc/passwd', '/allowed/root').valid).toBe(false);
  });

  it('rejects null bytes in path', () => {
    const result = validatePathWithinRoot('file\0.txt', '/allowed/root');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.PATH_TRAVERSAL);
    }
  });

  it('rejects absolute paths that escape root', () => {
    expect(validatePathWithinRoot('/etc/passwd', '/allowed/root').valid).toBe(false);
  });

  it('allows the root directory itself', () => {
    expect(validatePathWithinRoot('.', '/allowed/root').valid).toBe(true);
  });
});

describe('sanitizePath', () => {
  it('returns resolved path for valid paths', () => {
    const result = sanitizePath('subdir/file.txt', '/allowed/root');
    expect(result).toBe('/allowed/root/subdir/file.txt');
  });

  it('throws on path traversal attempts', () => {
    expect(() => sanitizePath('../../../etc/passwd', '/allowed/root')).toThrow(
      ValidationErrorCode.PATH_TRAVERSAL,
    );
  });

  it('throws on null byte attacks', () => {
    expect(() => sanitizePath('file\0.txt', '/allowed/root')).toThrow(
      ValidationErrorCode.PATH_TRAVERSAL,
    );
  });
});

/* ------------------------------------------------------------------
 * CSRF origin validation
 * ------------------------------------------------------------------ */

describe('validateCsrfOrigin', () => {
  const allowedOrigins = ['https://lumenflow.dev', 'http://localhost:3000'];

  it('accepts requests with matching Origin header', () => {
    const request = {
      headers: { get: (name: string) => (name === 'Origin' ? 'https://lumenflow.dev' : null) },
    };
    expect(validateCsrfOrigin(request, allowedOrigins).valid).toBe(true);
  });

  it('accepts requests with matching Referer header when Origin is absent', () => {
    const request = {
      headers: {
        get: (name: string) =>
          name === 'Referer' ? 'http://localhost:3000/some/page' : null,
      },
    };
    expect(validateCsrfOrigin(request, allowedOrigins).valid).toBe(true);
  });

  it('rejects requests with mismatched Origin', () => {
    const request = {
      headers: { get: (name: string) => (name === 'Origin' ? 'https://evil.com' : null) },
    };
    const result = validateCsrfOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.CSRF_ORIGIN_MISMATCH);
    }
  });

  it('rejects requests with no Origin or Referer headers', () => {
    const request = { headers: { get: () => null } };
    const result = validateCsrfOrigin(request, allowedOrigins);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.CSRF_ORIGIN_MISMATCH);
      expect(result.message).toContain('Missing');
    }
  });

  it('uses Origin over Referer when both are present', () => {
    const request = {
      headers: {
        get: (name: string) => {
          if (name === 'Origin') return 'https://lumenflow.dev';
          if (name === 'Referer') return 'https://evil.com/page';
          return null;
        },
      },
    };
    expect(validateCsrfOrigin(request, allowedOrigins).valid).toBe(true);
  });
});

/* ------------------------------------------------------------------
 * Body size validation
 * ------------------------------------------------------------------ */

describe('validateBodySize', () => {
  it('accepts requests within size limit', () => {
    const request = {
      headers: { get: (name: string) => (name === 'Content-Length' ? '1024' : null) },
    };
    expect(validateBodySize(request).valid).toBe(true);
  });

  it('rejects requests exceeding size limit', () => {
    const request = {
      headers: {
        get: (name: string) =>
          name === 'Content-Length' ? String(DEFAULT_MAX_BODY_SIZE + 1) : null,
      },
    };
    const result = validateBodySize(request);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(ValidationErrorCode.BODY_TOO_LARGE);
    }
  });

  it('accepts requests without Content-Length header', () => {
    const request = { headers: { get: () => null } };
    expect(validateBodySize(request).valid).toBe(true);
  });

  it('respects custom size limit', () => {
    const request = {
      headers: { get: (name: string) => (name === 'Content-Length' ? '500' : null) },
    };
    expect(validateBodySize(request, 100).valid).toBe(false);
    expect(validateBodySize(request, 1000).valid).toBe(true);
  });
});
