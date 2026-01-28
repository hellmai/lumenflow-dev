import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterStagedWUYamlFiles, validateWUYamlString } from '../pre-commit.mjs';

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
});
