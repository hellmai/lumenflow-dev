/**
 * @file claude-enforcement.test.ts
 * End-to-end tests for Claude Code enforcement hooks (WU-1367)
 *
 * These tests verify the full integration flow:
 * 1. Config schema parsing
 * 2. Hook generation via integrate command
 * 3. Hook script functionality
 */

// Test file lint exceptions
/* eslint-disable sonarjs/no-duplicate-string */
// Object injection is expected in tests accessing parsed config properties
/* eslint-disable security/detect-object-injection */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CLAUDE_CODE_CLIENT = 'claude-code';

describe('WU-1367: Claude Enforcement E2E', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-enforcement-'));

    // Create basic LumenFlow structure
    fs.mkdirSync(path.join(testDir, '.lumenflow'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Config Schema Integration', () => {
    it('should parse enforcement config from .lumenflow.config.yaml', async () => {
      const configPath = path.join(testDir, '.lumenflow.config.yaml');
      fs.writeFileSync(
        configPath,
        `
version: '2.0'
project: test
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
        require_wu_for_edits: false
        warn_on_stop_without_wu_done: true
`,
      );

      // Import and parse config
      const { parseConfig } = await import('@lumenflow/core/dist/lumenflow-config-schema.js');
      const yaml = await import('yaml');

      const content = fs.readFileSync(configPath, 'utf-8');
      const rawConfig = yaml.parse(content);
      const config = parseConfig(rawConfig);

      expect(config.agents.clients[CLAUDE_CODE_CLIENT]).toBeDefined();
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement).toBeDefined();
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.hooks).toBe(true);
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.block_outside_worktree).toBe(
        true,
      );
      expect(config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.require_wu_for_edits).toBe(
        false,
      );
      expect(
        config.agents.clients[CLAUDE_CODE_CLIENT].enforcement?.warn_on_stop_without_wu_done,
      ).toBe(true);
    });
  });

  describe('Hook Generation', () => {
    it('should generate hooks via integrateClaudeCode function', async () => {
      const { integrateClaudeCode } = await import('../src/commands/integrate.js');

      await integrateClaudeCode(testDir, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
          require_wu_for_edits: true,
          warn_on_stop_without_wu_done: true,
        },
      });

      // Check that hooks directory was created
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks'))).toBe(true);

      // Check that hook scripts were created
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh'))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'require-wu.sh'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'warn-incomplete.sh'))).toBe(
        true,
      );

      // Check that settings.json was updated
      const settingsPath = path.join(testDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
    });

    it('should generate executable hook scripts', async () => {
      const { integrateClaudeCode } = await import('../src/commands/integrate.js');

      await integrateClaudeCode(testDir, {
        enforcement: {
          hooks: true,
          block_outside_worktree: true,
        },
      });

      const hookPath = path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh');

      // Check file is executable
      const stat = fs.statSync(hookPath);
      const isExecutable = (stat.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);

      // Check script starts with shebang
      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    });
  });

  describe('Hook Sync Integration', () => {
    it('should sync hooks when called via syncEnforcementHooks', async () => {
      // Create config file
      const configPath = path.join(testDir, '.lumenflow.config.yaml');
      fs.writeFileSync(
        configPath,
        `
version: '2.0'
project: test
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
`,
      );

      const { syncEnforcementHooks } = await import('../src/hooks/enforcement-sync.js');

      const result = await syncEnforcementHooks(testDir);

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh'))).toBe(
        true,
      );
    });

    it('should skip sync when hooks disabled in config', async () => {
      const configPath = path.join(testDir, '.lumenflow.config.yaml');
      fs.writeFileSync(
        configPath,
        `
version: '2.0'
project: test
agents:
  clients:
    claude-code:
      enforcement:
        hooks: false
`,
      );

      const { syncEnforcementHooks } = await import('../src/hooks/enforcement-sync.js');

      const result = await syncEnforcementHooks(testDir);

      expect(result).toBe(false);
      expect(fs.existsSync(path.join(testDir, '.claude', 'hooks', 'enforce-worktree.sh'))).toBe(
        false,
      );
    });
  });

  describe('Graceful Degradation', () => {
    it('should allow operations when .lumenflow directory does not exist', async () => {
      // Remove .lumenflow directory
      fs.rmSync(path.join(testDir, '.lumenflow'), { recursive: true, force: true });

      const { checkWorktreeEnforcement } = await import('../src/hooks/enforcement-checks.js');

      // Set CLAUDE_PROJECT_DIR to test directory
      const originalEnv = process.env.CLAUDE_PROJECT_DIR;
      process.env.CLAUDE_PROJECT_DIR = testDir;

      try {
        const result = await checkWorktreeEnforcement({
          file_path: path.join(testDir, 'test.ts'),
          tool_name: 'Write',
        });

        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('graceful');
      } finally {
        process.env.CLAUDE_PROJECT_DIR = originalEnv;
      }
    });
  });
});
