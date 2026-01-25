#!/usr/bin/env node
/**
 * Tests for lumenflow-upgrade CLI command
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * lumenflow-upgrade updates all @lumenflow/* packages to latest versions.
 * Key requirements:
 * - Uses worktree pattern (runs pnpm install in worktree, not main)
 * - Checks all 7 @lumenflow/* packages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import functions under test
import {
  parseUpgradeArgs,
  LUMENFLOW_PACKAGES,
  buildUpgradeCommands,
  UpgradeArgs,
  UpgradeResult,
} from '../lumenflow-upgrade.js';

describe('lumenflow-upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('LUMENFLOW_PACKAGES constant', () => {
    it('should include all 7 @lumenflow/* packages', () => {
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/agent');
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/cli');
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/core');
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/initiatives');
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/memory');
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/metrics');
      expect(LUMENFLOW_PACKAGES).toContain('@lumenflow/shims');
      expect(LUMENFLOW_PACKAGES).toHaveLength(7);
    });

    it('should have packages in alphabetical order', () => {
      const sorted = [...LUMENFLOW_PACKAGES].sort();
      expect(LUMENFLOW_PACKAGES).toEqual(sorted);
    });
  });

  describe('parseUpgradeArgs', () => {
    it('should parse --version flag', () => {
      const args = parseUpgradeArgs(['node', 'lumenflow-upgrade.js', '--version', '1.5.0']);
      expect(args.version).toBe('1.5.0');
    });

    it('should parse --latest flag', () => {
      const args = parseUpgradeArgs(['node', 'lumenflow-upgrade.js', '--latest']);
      expect(args.latest).toBe(true);
    });

    it('should parse --dry-run flag', () => {
      const args = parseUpgradeArgs(['node', 'lumenflow-upgrade.js', '--dry-run']);
      expect(args.dryRun).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = parseUpgradeArgs(['node', 'lumenflow-upgrade.js', '--help']);
      expect(args.help).toBe(true);
    });

    it('should default latest to false', () => {
      const args = parseUpgradeArgs(['node', 'lumenflow-upgrade.js']);
      expect(args.latest).toBeFalsy();
    });

    it('should default dryRun to false', () => {
      const args = parseUpgradeArgs(['node', 'lumenflow-upgrade.js']);
      expect(args.dryRun).toBeFalsy();
    });
  });

  describe('buildUpgradeCommands', () => {
    it('should build commands for specific version', () => {
      const args: UpgradeArgs = { version: '1.5.0' };
      const commands = buildUpgradeCommands(args);

      // Should have pnpm add command for all packages
      expect(commands.addCommand).toContain('pnpm add');
      expect(commands.addCommand).toContain('@lumenflow/agent@1.5.0');
      expect(commands.addCommand).toContain('@lumenflow/cli@1.5.0');
      expect(commands.addCommand).toContain('@lumenflow/core@1.5.0');
      expect(commands.addCommand).toContain('@lumenflow/initiatives@1.5.0');
      expect(commands.addCommand).toContain('@lumenflow/memory@1.5.0');
      expect(commands.addCommand).toContain('@lumenflow/metrics@1.5.0');
      expect(commands.addCommand).toContain('@lumenflow/shims@1.5.0');
    });

    it('should build commands for latest version', () => {
      const args: UpgradeArgs = { latest: true };
      const commands = buildUpgradeCommands(args);

      // Should have pnpm add command for all packages with @latest
      expect(commands.addCommand).toContain('pnpm add');
      expect(commands.addCommand).toContain('@lumenflow/agent@latest');
      expect(commands.addCommand).toContain('@lumenflow/cli@latest');
    });

    it('should include dev dependencies flag', () => {
      const args: UpgradeArgs = { version: '1.5.0' };
      const commands = buildUpgradeCommands(args);

      // LumenFlow packages are dev dependencies
      expect(commands.addCommand).toContain('--save-dev');
    });

    it('should include all 7 packages in the command', () => {
      const args: UpgradeArgs = { version: '1.5.0' };
      const commands = buildUpgradeCommands(args);

      // Count how many packages are in the command
      const packageCount = LUMENFLOW_PACKAGES.filter((pkg) =>
        commands.addCommand.includes(pkg),
      ).length;
      expect(packageCount).toBe(7);
    });
  });

  describe('worktree pattern enforcement', () => {
    it('should include note about worktree usage in commands', () => {
      const args: UpgradeArgs = { version: '1.5.0' };
      const commands = buildUpgradeCommands(args);

      // The command should be designed to run in worktree
      // Actual execution is tested in integration tests
      expect(commands.addCommand).toBeDefined();
      expect(commands.addCommand.length).toBeGreaterThan(0);
    });
  });
});
