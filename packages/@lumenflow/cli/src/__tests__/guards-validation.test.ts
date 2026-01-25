/**
 * @file guards-validation.test.ts
 * @description Tests for guard and validation CLI tools (WU-1111)
 *
 * Tests cover:
 * - guard-worktree-commit: Prevents WU commits from main checkout
 * - guard-locked: Prevents changes to locked WUs
 * - validate: Main WU YAML validator
 * - validate-agent-skills: Validates agent skill definitions
 * - validate-agent-sync: Validates agent sync state
 * - validate-backlog-sync: Validates backlog.md is in sync with WU YAML files
 * - validate-skills-spec: Validates skills spec format
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Test utilities
function createTempDir(): string {
  const tmpDir = path.join(os.tmpdir(), `guards-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function cleanupTempDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// guard-locked tests
// ============================================================================
describe('guard-locked', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('isWULocked', () => {
    it('should return true when WU has locked: true', async () => {
      const { isWULocked } = await import('../guard-locked.js');

      const wuYaml = `
id: WU-123
title: Test WU
status: done
locked: true
`;
      const wuPath = path.join(tmpDir, 'WU-123.yaml');
      writeFileSync(wuPath, wuYaml);

      const result = isWULocked(wuPath);
      expect(result).toBe(true);
    });

    it('should return false when WU has locked: false', async () => {
      const { isWULocked } = await import('../guard-locked.js');

      const wuYaml = `
id: WU-456
title: Test WU
status: in_progress
locked: false
`;
      const wuPath = path.join(tmpDir, 'WU-456.yaml');
      writeFileSync(wuPath, wuYaml);

      const result = isWULocked(wuPath);
      expect(result).toBe(false);
    });

    it('should return false when WU has no locked field', async () => {
      const { isWULocked } = await import('../guard-locked.js');

      const wuYaml = `
id: WU-789
title: Test WU
status: ready
`;
      const wuPath = path.join(tmpDir, 'WU-789.yaml');
      writeFileSync(wuPath, wuYaml);

      const result = isWULocked(wuPath);
      expect(result).toBe(false);
    });

    it('should throw when WU file does not exist', async () => {
      const { isWULocked } = await import('../guard-locked.js');

      const wuPath = path.join(tmpDir, 'WU-999.yaml');
      expect(() => isWULocked(wuPath)).toThrow(/not found/);
    });
  });

  describe('assertWUNotLocked', () => {
    it('should not throw when WU is not locked', async () => {
      const { assertWUNotLocked } = await import('../guard-locked.js');

      const wuYaml = `
id: WU-100
title: Unlocked WU
status: in_progress
locked: false
`;
      const wuPath = path.join(tmpDir, 'WU-100.yaml');
      writeFileSync(wuPath, wuYaml);

      expect(() => assertWUNotLocked(wuPath)).not.toThrow();
    });

    it('should throw with descriptive message when WU is locked', async () => {
      const { assertWUNotLocked } = await import('../guard-locked.js');

      const wuYaml = `
id: WU-200
title: Locked WU
status: done
locked: true
`;
      const wuPath = path.join(tmpDir, 'WU-200.yaml');
      writeFileSync(wuPath, wuYaml);

      expect(() => assertWUNotLocked(wuPath)).toThrow(/WU-200.*locked/i);
    });

    it('should include wu:unlock suggestion in error message', async () => {
      const { assertWUNotLocked } = await import('../guard-locked.js');

      const wuYaml = `
id: WU-300
title: Locked WU
status: done
locked: true
`;
      const wuPath = path.join(tmpDir, 'WU-300.yaml');
      writeFileSync(wuPath, wuYaml);

      expect(() => assertWUNotLocked(wuPath)).toThrow(/wu:unlock/);
    });
  });
});

// ============================================================================
// guard-worktree-commit tests
// ============================================================================
describe('guard-worktree-commit', () => {
  describe('shouldBlockCommit', () => {
    it('should block commits with WU prefix from main checkout', async () => {
      const { shouldBlockCommit } = await import('../guard-worktree-commit.js');

      const result = shouldBlockCommit({
        commitMessage: 'wu(WU-123): add feature',
        isMainCheckout: true,
        isInWorktree: false,
      });

      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/worktree/i);
    });

    it('should allow commits with WU prefix from worktree', async () => {
      const { shouldBlockCommit } = await import('../guard-worktree-commit.js');

      const result = shouldBlockCommit({
        commitMessage: 'wu(WU-123): add feature',
        isMainCheckout: false,
        isInWorktree: true,
      });

      expect(result.blocked).toBe(false);
    });

    it('should allow non-WU commits from main checkout', async () => {
      const { shouldBlockCommit } = await import('../guard-worktree-commit.js');

      const result = shouldBlockCommit({
        commitMessage: 'chore: update dependencies',
        isMainCheckout: true,
        isInWorktree: false,
      });

      expect(result.blocked).toBe(false);
    });

    it('should detect WU prefix case-insensitively', async () => {
      const { shouldBlockCommit } = await import('../guard-worktree-commit.js');

      const result = shouldBlockCommit({
        commitMessage: 'WU(wu-456): something',
        isMainCheckout: true,
        isInWorktree: false,
      });

      expect(result.blocked).toBe(true);
    });

    it('should block feat(WU-xxx) pattern from main', async () => {
      const { shouldBlockCommit } = await import('../guard-worktree-commit.js');

      const result = shouldBlockCommit({
        commitMessage: 'feat(WU-789): new feature',
        isMainCheckout: true,
        isInWorktree: false,
      });

      expect(result.blocked).toBe(true);
    });
  });
});

// ============================================================================
// validate-agent-skills tests
// ============================================================================
describe('validate-agent-skills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    mkdirSync(path.join(tmpDir, '.claude', 'skills'), { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('validateSkillFile', () => {
    it('should pass for valid skill with all required fields', async () => {
      const { validateSkillFile } = await import('../validate-agent-skills.js');

      const skillContent = `# My Skill

**Source**: some-doc.md

## When to Use
Use this skill when you need to do something.

## Core Concepts
Important concepts here.
`;
      const skillPath = path.join(tmpDir, '.claude', 'skills', 'my-skill', 'SKILL.md');
      mkdirSync(path.dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, skillContent);

      const result = validateSkillFile(skillPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for skill missing "When to Use" section', async () => {
      const { validateSkillFile } = await import('../validate-agent-skills.js');

      const skillContent = `# My Skill

**Source**: some-doc.md

## Core Concepts
Concepts only, no when-to-use.
`;
      const skillPath = path.join(tmpDir, '.claude', 'skills', 'bad-skill', 'SKILL.md');
      mkdirSync(path.dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, skillContent);

      const result = validateSkillFile(skillPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /When to Use/i.test(e))).toBe(true);
    });

    it('should fail for skill missing title heading', async () => {
      const { validateSkillFile } = await import('../validate-agent-skills.js');

      const skillContent = `No title heading here

## When to Use
Some content.
`;
      const skillPath = path.join(tmpDir, '.claude', 'skills', 'no-title', 'SKILL.md');
      mkdirSync(path.dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, skillContent);

      const result = validateSkillFile(skillPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /title|heading/i.test(e))).toBe(true);
    });
  });

  describe('validateAllSkills', () => {
    it('should validate all skills in directory', async () => {
      const { validateAllSkills } = await import('../validate-agent-skills.js');

      // Create two valid skills
      const skill1Path = path.join(tmpDir, '.claude', 'skills', 'skill-one', 'SKILL.md');
      const skill2Path = path.join(tmpDir, '.claude', 'skills', 'skill-two', 'SKILL.md');
      mkdirSync(path.dirname(skill1Path), { recursive: true });
      mkdirSync(path.dirname(skill2Path), { recursive: true });

      const validContent = `# Valid Skill

## When to Use
Use this.
`;
      writeFileSync(skill1Path, validContent);
      writeFileSync(skill2Path, validContent);

      const results = validateAllSkills(path.join(tmpDir, '.claude', 'skills'));
      expect(results.totalValid).toBe(2);
      expect(results.totalInvalid).toBe(0);
    });
  });
});

// ============================================================================
// validate-agent-sync tests
// ============================================================================
describe('validate-agent-sync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('validateAgentSync', () => {
    it('should pass when agent files exist and match expected structure', async () => {
      const { validateAgentSync } = await import('../validate-agent-sync.js');

      // Create expected agent directory structure
      const agentDir = path.join(tmpDir, '.claude', 'agents');
      mkdirSync(agentDir, { recursive: true });

      const agentDef = `{
  "name": "test-agent",
  "description": "A test agent"
}`;
      writeFileSync(path.join(agentDir, 'test-agent.json'), agentDef);

      const result = await validateAgentSync({ cwd: tmpDir });
      expect(result.valid).toBe(true);
    });

    it('should fail when agent directory is missing', async () => {
      const { validateAgentSync } = await import('../validate-agent-sync.js');

      // No agent directory created
      const result = await validateAgentSync({ cwd: tmpDir });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /agents.*not found|missing/i.test(e))).toBe(true);
    });

    it('should warn when agent definitions have no description', async () => {
      const { validateAgentSync } = await import('../validate-agent-sync.js');

      const agentDir = path.join(tmpDir, '.claude', 'agents');
      mkdirSync(agentDir, { recursive: true });

      const agentDef = `{
  "name": "no-desc-agent"
}`;
      writeFileSync(path.join(agentDir, 'no-desc.json'), agentDef);

      const result = await validateAgentSync({ cwd: tmpDir });
      expect(result.warnings.some((w) => /description/i.test(w))).toBe(true);
    });
  });
});

// ============================================================================
// validate-backlog-sync tests
// ============================================================================
describe('validate-backlog-sync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    mkdirSync(path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu'), { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('validateBacklogSync', () => {
    it('should pass when backlog.md lists all WU YAML files', async () => {
      const { validateBacklogSync } = await import('../validate-backlog-sync.js');

      // Create WU files
      writeFileSync(
        path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-001.yaml'),
        'id: WU-001\ntitle: First WU\nstatus: ready',
      );
      writeFileSync(
        path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-002.yaml'),
        'id: WU-002\ntitle: Second WU\nstatus: done',
      );

      // Create backlog.md that references both
      const backlogContent = `# Backlog

## Ready
- WU-001: First WU

## Done
- WU-002: Second WU
`;
      writeFileSync(
        path.join(tmpDir, 'docs', '04-operations', 'tasks', 'backlog.md'),
        backlogContent,
      );

      const result = await validateBacklogSync({ cwd: tmpDir });
      expect(result.valid).toBe(true);
    });

    it('should fail when WU exists but not in backlog.md', async () => {
      const { validateBacklogSync } = await import('../validate-backlog-sync.js');

      // Create WU file
      writeFileSync(
        path.join(tmpDir, 'docs', '04-operations', 'tasks', 'wu', 'WU-001.yaml'),
        'id: WU-001\ntitle: Missing WU\nstatus: ready',
      );

      // Create backlog.md that doesn't reference the WU
      const backlogContent = `# Backlog

## Ready
(empty)
`;
      writeFileSync(
        path.join(tmpDir, 'docs', '04-operations', 'tasks', 'backlog.md'),
        backlogContent,
      );

      const result = await validateBacklogSync({ cwd: tmpDir });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /WU-001.*not found.*backlog/i.test(e))).toBe(true);
    });
  });
});

// ============================================================================
// validate-skills-spec tests
// ============================================================================
describe('validate-skills-spec', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('validateSkillsSpec', () => {
    it('should pass for skill with required sections', async () => {
      const { validateSkillsSpec } = await import('../validate-skills-spec.js');

      const skillSpec = `# Skill Name

## When to Use
Describe when to activate this skill.

## Key Concepts
Important concepts.

## Examples
Show examples.
`;
      const skillPath = path.join(tmpDir, 'SKILL.md');
      writeFileSync(skillPath, skillSpec);

      const result = validateSkillsSpec(skillPath);
      expect(result.valid).toBe(true);
    });

    it('should fail for skill missing required "When to Use" section', async () => {
      const { validateSkillsSpec } = await import('../validate-skills-spec.js');

      const skillSpec = `# Skill Name

## Key Concepts
Concepts but no when-to-use.
`;
      const skillPath = path.join(tmpDir, 'SKILL.md');
      writeFileSync(skillPath, skillSpec);

      const result = validateSkillsSpec(skillPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /When to Use/i.test(e))).toBe(true);
    });

    it('should warn for skill without examples section', async () => {
      const { validateSkillsSpec } = await import('../validate-skills-spec.js');

      const skillSpec = `# Skill Name

## When to Use
When needed.

## Key Concepts
Concepts only.
`;
      const skillPath = path.join(tmpDir, 'SKILL.md');
      writeFileSync(skillPath, skillSpec);

      const result = validateSkillsSpec(skillPath);
      expect(result.warnings.some((w) => /Examples/i.test(w))).toBe(true);
    });
  });
});
