/**
 * @file commands.test.ts
 * Tests for lumenflow commands discovery feature (WU-1378)
 * Extended for public CLI manifest alignment (WU-1432)
 *
 * Tests the commands subcommand that lists all available CLI commands
 * grouped by category with brief descriptions. Also verifies alignment
 * between public-manifest.ts, commands.ts, and package.json bin entries.
 */

import { describe, it, expect } from 'vitest';
import { getCommandsRegistry, formatCommandsOutput, type CommandCategory } from '../commands.js';
import {
  getPublicManifest,
  getPublicCommandNames,
  getPublicBinNames,
  isPublicCommand,
  type PublicCommand,
} from '../public-manifest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '../../package.json');

// Script commands that are NOT CLI binaries (pnpm scripts only)
// These appear in the registry but should NOT be in the manifest
const SCRIPT_COMMANDS = new Set(['format', 'lint', 'typecheck', 'test', 'setup', 'strict:progress']);

describe('lumenflow commands', () => {
  describe('getCommandsRegistry', () => {
    it('should return command categories', () => {
      const registry = getCommandsRegistry();

      expect(registry).toBeDefined();
      expect(Array.isArray(registry)).toBe(true);
      expect(registry.length).toBeGreaterThan(0);
    });

    it('should include WU Lifecycle category with key commands', () => {
      const registry = getCommandsRegistry();
      const wuLifecycle = registry.find((cat: CommandCategory) => cat.name === 'WU Lifecycle');

      expect(wuLifecycle).toBeDefined();
      expect(wuLifecycle!.commands).toBeDefined();

      const commandNames = wuLifecycle!.commands.map((cmd) => cmd.name);
      expect(commandNames).toContain('wu:create');
      expect(commandNames).toContain('wu:claim');
    });

    it('should include Initiatives category', () => {
      const registry = getCommandsRegistry();
      const initiatives = registry.find((cat: CommandCategory) => cat.name === 'Initiatives');

      expect(initiatives).toBeDefined();
      expect(initiatives!.commands.some((cmd) => cmd.name === 'initiative:create')).toBe(true);
    });

    it('should include Gates & Quality category with gates command', () => {
      const registry = getCommandsRegistry();
      const gatesCategory = registry.find((cat: CommandCategory) => cat.name === 'Gates & Quality');

      expect(gatesCategory).toBeDefined();
      expect(gatesCategory!.commands.some((cmd) => cmd.name === 'gates')).toBe(true);
    });

    it('should have description for each command', () => {
      const registry = getCommandsRegistry();

      for (const category of registry) {
        for (const cmd of category.commands) {
          expect(cmd.description).toBeDefined();
          expect(cmd.description.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('formatCommandsOutput', () => {
    it('should include category headers', () => {
      const output = formatCommandsOutput();

      expect(output).toContain('WU Lifecycle');
      expect(output).toContain('Initiatives');
      expect(output).toContain('Gates & Quality');
    });

    it('should include command names and descriptions', () => {
      const output = formatCommandsOutput();

      expect(output).toContain('wu:create');
      expect(output).toContain('wu:claim');
      expect(output).toContain('initiative:create');
      expect(output).toContain('gates');
    });

    it('should include hint to run --help for details', () => {
      const output = formatCommandsOutput();

      expect(output).toMatch(/--help/i);
    });

    it('should format output with clear grouping', () => {
      const output = formatCommandsOutput();
      const lines = output.split('\n');

      // Should have multiple non-empty lines
      const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
      expect(nonEmptyLines.length).toBeGreaterThan(10);
    });
  });
});

// ============================================================================
// WU-1432: Public CLI Manifest Tests
// ============================================================================

describe('public CLI manifest (WU-1432)', () => {
  describe('getPublicManifest', () => {
    it('should return an array of public commands', () => {
      const manifest = getPublicManifest();

      expect(manifest).toBeDefined();
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBeGreaterThan(0);
    });

    it('should have required fields for each command', () => {
      const manifest = getPublicManifest();

      for (const cmd of manifest) {
        expect(cmd.name).toBeDefined();
        expect(typeof cmd.name).toBe('string');
        expect(cmd.name.length).toBeGreaterThan(0);

        expect(cmd.binName).toBeDefined();
        expect(typeof cmd.binName).toBe('string');
        expect(cmd.binName.length).toBeGreaterThan(0);

        expect(cmd.description).toBeDefined();
        expect(typeof cmd.description).toBe('string');
        expect(cmd.description.length).toBeGreaterThan(0);

        expect(cmd.category).toBeDefined();
        expect(typeof cmd.category).toBe('string');
        expect(cmd.category.length).toBeGreaterThan(0);
      }
    });

    it('should include core public commands', () => {
      const names = getPublicCommandNames();

      // WU lifecycle - must be public
      expect(names).toContain('wu:create');
      expect(names).toContain('wu:claim');
      expect(names).toContain('wu:done');
      expect(names).toContain('wu:prep');
      expect(names).toContain('wu:status');

      // Gates - must be public
      expect(names).toContain('gates');
      expect(names).toContain('lumenflow');

      // Memory - must be public
      expect(names).toContain('mem:checkpoint');
      expect(names).toContain('mem:inbox');

      // Initiatives - must be public
      expect(names).toContain('initiative:create');
      expect(names).toContain('initiative:status');
    });

    it('should NOT include internal/maintainer commands', () => {
      const names = getPublicCommandNames();

      // Guards are internal
      expect(names).not.toContain('guard-worktree-commit');
      expect(names).not.toContain('guard-locked');
      expect(names).not.toContain('guard-main-branch');

      // Validation internals
      expect(names).not.toContain('validate-agent-skills');
      expect(names).not.toContain('validate-agent-sync');
      expect(names).not.toContain('validate-backlog-sync');
      expect(names).not.toContain('validate-skills-spec');

      // Session internals
      expect(names).not.toContain('session-coordinator');
      expect(names).not.toContain('rotate-progress');

      // Trace/debug internals
      expect(names).not.toContain('trace-gen');
    });
  });

  describe('isPublicCommand', () => {
    it('should return true for public commands', () => {
      expect(isPublicCommand('wu:create')).toBe(true);
      expect(isPublicCommand('wu:claim')).toBe(true);
      expect(isPublicCommand('gates')).toBe(true);
      expect(isPublicCommand('lumenflow')).toBe(true);
    });

    it('should return false for internal commands', () => {
      expect(isPublicCommand('guard-worktree-commit')).toBe(false);
      expect(isPublicCommand('validate-agent-skills')).toBe(false);
      expect(isPublicCommand('session-coordinator')).toBe(false);
    });
  });
});

describe('manifest alignment (WU-1432)', () => {
  describe('commands.ts derives from manifest', () => {
    it('should have all CLI registry commands in the public manifest (excluding script commands)', () => {
      const registry = getCommandsRegistry();
      const publicNames = new Set(getPublicCommandNames());

      const registryNames: string[] = [];
      for (const category of registry) {
        for (const cmd of category.commands) {
          // Skip script commands - they're not CLI binaries
          if (!SCRIPT_COMMANDS.has(cmd.name)) {
            registryNames.push(cmd.name);
          }
        }
      }

      // Every CLI command in the registry must be a public command
      for (const name of registryNames) {
        expect(
          publicNames.has(name),
          `Command "${name}" in registry but not in public manifest`,
        ).toBe(true);
      }
    });

    it('should have matching descriptions between manifest and registry', () => {
      const manifest = getPublicManifest();
      const registry = getCommandsRegistry();

      // Build a map of registry descriptions
      const registryDescriptions = new Map<string, string>();
      for (const category of registry) {
        for (const cmd of category.commands) {
          registryDescriptions.set(cmd.name, cmd.description);
        }
      }

      // For commands that appear in both, descriptions should match
      for (const cmd of manifest) {
        const registryDesc = registryDescriptions.get(cmd.name);
        if (registryDesc) {
          expect(cmd.description, `Description mismatch for "${cmd.name}"`).toBe(registryDesc);
        }
      }
    });

    it('should have matching categories between manifest and registry', () => {
      const manifest = getPublicManifest();
      const registry = getCommandsRegistry();

      // Build a map of registry categories
      const registryCategories = new Map<string, string>();
      for (const category of registry) {
        for (const cmd of category.commands) {
          registryCategories.set(cmd.name, category.name);
        }
      }

      // For commands that appear in both, categories should match
      for (const cmd of manifest) {
        const registryCategory = registryCategories.get(cmd.name);
        if (registryCategory) {
          expect(cmd.category, `Category mismatch for "${cmd.name}"`).toBe(registryCategory);
        }
      }
    });
  });

  describe('package.json bin alignment', () => {
    it('should only include public commands in bin', () => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const binEntries = Object.keys(packageJson.bin || {});
      const publicBinNames = new Set(getPublicBinNames());

      // Every bin entry should be in the public manifest
      for (const binName of binEntries) {
        expect(
          publicBinNames.has(binName),
          `Bin "${binName}" is in package.json but not in public manifest - should it be internal?`,
        ).toBe(true);
      }
    });

    it('should have all public commands in bin', () => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const binEntries = new Set(Object.keys(packageJson.bin || {}));
      const publicManifest = getPublicManifest();

      // Every public manifest command should have a bin entry
      for (const cmd of publicManifest) {
        expect(
          binEntries.has(cmd.binName),
          `Public command "${cmd.name}" (bin: ${cmd.binName}) missing from package.json bin`,
        ).toBe(true);
      }
    });

    it('should have correct file paths in bin', () => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const publicManifest = getPublicManifest();

      for (const cmd of publicManifest) {
        const binPath = packageJson.bin?.[cmd.binName];
        expect(binPath, `Missing bin path for ${cmd.binName}`).toBeDefined();
        expect(binPath, `Bin path for ${cmd.binName} should start with ./dist/`).toMatch(
          /^\.\/dist\//,
        );
        expect(binPath, `Bin path for ${cmd.binName} should end with .js`).toMatch(/\.js$/);
      }
    });

    it('should not include internal commands in bin', () => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const binEntries = Object.keys(packageJson.bin || {});

      // These internal commands should NOT be in bin
      const internalCommands = [
        'guard-worktree-commit',
        'guard-locked',
        'guard-main-branch',
        'validate-agent-skills',
        'validate-agent-sync',
        'validate-backlog-sync',
        'validate-skills-spec',
        'session-coordinator',
        'rotate-progress',
        'trace-gen',
      ];

      for (const internalCmd of internalCommands) {
        expect(
          binEntries.includes(internalCmd),
          `Internal command "${internalCmd}" should NOT be in package.json bin`,
        ).toBe(false);
      }
    });
  });
});
