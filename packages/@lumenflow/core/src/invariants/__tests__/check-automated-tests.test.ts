// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file check-automated-tests.test.ts
 * Test suite for INV-AUTOMATED-TESTS-FOR-CODE invariant (WU-2333)
 *
 * TDD: These tests are written BEFORE implementation.
 *
 * Acceptance criteria:
 * - Invariant registry includes INV-AUTOMATED-TESTS-FOR-CODE
 * - Invariant check enforces automated tests for code file changes (config files excluded)
 * - Invariant tests cover pass/fail cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Module under test
import { checkAutomatedTestsInvariant } from '../check-automated-tests.js';

// Also verify registry contains the invariant
import { loadInvariants } from '../../invariants-runner.js';

// WU-2135: Use the centralized WU_DIR constant to avoid path drift
import { DIRECTORIES } from '../../wu-constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../../');
// Use os.tmpdir() for cross-platform temp directory instead of hardcoded /tmp
const TEMP_BASE = path.join(path.resolve('/tmp'), 'lumenflow-test');
// WU-2135: Derive the WU subdirectory from the constant used by the source
const WU_SUBDIR = DIRECTORIES.WU_DIR;

describe('INV-AUTOMATED-TESTS-FOR-CODE invariant (WU-2333)', () => {
  const TEST_DIR = path.join(TEMP_BASE, `invariants-automated-tests-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(path.join(TEST_DIR, WU_SUBDIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('registry', () => {
    it('should include INV-AUTOMATED-TESTS-FOR-CODE in invariants.yml', () => {
      const invariants = loadInvariants(path.join(REPO_ROOT, 'tools/invariants.yml'));
      const automatedTestsInvariant = invariants.find(
        (inv) => inv.id === 'INV-AUTOMATED-TESTS-FOR-CODE',
      );

      expect(automatedTestsInvariant).toBeDefined();
      expect(automatedTestsInvariant.type).toBe('wu-automated-tests');
      expect(automatedTestsInvariant.description).toContain('automated test');
    });
  });

  describe('checkAutomatedTestsInvariant', () => {
    describe('pass cases', () => {
      it('should pass when WU has code files and automated tests', () => {
        const wuYaml = `
id: WU-TEST-001
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/some-module.ts
tests:
  unit:
    - tools/lib/__tests__/some-module.test.ts
  manual: []
  e2e: []
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-001.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      });

      it('should pass when WU has only config files (no automated tests required)', () => {
        const wuYaml = `
id: WU-TEST-002
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - vitest.config.ts
  - eslint.config.mjs
tests:
  unit: []
  manual:
    - Verify config changes work
  e2e: []
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-002.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      });

      it('should pass when WU has only documentation files', () => {
        const wuYaml = `
id: WU-TEST-003
title: Test WU
lane: 'Documentation'
type: documentation
status: in_progress
code_paths:
  - docs/README.md
tests:
  unit: []
  manual:
    - Verify documentation
  e2e: []
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-003.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      });

      it('should pass when WU type is documentation (exempt)', () => {
        const wuYaml = `
id: WU-TEST-004
title: Test WU
lane: 'Core Systems'
type: documentation
status: in_progress
code_paths:
  - tools/lib/some-module.ts
tests:
  unit: []
  manual:
    - Manual check
  e2e: []
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-004.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should pass when WU status is done (do not validate completed WUs)', () => {
        const wuYaml = `
id: WU-TEST-005
title: Test WU
lane: 'Core Systems'
type: feature
status: done
code_paths:
  - tools/lib/some-module.ts
tests:
  unit: []
  manual:
    - Manual check
  e2e: []
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-005.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should pass when WU status is ready (not actively being worked)', () => {
        const wuYaml = `
id: WU-TEST-006
title: Test WU
lane: 'Core Systems'
type: feature
status: ready
code_paths:
  - tools/lib/some-module.ts
tests:
  unit: []
  manual:
    - Manual check
  e2e: []
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-006.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should pass when WU has e2e tests instead of unit tests', () => {
        const wuYaml = `
id: WU-TEST-007
title: Test WU
lane: 'Experience: Web'
type: feature
status: in_progress
code_paths:
  - apps/web/src/components/Button.tsx
tests:
  unit: []
  manual: []
  e2e:
    - apps/web/e2e/button.spec.ts
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-007.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should pass when WU has integration tests', () => {
        const wuYaml = `
id: WU-TEST-008
title: Test WU
lane: 'Core Systems'
type: feature
status: in_progress
code_paths:
  - packages/@lumenflow/core/src/usecases/foo.ts
tests:
  unit: []
  manual: []
  integration:
    - packages/@lumenflow/core/src/__tests__/integration/foo.test.ts
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-008.yaml'), wuYaml);

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });
    });

    describe('fail cases', () => {
      it('should FAIL when WU has code files but only manual tests', () => {
        const wuYaml = `
id: WU-TEST-FAIL-001
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/some-module.ts
tests:
  unit: []
  manual:
    - Manual verification
  e2e: []
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-FAIL-001.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(false);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].id).toBe('INV-AUTOMATED-TESTS-FOR-CODE');
        expect(result.violations[0].wuId).toBe('WU-TEST-FAIL-001');
      });

      it('should FAIL when WU has code files and no tests at all', () => {
        const wuYaml = `
id: WU-TEST-FAIL-002
title: Test WU
lane: 'Experience: Web'
type: feature
status: in_progress
code_paths:
  - apps/web/src/app/page.tsx
tests:
  unit: []
  manual: []
  e2e: []
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-FAIL-002.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(false);
        expect(result.violations[0].wuId).toBe('WU-TEST-FAIL-002');
      });

      it('should FAIL for multiple WUs missing automated tests', () => {
        const wuYaml1 = `
id: WU-TEST-FAIL-003
title: Test WU 1
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/module1.ts
tests:
  manual:
    - Manual check
`;
        const wuYaml2 = `
id: WU-TEST-FAIL-004
title: Test WU 2
lane: 'Core Systems'
type: feature
status: in_progress
code_paths:
  - packages/@lumenflow/core/src/usecase.ts
tests:
  manual:
    - Manual check
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-FAIL-003.yaml'),
          wuYaml1,
        );
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-FAIL-004.yaml'),
          wuYaml2,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(false);
        expect(result.violations).toHaveLength(2);
      });
    });

    describe('config file exclusions', () => {
      it('should exclude vitest.config.ts from requiring automated tests', () => {
        const wuYaml = `
id: WU-TEST-CONFIG-001
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - vitest.config.ts
tests:
  manual:
    - Verify config works
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-CONFIG-001.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should exclude eslint.config.mjs from requiring automated tests', () => {
        const wuYaml = `
id: WU-TEST-CONFIG-002
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - eslint.config.mjs
tests:
  manual:
    - Verify linting works
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-CONFIG-002.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should exclude .prettierrc.js from requiring automated tests', () => {
        const wuYaml = `
id: WU-TEST-CONFIG-003
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - .prettierrc.js
tests:
  manual:
    - Verify formatting works
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-CONFIG-003.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should require tests when mix of config and code files', () => {
        const wuYaml = `
id: WU-TEST-CONFIG-004
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - vitest.config.ts
  - tools/lib/some-module.ts
tests:
  manual:
    - Verify config works
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-CONFIG-004.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        // Should fail because there's also a code file
        expect(result.valid).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle WU with missing code_paths', () => {
        const wuYaml = `
id: WU-TEST-EDGE-001
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
tests:
  manual:
    - Manual check
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-EDGE-001.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        // No code_paths means no code files, so should pass
        expect(result.valid).toBe(true);
      });

      it('should handle WU with empty code_paths array', () => {
        const wuYaml = `
id: WU-TEST-EDGE-002
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths: []
tests:
  manual:
    - Manual check
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-EDGE-002.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        expect(result.valid).toBe(true);
      });

      it('should handle WU with missing tests object', () => {
        const wuYaml = `
id: WU-TEST-EDGE-003
title: Test WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/some-module.ts
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-TEST-EDGE-003.yaml'),
          wuYaml,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        // Has code file but no tests = fail
        expect(result.valid).toBe(false);
      });

      it('should not crash on invalid YAML', () => {
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-INVALID.yaml'),
          'not: valid: yaml: :::',
        );

        // Should not throw, just skip invalid files

        expect(() => checkAutomatedTestsInvariant({ baseDir: TEST_DIR })).not.toThrow();
      });

      it('should only check in_progress and blocked WUs', () => {
        // done WU - should skip
        const doneWu = `
id: WU-DONE
status: done
code_paths:
  - tools/lib/some-module.ts
tests:
  manual:
    - Manual
`;
        // ready WU - should skip
        const readyWu = `
id: WU-READY
status: ready
code_paths:
  - tools/lib/some-module.ts
tests:
  manual:
    - Manual
`;
        // blocked WU - should check
        const blockedWu = `
id: WU-BLOCKED
status: blocked
code_paths:
  - tools/lib/some-module.ts
tests:
  manual:
    - Manual
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-DONE.yaml'), doneWu);
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-READY.yaml'), readyWu);
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-BLOCKED.yaml'),
          blockedWu,
        );

        const result = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });

        // Only blocked WU should be flagged
        expect(result.valid).toBe(false);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].wuId).toBe('WU-BLOCKED');
      });
    });

    /**
     * WU-2425: Scoped validation via wuId parameter
     *
     * When wu:done runs, it should only validate the completing WU,
     * not all active WUs in the backlog. This prevents unrelated WUs
     * from blocking completion.
     */
    describe('scoped validation (wuId parameter) - WU-2425', () => {
      it('should only validate specified WU when wuId option is provided', () => {
        // WU with code files and proper tests (valid)
        const validWu = `
id: WU-VALID-001
title: Valid WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/valid-module.ts
tests:
  unit:
    - tools/lib/__tests__/valid-module.test.ts
`;
        // Another WU missing automated tests (would fail without scoping)
        const invalidWu = `
id: WU-INVALID-001
title: Invalid WU
lane: 'Core Systems'
type: feature
status: in_progress
code_paths:
  - packages/@lumenflow/core/src/usecase.ts
tests:
  manual:
    - Manual check
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-VALID-001.yaml'),
          validWu,
        );
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-INVALID-001.yaml'),
          invalidWu,
        );

        // Without wuId, would fail due to WU-INVALID-001
        const resultAll = checkAutomatedTestsInvariant({ baseDir: TEST_DIR });
        expect(resultAll.valid).toBe(false);
        expect(resultAll.violations).toHaveLength(1);
        expect(resultAll.violations[0].wuId).toBe('WU-INVALID-001');

        // With wuId=WU-VALID-001, should pass (only validates that WU)
        const resultScoped = checkAutomatedTestsInvariant({
          baseDir: TEST_DIR,
          wuId: 'WU-VALID-001',
        });
        expect(resultScoped.valid).toBe(true);
        expect(resultScoped.violations).toHaveLength(0);
      });

      it('should fail when scoped WU is invalid', () => {
        const invalidWu = `
id: WU-SCOPED-FAIL
title: Scoped WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/some-module.ts
tests:
  manual:
    - Manual only
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-SCOPED-FAIL.yaml'),
          invalidWu,
        );

        const result = checkAutomatedTestsInvariant({
          baseDir: TEST_DIR,
          wuId: 'WU-SCOPED-FAIL',
        });

        expect(result.valid).toBe(false);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].wuId).toBe('WU-SCOPED-FAIL');
      });

      it('should pass when scoped WU does not exist (graceful handling)', () => {
        // Create an unrelated WU that would fail validation
        const invalidWu = `
id: WU-OTHER
title: Other WU
lane: 'Operations: Tooling'
type: feature
status: in_progress
code_paths:
  - tools/lib/some-module.ts
tests:
  manual:
    - Manual only
`;
        writeFileSync(path.join(TEST_DIR, WU_SUBDIR, 'WU-OTHER.yaml'), invalidWu);

        // Request validation for non-existent WU
        const result = checkAutomatedTestsInvariant({
          baseDir: TEST_DIR,
          wuId: 'WU-NONEXISTENT',
        });

        // Should pass - no violations for the scoped WU (it doesn't exist)
        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      });

      it('should skip status check when wuId is provided (validates regardless of status)', () => {
        // A WU with done status but scoped explicitly
        const doneWu = `
id: WU-DONE-SCOPED
title: Done WU
lane: 'Operations: Tooling'
type: feature
status: done
code_paths:
  - tools/lib/some-module.ts
tests:
  manual:
    - Manual only
`;
        writeFileSync(
          path.join(TEST_DIR, WU_SUBDIR, 'WU-DONE-SCOPED.yaml'),
          doneWu,
        );

        // When explicitly scoped, status should not matter - validate anyway
        // (wu:done sets status to done before validation, so we need to check)
        const result = checkAutomatedTestsInvariant({
          baseDir: TEST_DIR,
          wuId: 'WU-DONE-SCOPED',
        });

        // Should fail because we're explicitly validating this WU
        expect(result.valid).toBe(false);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].wuId).toBe('WU-DONE-SCOPED');
      });
    });
  });
});
