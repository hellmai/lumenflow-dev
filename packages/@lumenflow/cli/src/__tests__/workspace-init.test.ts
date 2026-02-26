// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for workspace:init command (WU-1871)
 *
 * Acceptance criteria:
 * 1. workspace:init command prompts 5 questions interactively
 *    (project type, lanes, sandbox profile, denied paths, cloud connect)
 * 2. --yes flag accepts all defaults non-interactively and generates
 *    workspace.yaml without prompts
 * 3. Generated workspace.yaml validates against WorkspaceSpecSchema
 * 4. Generated file includes helpful YAML comments explaining each section
 * 5. Uses existing init-scaffolding.ts template infrastructure
 *    (processTemplate, createFile)
 *
 * TDD: These tests are written BEFORE the implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { WorkspaceSpecSchema } from '@lumenflow/kernel';

// We will import these from workspace-init.ts once implemented
// For TDD, tests are written first, implementation follows

describe('workspace:init command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `workspace-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getDefaultWorkspaceConfig', () => {
    it('should return a valid default configuration', async () => {
      const { getDefaultWorkspaceConfig } = await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();

      expect(config).toBeDefined();
      expect(config.id).toBe('default');
      expect(config.name).toBe('My Project');
      expect(config.lanes).toHaveLength(1);
      expect(config.lanes[0].id).toBe('default');
      expect(config.lanes[0].title).toBe('Default');
      expect(config.security).toBeDefined();
      expect(config.security.network_default).toBe('off');
      expect(config.security.deny_overlays).toEqual(['~/.ssh', '~/.aws', '~/.gnupg', '.env']);
      expect(config.memory_namespace).toBe('default');
      expect(config.event_namespace).toBe('default');
    });

    it('should pin software-delivery pack by default (WU-2193)', async () => {
      const { getDefaultWorkspaceConfig } = await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();

      expect(config.packs).toHaveLength(1);
      const sdPin = config.packs[0];
      expect(sdPin.id).toBe('software-delivery');
      expect(sdPin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(sdPin.integrity).toBe('dev');
      expect(sdPin.source).toBe('local');
    });

    it('should have consistent pack pin and software_delivery config (WU-2193)', async () => {
      const { getDefaultWorkspaceConfig } = await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();

      // If software_delivery config exists, the pack must be pinned
      const hasSdConfig = config.software_delivery !== undefined;
      const hasSdPack = config.packs.some((p) => p.id === 'software-delivery');
      expect(hasSdConfig).toBe(true);
      expect(hasSdPack).toBe(true);
    });

    it('should produce config that validates against WorkspaceSpecSchema', async () => {
      const { getDefaultWorkspaceConfig } = await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();
      const result = WorkspaceSpecSchema.safeParse(config);

      expect(result.success).toBe(true);
    });
  });

  describe('buildWorkspaceConfig', () => {
    it('should build config from user answers', async () => {
      const { buildWorkspaceConfig } = await import('../workspace-init.js');

      const config = buildWorkspaceConfig({
        projectName: 'acme-app',
        lanes: ['Backend', 'Frontend'],
        sandboxProfile: 'full',
        deniedPaths: ['~/.ssh', '~/.aws', '.env'],
        cloudConnect: true,
      });

      expect(config.id).toBe('acme-app');
      expect(config.name).toBe('acme-app');
      expect(config.lanes).toHaveLength(2);
      expect(config.lanes[0].id).toBe('backend');
      expect(config.lanes[0].title).toBe('Backend');
      expect(config.lanes[1].id).toBe('frontend');
      expect(config.lanes[1].title).toBe('Frontend');
      expect(config.security.network_default).toBe('full');
      expect(config.security.deny_overlays).toEqual(['~/.ssh', '~/.aws', '.env']);
    });

    it('should produce config that validates against WorkspaceSpecSchema', async () => {
      const { buildWorkspaceConfig } = await import('../workspace-init.js');

      const config = buildWorkspaceConfig({
        projectName: 'test-project',
        lanes: ['Ops'],
        sandboxProfile: 'off',
        deniedPaths: [],
        cloudConnect: false,
      });

      const result = WorkspaceSpecSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should pin software-delivery pack by default (WU-2193)', async () => {
      const { buildWorkspaceConfig } = await import('../workspace-init.js');

      const config = buildWorkspaceConfig({
        projectName: 'test-project',
        lanes: ['Ops'],
        sandboxProfile: 'off',
        deniedPaths: [],
        cloudConnect: false,
      });

      expect(config.packs).toHaveLength(1);
      expect(config.packs[0].id).toBe('software-delivery');
    });

    it('should normalize lane names to kebab-case IDs', async () => {
      const { buildWorkspaceConfig } = await import('../workspace-init.js');

      const config = buildWorkspaceConfig({
        projectName: 'my-project',
        lanes: ['Framework Core', 'CI CD Pipeline'],
        sandboxProfile: 'off',
        deniedPaths: [],
        cloudConnect: false,
      });

      expect(config.lanes[0].id).toBe('framework-core');
      expect(config.lanes[0].title).toBe('Framework Core');
      expect(config.lanes[1].id).toBe('ci-cd-pipeline');
      expect(config.lanes[1].title).toBe('CI CD Pipeline');
    });
  });

  describe('generateWorkspaceYaml', () => {
    // AC4: Generated file includes helpful YAML comments explaining each section
    it('should generate YAML with comments explaining each section', async () => {
      const { generateWorkspaceYaml, getDefaultWorkspaceConfig } =
        await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();
      const yamlContent = generateWorkspaceYaml(config);

      // Must contain comments for key sections
      expect(yamlContent).toContain('# Workspace ID');
      expect(yamlContent).toContain('# Human-readable project name');
      expect(yamlContent).toContain('# Domain packs');
      expect(yamlContent).toContain('# Work lanes');
      expect(yamlContent).toContain('# Security configuration');
      expect(yamlContent).toContain('# Network access');
      expect(yamlContent).toContain('# Paths denied');
    });

    it('should include software-delivery pack pin in generated YAML (WU-2193)', async () => {
      const { generateWorkspaceYaml, getDefaultWorkspaceConfig } =
        await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();
      const yamlContent = generateWorkspaceYaml(config);
      const parsed = YAML.parse(yamlContent);

      expect(parsed.packs).toHaveLength(1);
      expect(parsed.packs[0].id).toBe('software-delivery');
      expect(parsed.packs[0].source).toBe('local');
    });

    it('should produce valid YAML that can be parsed back', async () => {
      const { generateWorkspaceYaml, getDefaultWorkspaceConfig } =
        await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();
      const yamlContent = generateWorkspaceYaml(config);

      // Should be parseable YAML
      const parsed = YAML.parse(yamlContent);
      expect(parsed).toBeDefined();
      expect(parsed.id).toBe(config.id);
      expect(parsed.name).toBe(config.name);
    });

    // AC3: Generated workspace.yaml validates against WorkspaceSpecSchema
    it('should generate YAML whose parsed content validates against WorkspaceSpecSchema', async () => {
      const { generateWorkspaceYaml, buildWorkspaceConfig } = await import('../workspace-init.js');

      const config = buildWorkspaceConfig({
        projectName: 'validated-project',
        lanes: ['Engineering', 'Design'],
        sandboxProfile: 'off',
        deniedPaths: ['~/.ssh', '~/.gnupg'],
        cloudConnect: false,
      });

      const yamlContent = generateWorkspaceYaml(config);
      const parsed = YAML.parse(yamlContent);
      const result = WorkspaceSpecSchema.safeParse(parsed);

      expect(result.success).toBe(true);
    });
  });

  describe('writeWorkspaceFile', () => {
    // AC5: Uses existing init-scaffolding.ts template infrastructure
    it('should write workspace.yaml to the target directory', async () => {
      const { writeWorkspaceFile, getDefaultWorkspaceConfig } =
        await import('../workspace-init.js');

      const config = getDefaultWorkspaceConfig();
      const result = await writeWorkspaceFile(tempDir, config);

      const filePath = join(tempDir, 'workspace.yaml');
      expect(existsSync(filePath)).toBe(true);
      expect(result.created).toContain('workspace.yaml');
    });

    it('should not overwrite existing workspace.yaml in skip mode', async () => {
      const { writeWorkspaceFile, getDefaultWorkspaceConfig } =
        await import('../workspace-init.js');
      const { writeFileSync } = await import('node:fs');

      // Pre-create the file
      const filePath = join(tempDir, 'workspace.yaml');
      writeFileSync(filePath, 'existing: content\n');

      const config = getDefaultWorkspaceConfig();
      const result = await writeWorkspaceFile(tempDir, config, false);

      // Should be in skipped, not created
      expect(result.skipped).toContain('workspace.yaml');
      expect(result.created).not.toContain('workspace.yaml');

      // File content should be unchanged
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toBe('existing: content\n');
    });

    it('should overwrite existing workspace.yaml in force mode', async () => {
      const { writeWorkspaceFile, getDefaultWorkspaceConfig } =
        await import('../workspace-init.js');
      const { writeFileSync } = await import('node:fs');

      // Pre-create the file
      const filePath = join(tempDir, 'workspace.yaml');
      writeFileSync(filePath, 'existing: content\n');

      const config = getDefaultWorkspaceConfig();
      const result = await writeWorkspaceFile(tempDir, config, true);

      expect(result.created).toContain('workspace.yaml');

      // File content should be new
      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toBe('existing: content\n');
      expect(content).toContain(config.id);
    });

    it('should write valid YAML that parses against WorkspaceSpecSchema', async () => {
      const { writeWorkspaceFile, buildWorkspaceConfig } = await import('../workspace-init.js');

      const config = buildWorkspaceConfig({
        projectName: 'schema-test',
        lanes: ['Dev'],
        sandboxProfile: 'off',
        deniedPaths: ['~/.ssh'],
        cloudConnect: false,
      });

      await writeWorkspaceFile(tempDir, config);

      const filePath = join(tempDir, 'workspace.yaml');
      const content = readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(content);
      const result = WorkspaceSpecSchema.safeParse(parsed);

      expect(result.success).toBe(true);
    });
  });

  // AC2: --yes flag accepts all defaults non-interactively
  describe('runNonInteractive (--yes mode)', () => {
    it('should generate workspace.yaml with defaults when --yes is used', async () => {
      const { runNonInteractive } = await import('../workspace-init.js');

      const result = await runNonInteractive(tempDir);

      const filePath = join(tempDir, 'workspace.yaml');
      expect(existsSync(filePath)).toBe(true);
      expect(result.created).toContain('workspace.yaml');

      // Verify the content is valid
      const content = readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(content);
      const validation = WorkspaceSpecSchema.safeParse(parsed);
      expect(validation.success).toBe(true);
    });

    it('should include YAML comments in generated file', async () => {
      const { runNonInteractive } = await import('../workspace-init.js');

      await runNonInteractive(tempDir);

      const filePath = join(tempDir, 'workspace.yaml');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toContain('#');
    });
  });

  // AC1: workspace:init command prompts 5 questions interactively
  describe('WORKSPACE_QUESTIONS', () => {
    it('should define exactly 5 questions', async () => {
      const { WORKSPACE_QUESTIONS } = await import('../workspace-init.js');

      expect(WORKSPACE_QUESTIONS).toHaveLength(5);
    });

    it('should include project name question', async () => {
      const { WORKSPACE_QUESTIONS } = await import('../workspace-init.js');

      const projectQ = WORKSPACE_QUESTIONS.find((q) => q.name === 'projectName');
      expect(projectQ).toBeDefined();
      expect(projectQ!.prompt).toBeTruthy();
      expect(projectQ!.defaultValue).toBeTruthy();
    });

    it('should include lanes question', async () => {
      const { WORKSPACE_QUESTIONS } = await import('../workspace-init.js');

      const lanesQ = WORKSPACE_QUESTIONS.find((q) => q.name === 'lanes');
      expect(lanesQ).toBeDefined();
      expect(lanesQ!.prompt).toBeTruthy();
    });

    it('should include sandbox profile question', async () => {
      const { WORKSPACE_QUESTIONS } = await import('../workspace-init.js');

      const sandboxQ = WORKSPACE_QUESTIONS.find((q) => q.name === 'sandboxProfile');
      expect(sandboxQ).toBeDefined();
      expect(sandboxQ!.prompt).toBeTruthy();
    });

    it('should include denied paths question', async () => {
      const { WORKSPACE_QUESTIONS } = await import('../workspace-init.js');

      const deniedQ = WORKSPACE_QUESTIONS.find((q) => q.name === 'deniedPaths');
      expect(deniedQ).toBeDefined();
      expect(deniedQ!.prompt).toBeTruthy();
    });

    it('should include cloud connect question', async () => {
      const { WORKSPACE_QUESTIONS } = await import('../workspace-init.js');

      const cloudQ = WORKSPACE_QUESTIONS.find((q) => q.name === 'cloudConnect');
      expect(cloudQ).toBeDefined();
      expect(cloudQ!.prompt).toBeTruthy();
    });
  });

  describe('parseAnswers', () => {
    it('should parse raw string answers into typed config inputs', async () => {
      const { parseAnswers } = await import('../workspace-init.js');

      const answers: Record<string, string> = {
        projectName: 'my-app',
        lanes: 'Backend, Frontend, DevOps',
        sandboxProfile: 'off',
        deniedPaths: '~/.ssh, ~/.aws',
        cloudConnect: 'yes',
      };

      const parsed = parseAnswers(answers);

      expect(parsed.projectName).toBe('my-app');
      expect(parsed.lanes).toEqual(['Backend', 'Frontend', 'DevOps']);
      expect(parsed.sandboxProfile).toBe('off');
      expect(parsed.deniedPaths).toEqual(['~/.ssh', '~/.aws']);
      expect(parsed.cloudConnect).toBe(true);
    });

    it('should handle "no" for cloud connect', async () => {
      const { parseAnswers } = await import('../workspace-init.js');

      const answers: Record<string, string> = {
        projectName: 'test',
        lanes: 'Default',
        sandboxProfile: 'off',
        deniedPaths: '',
        cloudConnect: 'no',
      };

      const parsed = parseAnswers(answers);
      expect(parsed.cloudConnect).toBe(false);
    });

    it('should handle empty denied paths', async () => {
      const { parseAnswers } = await import('../workspace-init.js');

      const answers: Record<string, string> = {
        projectName: 'test',
        lanes: 'Default',
        sandboxProfile: 'off',
        deniedPaths: '',
        cloudConnect: 'no',
      };

      const parsed = parseAnswers(answers);
      expect(parsed.deniedPaths).toEqual([]);
    });
  });
});
