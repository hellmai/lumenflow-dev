#!/usr/bin/env node
/**
 * Tests for agent-friendly error messages with try-next hints
 *
 * WU-1339: Agent-friendly error messages and hints (AX3)
 * Uses Node's built-in test runner (node:test)
 *
 * Run: node --test tools/lib/__tests__/error-messages.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgentFriendlyError, ErrorCodes } from '../error-handler.js';

describe('createAgentFriendlyError', () => {
  it('creates error with tryNext command suggestions', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.WU_NOT_FOUND,
      'WU-1234 not found in docs/04-operations/tasks/wu/',
      {
        tryNext: ['pnpm wu:create --id WU-1234 --lane "Operations" --title "..."'],
        context: { wuId: 'WU-1234' },
      },
    );

    expect(error.code).toBe(ErrorCodes.WU_NOT_FOUND);
    expect(error.message).toBe('WU-1234 not found in docs/04-operations/tasks/wu/');
    expect(Array.isArray(error.tryNext)).toBeTruthy();
    expect(error.tryNext.length).toBe(1);
    assert.strictEqual(
      error.tryNext[0],
      'pnpm wu:create --id WU-1234 --lane "Operations" --title "..."',
    );
    expect(error.context).toEqual({ wuId: 'WU-1234' });
  });

  it('supports multiple tryNext suggestions', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.VALIDATION_ERROR,
      'WU-1234 appears in multiple backlog sections',
      {
        tryNext: [
          'pnpm wu:repair --id WU-1234 --deduplicate',
          'Or manually edit docs/04-operations/tasks/backlog.md',
        ],
        context: { wuId: 'WU-1234', sections: ['ready', 'in_progress'] },
      },
    );

    expect(error.tryNext.length).toBe(2);
    expect(error.tryNext[0]).toBe('pnpm wu:repair --id WU-1234 --deduplicate');
    expect(error.tryNext[1]).toBe('Or manually edit docs/04-operations/tasks/backlog.md');
  });

  it('works without tryNext (backward compatible)', () => {
    const error = createAgentFriendlyError(ErrorCodes.INTERNAL_ERROR, 'Something went wrong', {
      context: { detail: 'stack trace here' },
    });

    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.message).toBe('Something went wrong');
    expect(error.tryNext).toBe(undefined);
  });

  it('preserves WUError properties', () => {
    const error = createAgentFriendlyError(ErrorCodes.GATES_FAILED, 'Gates failed', {
      tryNext: ['pnpm format', 'pnpm lint:fix'],
    });

    expect(error instanceof Error).toBeTruthy();
    expect(error.name).toBe('WUError');
    expect(error.stack).toBeTruthy();
  });
});

describe('Error message format consistency', () => {
  it('provides clear description for WU_NOT_FOUND', () => {
    const error = createAgentFriendlyError(ErrorCodes.WU_NOT_FOUND, 'WU-1234 not found', {
      tryNext: ['pnpm wu:create --id WU-1234 --lane "<lane>" --title "..."'],
    });

    expect(error.message.includes('WU-1234')).toBe(true);
    expect(error.tryNext[0].includes('pnpm wu:create')).toBe(true);
  });

  it('provides clear description for LANE_OCCUPIED', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.INVALID_LANE,
      'Lane "Operations: Tooling" is already occupied by WU-1200',
      {
        tryNext: [
          'Wait for WU-1200 to complete or block',
          'Choose a different lane',
          'Use --force to override (P0 emergencies only)',
        ],
        context: { lane: 'Operations: Tooling', occupiedBy: 'WU-1200' },
      },
    );

    expect(error.message.includes('occupied')).toBe(true);
    expect(error.tryNext.length).toBe(3);
  });

  it('provides clear description for VALIDATION_ERROR (duplicate WU)', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.VALIDATION_ERROR,
      'WU-1234 appears in both Ready and In Progress sections',
      {
        tryNext: [
          'pnpm wu:repair --id WU-1234 --deduplicate',
          'Or manually edit docs/04-operations/tasks/backlog.md',
        ],
      },
    );

    expect(error.message.includes('both')).toBe(true);
    expect(error.tryNext[0].includes('--deduplicate')).toBe(true);
  });

  it('provides clear description for GATES_FAILED', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.GATES_FAILED,
      'Gates failed: format check failed',
      {
        tryNext: ['pnpm format', 'pnpm gates'],
      },
    );

    expect(error.message.includes('Gates failed')).toBe(true);
    expect(error.tryNext[0]).toBe('pnpm format');
  });

  it('provides clear description for GIT_ERROR (dirty working tree)', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.GIT_ERROR,
      'Working tree is not clean. Commit or stash changes before claiming.',
      {
        tryNext: [
          'git add . && git commit -m "..."',
          'git stash',
          'Use --no-auto if you already staged claim edits manually',
        ],
      },
    );

    expect(error.message.includes('Working tree')).toBe(true);
    expect(error.tryNext.length).toBe(3);
  });
});

describe('Error context information', () => {
  it('includes file paths in context for FILE_NOT_FOUND', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.FILE_NOT_FOUND,
      'Required metadata files missing: Status: docs/04-operations/tasks/status.md',
      {
        tryNext: ['Verify worktree has latest metadata files'],
        context: { missingFiles: ['Status: docs/04-operations/tasks/status.md'] },
      },
    );

    expect(error.context.missingFiles).toBeTruthy();
    expect(error.context.missingFiles.length).toBe(1);
  });

  it('includes WU ID in context for all WU-related errors', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.WU_ALREADY_CLAIMED,
      'WU-1234 is already claimed',
      {
        tryNext: ['Wait for owning agent to complete or coordinate handoff'],
        context: { wuId: 'WU-1234', branch: 'lane/operations/wu-1234' },
      },
    );

    expect(error.context.wuId).toBe('WU-1234');
    expect(error.context.branch).toBe('lane/operations/wu-1234');
  });

  it('includes section names for backlog validation errors', () => {
    const error = createAgentFriendlyError(ErrorCodes.VALIDATION_ERROR, 'Duplicate WU detected', {
      tryNext: ['Remove from Ready section'],
      context: { wuId: 'WU-1234', sections: ['ready', 'in_progress'] },
    });

    expect(error.context.sections).toEqual(['ready', 'in_progress']);
  });
});
