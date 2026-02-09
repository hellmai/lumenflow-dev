/**
 * @file no-beacon-references-docs.test.ts
 * Guardrail test: public + onboarding docs must not reference legacy `.beacon` paths
 * (WU-1450, WU-1529).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRootFromThisFile(): string {
  // packages/@lumenflow/cli/src/__tests__/no-beacon-references-docs.test.ts -> repo root
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', '..', '..', '..');
}

describe('no legacy .beacon references in docs (WU-1450, WU-1529)', () => {
  it('should not contain .beacon references in onboarding/public docs', () => {
    const repoRoot = repoRootFromThisFile();

    const files = [
      'docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-safety-card.md',
      'docs/04-operations/_frameworks/lumenflow/agent/onboarding/lumenflow-force-usage.md',
      'docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md',
      'CLAUDE.md',
      'apps/docs/src/content/docs/getting-started/upgrade.mdx',
      'apps/docs/src/content/docs/reference/changelog.mdx',
      'apps/docs/src/content/docs/reference/compatibility.mdx',
    ];

    for (const relPath of files) {
      const absPath = path.join(repoRoot, relPath);
      const content = readFileSync(absPath, 'utf-8');
      expect(content, `${relPath} should not reference .beacon`).not.toContain('.beacon');
    }
  });
});
