/**
 * @file wu-cleanup.test.ts
 * Test suite for wu:cleanup safety guards (WU-1056)
 * WU-1141: Added tests for PR merge verification with state=all parameter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before any imports that use it
// The mock must be hoisted (vi.mock is automatically hoisted)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock gh CLI availability check
vi.mock('@lumenflow/core/wu-done-pr', () => ({
  isGhCliAvailable: vi.fn(() => true),
}));

import { execSync } from 'node:child_process';
import { WU_STATUS } from '@lumenflow/core/wu-constants';
import {
  CLEANUP_GUARD_REASONS,
  evaluateCleanupGuards,
  verifyPRMerged,
} from '../dist/wu-cleanup.js';
import { isGhCliAvailable } from '@lumenflow/core/wu-done-pr';

// Cast mocks for TypeScript
const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockIsGhCliAvailable = isGhCliAvailable as ReturnType<typeof vi.fn>;

describe('wu:cleanup safety guards (WU-1056)', () => {
  it('blocks when worktree has uncommitted changes', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: true,
      hasUnpushedCommits: false,
      hasStamp: true,
      yamlStatus: WU_STATUS.DONE,
      ghAvailable: false,
      prMerged: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CLEANUP_GUARD_REASONS.UNCOMMITTED_CHANGES);
  });

  it('blocks when worktree has unpushed commits', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: false,
      hasUnpushedCommits: true,
      hasStamp: true,
      yamlStatus: WU_STATUS.DONE,
      ghAvailable: false,
      prMerged: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CLEANUP_GUARD_REASONS.UNPUSHED_COMMITS);
  });

  it('blocks when YAML status is not done', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      hasStamp: true,
      yamlStatus: WU_STATUS.IN_PROGRESS,
      ghAvailable: false,
      prMerged: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CLEANUP_GUARD_REASONS.STATUS_NOT_DONE);
  });

  it('blocks when stamp is missing', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      hasStamp: false,
      yamlStatus: WU_STATUS.DONE,
      ghAvailable: false,
      prMerged: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CLEANUP_GUARD_REASONS.MISSING_STAMP);
  });

  it('blocks when gh is available but PR is not merged', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      hasStamp: true,
      yamlStatus: WU_STATUS.DONE,
      ghAvailable: true,
      prMerged: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(CLEANUP_GUARD_REASONS.PR_NOT_MERGED);
  });

  it('allows cleanup when all guards pass and gh unavailable', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      hasStamp: true,
      yamlStatus: WU_STATUS.DONE,
      ghAvailable: false,
      prMerged: null,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe(null);
  });

  it('allows cleanup when gh available and PR merged', () => {
    const result = evaluateCleanupGuards({
      hasUncommittedChanges: false,
      hasUnpushedCommits: false,
      hasStamp: true,
      yamlStatus: WU_STATUS.DONE,
      ghAvailable: true,
      prMerged: true,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe(null);
  });
});

describe('verifyPRMerged (WU-1141)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGhCliAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('detects merged PRs via gh api with state=all parameter', async () => {
    // Simulate GitHub API response for a merged PR
    mockExecSync.mockReturnValue('true\n');

    const result = await verifyPRMerged('lane/framework-cli/wu-1141');

    expect(result.merged).toBe(true);
    expect(result.method).toBe('gh_api');

    // Verify the API call includes state=all to find closed/merged PRs
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('state=all'),
      expect.any(Object),
    );
  });

  it('returns merged=false for open (not yet merged) PRs', async () => {
    // Simulate GitHub API response for an open PR
    mockExecSync.mockReturnValue('false\n');

    const result = await verifyPRMerged('lane/framework-cli/wu-1141');

    expect(result.merged).toBe(false);
    expect(result.method).toBe('gh_api');
  });

  it('returns merged=null when no PR is found for branch', async () => {
    // Simulate empty response (no PR found)
    mockExecSync.mockReturnValue('');

    const result = await verifyPRMerged('lane/framework-cli/wu-1141');

    expect(result.merged).toBe(null);
    expect(result.method).toBe('gh_api');
  });

  it('handles gh api errors gracefully', async () => {
    // Simulate gh api failure
    mockExecSync.mockImplementation(() => {
      throw new Error('gh api failed');
    });

    const result = await verifyPRMerged('lane/framework-cli/wu-1141');

    expect(result.merged).toBe(null);
    expect(result.method).toBe('gh_api');
  });

  it('returns gh_unavailable when gh CLI is not available', async () => {
    mockIsGhCliAvailable.mockReturnValue(false);

    const result = await verifyPRMerged('lane/framework-cli/wu-1141');

    expect(result.merged).toBe(null);
    expect(result.method).toBe('gh_unavailable');
    // Should not call execSync when gh is unavailable
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
