import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  filterStagedWUYamlFiles,
  validateWUYamlString,
  formatMainBranchBlockMessage,
  shouldAllowMainCheckoutLaneCommit,
} from '../pre-commit.mjs';

describe('pre-commit hook (WU-1164)', () => {
  describe('filterStagedWUYamlFiles', () => {
    it('returns only WU YAML files under docs/04-operations/tasks/wu/', () => {
      const result = filterStagedWUYamlFiles([
        'docs/04-operations/tasks/wu/WU-1164.yaml',
        'docs/04-operations/tasks/wu/WU-9999.yaml',
        'docs/04-operations/tasks/backlog.md',
        'packages/@lumenflow/core/src/wu-schema.ts',
        'docs/04-operations/tasks/wu/WU-1234.yml',
      ]);

      expect(result).toEqual([
        'docs/04-operations/tasks/wu/WU-1164.yaml',
        'docs/04-operations/tasks/wu/WU-9999.yaml',
      ]);
    });
  });

  describe('validateWUYamlString', () => {
    it('passes for a valid WU YAML', async () => {
      const yamlText = [
        'id: WU-9999',
        'title: Test WU',
        "lane: 'Framework: Core'",
        'type: chore',
        'status: ready',
        'priority: P1',
        'created: 2026-01-28',
        'code_paths: []',
        'tests:',
        '  manual: []',
        '  unit: []',
        '  e2e: []',
        'artifacts: []',
        'dependencies: []',
        'risks: []',
        'requires_review: false',
        'assigned_to: tom@example.com',
        'exposure: backend-only',
        'requires_human_escalation: false',
        'requires_cso_approval: false',
        'requires_cto_approval: false',
        'requires_design_approval: false',
        'description: |-',
        '  This is a sufficiently long description that meets minimum length requirements.',
        'acceptance:',
        '  - Must validate',
      ].join('\n');

      const projectRoot = process.cwd();
      const result = await validateWUYamlString(yamlText, projectRoot);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('fails with field-level errors for invalid enum/email', async () => {
      const yamlText = [
        'id: WU-9999',
        'title: Test WU',
        "lane: 'Framework: Core'",
        'type: chore',
        'status: ready',
        'priority: P1',
        'created: 2026-01-28',
        'code_paths: []',
        'tests:',
        '  manual: []',
        '  unit: []',
        '  e2e: []',
        'artifacts: []',
        'dependencies: []',
        'risks: []',
        'requires_review: false',
        'assigned_to: not-an-email',
        'exposure: internal',
        'requires_human_escalation: false',
        'requires_cso_approval: false',
        'requires_cto_approval: false',
        'requires_design_approval: false',
        'description: |-',
        '  This is a sufficiently long description that meets minimum length requirements.',
        'acceptance:',
        '  - Must validate',
      ].join('\n');

      const projectRoot = process.cwd();
      const result = await validateWUYamlString(yamlText, projectRoot);
      expect(result.valid).toBe(false);

      const joined = result.errors.join('\n');
      expect(joined).toContain('assigned_to');
      expect(joined).toContain('exposure');
    });
  });

  describe('LUMENFLOW_FORCE bypass', () => {
    it('exits 0 when LUMENFLOW_FORCE=1', () => {
      const hookPath = join(process.cwd(), '.husky/hooks/pre-commit.mjs');
      const workDir = mkdtempSync(join(tmpdir(), 'lf-wu-1164-'));
      const reason = 'test-bypass';

      try {
        writeFileSync(join(workDir, '.lumenflow.config.yaml'), 'test: true\n');

        execFileSync('node', [hookPath], {
          cwd: workDir,
          env: {
            ...process.env,
            LUMENFLOW_FORCE: '1',
            LUMENFLOW_FORCE_REASON: reason,
          },
          stdio: 'pipe',
        });

        expect(true).toBe(true);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });
  });

  // WU-1589: AC3 - pre-commit should allow branch-pr commits on lane branches from main checkout
  describe('branch-pr mode pre-commit (WU-1589)', () => {
    // The main() function reads claimed_mode from WU YAML and allows 'branch-only' on main checkout.
    // WU-1589 extends this to also allow 'branch-pr'.
    // We test the regex-based YAML parsing that determines claimed_mode
    // by verifying the branch-pr value is recognized alongside branch-only.

    it('should recognize claimed_mode: branch-pr in YAML content regex', () => {
      const yamlContent = [
        'id: WU-1589',
        'title: Test WU',
        'claimed_mode: branch-pr',
        'status: in_progress',
      ].join('\n');

      const modeMatch = yamlContent.match(/^claimed_mode:\s*(.+)$/m);
      expect(modeMatch).not.toBeNull();
      expect(modeMatch![1].trim()).toBe('branch-pr');
    });

    it('should recognize claimed_mode: branch-only in YAML content regex', () => {
      const yamlContent = [
        'id: WU-1589',
        'title: Test WU',
        'claimed_mode: branch-only',
        'status: in_progress',
      ].join('\n');

      const modeMatch = yamlContent.match(/^claimed_mode:\s*(.+)$/m);
      expect(modeMatch).not.toBeNull();
      expect(modeMatch![1].trim()).toBe('branch-only');
    });

    it('should allow branch-pr mode in main-checkout lane-branch decision', () => {
      expect(shouldAllowMainCheckoutLaneCommit('branch-pr')).toBe(true);
    });

    it('should allow branch-only mode in main-checkout lane-branch decision', () => {
      expect(shouldAllowMainCheckoutLaneCommit('branch-only')).toBe(true);
    });

    it('should block worktree mode in main-checkout lane-branch decision', () => {
      expect(shouldAllowMainCheckoutLaneCommit('worktree')).toBe(false);
    });
  });

  describe('formatMainBranchBlockMessage (WU-1357)', () => {
    it('explains WHY main is protected', () => {
      const message = formatMainBranchBlockMessage('main');
      expect(message).toContain('WHY THIS HAPPENS');
      expect(message).toMatch(/track|coordinate|review/i);
    });

    it('provides multiple paths forward', () => {
      const message = formatMainBranchBlockMessage('main');
      // Path 1: Already have a WU
      expect(message).toContain('wu:claim');
      // Path 2: Need to create a WU
      expect(message).toContain('wu:create');
    });

    it('includes help resources', () => {
      const message = formatMainBranchBlockMessage('main');
      expect(message).toMatch(/NEED HELP|LEARN MORE/i);
      expect(message).toContain('LUMENFLOW.md');
    });

    it('suggests workflow-correct recovery instead of LUMENFLOW_FORCE (WU-1485)', () => {
      const message = formatMainBranchBlockMessage('main');

      // Must NOT contain LUMENFLOW_FORCE in error output
      expect(message).not.toContain('LUMENFLOW_FORCE');

      // Must suggest proper workflow commands instead
      expect(message).toMatch(/wu:done|wu:recover/);
    });

    it('uses consistent box characters from constants', () => {
      const message = formatMainBranchBlockMessage('main');
      // Should use box drawing characters for visual structure
      expect(message).toMatch(/[═─┌┐└┘│║╔╗╚╝╠╣]/);
    });

    it('includes the blocked branch name', () => {
      const message = formatMainBranchBlockMessage('main');
      expect(message.toLowerCase()).toContain('main');

      const masterMessage = formatMainBranchBlockMessage('master');
      expect(masterMessage.toLowerCase()).toContain('master');
    });
  });
});
