// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-done-docs-only-policy.test.ts
 * Guardrail test: docs-only eligibility checks must not use raw type/exposure string literals (WU-1446).
 *
 * This keeps CLI policy logic DRY and aligned with core constants/helpers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('wu:done docs-only policy (WU-1446)', () => {
  it('should not use raw documentation string comparisons for type/exposure checks', () => {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.join(thisDir, '..', 'wu-done.ts');
    const content = readFileSync(filePath, 'utf-8');

    // These comparisons should use core constants/helpers instead.
    expect(content).not.toContain("exposure === 'documentation'");
    expect(content).not.toContain("type === 'documentation'");
  });
});
