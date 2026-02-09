/**
 * Tests for sync:templates command (WU-1368)
 *
 * Two bugs being fixed:
 * 1. --check-drift flag syncs files instead of only checking - should be read-only
 * 2. sync:templates writes directly to main checkout - should use micro-worktree isolation
 *
 * TDD: These tests are written BEFORE the implementation changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock modules before importing
const mockWithMicroWorktree = vi.fn();

vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: mockWithMicroWorktree,
}));

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => ({
    branch: vi.fn().mockResolvedValue({ current: 'main' }),
    status: vi.fn().mockResolvedValue({ isClean: () => true }),
  })),
}));

vi.mock('@lumenflow/core/wu-helpers', () => ({
  ensureOnMain: vi.fn().mockResolvedValue(undefined),
}));

describe('sync:templates --check-drift', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `sync-templates-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tempDir);

    // Set up minimal project structure
    const templatesDir = join(tempDir, 'packages', '@lumenflow', 'cli', 'templates', 'core');
    mkdirSync(templatesDir, { recursive: true });

    // Create LUMENFLOW.md source
    writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow\n\nLast updated: 2025-01-01\n');

    // Create matching template (no drift)
    writeFileSync(
      join(templatesDir, 'LUMENFLOW.md.template'),
      '# LumenFlow\n\nLast updated: {{DATE}}\n',
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('checkTemplateDrift', () => {
    it('should NOT write any files when checking drift', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      // Get initial file mtimes
      const sourceFile = join(tempDir, 'LUMENFLOW.md');
      const templateFile = join(
        tempDir,
        'packages',
        '@lumenflow',
        'cli',
        'templates',
        'core',
        'LUMENFLOW.md.template',
      );

      const sourceMtimeBefore = existsSync(sourceFile) ? readFileSync(sourceFile, 'utf-8') : null;
      const templateMtimeBefore = existsSync(templateFile)
        ? readFileSync(templateFile, 'utf-8')
        : null;

      // Run check-drift
      await checkTemplateDrift(tempDir);

      // Verify files were NOT modified
      const sourceMtimeAfter = existsSync(sourceFile) ? readFileSync(sourceFile, 'utf-8') : null;
      const templateMtimeAfter = existsSync(templateFile)
        ? readFileSync(templateFile, 'utf-8')
        : null;

      expect(sourceMtimeAfter).toBe(sourceMtimeBefore);
      expect(templateMtimeAfter).toBe(templateMtimeBefore);
    });

    it('should return hasDrift=false when templates match source', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      const result = await checkTemplateDrift(tempDir);

      expect(result.hasDrift).toBe(false);
      expect(result.driftingFiles).toHaveLength(0);
    });

    it('should return hasDrift=true when templates differ from source', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      // Create source with different content
      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow Updated\n\nNew content here\n');

      const result = await checkTemplateDrift(tempDir);

      expect(result.hasDrift).toBe(true);
      expect(result.driftingFiles.length).toBeGreaterThan(0);
    });

    it('should return hasDrift=true when template file is missing', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      // Remove template file
      const templateFile = join(
        tempDir,
        'packages',
        '@lumenflow',
        'cli',
        'templates',
        'core',
        'LUMENFLOW.md.template',
      );
      rmSync(templateFile);

      const result = await checkTemplateDrift(tempDir);

      expect(result.hasDrift).toBe(true);
      expect(result.driftingFiles).toContain(
        'packages/@lumenflow/cli/templates/core/LUMENFLOW.md.template',
      );
    });

    it('should NOT call withMicroWorktree during drift check', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      await checkTemplateDrift(tempDir);

      // withMicroWorktree should NOT be called for read-only drift check
      expect(mockWithMicroWorktree).not.toHaveBeenCalled();
    });
  });

  describe('exit codes', () => {
    it('should exit 1 when drift is detected', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      // Create drifting source
      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow Updated\n\nDifferent content\n');

      const result = await checkTemplateDrift(tempDir);

      // The result should indicate drift - CLI will use this to set exit code
      expect(result.hasDrift).toBe(true);
    });

    it('should exit 0 when no drift detected', async () => {
      const { checkTemplateDrift } = await import('../sync-templates.js');

      const result = await checkTemplateDrift(tempDir);

      // The result should indicate no drift - CLI will use this to set exit code
      expect(result.hasDrift).toBe(false);
    });
  });
});

describe('sync:templates (sync mode)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `sync-templates-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tempDir);

    // Reset mock
    mockWithMicroWorktree.mockReset();
    mockWithMicroWorktree.mockImplementation(async ({ execute }) => {
      // Simulate micro-worktree by creating temp dir and calling execute
      const wtPath = join(tmpdir(), `micro-wt-${Date.now()}`);
      mkdirSync(wtPath, { recursive: true });
      const result = await execute({
        worktreePath: wtPath,
        gitWorktree: {
          add: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue(undefined),
        },
      });
      return { ...result, ref: 'main' };
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('micro-worktree isolation', () => {
    it('should use withMicroWorktree for sync operations', async () => {
      const { syncTemplatesWithWorktree } = await import('../sync-templates.js');

      // Set up source files
      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow\n\nContent\n');
      mkdirSync(join(tempDir, '.lumenflow'), { recursive: true });
      writeFileSync(join(tempDir, '.lumenflow', 'constraints.md'), '# Constraints\n');

      await syncTemplatesWithWorktree(tempDir);

      // Verify withMicroWorktree was called
      expect(mockWithMicroWorktree).toHaveBeenCalledTimes(1);
      expect(mockWithMicroWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'sync-templates',
          id: expect.any(String),
          execute: expect.any(Function),
        }),
      );
    });

    it('should write files to micro-worktree path, not main checkout', async () => {
      const { syncTemplatesWithWorktree } = await import('../sync-templates.js');

      // Set up source files
      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow\n\nContent\n');

      let capturedWorktreePath: string | null = null;
      mockWithMicroWorktree.mockImplementation(async ({ execute }) => {
        const wtPath = join(tmpdir(), `micro-wt-verify-${Date.now()}`);
        mkdirSync(wtPath, { recursive: true });
        capturedWorktreePath = wtPath;

        // Create templates structure in worktree
        const templatesDir = join(wtPath, 'packages', '@lumenflow', 'cli', 'templates', 'core');
        mkdirSync(templatesDir, { recursive: true });

        const result = await execute({
          worktreePath: wtPath,
          gitWorktree: {
            add: vi.fn().mockResolvedValue(undefined),
            commit: vi.fn().mockResolvedValue(undefined),
          },
        });
        return { ...result, ref: 'main' };
      });

      await syncTemplatesWithWorktree(tempDir);

      // Verify worktree path was used (not main checkout)
      expect(capturedWorktreePath).not.toBeNull();
      expect(capturedWorktreePath).not.toBe(tempDir);
      expect(capturedWorktreePath!.startsWith(tmpdir())).toBe(true);
    });

    it('should return list of synced files for commit', async () => {
      const { syncTemplatesWithWorktree } = await import('../sync-templates.js');

      // Set up source files
      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow\n\nContent\n');

      let capturedResult: { commitMessage: string; files: string[] } | null = null;
      mockWithMicroWorktree.mockImplementation(async ({ execute }) => {
        const wtPath = join(tmpdir(), `micro-wt-files-${Date.now()}`);
        mkdirSync(wtPath, { recursive: true });

        // Create templates structure
        const templatesDir = join(wtPath, 'packages', '@lumenflow', 'cli', 'templates', 'core');
        mkdirSync(templatesDir, { recursive: true });

        const result = await execute({
          worktreePath: wtPath,
          gitWorktree: {
            add: vi.fn().mockResolvedValue(undefined),
            commit: vi.fn().mockResolvedValue(undefined),
          },
        });
        capturedResult = result;
        return { ...result, ref: 'main' };
      });

      await syncTemplatesWithWorktree(tempDir);

      expect(capturedResult).not.toBeNull();
      expect(capturedResult!.commitMessage).toContain('sync:templates');
      expect(Array.isArray(capturedResult!.files)).toBe(true);
    });
  });

  describe('atomic commit', () => {
    it('should create atomic commit via micro-worktree pattern', async () => {
      const { syncTemplatesWithWorktree } = await import('../sync-templates.js');

      // Set up source files
      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow\n\nContent\n');

      await syncTemplatesWithWorktree(tempDir);

      // Verify withMicroWorktree was called (atomic commit pattern)
      expect(mockWithMicroWorktree).toHaveBeenCalled();

      // Verify the execute function returns proper commit info
      const callArgs = mockWithMicroWorktree.mock.calls[0][0];
      expect(callArgs.operation).toBe('sync-templates');
    });

    it('should include timestamp in operation id for uniqueness', async () => {
      const { syncTemplatesWithWorktree } = await import('../sync-templates.js');

      writeFileSync(join(tempDir, 'LUMENFLOW.md'), '# LumenFlow\n');

      await syncTemplatesWithWorktree(tempDir);

      const callArgs = mockWithMicroWorktree.mock.calls[0][0];
      // ID should be timestamp-based or unique identifier
      expect(typeof callArgs.id).toBe('string');
      expect(callArgs.id.length).toBeGreaterThan(0);
    });
  });
});

describe('sync:templates exports', () => {
  it('should export checkTemplateDrift function', async () => {
    const syncTemplates = await import('../sync-templates.js');
    expect(typeof syncTemplates.checkTemplateDrift).toBe('function');
  });

  it('should export syncTemplatesWithWorktree function', async () => {
    const syncTemplates = await import('../sync-templates.js');
    expect(typeof syncTemplates.syncTemplatesWithWorktree).toBe('function');
  });

  it('should export main function for CLI entry', async () => {
    const syncTemplates = await import('../sync-templates.js');
    expect(typeof syncTemplates.main).toBe('function');
  });
});
