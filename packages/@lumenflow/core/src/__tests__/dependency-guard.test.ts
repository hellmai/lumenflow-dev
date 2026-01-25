/**
 * Tests for dependency-guard module
 *
 * WU-1104: Port tests from ExampleApp to Vitest
 *
 * Tests detection of dependency-mutating pnpm commands.
 * @see {@link ../dependency-guard.ts}
 */

import { describe, it, expect } from 'vitest';
import {
  DEPENDENCY_MUTATING_COMMANDS,
  isDependencyMutatingCommand,
  buildDependencyBlockMessage,
  DEPS_LOG_PREFIX,
} from '../dependency-guard.js';

describe('dependency-guard', () => {
  describe('DEPENDENCY_MUTATING_COMMANDS', () => {
    it('should include add command', () => {
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('add');
    });

    it('should include install command and shorthand', () => {
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('install');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('i');
    });

    it('should include remove commands and aliases', () => {
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('remove');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('rm');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('uninstall');
    });

    it('should include update command and shorthand', () => {
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('update');
      expect(DEPENDENCY_MUTATING_COMMANDS).toContain('up');
    });
  });

  describe('isDependencyMutatingCommand', () => {
    describe('null/undefined/empty handling', () => {
      it('should return false for null', () => {
        expect(isDependencyMutatingCommand(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isDependencyMutatingCommand(undefined)).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isDependencyMutatingCommand('')).toBe(false);
      });

      it('should return false for whitespace only', () => {
        expect(isDependencyMutatingCommand('   ')).toBe(false);
      });
    });

    describe('non-pnpm commands', () => {
      it('should return false for npm commands', () => {
        expect(isDependencyMutatingCommand('npm install')).toBe(false);
        expect(isDependencyMutatingCommand('npm add react')).toBe(false);
      });

      it('should return false for yarn commands', () => {
        expect(isDependencyMutatingCommand('yarn add react')).toBe(false);
        expect(isDependencyMutatingCommand('yarn install')).toBe(false);
      });

      it('should return false for other commands', () => {
        expect(isDependencyMutatingCommand('git add .')).toBe(false);
        expect(isDependencyMutatingCommand('ls -la')).toBe(false);
      });

      it('should return false for just pnpm without subcommand', () => {
        expect(isDependencyMutatingCommand('pnpm')).toBe(false);
      });
    });

    describe('non-mutating pnpm commands', () => {
      it('should return false for pnpm run', () => {
        expect(isDependencyMutatingCommand('pnpm run test')).toBe(false);
        expect(isDependencyMutatingCommand('pnpm run build')).toBe(false);
      });

      it('should return false for pnpm exec', () => {
        expect(isDependencyMutatingCommand('pnpm exec vitest')).toBe(false);
      });

      it('should return false for pnpm list', () => {
        expect(isDependencyMutatingCommand('pnpm list')).toBe(false);
        expect(isDependencyMutatingCommand('pnpm ls')).toBe(false);
      });

      it('should return false for pnpm dlx', () => {
        expect(isDependencyMutatingCommand('pnpm dlx create-react-app')).toBe(false);
      });

      it('should return false for pnpm test', () => {
        expect(isDependencyMutatingCommand('pnpm test')).toBe(false);
      });
    });

    describe('mutating pnpm commands', () => {
      it('should detect pnpm add', () => {
        expect(isDependencyMutatingCommand('pnpm add react')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm add react vue')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm add -D typescript')).toBe(true);
      });

      it('should detect pnpm install', () => {
        expect(isDependencyMutatingCommand('pnpm install')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm i')).toBe(true);
      });

      it('should detect pnpm remove', () => {
        expect(isDependencyMutatingCommand('pnpm remove react')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm rm react')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm uninstall react')).toBe(true);
      });

      it('should detect pnpm update', () => {
        expect(isDependencyMutatingCommand('pnpm update')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm up')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm update react')).toBe(true);
      });
    });

    describe('commands with flags', () => {
      it('should handle --filter flag', () => {
        expect(isDependencyMutatingCommand('pnpm --filter web add react')).toBe(true);
        expect(isDependencyMutatingCommand('pnpm -F web add react')).toBe(true);
      });

      it('should handle --filter=value format', () => {
        expect(isDependencyMutatingCommand('pnpm --filter=web add react')).toBe(true);
      });

      it('should handle -D flag', () => {
        expect(isDependencyMutatingCommand('pnpm add -D typescript')).toBe(true);
      });

      it('should handle multiple flags', () => {
        expect(isDependencyMutatingCommand('pnpm --filter web --workspace-root add react')).toBe(
          true,
        );
      });
    });

    describe('edge cases', () => {
      it('should handle extra whitespace', () => {
        expect(isDependencyMutatingCommand('  pnpm   add   react  ')).toBe(true);
      });

      it('should handle commands with package names containing add/install', () => {
        // The subcommand is 'run', not 'add'
        expect(isDependencyMutatingCommand('pnpm run add-user')).toBe(false);
      });
    });
  });

  describe('buildDependencyBlockMessage', () => {
    it('should include blocked emoji and title', () => {
      const message = buildDependencyBlockMessage('pnpm add react');

      expect(message).toContain('BLOCKED');
      expect(message).toContain('Dependency mutation on main checkout');
    });

    it('should include the original command', () => {
      const message = buildDependencyBlockMessage('pnpm add react');

      expect(message).toContain('Command: pnpm add react');
    });

    it('should recommend deps:add for add command', () => {
      const message = buildDependencyBlockMessage('pnpm add react');

      expect(message).toContain('pnpm deps:add');
    });

    it('should recommend deps:add for install command', () => {
      const message = buildDependencyBlockMessage('pnpm install');

      expect(message).toContain('pnpm deps:add');
    });

    it('should recommend deps:add for i shorthand', () => {
      const message = buildDependencyBlockMessage('pnpm i');

      expect(message).toContain('pnpm deps:add');
    });

    it('should recommend deps:remove for remove command', () => {
      const message = buildDependencyBlockMessage('pnpm remove react');

      expect(message).toContain('pnpm deps:remove');
    });

    it('should recommend deps:remove for rm command', () => {
      const message = buildDependencyBlockMessage('pnpm rm react');

      expect(message).toContain('pnpm deps:remove');
    });

    it('should recommend deps:remove for uninstall command', () => {
      const message = buildDependencyBlockMessage('pnpm uninstall react');

      expect(message).toContain('pnpm deps:remove');
    });

    it('should include fix instructions', () => {
      const message = buildDependencyBlockMessage('pnpm add react');

      expect(message).toContain('TO FIX:');
      expect(message).toContain('pnpm wu:claim');
      expect(message).toContain('worktrees/');
    });

    it('should include documentation references', () => {
      const message = buildDependencyBlockMessage('pnpm add react');

      expect(message).toContain('CLAUDE.md');
      expect(message).toContain('lumenflow-complete.md');
    });

    it('should explain consequences of running on main', () => {
      const message = buildDependencyBlockMessage('pnpm add react');

      expect(message).toContain('lockfile');
      expect(message).toContain('virtual-store');
      expect(message).toContain('wu:done');
    });
  });

  describe('DEPS_LOG_PREFIX', () => {
    it('should be defined', () => {
      expect(DEPS_LOG_PREFIX).toBe('[deps-guard]');
    });
  });
});
