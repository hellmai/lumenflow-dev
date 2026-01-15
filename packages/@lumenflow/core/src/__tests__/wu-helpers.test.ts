/**
 * @file wu-helpers.test.mjs
 * Tests for WU helper functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateWUIDFormat,
  extractWUFromBranch,
  validateBranchName,
  extractWUFromCommitMessage,
} from '../wu-helpers.js';

describe('validateWUIDFormat', () => {
  let consoleErrorSpy;
  let processExitSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('valid WU IDs', () => {
    it('should accept WU-123 format', () => {
      validateWUIDFormat('WU-123');
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should accept WU-1 (single digit)', () => {
      validateWUIDFormat('WU-1');
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should accept WU-99999 (large number)', () => {
      validateWUIDFormat('WU-99999');
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe('invalid WU IDs', () => {
    it('should reject lowercase wu-123', () => {
      validateWUIDFormat('wu-123');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid WU ID format'));
    });

    it('should reject missing number', () => {
      validateWUIDFormat('WU-');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid WU ID format'));
    });

    it('should reject wrong prefix', () => {
      validateWUIDFormat('TICKET-123');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid WU ID format'));
    });

    it('should reject no prefix', () => {
      validateWUIDFormat('123');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid WU ID format'));
    });

    it('should reject spaces', () => {
      validateWUIDFormat('WU- 123');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid WU ID format'));
    });

    it('should reject empty string', () => {
      validateWUIDFormat('');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid WU ID format'));
    });
  });
});

describe('extractWUFromBranch', () => {
  it('should extract WU ID from lane branch', () => {
    expect(extractWUFromBranch('lane/operations-tooling/wu-123')).toBe('WU-123');
  });

  it('should handle lowercase wu prefix', () => {
    expect(extractWUFromBranch('lane/intelligence/wu-456')).toBe('WU-456');
  });

  it('should return null for main branch', () => {
    expect(extractWUFromBranch('main')).toBeNull();
  });

  it('should return null for non-lane branch', () => {
    expect(extractWUFromBranch('feature/something')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(extractWUFromBranch(null)).toBeNull();
  });
});

describe('validateBranchName', () => {
  it('should validate lane branch format', () => {
    const result = validateBranchName('lane/operations/wu-123');
    expect(result.valid).toBe(true);
    expect(result.lane).toBe('operations');
    expect(result.wuid).toBe('WU-123');
  });

  it('should allow main branch', () => {
    const result = validateBranchName('main');
    expect(result.valid).toBe(true);
  });

  it('should reject non-lane branches', () => {
    const result = validateBranchName('feature/something');
    expect(result.valid).toBe(false);
    expect(result.error).toContain("doesn't follow lane");
  });
});

describe('extractWUFromCommitMessage', () => {
  it('should extract from wu(WU-123) format', () => {
    expect(extractWUFromCommitMessage('wu(WU-123): fix something')).toBe('WU-123');
  });

  it('should extract from chore(wu-456) format', () => {
    expect(extractWUFromCommitMessage('chore(wu-456): update docs')).toBe('WU-456');
  });

  it('should extract from feat(WU-789) format', () => {
    expect(extractWUFromCommitMessage('feat(WU-789): add feature')).toBe('WU-789');
  });

  it('should return null for no WU ID', () => {
    expect(extractWUFromCommitMessage('fix: random commit')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(extractWUFromCommitMessage(null)).toBeNull();
  });
});
