/**
 * Dependency Guard Tests (WU-2539)
 *
 * Tests for detecting and blocking dependency-mutating pnpm commands.
 * Enforces worktree discipline for dependency changes.
 * Refactored to reduce cognitive complexity.
 */

import { describe, it, expect } from 'vitest';
import {
  isDependencyMutatingCommand,
  buildDependencyBlockMessage,
  DEPENDENCY_MUTATING_COMMANDS,
} from '../../src/guards/dependency-guard.js';

describe('Dependency Guard', () => {
  describe('isDependencyMutatingCommand', () => {
    describe('detects mutating commands', () => {
      it('detects pnpm add', () => {
        expect(isDependencyMutatingCommand('pnpm add react')).toBe(true);
      });

      it('detects pnpm add with flags', () => {
        expect(isDependencyMutatingCommand('pnpm add -D typescript')).toBe(true);
      });

      it('detects pnpm install', () => {
        expect(isDependencyMutatingCommand('pnpm install')).toBe(true);
      });

      it('detects pnpm i (shorthand)', () => {
        expect(isDependencyMutatingCommand('pnpm i')).toBe(true);
      });

      it('detects pnpm remove', () => {
        expect(isDependencyMutatingCommand('pnpm remove lodash')).toBe(true);
      });

      it('detects pnpm rm (shorthand)', () => {
        expect(isDependencyMutatingCommand('pnpm rm lodash')).toBe(true);
      });

      it('detects pnpm uninstall', () => {
        expect(isDependencyMutatingCommand('pnpm uninstall lodash')).toBe(true);
      });

      it('detects pnpm update', () => {
        expect(isDependencyMutatingCommand('pnpm update')).toBe(true);
      });

      it('detects pnpm up (shorthand)', () => {
        expect(isDependencyMutatingCommand('pnpm up')).toBe(true);
      });

      it('handles --filter flag', () => {
        expect(isDependencyMutatingCommand('pnpm --filter web add react')).toBe(true);
      });

      it('handles -F flag', () => {
        expect(isDependencyMutatingCommand('pnpm -F web add react')).toBe(true);
      });

      it('handles --filter=value format', () => {
        expect(isDependencyMutatingCommand('pnpm --filter=web add react')).toBe(true);
      });
    });

    describe('allows safe commands', () => {
      it('allows pnpm run', () => {
        expect(isDependencyMutatingCommand('pnpm run test')).toBe(false);
      });

      it('allows pnpm test', () => {
        expect(isDependencyMutatingCommand('pnpm test')).toBe(false);
      });

      it('allows pnpm lint', () => {
        expect(isDependencyMutatingCommand('pnpm lint')).toBe(false);
      });

      it('allows pnpm build', () => {
        expect(isDependencyMutatingCommand('pnpm build')).toBe(false);
      });

      it('allows pnpm exec', () => {
        expect(isDependencyMutatingCommand('pnpm exec tsc')).toBe(false);
      });

      it('allows pnpm dlx', () => {
        expect(isDependencyMutatingCommand('pnpm dlx create-next-app')).toBe(false);
      });
    });

    describe('ignores non-pnpm commands', () => {
      it('ignores npm commands', () => {
        expect(isDependencyMutatingCommand('npm install')).toBe(false);
      });

      it('ignores yarn commands', () => {
        expect(isDependencyMutatingCommand('yarn add react')).toBe(false);
      });

      it('ignores other commands', () => {
        expect(isDependencyMutatingCommand('git commit -m "test"')).toBe(false);
      });
    });

    describe('handles edge cases', () => {
      it('handles null', () => {
        expect(isDependencyMutatingCommand(null as unknown as string)).toBe(false);
      });

      it('handles undefined', () => {
        expect(isDependencyMutatingCommand(undefined as unknown as string)).toBe(false);
      });

      it('handles empty string', () => {
        expect(isDependencyMutatingCommand('')).toBe(false);
      });

      it('handles whitespace only', () => {
        expect(isDependencyMutatingCommand('   ')).toBe(false);
      });

      it('handles pnpm alone', () => {
        expect(isDependencyMutatingCommand('pnpm')).toBe(false);
      });
    });
  });

  describe('buildDependencyBlockMessage', () => {
    it('includes the blocked command', () => {
      const message = buildDependencyBlockMessage('pnpm add react');
      expect(message).toContain('pnpm add react');
    });

    it('includes BLOCKED indicator', () => {
      const message = buildDependencyBlockMessage('pnpm add react');
      expect(message).toContain('BLOCKED');
    });

    it('suggests deps:add for add commands', () => {
      const message = buildDependencyBlockMessage('pnpm add react');
      expect(message).toContain('deps:add');
    });

    it('suggests deps:remove for remove commands', () => {
      const message = buildDependencyBlockMessage('pnpm remove lodash');
      expect(message).toContain('deps:remove');
    });

    it('explains worktree isolation', () => {
      const message = buildDependencyBlockMessage('pnpm install');
      expect(message).toContain('worktree');
    });
  });

  describe('DEPENDENCY_MUTATING_COMMANDS constant', () => {
    it('includes all expected commands', () => {
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('add');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('install');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('i');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('remove');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('rm');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('uninstall');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('update');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('up');
    });
  });
});
