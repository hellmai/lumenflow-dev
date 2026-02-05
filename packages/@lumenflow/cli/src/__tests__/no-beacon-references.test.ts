/**
 * @file no-beacon-references.test.ts
 * Guardrail test: `.beacon` is legacy and must not be referenced in docs/templates/scripts (WU-1447).
 *
 * This keeps onboarding friction-free by ensuring `.lumenflow/` is the single canonical namespace.
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

describe('no legacy .beacon references (WU-1447)', () => {
  it('should not contain .beacon references in tracked onboarding docs/templates/scripts', () => {
    const repoRoot = repoRootFromThisFile();

    const files = [
      'scripts/safe-git',
      'scripts/hooks/check-lockfile.sh',
      'scripts/hooks/scan-secrets.sh',
      'scripts/hooks/validate-paths.sh',
      'scripts/hooks/validate-worktree-discipline.sh',
      'LUMENFLOW.md',
      'packages/@lumenflow/cli/templates/core/LUMENFLOW.md.template',
      'packages/@lumenflow/cli/templates/core/ai/onboarding/agent-safety-card.md.template',
      'packages/@lumenflow/cli/templates/core/ai/onboarding/lumenflow-force-usage.md.template',
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
