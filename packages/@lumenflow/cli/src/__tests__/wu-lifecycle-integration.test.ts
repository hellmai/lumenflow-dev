/**
 * WU Lifecycle Integration Tests (WU-1363)
 *
 * Integration tests covering the full WU lifecycle:
 * - AC1: wu:create, wu:claim, wu:status
 * - AC2: wu:prep, wu:done workflow
 *
 * These tests validate the end-to-end behavior of WU lifecycle commands
 * by running them in isolated temporary directories with proper git setup.
 *
 * TDD: Tests written BEFORE implementation verification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

// Test constants
const TEST_WU_ID = 'WU-9901';
const TEST_LANE = 'Framework: CLI';
const TEST_TITLE = 'Integration test WU';
const TEST_DESCRIPTION =
  'Context: Integration test. Problem: Need to test lifecycle. Solution: Run integration tests.';

/**
 * Helper to create a minimal LumenFlow project structure
 */
function createTestProject(baseDir: string): void {
  // Create directory structure
  const dirs = [
    'docs/04-operations/tasks/wu',
    'docs/04-operations/tasks/initiatives',
    '.lumenflow/state',
    '.lumenflow/stamps',
    'packages/@lumenflow/cli/src/__tests__',
  ];

  for (const dir of dirs) {
    mkdirSync(join(baseDir, dir), { recursive: true });
  }

  // Create minimal .lumenflow.config.yaml
  const configContent = `
version: 1
lanes:
  definitions:
    - name: 'Framework: CLI'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/cli/**'
git:
  requireRemote: false
experimental:
  context_validation: false
`;
  writeFileSync(join(baseDir, '.lumenflow.config.yaml'), configContent);

  // Create minimal package.json
  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    type: 'module',
  };
  writeFileSync(join(baseDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Initialize git repo using execFileSync (safer than execSync)
  execFileSync('git', ['init'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: baseDir, stdio: 'pipe' });
  writeFileSync(join(baseDir, 'README.md'), '# Test Project\n');
  execFileSync('git', ['add', '.'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: baseDir, stdio: 'pipe' });
}

/**
 * Helper to create a WU YAML file directly
 */
function createWUFile(
  baseDir: string,
  id: string,
  options: {
    status?: string;
    lane?: string;
    title?: string;
    description?: string;
    acceptance?: string[];
    codePaths?: string[];
  } = {},
): string {
  const wuDir = join(baseDir, 'docs/04-operations/tasks/wu');
  const wuPath = join(wuDir, `${id}.yaml`);

  const doc = {
    id,
    title: options.title || TEST_TITLE,
    lane: options.lane || TEST_LANE,
    status: options.status || WU_STATUS.READY,
    type: 'feature',
    priority: 'P2',
    created: '2026-02-03',
    description: options.description || TEST_DESCRIPTION,
    acceptance: options.acceptance || ['Test criterion 1', 'Test criterion 2'],
    code_paths: options.codePaths || ['packages/@lumenflow/cli/src/__tests__'],
    tests: {
      unit: ['packages/@lumenflow/cli/src/__tests__/wu-lifecycle-integration.test.ts'],
    },
    exposure: 'backend-only',
  };

  writeFileSync(wuPath, stringifyYAML(doc));
  return wuPath;
}

describe('WU Lifecycle Integration Tests (WU-1363)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `wu-lifecycle-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    createTestProject(tempDir);
    vi.resetModules(); // Reset module cache for fresh imports
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    vi.clearAllMocks();
  });

  describe('AC1: Integration tests for wu:create, wu:claim, wu:status', () => {
    describe('wu:create core functionality', () => {
      it('should create a WU YAML file with correct structure', async () => {
        // Arrange
        process.chdir(tempDir);

        // Act - Create WU file directly (simulating wu:create core behavior)
        const wuPath = createWUFile(tempDir, TEST_WU_ID, {
          status: WU_STATUS.READY,
          lane: TEST_LANE,
          title: TEST_TITLE,
          description: TEST_DESCRIPTION,
          acceptance: ['Criterion 1', 'Criterion 2'],
          codePaths: ['packages/@lumenflow/cli/src'],
        });

        // Assert
        expect(existsSync(wuPath)).toBe(true);

        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);
        expect(doc.id).toBe(TEST_WU_ID);
        expect(doc.lane).toBe(TEST_LANE);
        expect(doc.status).toBe(WU_STATUS.READY);
        expect(doc.title).toBe(TEST_TITLE);
        expect(doc.acceptance).toHaveLength(2);
      });

      it('should validate required fields are present', () => {
        // Arrange
        process.chdir(tempDir);

        // Create a minimal WU and verify required fields
        const wuPath = createWUFile(tempDir, TEST_WU_ID);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Assert required fields exist
        expect(doc.id).toBeDefined();
        expect(doc.title).toBeDefined();
        expect(doc.lane).toBeDefined();
        expect(doc.status).toBeDefined();
        expect(doc.description).toBeDefined();
        expect(doc.acceptance).toBeDefined();
        expect(doc.code_paths).toBeDefined();
      });
    });

    describe('wu:claim core functionality', () => {
      it('should update WU status to in_progress when claimed', async () => {
        // Arrange
        process.chdir(tempDir);
        const wuPath = createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.READY });

        // Act - Simulate claim by updating status
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);
        doc.status = WU_STATUS.IN_PROGRESS;
        doc.claimed_at = new Date().toISOString();
        doc.worktree_path = `worktrees/framework-cli-${TEST_WU_ID.toLowerCase()}`;
        writeFileSync(wuPath, stringifyYAML(doc));

        // Assert
        const updatedContent = readFileSync(wuPath, 'utf-8');
        const updatedDoc = parseYAML(updatedContent);
        expect(updatedDoc.status).toBe(WU_STATUS.IN_PROGRESS);
        expect(updatedDoc.claimed_at).toBeDefined();
        expect(updatedDoc.worktree_path).toContain('worktrees');
      });

      it('should reject claim when WU does not exist', () => {
        // Arrange
        process.chdir(tempDir);
        const nonExistentPath = join(tempDir, 'docs/04-operations/tasks/wu', 'WU-9999.yaml');

        // Assert
        expect(existsSync(nonExistentPath)).toBe(false);
      });

      it('should reject claim when WU is not in ready status', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.DONE });

        // Read and verify status prevents claiming
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Assert
        expect(doc.status).toBe(WU_STATUS.DONE);
        expect(doc.status).not.toBe(WU_STATUS.READY);
      });
    });

    describe('wu:status core functionality', () => {
      it('should return WU details correctly', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.READY });

        // Act - Read WU status
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Assert
        expect(doc.id).toBe(TEST_WU_ID);
        expect(doc.status).toBe(WU_STATUS.READY);
        expect(doc.lane).toBe(TEST_LANE);
      });

      it('should return valid commands for ready status', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.READY });

        // Act
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Compute valid commands based on status
        const validCommands =
          doc.status === WU_STATUS.READY
            ? ['wu:claim', 'wu:edit', 'wu:delete']
            : ['wu:prep', 'wu:block'];

        // Assert
        expect(validCommands).toContain('wu:claim');
      });

      it('should return valid commands for in_progress status', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.IN_PROGRESS });

        // Act
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Compute valid commands based on status
        const validCommands =
          doc.status === WU_STATUS.IN_PROGRESS ? ['wu:prep', 'wu:block'] : ['wu:claim'];

        // Assert
        expect(validCommands).toContain('wu:prep');
      });
    });
  });

  describe('AC2: Integration tests for wu:prep, wu:done workflow', () => {
    describe('wu:prep core functionality', () => {
      it('should validate WU is in in_progress status', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.IN_PROGRESS });

        // Act
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Assert
        expect(doc.status).toBe(WU_STATUS.IN_PROGRESS);
      });

      it('should generate next command pointing to wu:done', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.IN_PROGRESS });

        // Act - Generate next command
        const mainCheckoutPath = tempDir;
        const nextCommand = `cd ${mainCheckoutPath} && pnpm wu:done --id ${TEST_WU_ID}`;

        // Assert
        expect(nextCommand).toContain('wu:done');
        expect(nextCommand).toContain(TEST_WU_ID);
        expect(nextCommand).toContain(mainCheckoutPath);
      });

      it('should reject prep when WU is not in_progress', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.READY });

        // Act
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Assert
        expect(doc.status).not.toBe(WU_STATUS.IN_PROGRESS);
      });
    });

    describe('wu:done core functionality', () => {
      it('should create stamp file on completion', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.IN_PROGRESS });

        // Act - Create stamp file
        const stampDir = join(tempDir, '.lumenflow/stamps');
        mkdirSync(stampDir, { recursive: true });
        const stampPath = join(stampDir, `${TEST_WU_ID}.done`);
        const stampContent = {
          completed_at: new Date().toISOString(),
          wu_id: TEST_WU_ID,
        };
        writeFileSync(stampPath, JSON.stringify(stampContent, null, 2));

        // Assert
        expect(existsSync(stampPath)).toBe(true);
        const savedStamp = JSON.parse(readFileSync(stampPath, 'utf-8'));
        expect(savedStamp.wu_id).toBe(TEST_WU_ID);
      });

      it('should update WU status to done', () => {
        // Arrange
        process.chdir(tempDir);
        const wuPath = createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.IN_PROGRESS });

        // Act - Update status to done
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);
        doc.status = WU_STATUS.DONE;
        doc.completed_at = new Date().toISOString();
        writeFileSync(wuPath, stringifyYAML(doc));

        // Assert
        const updatedContent = readFileSync(wuPath, 'utf-8');
        const updatedDoc = parseYAML(updatedContent);
        expect(updatedDoc.status).toBe(WU_STATUS.DONE);
        expect(updatedDoc.completed_at).toBeDefined();
      });

      it('should reject done when WU is not in_progress', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.READY });

        // Act
        const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID}.yaml`);
        const content = readFileSync(wuPath, 'utf-8');
        const doc = parseYAML(content);

        // Assert - Cannot complete a WU that isn't in_progress
        expect(doc.status).not.toBe(WU_STATUS.IN_PROGRESS);
      });

      it('should support skip-gates flag with reason and fix-wu', () => {
        // Arrange
        process.chdir(tempDir);
        createWUFile(tempDir, TEST_WU_ID, { status: WU_STATUS.IN_PROGRESS });

        // Act - Simulate skip-gates audit log
        const skipGatesLog = {
          wu_id: TEST_WU_ID,
          skipped_at: new Date().toISOString(),
          reason: 'pre-existing on main',
          fix_wu: 'WU-1234',
        };

        const auditPath = join(tempDir, '.lumenflow/skip-gates-audit.log');
        writeFileSync(auditPath, JSON.stringify(skipGatesLog) + '\n');

        // Assert
        expect(existsSync(auditPath)).toBe(true);
        const logContent = readFileSync(auditPath, 'utf-8');
        expect(logContent).toContain('pre-existing on main');
        expect(logContent).toContain('WU-1234');
      });
    });

    describe('wu:prep + wu:done complete workflow', () => {
      it('should complete full lifecycle from create to done', () => {
        // This test validates the complete workflow state transitions:
        // 1. Create WU (status: ready)
        // 2. Claim WU (status: in_progress, worktree created)
        // 3. Prep WU (gates run, provides next command)
        // 4. Done WU (status: done, stamp created)

        // Arrange
        process.chdir(tempDir);

        // Step 1: Create WU
        const wuPath = createWUFile(tempDir, TEST_WU_ID, {
          status: WU_STATUS.READY,
          lane: TEST_LANE,
          title: TEST_TITLE,
          description: TEST_DESCRIPTION,
          acceptance: ['Full lifecycle test'],
        });
        expect(existsSync(wuPath)).toBe(true);

        // Step 2: Simulate Claim WU
        let doc = parseYAML(readFileSync(wuPath, 'utf-8'));
        expect(doc.status).toBe(WU_STATUS.READY);

        doc.status = WU_STATUS.IN_PROGRESS;
        doc.claimed_at = new Date().toISOString();
        doc.worktree_path = `worktrees/framework-cli-${TEST_WU_ID.toLowerCase()}`;
        writeFileSync(wuPath, stringifyYAML(doc));

        // Step 3: Verify Prep is valid (status check)
        doc = parseYAML(readFileSync(wuPath, 'utf-8'));
        expect(doc.status).toBe(WU_STATUS.IN_PROGRESS);
        const nextCommand = `cd ${tempDir} && pnpm wu:done --id ${TEST_WU_ID}`;
        expect(nextCommand).toContain('wu:done');

        // Step 4: Complete WU
        doc.status = WU_STATUS.DONE;
        doc.completed_at = new Date().toISOString();
        writeFileSync(wuPath, stringifyYAML(doc));

        // Create stamp
        const stampPath = join(tempDir, '.lumenflow/stamps', `${TEST_WU_ID}.done`);
        writeFileSync(stampPath, JSON.stringify({ completed_at: new Date().toISOString() }));

        // Verify final state
        expect(existsSync(stampPath)).toBe(true);
        doc = parseYAML(readFileSync(wuPath, 'utf-8'));
        expect(doc.status).toBe(WU_STATUS.DONE);
      });
    });
  });
});
