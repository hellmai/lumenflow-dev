/**
 * @file wu-cleanup.test.ts
 * Test suite for wu:cleanup safety guards (WU-1056)
 */

import { describe, it, expect } from 'vitest';

import { WU_STATUS } from '@lumenflow/core/dist/wu-constants.js';

import { CLEANUP_GUARD_REASONS, evaluateCleanupGuards } from '../dist/wu-cleanup.js';

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
