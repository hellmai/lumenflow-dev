#!/usr/bin/env node
/**
 * Tests for deps-add and deps-remove CLI commands
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 * WU-1534: Harden CLI command execution surfaces
 *
 * These commands provide safe wrappers for pnpm add/remove that enforce
 * worktree discipline - dependencies can only be modified in worktrees,
 * not on the main checkout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import functions under test
import {
  parseDepsAddArgs,
  parseDepsRemoveArgs,
  validateWorktreeContext,
  buildPnpmAddCommand,
  buildPnpmRemoveCommand,
  validatePackageName,
  DepsAddArgs,
  DepsRemoveArgs,
} from '../deps-add.js';

describe('deps-add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseDepsAddArgs', () => {
    it('should parse package name from positional argument', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', 'react']);
      expect(args.packages).toEqual(['react']);
    });

    it('should parse multiple packages', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', 'react', 'react-dom', 'typescript']);
      expect(args.packages).toEqual(['react', 'react-dom', 'typescript']);
    });

    it('should parse --dev flag', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', 'vitest', '--dev']);
      expect(args.dev).toBe(true);
      expect(args.packages).toEqual(['vitest']);
    });

    it('should parse -D flag as dev dependency', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '-D', 'vitest']);
      expect(args.dev).toBe(true);
      expect(args.packages).toEqual(['vitest']);
    });

    it('should parse --filter flag', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '--filter', '@lumenflow/cli', 'chalk']);
      expect(args.filter).toBe('@lumenflow/cli');
      expect(args.packages).toEqual(['chalk']);
    });

    it('should parse --exact flag', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '--exact', 'react@18.2.0']);
      expect(args.exact).toBe(true);
    });

    it('should set help flag', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '--help']);
      expect(args.help).toBe(true);
    });

    it('should return empty packages array when no packages specified', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js']);
      expect(args.packages).toEqual([]);
    });
  });

  describe('validateWorktreeContext', () => {
    it('should return valid when cwd contains worktrees/', () => {
      const result = validateWorktreeContext('/opt/project/worktrees/framework-cli-wu-1112');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid when cwd is main checkout', () => {
      const result = validateWorktreeContext('/opt/project');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('main checkout');
    });

    it('should provide fix command when invalid', () => {
      const result = validateWorktreeContext('/opt/project');
      expect(result.fixCommand).toBeDefined();
      expect(result.fixCommand).toContain('wu:claim');
    });
  });

  describe('buildPnpmAddCommand (argv array)', () => {
    it('should return an argv array, not a string', () => {
      const args: DepsAddArgs = { packages: ['react'] };
      const cmd = buildPnpmAddCommand(args);
      expect(Array.isArray(cmd)).toBe(true);
    });

    it('should build basic add command as argv array', () => {
      const args: DepsAddArgs = { packages: ['react'] };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add', 'react']);
    });

    it('should add --save-dev for dev dependencies', () => {
      const args: DepsAddArgs = { packages: ['vitest'], dev: true };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add', '--save-dev', 'vitest']);
    });

    it('should add --filter for workspace packages', () => {
      const args: DepsAddArgs = { packages: ['chalk'], filter: '@lumenflow/cli' };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add', '--filter', '@lumenflow/cli', 'chalk']);
    });

    it('should add --save-exact for exact versions', () => {
      const args: DepsAddArgs = { packages: ['react@18.2.0'], exact: true };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add', '--save-exact', 'react@18.2.0']);
    });

    it('should combine multiple flags', () => {
      const args: DepsAddArgs = {
        packages: ['vitest'],
        dev: true,
        filter: '@lumenflow/cli',
        exact: true,
      };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toContain('--save-dev');
      expect(cmd).toContain('--filter');
      expect(cmd).toContain('@lumenflow/cli');
      expect(cmd).toContain('--save-exact');
      expect(cmd).toContain('vitest');
    });

    it('should handle multiple packages', () => {
      const args: DepsAddArgs = { packages: ['react', 'react-dom'] };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add', 'react', 'react-dom']);
    });
  });
});

describe('deps-remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseDepsRemoveArgs', () => {
    it('should parse package name from positional argument', () => {
      const args = parseDepsRemoveArgs(['node', 'deps-remove.js', 'lodash']);
      expect(args.packages).toEqual(['lodash']);
    });

    it('should parse multiple packages', () => {
      const args = parseDepsRemoveArgs(['node', 'deps-remove.js', 'lodash', 'moment']);
      expect(args.packages).toEqual(['lodash', 'moment']);
    });

    it('should parse --filter flag', () => {
      const args = parseDepsRemoveArgs([
        'node',
        'deps-remove.js',
        '--filter',
        '@lumenflow/core',
        'lodash',
      ]);
      expect(args.filter).toBe('@lumenflow/core');
      expect(args.packages).toEqual(['lodash']);
    });

    it('should set help flag', () => {
      const args = parseDepsRemoveArgs(['node', 'deps-remove.js', '--help']);
      expect(args.help).toBe(true);
    });
  });

  describe('buildPnpmRemoveCommand (argv array)', () => {
    it('should return an argv array, not a string', () => {
      const args: DepsRemoveArgs = { packages: ['lodash'] };
      const cmd = buildPnpmRemoveCommand(args);
      expect(Array.isArray(cmd)).toBe(true);
    });

    it('should build basic remove command as argv array', () => {
      const args: DepsRemoveArgs = { packages: ['lodash'] };
      const cmd = buildPnpmRemoveCommand(args);
      expect(cmd).toEqual(['remove', 'lodash']);
    });

    it('should add --filter for workspace packages', () => {
      const args: DepsRemoveArgs = { packages: ['lodash'], filter: '@lumenflow/core' };
      const cmd = buildPnpmRemoveCommand(args);
      expect(cmd).toEqual(['remove', '--filter', '@lumenflow/core', 'lodash']);
    });

    it('should handle multiple packages', () => {
      const args: DepsRemoveArgs = { packages: ['lodash', 'moment'] };
      const cmd = buildPnpmRemoveCommand(args);
      expect(cmd).toEqual(['remove', 'lodash', 'moment']);
    });

    it('should handle empty packages array', () => {
      const args: DepsRemoveArgs = { packages: [] };
      const cmd = buildPnpmRemoveCommand(args);
      expect(cmd).toEqual(['remove']);
    });
  });

  describe('parseDepsAddArgs edge cases', () => {
    it('should handle -h flag', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '-h']);
      expect(args.help).toBe(true);
    });

    it('should handle -E flag for exact', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '-E', 'react']);
      expect(args.exact).toBe(true);
    });

    it('should handle -F flag for filter', () => {
      const args = parseDepsAddArgs(['node', 'deps-add.js', '-F', '@lumenflow/cli', 'chalk']);
      expect(args.filter).toBe('@lumenflow/cli');
    });
  });

  describe('parseDepsRemoveArgs edge cases', () => {
    it('should handle -h flag', () => {
      const args = parseDepsRemoveArgs(['node', 'deps-remove.js', '-h']);
      expect(args.help).toBe(true);
    });

    it('should handle -F flag for filter', () => {
      const args = parseDepsRemoveArgs([
        'node',
        'deps-remove.js',
        '-F',
        '@lumenflow/cli',
        'lodash',
      ]);
      expect(args.filter).toBe('@lumenflow/cli');
    });
  });

  describe('buildPnpmAddCommand edge cases', () => {
    it('should handle empty packages array', () => {
      const args: DepsAddArgs = { packages: [] };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add']);
    });

    it('should handle undefined packages', () => {
      const args: DepsAddArgs = {};
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toEqual(['add']);
    });
  });
});

describe('WU-1534: injection prevention', () => {
  describe('validatePackageName', () => {
    it('should accept valid npm package names', () => {
      expect(validatePackageName('react')).toBe(true);
      expect(validatePackageName('react-dom')).toBe(true);
      expect(validatePackageName('@lumenflow/cli')).toBe(true);
      expect(validatePackageName('lodash.get')).toBe(true);
      expect(validatePackageName('react@18.2.0')).toBe(true);
      expect(validatePackageName('@types/node@^22.0.0')).toBe(true);
      expect(validatePackageName('my-pkg@~1.2.3')).toBe(true);
    });

    it('should reject package names with shell metacharacters', () => {
      expect(validatePackageName('react; rm -rf /')).toBe(false);
      expect(validatePackageName('react && echo pwned')).toBe(false);
      expect(validatePackageName('react | cat /etc/passwd')).toBe(false);
      expect(validatePackageName('$(whoami)')).toBe(false);
      expect(validatePackageName('`whoami`')).toBe(false);
      expect(validatePackageName('react\nmalicious')).toBe(false);
    });

    it('should reject package names with shell redirection', () => {
      expect(validatePackageName('react > /tmp/out')).toBe(false);
      expect(validatePackageName('react < /etc/passwd')).toBe(false);
    });

    it('should reject empty or whitespace-only names', () => {
      expect(validatePackageName('')).toBe(false);
      expect(validatePackageName('  ')).toBe(false);
    });
  });

  describe('buildPnpmAddCommand does not produce shell-injectable argv', () => {
    it('should keep malicious package names as single argv elements', () => {
      // Even if validation is bypassed, argv-based execution treats each
      // element as a literal argument, not shell syntax
      const args: DepsAddArgs = { packages: ['react; rm -rf /'] };
      const cmd = buildPnpmAddCommand(args);
      // The malicious string should be ONE element in the array, not split
      expect(cmd).toContain('react; rm -rf /');
      expect(cmd.length).toBe(2); // ['add', 'react; rm -rf /']
    });

    it('should keep $(command) as a literal argv element', () => {
      const args: DepsAddArgs = { packages: ['$(whoami)'] };
      const cmd = buildPnpmAddCommand(args);
      expect(cmd).toContain('$(whoami)');
      expect(cmd.length).toBe(2);
    });
  });

  describe('buildPnpmRemoveCommand does not produce shell-injectable argv', () => {
    it('should keep malicious package names as single argv elements', () => {
      const args: DepsRemoveArgs = { packages: ['lodash && echo pwned'] };
      const cmd = buildPnpmRemoveCommand(args);
      expect(cmd).toContain('lodash && echo pwned');
      expect(cmd.length).toBe(2); // ['remove', 'lodash && echo pwned']
    });
  });
});
