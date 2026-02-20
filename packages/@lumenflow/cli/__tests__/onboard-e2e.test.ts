/**
 * @file onboard-e2e.test.ts
 * Tests for lumenflow onboard interactive setup wizard (WU-1927)
 *
 * Tests each acceptance criterion:
 * AC1: Detects Node, git, existing workspace
 * AC2: Offers domain choice (software delivery, infra, custom)
 * AC3: Generates workspace.yaml with selected pack
 * AC4: Installs pack from registry
 * AC5: Launches dashboard
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('lumenflow onboard (WU-1927)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-onboard-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('AC1: detectEnvironment', () => {
    it('should detect Node.js version', async () => {
      const { detectEnvironment } = await import('../src/onboard.js');
      const env = await detectEnvironment(tempDir);

      expect(env.node).toBeDefined();
      expect(env.node.available).toBe(true);
      expect(env.node.version).toMatch(/^\d+\.\d+/);
    });

    it('should detect git availability', async () => {
      const { detectEnvironment } = await import('../src/onboard.js');
      const env = await detectEnvironment(tempDir);

      expect(env.git).toBeDefined();
      expect(env.git.available).toBe(true);
    });

    it('should detect existing workspace.yaml', async () => {
      // Create a workspace.yaml in the temp dir
      fs.writeFileSync(
        path.join(tempDir, 'workspace.yaml'),
        'id: test\nname: Test\npacks: []\nlanes: []\nsecurity:\n  allowed_scopes: []\n  network_default: off\n  deny_overlays: []\nmemory_namespace: test\nevent_namespace: test\n',
      );

      const { detectEnvironment } = await import('../src/onboard.js');
      const env = await detectEnvironment(tempDir);

      expect(env.existingWorkspace).toBe(true);
    });

    it('should detect no existing workspace.yaml', async () => {
      const { detectEnvironment } = await import('../src/onboard.js');
      const env = await detectEnvironment(tempDir);

      expect(env.existingWorkspace).toBe(false);
    });
  });

  describe('AC2: domain choices', () => {
    it('should export DOMAIN_CHOICES with software-delivery, infra, and custom', async () => {
      const { DOMAIN_CHOICES } = await import('../src/onboard.js');

      expect(DOMAIN_CHOICES).toBeDefined();
      expect(Array.isArray(DOMAIN_CHOICES)).toBe(true);
      expect(DOMAIN_CHOICES.length).toBeGreaterThanOrEqual(3);

      const ids = DOMAIN_CHOICES.map((c) => c.value);
      expect(ids).toContain('software-delivery');
      expect(ids).toContain('infra');
      expect(ids).toContain('custom');
    });
  });

  describe('AC3: generateWorkspaceForDomain', () => {
    it('should generate workspace.yaml with software-delivery pack', async () => {
      const { generateWorkspaceForDomain } = await import('../src/onboard.js');
      const result = await generateWorkspaceForDomain(tempDir, {
        projectName: 'my-app',
        domain: 'software-delivery',
      });

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBeDefined();

      const workspacePath = path.join(tempDir, 'workspace.yaml');
      expect(fs.existsSync(workspacePath)).toBe(true);

      const content = fs.readFileSync(workspacePath, 'utf-8');
      expect(content).toContain('my-app');
      expect(content).toContain('software-delivery');
    });

    it('should generate workspace.yaml with infra pack', async () => {
      const { generateWorkspaceForDomain } = await import('../src/onboard.js');
      const result = await generateWorkspaceForDomain(tempDir, {
        projectName: 'infra-proj',
        domain: 'infra',
      });

      expect(result.success).toBe(true);

      const workspacePath = path.join(tempDir, 'workspace.yaml');
      const content = fs.readFileSync(workspacePath, 'utf-8');
      expect(content).toContain('infra-proj');
      expect(content).toContain('infra');
    });

    it('should generate workspace.yaml with empty packs for custom domain', async () => {
      const { generateWorkspaceForDomain } = await import('../src/onboard.js');
      const result = await generateWorkspaceForDomain(tempDir, {
        projectName: 'custom-proj',
        domain: 'custom',
      });

      expect(result.success).toBe(true);

      const workspacePath = path.join(tempDir, 'workspace.yaml');
      const content = fs.readFileSync(workspacePath, 'utf-8');
      expect(content).toContain('custom-proj');
      // Custom domain should have an empty packs array
      expect(content).toContain('packs: []');
    });

    it('should not overwrite existing workspace.yaml without force', async () => {
      // Create existing workspace.yaml
      const existingContent = 'id: existing\nname: Existing\n';
      fs.writeFileSync(path.join(tempDir, 'workspace.yaml'), existingContent);

      const { generateWorkspaceForDomain } = await import('../src/onboard.js');
      const result = await generateWorkspaceForDomain(tempDir, {
        projectName: 'new-app',
        domain: 'software-delivery',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('AC4: installDomainPack', () => {
    it('should call installPack for software-delivery domain', async () => {
      const { installDomainPack } = await import('../src/onboard.js');

      // For testing, this returns a structured result.
      // In reality it would call pack-install, but we test the orchestration.
      const result = await installDomainPack(tempDir, {
        domain: 'software-delivery',
        skipInstall: true, // Skip actual registry call in test
      });

      expect(result).toBeDefined();
      expect(result.packId).toBe('software-delivery');
      expect(result.skipped).toBe(true);
    });

    it('should skip install for custom domain', async () => {
      const { installDomainPack } = await import('../src/onboard.js');

      const result = await installDomainPack(tempDir, {
        domain: 'custom',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('custom');
    });
  });

  describe('AC5: launchDashboard', () => {
    it('should return dashboard URL or instruction', async () => {
      const { launchDashboard } = await import('../src/onboard.js');

      const result = await launchDashboard(tempDir, { dryRun: true });

      expect(result).toBeDefined();
      expect(result.instruction).toBeDefined();
      expect(typeof result.instruction).toBe('string');
      expect(result.instruction.length).toBeGreaterThan(0);
    });
  });

  describe('runOnboard (full orchestration)', () => {
    it('should export runOnboard function', async () => {
      const { runOnboard } = await import('../src/onboard.js');
      expect(typeof runOnboard).toBe('function');
    });

    it('should run non-interactive mode with --yes flag', async () => {
      const { runOnboard } = await import('../src/onboard.js');

      const result = await runOnboard({
        targetDir: tempDir,
        nonInteractive: true,
        projectName: 'quick-start',
        domain: 'software-delivery',
        skipPackInstall: true,
        skipDashboard: true,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'workspace.yaml'))).toBe(true);
    });
  });
});
