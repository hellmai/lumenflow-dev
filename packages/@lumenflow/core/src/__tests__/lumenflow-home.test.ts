/**
 * Tests for lumenflow-home.ts
 *
 * WU-1062: External plan storage and no-main-write mode
 *
 * Tests the $LUMENFLOW_HOME environment variable handling and plan directory resolution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock the module before importing
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(() => '/home/testuser'),
  };
});

// Import after mocking
import {
  getLumenflowHome,
  getPlansDir,
  isExternalPath,
  normalizeSpecRef,
} from '../lumenflow-home.js';

describe('lumenflow-home', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env.LUMENFLOW_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('getLumenflowHome', () => {
    it('should return $LUMENFLOW_HOME when set', () => {
      process.env.LUMENFLOW_HOME = '/custom/lumenflow/path';
      const result = getLumenflowHome();
      expect(result).toBe('/custom/lumenflow/path');
    });

    it('should return ~/.lumenflow when $LUMENFLOW_HOME not set', () => {
      const result = getLumenflowHome();
      expect(result).toBe('/home/testuser/.lumenflow');
    });

    it('should expand ~ in LUMENFLOW_HOME', () => {
      process.env.LUMENFLOW_HOME = '~/.custom-lumenflow';
      const result = getLumenflowHome();
      expect(result).toBe('/home/testuser/.custom-lumenflow');
    });

    it('should handle trailing slashes', () => {
      process.env.LUMENFLOW_HOME = '/custom/path/';
      const result = getLumenflowHome();
      expect(result).toBe('/custom/path');
    });
  });

  describe('getPlansDir', () => {
    it('should return plans directory under LUMENFLOW_HOME', () => {
      process.env.LUMENFLOW_HOME = '/custom/lumenflow';
      const result = getPlansDir();
      expect(result).toBe('/custom/lumenflow/plans');
    });

    it('should return plans directory under ~/.lumenflow by default', () => {
      const result = getPlansDir();
      expect(result).toBe('/home/testuser/.lumenflow/plans');
    });
  });

  describe('isExternalPath', () => {
    it('should return true for paths starting with ~/', () => {
      expect(isExternalPath('~/.lumenflow/plans/plan.md')).toBe(true);
    });

    it('should return true for paths starting with $LUMENFLOW_HOME', () => {
      expect(isExternalPath('$LUMENFLOW_HOME/plans/plan.md')).toBe(true);
    });

    it('should return true for lumenflow:// protocol', () => {
      expect(isExternalPath('lumenflow://plans/plan.md')).toBe(true);
    });

    it('should return true for absolute paths outside repo', () => {
      expect(isExternalPath('/home/user/.lumenflow/plans/plan.md')).toBe(true);
    });

    it('should return false for relative paths', () => {
      expect(isExternalPath('docs/04-operations/plans/plan.md')).toBe(false);
    });

    it('should return false for repo-relative paths', () => {
      expect(isExternalPath('./docs/plans/plan.md')).toBe(false);
    });
  });

  describe('normalizeSpecRef', () => {
    it('should expand lumenflow:// protocol to LUMENFLOW_HOME', () => {
      process.env.LUMENFLOW_HOME = '/custom/lumenflow';
      const result = normalizeSpecRef('lumenflow://plans/WU-1062-plan.md');
      expect(result).toBe('/custom/lumenflow/plans/WU-1062-plan.md');
    });

    it('should expand ~ to home directory', () => {
      const result = normalizeSpecRef('~/.lumenflow/plans/plan.md');
      expect(result).toBe('/home/testuser/.lumenflow/plans/plan.md');
    });

    it('should expand $LUMENFLOW_HOME', () => {
      process.env.LUMENFLOW_HOME = '/my/lumenflow';
      const result = normalizeSpecRef('$LUMENFLOW_HOME/plans/plan.md');
      expect(result).toBe('/my/lumenflow/plans/plan.md');
    });

    it('should return repo-relative paths unchanged', () => {
      const result = normalizeSpecRef('docs/04-operations/plans/plan.md');
      expect(result).toBe('docs/04-operations/plans/plan.md');
    });
  });
});
