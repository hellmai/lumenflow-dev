#!/usr/bin/env node
/**
 * Tests for agent-friendly error messages with try-next hints
 *
 * WU-1339: Agent-friendly error messages and hints (AX3)
 * Uses Node's built-in test runner (node:test)
 *
 * Run: node --test tools/lib/__tests__/error-messages.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createAgentFriendlyError, ErrorCodes } from '../error-handler.mjs';

describe('createAgentFriendlyError', () => {
  it('creates error with tryNext command suggestions', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.WU_NOT_FOUND,
      'WU-1234 not found in docs/04-operations/tasks/wu/',
      {
        tryNext: ['pnpm wu:create --id WU-1234 --lane "Operations" --title "..."'],
        context: { wuId: 'WU-1234' },
      }
    );

    assert.strictEqual(error.code, ErrorCodes.WU_NOT_FOUND);
    assert.strictEqual(error.message, 'WU-1234 not found in docs/04-operations/tasks/wu/');
    assert.ok(Array.isArray(error.tryNext));
    assert.strictEqual(error.tryNext.length, 1);
    assert.strictEqual(
      error.tryNext[0],
      'pnpm wu:create --id WU-1234 --lane "Operations" --title "..."'
    );
    assert.deepStrictEqual(error.context, { wuId: 'WU-1234' });
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
      }
    );

    assert.strictEqual(error.tryNext.length, 2);
    assert.strictEqual(error.tryNext[0], 'pnpm wu:repair --id WU-1234 --deduplicate');
    assert.strictEqual(error.tryNext[1], 'Or manually edit docs/04-operations/tasks/backlog.md');
  });

  it('works without tryNext (backward compatible)', () => {
    const error = createAgentFriendlyError(ErrorCodes.INTERNAL_ERROR, 'Something went wrong', {
      context: { detail: 'stack trace here' },
    });

    assert.strictEqual(error.code, ErrorCodes.INTERNAL_ERROR);
    assert.strictEqual(error.message, 'Something went wrong');
    assert.strictEqual(error.tryNext, undefined);
  });

  it('preserves WUError properties', () => {
    const error = createAgentFriendlyError(ErrorCodes.GATES_FAILED, 'Gates failed', {
      tryNext: ['pnpm format', 'pnpm lint:fix'],
    });

    assert.ok(error instanceof Error);
    assert.strictEqual(error.name, 'WUError');
    assert.ok(error.stack);
  });
});

describe('Error message format consistency', () => {
  it('provides clear description for WU_NOT_FOUND', () => {
    const error = createAgentFriendlyError(ErrorCodes.WU_NOT_FOUND, 'WU-1234 not found', {
      tryNext: ['pnpm wu:create --id WU-1234 --lane "<lane>" --title "..."'],
    });

    assert.ok(error.message.includes('WU-1234'));
    assert.ok(error.tryNext[0].includes('pnpm wu:create'));
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
      }
    );

    assert.ok(error.message.includes('occupied'));
    assert.strictEqual(error.tryNext.length, 3);
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
      }
    );

    assert.ok(error.message.includes('both'));
    assert.ok(error.tryNext[0].includes('--deduplicate'));
  });

  it('provides clear description for GATES_FAILED', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.GATES_FAILED,
      'Gates failed: format check failed',
      {
        tryNext: ['pnpm format', 'pnpm gates'],
      }
    );

    assert.ok(error.message.includes('Gates failed'));
    assert.strictEqual(error.tryNext[0], 'pnpm format');
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
      }
    );

    assert.ok(error.message.includes('Working tree'));
    assert.strictEqual(error.tryNext.length, 3);
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
      }
    );

    assert.ok(error.context.missingFiles);
    assert.strictEqual(error.context.missingFiles.length, 1);
  });

  it('includes WU ID in context for all WU-related errors', () => {
    const error = createAgentFriendlyError(
      ErrorCodes.WU_ALREADY_CLAIMED,
      'WU-1234 is already claimed',
      {
        tryNext: ['Wait for owning agent to complete or coordinate handoff'],
        context: { wuId: 'WU-1234', branch: 'lane/operations/wu-1234' },
      }
    );

    assert.strictEqual(error.context.wuId, 'WU-1234');
    assert.strictEqual(error.context.branch, 'lane/operations/wu-1234');
  });

  it('includes section names for backlog validation errors', () => {
    const error = createAgentFriendlyError(ErrorCodes.VALIDATION_ERROR, 'Duplicate WU detected', {
      tryNext: ['Remove from Ready section'],
      context: { wuId: 'WU-1234', sections: ['ready', 'in_progress'] },
    });

    assert.deepStrictEqual(error.context.sections, ['ready', 'in_progress']);
  });
});
