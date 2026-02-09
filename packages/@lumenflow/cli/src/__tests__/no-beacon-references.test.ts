/**
 * @file no-beacon-references.test.ts
 * Guardrail test: `.beacon` is legacy and must not be referenced in live operational
 * docs/templates/scripts/hooks (WU-1447, WU-1529).
 *
 * This keeps `.lumenflow/` as the single canonical namespace in runtime and agent guidance.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRootFromThisFile(): string {
  // packages/@lumenflow/cli/src/__tests__/no-beacon-references.test.ts -> repo root (../../../../../)
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', '..', '..', '..');
}

describe('no legacy .beacon references in live operational files (WU-1529)', () => {
  it('should not contain .beacon references in active hooks, overlays, templates, and rules', () => {
    const repoRoot = repoRootFromThisFile();

    const files = [
      '.claude/agents/lumenflow-enforcer.md',
      '.claude/agents/lumenflow-doc-sync.md',
      '.claude/skills/context-management/SKILL.md',
      '.claude/skills/execution-memory/SKILL.md',
      '.claude/skills/orchestration/SKILL.md',
      '.lumenflow/constraints.md',
      '.lumenflow/rules/wu-workflow.md',
      '.husky/hooks/pre-commit.mjs',
      '.husky/hooks/commit-msg.mjs',
      '.husky/hooks/pre-push.mjs',
      '.husky/hooks/prepare-commit-msg.mjs',
      'scripts/safe-git',
      'scripts/hooks/check-lockfile.sh',
      'scripts/hooks/scan-secrets.sh',
      'scripts/hooks/validate-paths.sh',
      'scripts/hooks/validate-worktree-discipline.sh',
      'LUMENFLOW.md',
      'packages/@lumenflow/cli/templates/core/LUMENFLOW.md.template',
      'packages/@lumenflow/cli/templates/core/.husky/pre-commit.template',
      'packages/@lumenflow/cli/templates/core/.lumenflow/constraints.md.template',
      'packages/@lumenflow/cli/templates/core/.lumenflow/rules/wu-workflow.md.template',
      'packages/@lumenflow/cli/templates/core/ai/onboarding/agent-safety-card.md.template',
      'packages/@lumenflow/cli/templates/core/ai/onboarding/lumenflow-force-usage.md.template',
      'packages/@lumenflow/cli/templates/vendors/claude/.claude/skills/context-management/SKILL.md.template',
      'packages/@lumenflow/cli/templates/vendors/claude/.claude/skills/execution-memory/SKILL.md.template',
      'packages/@lumenflow/cli/templates/vendors/claude/.claude/skills/orchestration/SKILL.md.template',
      'apps/docs/src/content/docs/guides/agent-onboarding.mdx',
      'apps/docs/src/content/docs/guides/ai-agents.mdx',
      'packages/@lumenflow/agent/README.md',
    ];

    for (const relPath of files) {
      const absPath = path.join(repoRoot, relPath);
      const content = readFileSync(absPath, 'utf-8');
      expect(content, `${relPath} should not reference .beacon`).not.toContain('.beacon');
    }
  });
});
